import { useEffect, useMemo, useRef, useState } from "react";
import { useGetCandidate, useListCandidateHistory, useListCandidateNotes } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Link, useRoute } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewThreadPanel } from "@/components/review-thread-panel";
import { Loader2, ArrowLeft, FileText, Upload, Save, Undo2, Clock3, AlertTriangle, MessageSquare, Tag } from "lucide-react";
import { validateResumeFile } from "@/lib/utils";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import { useQueryClient } from "@tanstack/react-query";
import { parseResumeFileWithFallback, type ParsedCandidateProfile } from "@/lib/resume-parse";
import { uploadResumeFile } from "@/lib/resume-upload";
import { formatTurkishLira, parseCandidateTags } from "@/lib/candidate-display";
import { PrivateObjectLink } from "@/components/private-object-link";

const EDITABLE_STATUSES = new Set(["submitted", "screening", "pending_approval"]);

export default function VendorCandidateDetail() {
  const [, params] = useRoute("/vendor/candidates/:id");
  const candidateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: history = [], isLoading: historyLoading } = useListCandidateHistory(candidateId);
  const { data: notes = [], isLoading: notesLoading } = useListCandidateNotes(candidateId);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    expectedSalary: "",
    tags: "",
    currentTitle: "",
    location: "",
    summary: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedProfile, setParsedProfile] = useState<ParsedCandidateProfile | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    if (!candidate) return;
    setFormData({
      firstName: candidate.firstName ?? "",
      lastName: candidate.lastName ?? "",
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      expectedSalary: candidate.expectedSalary != null ? String(candidate.expectedSalary) : "",
      tags: candidate.tags ?? "",
      currentTitle: candidate.currentTitle ?? "",
      location: candidate.location ?? "",
      summary: candidate.summary ?? "",
    });
  }, [candidate]);

  const canEdit = candidate ? EDITABLE_STATUSES.has(candidate.status) : false;
  const { visibleTags, englishLevel } = useMemo(() => parseCandidateTags(candidate?.tags), [candidate?.tags]);
  const parsedSkills = candidate?.parsedSkills?.length ? candidate.parsedSkills : visibleTags;
  const expectedSalaryLabel = formatTurkishLira(candidate?.expectedSalary);

  const handleResumeSelection = async (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const fileError = validateResumeFile(file);
    if (fileError) {
      toast({ title: "Invalid CV file", description: fileError, variant: "destructive" });
      if (fileRef.current) fileRef.current.value = "";
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setParsing(true);
    setParseProgress("Reading resume and preparing normalized profile…");

    try {
      const token = localStorage.getItem("ats_token");
      const parsed = await parseResumeFileWithFallback({
        file,
        token,
        onProgress: setParseProgress,
      });
      setParsedProfile(parsed);
      setFormData((current) => ({
        ...current,
        firstName: parsed.firstName || current.firstName,
        lastName: parsed.lastName || current.lastName,
        email: parsed.email || current.email,
        phone: parsed.phone || current.phone,
        expectedSalary: parsed.expectedSalary ? String(parsed.expectedSalary) : current.expectedSalary,
        tags: parsed.skills || current.tags,
        currentTitle: parsed.currentTitle || current.currentTitle,
        location: parsed.location || current.location,
        summary: parsed.summary || current.summary,
      }));
      toast({
        title: parsed.parseReviewRequired ? "Resume parsed with review suggested" : "Resume parsed successfully",
        description:
          parsed.warnings?.[0] ||
          "Candidate fields were updated from the newly uploaded resume.",
      });
    } catch (error) {
      toast({
        title: "Resume parsing error",
        description: error instanceof Error ? error.message : "Unknown parsing error",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
      setParseProgress("");
    }
  };

  const handleSave = async () => {
    if (!candidate) return;
    if (!canEdit) {
      toast({
        title: "Candidate can no longer be edited",
        description: "Only submitted, screening, or pending approval candidates can be edited by the vendor.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.email.trim()) {
      toast({
        title: "Candidate identity is incomplete",
        description: "First name, last name, and email must be filled in before saving.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.phone.trim()) {
      toast({
        title: "Phone number is required",
        description: "Please keep the contact phone number filled in before saving.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.expectedSalary.trim()) {
      toast({
        title: "Expected salary is required",
        description: "Please keep the expected monthly salary in TL filled in before saving.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("ats_token");
      let nextCvUrl: string | undefined;

      if (selectedFile) {
        nextCvUrl = await uploadResumeFile(selectedFile, { token, maxAttempts: 3 });
      }

      const response = await fetch(`/api/candidates/${candidateId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim() || null,
          expectedSalary: formData.expectedSalary ? Number(formData.expectedSalary) : null,
          tags: formData.tags.trim() || null,
          currentTitle: formData.currentTitle.trim() || null,
          location: formData.location.trim() || null,
          summary: formData.summary.trim() || null,
          cvUrl: nextCvUrl ?? undefined,
          originalCvFileName: selectedFile?.name,
          originalCvMimeType: selectedFile?.type || undefined,
          parseStatus: parsedProfile?.parseStatus,
          parseConfidence: parsedProfile?.parseConfidence ?? undefined,
          parseReviewRequired: parsedProfile?.parseReviewRequired ?? undefined,
          parseProvider: parsedProfile?.parseProvider || undefined,
          standardizedProfile: parsedProfile?.standardizedProfile || undefined,
          executiveHeadline: parsedProfile?.executiveHeadline || undefined,
          professionalSnapshot: parsedProfile?.professionalSnapshot || undefined,
          domainFocus: parsedProfile?.domainFocus?.length ? parsedProfile.domainFocus : undefined,
          senioritySignal: parsedProfile?.senioritySignal || undefined,
          candidateStrengths: parsedProfile?.candidateStrengths?.length ? parsedProfile.candidateStrengths : undefined,
          candidateRisks: parsedProfile?.candidateRisks?.length ? parsedProfile.candidateRisks : undefined,
          notableAchievements: parsedProfile?.notableAchievements?.length ? parsedProfile.notableAchievements : undefined,
          inferredWorkModel: parsedProfile?.inferredWorkModel || undefined,
          locationFlexibility: parsedProfile?.locationFlexibility || undefined,
          salarySignal: parsedProfile?.salarySignal || undefined,
          languageItems: parsedProfile?.languageItems?.length ? parsedProfile.languageItems : undefined,
          fieldConfidence: parsedProfile?.fieldConfidence ?? undefined,
          evidence: parsedProfile?.evidence?.length ? parsedProfile.evidence : undefined,
          education: parsedProfile?.education || undefined,
          languages: parsedProfile?.languages || undefined,
          yearsExperience: parsedProfile?.yearsExperience ?? undefined,
          parsedSkills: parsedProfile?.parsedSkills?.length ? parsedProfile.parsedSkills : undefined,
          parsedExperience: parsedProfile?.parsedExperience?.length ? parsedProfile.parsedExperience : undefined,
          parsedEducation: parsedProfile?.parsedEducation?.length ? parsedProfile.parsedEducation : undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Candidate could not be updated");
      }

      const updatedCandidate = await response.json();
      syncCandidateAcrossCaches(queryClient, updatedCandidate);
      await invalidateCandidateQueries(queryClient, candidateId);
      setSelectedFile(null);
      setParsedProfile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "Candidate updated successfully" });
    } catch (error) {
      toast({
        title: "Candidate update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async () => {
    if (!candidate) return;
    if (!canEdit) {
      toast({
        title: "Candidate can no longer be withdrawn",
        description: "Only submitted, screening, or pending approval candidates can be withdrawn by the vendor.",
        variant: "destructive",
      });
      return;
    }

    const confirmed = window.confirm("Withdraw this candidate submission? The client will no longer see it.");
    if (!confirmed) return;

    setWithdrawing(true);
    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch(`/api/candidates/${candidateId}/withdraw`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Withdrawn by vendor" }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Candidate could not be withdrawn");
      }

      const updatedCandidate = await response.json();
      syncCandidateAcrossCaches(queryClient, updatedCandidate);
      await invalidateCandidateQueries(queryClient, candidateId);
      toast({ title: "Candidate withdrawn" });
    } catch (error) {
      toast({
        title: "Withdraw failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout allowedRoles={["vendor"]}>
        <div className="flex justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!candidate) {
    return (
      <DashboardLayout allowedRoles={["vendor"]}>
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500">
          Candidate not found.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href="/vendor/candidates"
          className="inline-flex items-center text-sm font-medium text-slate-500 transition-colors hover:text-primary"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to My Candidates
        </Link>

        <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-lg shadow-black/5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-bold text-slate-900">
                      {candidate.firstName} {candidate.lastName}
                    </h1>
                    <StatusBadge status={candidate.status} />
                  </div>
                  <p className="mt-2 text-slate-500">{candidate.email}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
                    {candidate.currentTitle ? <span>{candidate.currentTitle}</span> : null}
                    {candidate.location ? <span>{candidate.location}</span> : null}
                    {candidate.yearsExperience != null ? <span>{candidate.yearsExperience} years experience</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {candidate.cvUrl ? (
                    <PrivateObjectLink
                      objectPath={candidate.cvUrl}
                      className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-xl gap-2" })}
                    >
                      <FileText className="h-4 w-4" /> View Original CV
                    </PrivateObjectLink>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Role", value: candidate.roleTitle },
                  { label: "Company", value: candidate.vendorCompanyName },
                  { label: "Phone", value: candidate.phone || "Not provided" },
                  { label: "Expected Salary", value: expectedSalaryLabel },
                  { label: "English level", value: englishLevel || "Not provided" },
                  { label: "Submitted", value: new Date(candidate.submittedAt).toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

              {parsedSkills.length > 0 ? (
                <div className="mt-6">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Tag className="h-4 w-4 text-primary" /> Skills
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {parsedSkills.map((tag, index) => (
                      <span key={`${tag}-${index}`} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-lg shadow-black/5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Vendor Controls</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Update candidate details or replace the CV before the submission moves too far in the pipeline.
                  </p>
                </div>
                {!canEdit ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Read-only once the pipeline moves beyond approval
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">First Name</label>
                  <Input required value={formData.firstName} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, firstName: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Last Name</label>
                  <Input required value={formData.lastName} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, lastName: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Email</label>
                  <Input required type="email" value={formData.email} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, email: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Phone</label>
                  <Input required value={formData.phone} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, phone: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Expected Salary (TL)</label>
                  <Input required min="1" type="number" value={formData.expectedSalary} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, expectedSalary: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Current Title</label>
                  <Input value={formData.currentTitle} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, currentTitle: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Location</label>
                  <Input value={formData.location} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, location: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Tags / Skills</label>
                  <Input value={formData.tags} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, tags: e.target.value }))} className="h-11 rounded-xl" />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <label className="text-sm font-semibold">Summary</label>
                <Textarea value={formData.summary} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, summary: e.target.value }))} rows={4} className="rounded-xl resize-none" />
              </div>

              <div className="mt-4 space-y-2">
                <label className="text-sm font-semibold">Replace CV</label>
                <div
                  className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${canEdit ? "cursor-pointer border-slate-200 hover:border-primary/50 hover:bg-primary/5" : "border-slate-100 bg-slate-50 text-slate-400"}`}
                  onClick={() => canEdit && fileRef.current?.click()}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => void handleResumeSelection(e.target.files?.[0] || null)}
                    disabled={!canEdit}
                  />
                  {selectedFile ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                        <FileText className="h-4 w-4" /> {selectedFile.name}
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
                        {parsing ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {parseProgress || "Reading resume and preparing normalized profile…"}
                          </>
                        ) : (
                          <>
                            <Upload className="h-3 w-3" />
                            New resume ready to save
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">
                      <Upload className="mx-auto mb-1 h-5 w-5" />
                      Upload a replacement PDF, DOCX, or image resume
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!canEdit || parsing || saving || withdrawing}
                  className="rounded-xl gap-2"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  disabled={!canEdit || saving || withdrawing}
                  onClick={handleWithdraw}
                >
                  {withdrawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  Withdraw Candidate
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Clock3 className="h-4 w-4 text-slate-400" />
                Submission History
              </div>
              <div className="mt-4 space-y-3">
                {historyLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No history has been recorded yet.
                  </div>
                ) : (
                  history.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-100 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">
                          {(entry.previousStatus ?? "new").replace(/_/g, " ")} → {entry.nextStatus.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{entry.changedByName}</div>
                      {entry.reason ? <div className="mt-2 text-sm text-slate-600">{entry.reason}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <MessageSquare className="h-4 w-4 text-primary" />
                Shared Notes
              </div>
              <p className="mt-2 text-sm text-slate-500">
                These notes are visible to the shared review team and remain read-only from the vendor side.
              </p>
              <div className="mt-4 space-y-3">
                {notesLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : notes.length ? (
                  notes.map((note) => (
                    <div key={note.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">{note.authorName}</p>
                        <p className="text-xs text-slate-400">{new Date(note.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No shared notes yet.</div>
                )}
              </div>
            </div>

            <ReviewThreadPanel
              scopeType="candidate"
              scopeId={candidate.id}
              actorRole="vendor"
              title="Candidate thread"
              description="Track candidate-specific follow-up and review feedback in a scoped thread that stays attached to this submission."
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
