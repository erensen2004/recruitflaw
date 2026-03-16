import { useState, useRef } from "react";
import { useSubmitCandidate, useGetRole } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowLeft, Send, FileText, Upload, Sparkles, Tag } from "lucide-react";
import { useRoute, Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { validateResumeFile } from "@/lib/utils";
import { getErrorMessage, parseResumeFileWithFallback, parseResumeText, type ParsedCandidateProfile } from "@/lib/resume-parse";

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

export default function VendorSubmitCandidate() {
  const [, params] = useRoute("/vendor/submit/:roleId");
  const roleId = Number(params?.roleId);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: role, isLoading: roleLoading } = useGetRole(roleId);
  const [formData, setFormData] = useState({
    firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", tags: ""
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cvText, setCvText] = useState("");
  const [showCvParse, setShowCvParse] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [parsedProfile, setParsedProfile] = useState<ParsedCandidateProfile | null>(null);

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

  const { mutate: submit, isPending } = useSubmitCandidate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Candidate submitted successfully!" });
        setLocation("/vendor/candidates");
      },
      onError: (err: any) => {
        toast({
          title: "Submission failed",
          description: err?.message || "This candidate might already be submitted for this role.",
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

  const applyParsedProfile = (parsed: ParsedCandidateProfile) => {
    setParsedProfile(parsed);
    setFormData((prev) => ({
      ...prev,
      firstName: parsed.firstName || prev.firstName,
      lastName: parsed.lastName || prev.lastName,
      email: parsed.email || prev.email,
      phone: parsed.phone || prev.phone,
      expectedSalary: parsed.expectedSalary ? String(parsed.expectedSalary) : prev.expectedSalary,
      tags: parsed.skills || prev.tags,
    }));
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
      applyParsedProfile(parsed);
      toast({
        title: parsed.parseReviewRequired ? "Resume parsed with review suggested" : "Resume parsed successfully",
        description:
          parsed.warnings?.[0] ||
          "We auto-filled the candidate fields from the uploaded resume.",
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

  const handleParseCV = async () => {
    if (!cvText.trim()) {
      toast({ title: "Please paste CV text first", variant: "destructive" });
      return;
    }

    setParsing(true);
    setParseProgress("Normalizing pasted resume text…");
    try {
      const token = localStorage.getItem("ats_token");
      const parsed = await parseResumeText(token, cvText);
      applyParsedProfile(parsed);
      toast({ title: "CV parsed successfully!", description: "Fields pre-filled from CV." });
      setShowCvParse(false);
    } catch (error) {
      toast({
        title: "CV parsing error",
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
        expectedSalary: formData.expectedSalary ? Number(formData.expectedSalary) : undefined,
        roleId,
        cvUrl,
        originalCvFileName: cvFile?.name,
        originalCvMimeType: cvFile?.type || undefined,
        tags: formData.tags || parsedProfile?.parsedSkills?.join(", ") || undefined,
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
      <div className="max-w-2xl mx-auto">
        <Link href="/vendor/positions" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Positions
        </Link>

        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Submit Candidate</h1>
            {roleLoading ? <Loader2 className="w-4 h-4 animate-spin mt-2" /> : (
              <p className="text-slate-500 mt-1">For <span className="font-semibold text-primary">{role?.title}</span> at {role?.companyName}</p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl mt-1 gap-2"
            onClick={() => setShowCvParse(!showCvParse)}
          >
            <Sparkles className="w-4 h-4 text-violet-500" />
            Parse CV with AI
          </Button>
        </div>

        {parsedProfile && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Sparkles className="w-4 h-4" />
              Normalized Candidate Snapshot
            </div>
            <p className="mt-2 text-sm text-emerald-800">
              Different CV layouts are converted into one recruiter-friendly intake format before submission.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
              Parse quality {parsedProfile.parseConfidence ?? 0}% • {parsedProfile.parseReviewRequired ? "Review suggested" : "Ready"}
            </div>
            {snapshotFields.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {snapshotFields.map((field) => (
                  <div key={field.label} className="rounded-xl bg-white/80 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{field.label}</div>
                    <div className="mt-1 text-sm text-slate-800">{field.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Contact details were extracted, but some sections still need a quick recruiter review.
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

        {showCvParse && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 mb-6">
            <h3 className="font-semibold text-violet-900 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> AI CV Parser
            </h3>
            <p className="text-sm text-violet-700 mb-3">You can upload a PDF, DOCX, or image resume for auto-fill, or paste raw CV text here as a fallback.</p>
            <Textarea
              value={cvText}
              onChange={e => setCvText(e.target.value)}
              placeholder="Paste CV / resume text here..."
              rows={6}
              className="rounded-xl resize-none mb-3 text-sm"
            />
            <Button
              type="button"
              onClick={handleParseCV}
              disabled={parsing}
              className="rounded-xl bg-violet-600 text-white hover:bg-violet-700 hover-elevate active-elevate-2"
            >
              {parsing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{parseProgress || "Parsing…"}</> : <><Sparkles className="w-4 h-4 mr-2" />Parse & Fill</>}
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg shadow-black/5 border border-slate-100 p-8 space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold">First Name</label>
              <Input required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Last Name</label>
              <Input required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="h-12 rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">Email Address</label>
            <Input type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="h-12 rounded-xl" />
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Phone Number</label>
              <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Expected Salary ($)</label>
              <Input type="number" value={formData.expectedSalary} onChange={e => setFormData({ ...formData, expectedSalary: e.target.value })} className="h-12 rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-400" />
              Tags / Skills <span className="font-normal text-slate-400">(comma separated)</span>
            </label>
            <Input
              value={formData.tags}
              onChange={e => setFormData({ ...formData, tags: e.target.value })}
              placeholder="React, TypeScript, 5 years experience, Remote OK"
              className="h-12 rounded-xl"
            />
            {formData.tags && (
              <div className="flex flex-wrap gap-1 mt-1">
                {formData.tags.split(",").map(t => t.trim()).filter(Boolean).map((tag, i) => (
                  <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">CV / Resume <span className="font-normal text-slate-400">(PDF, DOCX, or image, optional)</span></label>
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (!file) {
                    setCvFile(null);
                    return;
                  }

                  const validationError = validateResumeFile(file);
                  if (validationError) {
                    toast({ title: "Invalid CV file", description: validationError, variant: "destructive" });
                    if (fileRef.current) {
                      fileRef.current.value = "";
                    }
                    setCvFile(null);
                    return;
                  }

                  setCvFile(file);
                  void parsePdfCv(file);
                }}
              />
              {cvFile ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                    <FileText className="w-5 h-5" />
                    <span>{cvFile.name}</span>
                    <span className="text-slate-400 font-normal">({(cvFile.size / 1024).toFixed(0)} KB)</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {parsing ? parseProgress || "Resume is being parsed automatically…" : "Fields are auto-filled after resume analysis."}
                  </div>
                  {parsedProfile?.parseReviewRequired ? (
                    <div className="text-xs text-amber-700">Some extracted fields may need a quick manual review.</div>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      void parsePdfCv(cvFile);
                    }}
                    disabled={parsing}
                    className="rounded-lg gap-2 hover-elevate active-elevate-2"
                  >
                    {parsing ? <><Loader2 className="w-3 h-3 animate-spin" />{parseProgress || "Parsing resume…"}</> : <><Sparkles className="w-3 h-3" />Parse Again</>}
                  </Button>
                </div>
              ) : (
                <div className="text-slate-400">
                  <Upload className="w-6 h-6 mx-auto mb-2" />
                  <p className="text-sm">Click to upload CV (PDF, DOCX, or image)</p>
                  <p className="text-xs mt-1">Candidate fields and standardized profile will be generated automatically.</p>
                </div>
              )}
            </div>
          </div>

          <Button disabled={parsing || isPending || uploading} type="submit" className="w-full h-12 rounded-xl mt-4 text-base shadow-md hover-elevate active-elevate-2">
            {parsing ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" />Parsing CV...</>
            ) : isPending || uploading ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" />{uploading ? "Uploading CV..." : "Submitting..."}</>
            ) : (
              <><Send className="w-4 h-4 mr-2" />Submit Profile</>
            )}
          </Button>
        </form>
      </div>
    </DashboardLayout>
  );
}
