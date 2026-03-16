import { useEffect, useMemo, useRef, useState } from "react";
import { useGetCandidate, useListCandidateHistory } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Link, useRoute } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { Loader2, ArrowLeft, FileText, Upload, Sparkles, Save, Undo2, Clock3, AlertTriangle } from "lucide-react";
import { getPrivateObjectUrl, validateResumeFile } from "@/lib/utils";
import { exportStandardizedCandidatePdf } from "@/lib/standardized-cv";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import { useQueryClient } from "@tanstack/react-query";
import { parseResumeFileWithFallback, type ParsedCandidateProfile } from "@/lib/resume-parse";
import { uploadResumeFile } from "@/lib/resume-upload";

function cleanSnapshotText(value?: string | null) {
  if (!value) return null;
  const normalized = value
    .replace(/\b(?:null|undefined)\b/gi, "")
    .replace(/\s*\|\s*\|+/g, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!normalized || /^(not found|n\/a)$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

const EDITABLE_STATUSES = new Set(["submitted", "screening"]);

export default function VendorCandidateDetail() {
  const [, params] = useRoute("/vendor/candidates/:id");
  const candidateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: history = [], isLoading: historyLoading } = useListCandidateHistory(candidateId);

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
  const snapshotSource = parsedProfile ?? candidate ?? null;

  const snapshotFields = useMemo(() => {
    if (!snapshotSource) return [];
    return [
      { label: "Current Title", value: cleanSnapshotText(snapshotSource.currentTitle) },
      { label: "Location", value: cleanSnapshotText(snapshotSource.location) },
      {
        label: "Experience",
        value:
          snapshotSource.yearsExperience != null
            ? `${snapshotSource.yearsExperience} years`
            : null,
      },
      { label: "Languages", value: cleanSnapshotText(snapshotSource.languages) },
    ].filter((field): field is { label: string; value: string } => Boolean(field.value));
  }, [snapshotSource]);

  const snapshotEducation = cleanSnapshotText(snapshotSource?.education);
  const snapshotSummary = cleanSnapshotText(snapshotSource?.summary);
  const snapshotProfile = cleanSnapshotText(snapshotSource?.standardizedProfile);

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
        description: "Only submitted or screening candidates can be edited by the vendor.",
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
        description: "Only submitted or screening candidates can be withdrawn by the vendor.",
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
                    <Button asChild variant="outline" size="sm" className="rounded-xl gap-2">
                      <a href={getPrivateObjectUrl(candidate.cvUrl) ?? "#"} target="_blank" rel="noreferrer">
                        <FileText className="h-4 w-4" /> View Original CV
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-2"
                    onClick={() => exportStandardizedCandidatePdf(candidate)}
                  >
                    <Sparkles className="h-4 w-4" /> Export Standardized CV
                  </Button>
                </div>
              </div>
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
                    Read-only once the pipeline moves beyond screening
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">First Name</label>
                  <Input value={formData.firstName} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, firstName: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Last Name</label>
                  <Input value={formData.lastName} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, lastName: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Email</label>
                  <Input type="email" value={formData.email} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, email: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Phone</label>
                  <Input value={formData.phone} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, phone: e.target.value }))} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Expected Salary ($)</label>
                  <Input type="number" value={formData.expectedSalary} disabled={!canEdit || saving} onChange={(e) => setFormData((current) => ({ ...current, expectedSalary: e.target.value }))} className="h-11 rounded-xl" />
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
            {snapshotSource ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <Sparkles className="h-4 w-4" />
                  Standardized CV Snapshot
                </div>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
                  Parse quality {snapshotSource.parseConfidence ?? 0}% • {snapshotSource.parseReviewRequired ? "Review suggested" : "Ready"}
                </div>
                {snapshotFields.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {snapshotFields.map((field) => (
                      <div key={field.label} className="rounded-xl bg-white/80 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{field.label}</div>
                        <div className="mt-1 text-sm text-slate-800">{field.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {snapshotEducation ? (
                  <div className="mt-3 rounded-xl bg-white/80 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Education</div>
                    <div className="mt-1 text-sm text-slate-800">{snapshotEducation}</div>
                  </div>
                ) : null}
                {snapshotSummary ? (
                  <div className="mt-3 rounded-xl bg-white/80 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</div>
                    <div className="mt-1 text-sm text-slate-800">{snapshotSummary}</div>
                  </div>
                ) : null}
                {snapshotProfile ? (
                  <div className="mt-3 rounded-xl bg-white/80 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standardized Profile</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">{snapshotProfile}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}

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
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
