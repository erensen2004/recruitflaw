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
import { composeCandidateTags, formatTurkishLira, parseCandidateTags } from "@/lib/candidate-display";
import { parseResumeFileWithFallback, parseResumeText, type ParsedCandidateProfile } from "@/lib/resume-parse";
import { getRoleSummaryLines } from "@/lib/role-display";
import { uploadResumeFile } from "@/lib/resume-upload";
import { ReviewThreadPanel } from "@/components/review-thread-panel";

export default function VendorSubmitCandidate() {
  const [, submitParams] = useRoute("/vendor/submit/:roleId");
  const [, positionParams] = useRoute("/vendor/positions/:roleId");
  const params = submitParams ?? positionParams;
  const roleId = Number(params?.roleId);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: role, isLoading: roleLoading } = useGetRole(roleId);
  const [formData, setFormData] = useState({
    firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", englishLevel: "", tags: ""
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cvText, setCvText] = useState("");
  const [showCvParse, setShowCvParse] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [parsedProfile, setParsedProfile] = useState<ParsedCandidateProfile | null>(null);

  const parsedTagsPreview = parseCandidateTags(formData.tags);
  const roleSummary = role ? getRoleSummaryLines(role) : null;

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
      return await uploadResumeFile(file, { token, maxAttempts: 3 });
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

  const handleFileSelection = async (file: File | null) => {
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
    if (!formData.expectedSalary.trim()) {
      toast({
        title: "Expected salary is required",
        description: "Please enter the candidate's expected monthly salary in TL.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.phone.trim()) {
      toast({
        title: "Phone number is required",
        description: "Please enter the candidate's contact number before submitting.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.englishLevel.trim()) {
      toast({
        title: "English level is required",
        description: "Please enter a free-text English level before submitting.",
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
    const englishLevel = formData.englishLevel.trim();
    submit({
      data: {
        ...formData,
        email: formData.email.trim().toLowerCase(),
        expectedSalary: formData.expectedSalary ? Number(formData.expectedSalary) : undefined,
        roleId,
        cvUrl,
        originalCvFileName: cvFile?.name,
        originalCvMimeType: cvFile?.type || undefined,
        tags: composeCandidateTags(formData.tags || parsedProfile?.parsedSkills?.join(", ") || "", englishLevel) || undefined,
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

        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Role Details</h1>
            {roleLoading ? <Loader2 className="w-4 h-4 animate-spin mt-2" /> : (
              <p className="text-slate-500 mt-1">Review the role brief first, then submit a candidate from this detail screen.</p>
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

        {role ? (
          <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Position</div>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">{role.title}</h2>
                <p className="mt-2 text-sm text-slate-500">{role.companyName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {roleSummary?.workModeLabel || "Work mode not set"}
                </span>
                {roleSummary?.employmentTypeLabel ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {roleSummary.employmentTypeLabel}
                  </span>
                ) : null}
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Max salary {role.salaryMax != null ? formatTurkishLira(role.salaryMax) : "Not provided"}
                </span>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Role brief</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {roleSummary?.descriptionBody || "The admin team will finalize the role brief before publication."}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Required skills</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {role?.skills || "Not specified"}
                </p>
                {role?.location ? <p className="mt-3 text-sm font-medium text-slate-700">Location: {role.location}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {parsedProfile && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Sparkles className="w-4 h-4" />
              Resume analyzed successfully
            </div>
            <p className="mt-2 text-sm text-emerald-800">
              The form was pre-filled from the uploaded resume. The admin and client teams will see the full standardized output during review.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
              Parse quality {parsedProfile.parseConfidence ?? 0}% • {parsedProfile.parseReviewRequired ? "Review suggested" : "Ready"}
            </div>
            <div className="mt-4 rounded-xl border border-white/60 bg-white/70 p-3 text-sm text-emerald-900">
              Review the contact details, salary, English level, and tags below before submitting the candidate.
            </div>
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
              <label className="text-sm font-semibold">Phone Number *</label>
              <Input required type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Expected Salary (TL)</label>
              <Input
                type="number"
                min="1"
                required
                value={formData.expectedSalary}
                onChange={e => setFormData({ ...formData, expectedSalary: e.target.value })}
                placeholder="45000"
                className="h-12 rounded-xl"
              />
              <p className="text-xs text-slate-500">Enter the expected monthly salary in Turkish Lira.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">English Level</label>
            <Input
              required
              value={formData.englishLevel}
              onChange={e => setFormData({ ...formData, englishLevel: e.target.value })}
              placeholder="B2, fluent, native, professional working proficiency..."
              className="h-12 rounded-xl"
            />
            <p className="text-xs text-slate-500">Free-text field, stored with the candidate profile for client and admin review.</p>
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
                {parsedTagsPreview.visibleTags.map((tag, i) => (
                  <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                ))}
                {formData.englishLevel.trim() ? (
                  <span className="bg-sky-100 text-sky-700 text-xs font-medium px-2 py-0.5 rounded-full">
                    English level: {formData.englishLevel.trim()}
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">CV / Resume <span className="font-normal text-slate-400">(PDF, DOCX, or image, optional)</span></label>
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/50 hover:bg-primary/5"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={e => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={e => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                void handleFileSelection(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={e => void handleFileSelection(e.target.files?.[0] || null)}
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
                  <p className="text-sm">Drop a CV here or click to upload (PDF, DOCX, or image)</p>
                  <p className="text-xs mt-1">Candidate fields will be normalized automatically before submission.</p>
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
              <><Send className="w-4 h-4 mr-2" />Submit Candidate</>
            )}
          </Button>
        </form>

        {role ? (
          <div className="mt-6">
            <ReviewThreadPanel
              scopeType="role"
              scopeId={roleId}
              actorRole="vendor"
              title="Role clarification thread"
              description="Keep vendor-side role questions and clarifications attached to this exact position instead of spreading them across calls or chat."
            />
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
