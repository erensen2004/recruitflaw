import { useState, useRef } from "react";
import { useListCandidates, useSubmitCandidate, useListRoles } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCircle, Loader2, Plus, FileText, Upload, Tag, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency, getPrivateObjectUrl, validateResumeFile } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListCandidatesQueryKey } from "@workspace/api-client-react";
import { getErrorMessage, parseResumeFileWithFallback, type ParsedCandidateProfile } from "@/lib/resume-parse";

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

export default function VendorCandidates() {
  const { data: candidates, isLoading } = useListCandidates();
  const { data: roles } = useListRoles();
  const [isOpen, setIsOpen] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [tags, setTags] = useState("");
  const [parsedProfile, setParsedProfile] = useState<ParsedCandidateProfile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const snapshotFields = parsedProfile
    ? [
        { label: "Current Title", value: cleanSnapshotText(parsedProfile.currentTitle) },
        { label: "Location", value: cleanSnapshotText(parsedProfile.location) },
        {
          label: "Experience",
          value: parsedProfile.yearsExperience != null ? `${parsedProfile.yearsExperience} years` : null,
        },
        { label: "Languages", value: cleanSnapshotText(parsedProfile.languages) },
      ].filter((field): field is { label: string; value: string } => Boolean(field.value))
    : [];
  const snapshotEducation = cleanSnapshotText(parsedProfile?.education);
  const snapshotSummary = cleanSnapshotText(parsedProfile?.summary);
  const snapshotProfile = cleanSnapshotText(parsedProfile?.standardizedProfile);

  const publishedRoles = roles?.filter(r => r.status === "published") || [];
  const [formData, setFormData] = useState({
    firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", roleId: ""
  });
  const resetForm = () => {
    setFormData({ firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", roleId: "" });
    setTags("");
    setCvFile(null);
    setParsedProfile(null);
    setParsing(false);
    setParseProgress("");
    setUploading(false);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const { mutate: submit, isPending } = useSubmitCandidate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        setIsOpen(false);
        resetForm();
        toast({ title: "Candidate submitted successfully!" });
      },
      onError: (err: any) => {
        toast({
          title: "Submission failed",
          description: err?.message || "This candidate may already be submitted for this role.",
          variant: "destructive"
        });
      }
    }
  });

  const uploadCv = async (file: File): Promise<string | null> => {
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) {
        throw new Error(await getErrorMessage(res));
      }

      const { uploadURL, objectPath } = await res.json();
      const uploadHeaders: Record<string, string> = { "Content-Type": file.type };
      if (token && uploadURL.startsWith("/api/")) {
        uploadHeaders.Authorization = `Bearer ${token}`;
      }
      const uploadRes = await fetch(uploadURL, { method: "PUT", headers: uploadHeaders, body: file });
      if (!uploadRes.ok) {
        throw new Error("File upload failed");
      }

      const confirmRes = await fetch("/api/storage/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectPath }),
      });
      if (!confirmRes.ok) {
        throw new Error(await getErrorMessage(confirmRes));
      }

      return objectPath;
    } catch (error) {
      toast({
        title: "CV upload failed",
        description: error instanceof Error ? error.message : "Unknown upload error",
        variant: "destructive",
      });
      return null;
    }
  };

  const parsePdfCv = async (file: File): Promise<void> => {
    const validationError = validateResumeFile(file);
    if (validationError) {
      toast({ title: "Invalid CV file", description: validationError, variant: "destructive" });
      return;
    }

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
      setFormData(prev => ({
        ...prev,
        firstName: parsed.firstName || prev.firstName,
        lastName: parsed.lastName || prev.lastName,
        email: parsed.email || prev.email,
        phone: parsed.phone || prev.phone,
        expectedSalary: parsed.expectedSalary ? String(parsed.expectedSalary) : prev.expectedSalary,
      }));
      if (parsed.skills) {
        setTags(parsed.skills);
      }
      toast({
        title: parsed.parseReviewRequired ? "Resume parsed with review suggested" : "Resume parsed successfully",
        description:
          parsed.warnings?.[0] ||
          "Candidate fields were auto-filled and normalized from the uploaded resume.",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsing) {
      toast({
        title: "Please wait for parsing",
        description: "We are still extracting data from the uploaded CV.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.roleId) {
      toast({ title: "Please select a position", variant: "destructive" });
      return;
    }

    setUploading(true);
    let cvUrl: string | undefined;
    if (cvFile) {
      const objectPath = await uploadCv(cvFile);
      if (!objectPath) {
        setUploading(false);
        return;
      }
      cvUrl = objectPath;
    }
    setUploading(false);
    submit({
      data: {
        ...formData,
        email: formData.email.trim().toLowerCase(),
        roleId: Number(formData.roleId),
        expectedSalary: formData.expectedSalary ? Number(formData.expectedSalary) : undefined,
        cvUrl,
        originalCvFileName: cvFile?.name,
        originalCvMimeType: cvFile?.type || undefined,
        tags: tags || parsedProfile?.parsedSkills?.join(", ") || undefined,
        currentTitle: parsedProfile?.currentTitle || undefined,
        location: parsedProfile?.location || undefined,
        yearsExperience: parsedProfile?.yearsExperience ?? undefined,
        education: parsedProfile?.education || undefined,
        languages: parsedProfile?.languages || undefined,
        summary: parsedProfile?.summary || undefined,
        standardizedProfile: parsedProfile?.standardizedProfile || undefined,
        parseStatus: parsedProfile?.parseStatus || undefined,
        parseConfidence: parsedProfile?.parseConfidence ?? undefined,
        parseReviewRequired: parsedProfile?.parseReviewRequired ?? undefined,
        parseProvider: parsedProfile?.parseProvider || undefined,
        parsedSkills: parsedProfile?.parsedSkills?.length ? parsedProfile.parsedSkills : undefined,
        parsedExperience: parsedProfile?.parsedExperience?.length ? parsedProfile.parsedExperience : undefined,
        parsedEducation: parsedProfile?.parsedEducation?.length ? parsedProfile.parsedEducation : undefined,
      }
    });
  };

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}
      >
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">My Candidates</h1>
            <p className="mt-1 text-slate-500">Track the pipeline status of candidates you submitted</p>
          </div>
          <DialogTrigger asChild>
            <Button className="h-11 rounded-xl px-6 shadow-md hover-elevate active-elevate-2">
              <Plus className="mr-2 h-4 w-4" />
              Add Candidate
            </Button>
          </DialogTrigger>
        </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role Applied</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Salary Req.</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">CV</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : candidates?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center">
                    <UserCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium">No candidates yet</p>
                    <p className="text-sm text-slate-400 mt-1">Click &quot;Add Candidate&quot; to submit your first candidate and start tracking their pipeline.</p>
                  </td>
                </tr>
              ) : candidates?.map(c => {
                const splitTags = c.tags ? c.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
                return (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0 text-orange-600">
                          <UserCircle className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                          <div className="text-sm text-slate-500">{c.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">{c.roleTitle}</td>
                    <td className="px-6 py-4">
                      {splitTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {splitTags.slice(0, 2).map((tag, i) => (
                            <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                          {splitTags.length > 2 && <span className="text-xs text-slate-400">+{splitTags.length - 2}</span>}
                        </div>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{c.expectedSalary ? formatCurrency(c.expectedSalary) : "-"}</td>
                    <td className="px-6 py-4">
                      {c.cvUrl ? (
                        <a
                          href={getPrivateObjectUrl(c.cvUrl) ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-all hover:text-primary/80 hover:underline active:scale-[0.98]"
                        >
                          <FileText className="w-4 h-4" /> View CV
                        </a>
                      ) : (
                        <span className="text-slate-400 text-sm">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                    <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(c.submittedAt), "MMM d, yyyy")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

        <DialogContent className="sm:max-w-xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Candidate</DialogTitle>
            <DialogDescription>
              Select an open position, upload the candidate's resume, and review the normalized fields before submitting.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Open Position</label>
              <Select required value={formData.roleId} onValueChange={v => setFormData({ ...formData, roleId: v })} disabled={publishedRoles.length === 0}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Select a position" />
                </SelectTrigger>
                <SelectContent>
                  {publishedRoles.length === 0 ? (
                    <SelectItem value="none" disabled>No open positions available</SelectItem>
                  ) : publishedRoles.map(r => (
                    <SelectItem key={r.id} value={r.id.toString()}>{r.title} - {r.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">First Name</label>
                <Input required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Last Name</label>
                <Input required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="h-11 rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Email Address</label>
              <Input type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="h-11 rounded-xl" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Phone</label>
                <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Expected Salary ($)</label>
                <Input type="number" value={formData.expectedSalary} onChange={e => setFormData({ ...formData, expectedSalary: e.target.value })} className="h-11 rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold flex items-center gap-2">
                <Tag className="w-4 h-4 text-slate-400" />
                Tags / Skills
              </label>
              <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="React, TypeScript, Node.js" className="h-11 rounded-xl" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">CV / Resume</label>
              <div
                className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0] || null;
                    if (!file) {
                      setCvFile(null);
                      return;
                    }

                    const fileError = validateResumeFile(file);
                    if (fileError) {
                      toast({ title: "Invalid CV file", description: fileError, variant: "destructive" });
                      if (fileRef.current) {
                        fileRef.current.value = "";
                      }
                      setCvFile(null);
                      return;
                    }

                    setCvFile(file);
                    await parsePdfCv(file);
                  }}
                />
                {cvFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                      <FileText className="w-4 h-4" /> {cvFile.name}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
                      {parsing ? <><Loader2 className="w-3 h-3 animate-spin" />{parseProgress || "Reading resume and preparing normalized profile…"}</> : <><Sparkles className="w-3 h-3" />Resume uploaded. Candidate fields will be normalized automatically.</>}
                    </div>
                    {parsedProfile?.parseReviewRequired ? (
                      <div className="text-xs text-amber-700">
                        Some fields may need review, but you can still submit the candidate.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm">
                    <Upload className="w-5 h-5 mx-auto mb-1" />
                    Click to upload PDF, DOCX, or image resume and auto-fill candidate fields
                  </div>
                )}
              </div>
            </div>

            {parsedProfile && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <Sparkles className="w-4 h-4" />
                  Standardized CV Snapshot
                </div>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
                  Parse quality {parsedProfile.parseConfidence ?? 0}% • {parsedProfile.parseReviewRequired ? "Review suggested" : "Ready"}
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
                ) : (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Contact details were extracted, but some resume sections still need review.
                  </div>
                )}
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
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">
                      {snapshotProfile}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="flex-1 h-11 rounded-xl hover-elevate active-elevate-2">Cancel</Button>
              <Button type="submit" disabled={parsing || isPending || uploading} className="flex-1 h-11 rounded-xl hover-elevate active-elevate-2">
                {(parsing || isPending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Candidate"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
