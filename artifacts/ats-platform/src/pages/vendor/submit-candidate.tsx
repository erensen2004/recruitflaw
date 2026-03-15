import { useState, useRef } from "react";
import { useSubmitCandidate, useGetRole } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowLeft, Send, FileText, Upload, Sparkles, Tag } from "lucide-react";
import { useRoute, Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { validatePdfResumeFile } from "@/lib/utils";

type ParsedCandidateProfile = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  skills?: string | null;
  expectedSalary?: number | null;
  currentTitle?: string | null;
  location?: string | null;
  yearsExperience?: number | null;
  education?: string | null;
  languages?: string | null;
  summary?: string | null;
  standardizedProfile?: string | null;
};

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    // Ignore JSON parsing failures and fall back to status text.
  }

  return `${response.status} ${response.statusText}`.trim() || "Unknown error";
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
  const [parsedProfile, setParsedProfile] = useState<ParsedCandidateProfile | null>(null);

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
      const uploadRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
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
    const validationError = validatePdfResumeFile(file);
    if (validationError) {
      toast({ title: "Invalid CV file", description: validationError, variant: "destructive" });
      return;
    }

    setParsing(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch("/api/cv-parse", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/pdf",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!res.ok) {
        toast({
          title: "PDF parsing failed",
          description: await getErrorMessage(res),
          variant: "destructive",
        });
        return;
      }

      const parsed: ParsedCandidateProfile = await res.json();
      applyParsedProfile(parsed);
      toast({ title: "CV parsed successfully", description: "We auto-filled the candidate fields from the uploaded PDF." });
    } catch (error) {
      toast({
        title: "PDF parsing error",
        description: error instanceof Error ? error.message : "Unknown parsing error",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const handleParseCV = async () => {
    if (!cvText.trim()) {
      toast({ title: "Please paste CV text first", variant: "destructive" });
      return;
    }

    setParsing(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch("/api/cv-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cvText }),
      });
      if (!res.ok) {
        toast({
          title: "CV parsing failed",
          description: await getErrorMessage(res),
          variant: "destructive",
        });
        return;
      }

      const parsed: ParsedCandidateProfile = await res.json();
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
        tags: formData.tags || undefined,
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-white/80 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Title</div>
                <div className="mt-1 text-sm text-slate-800">{parsedProfile.currentTitle || "Not found"}</div>
              </div>
              <div className="rounded-xl bg-white/80 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</div>
                <div className="mt-1 text-sm text-slate-800">{parsedProfile.location || "Not found"}</div>
              </div>
              <div className="rounded-xl bg-white/80 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Experience</div>
                <div className="mt-1 text-sm text-slate-800">
                  {parsedProfile.yearsExperience != null ? `${parsedProfile.yearsExperience} years` : "Not found"}
                </div>
              </div>
              <div className="rounded-xl bg-white/80 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Languages</div>
                <div className="mt-1 text-sm text-slate-800">{parsedProfile.languages || "Not found"}</div>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-white/80 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Education</div>
              <div className="mt-1 text-sm text-slate-800">{parsedProfile.education || "Not found"}</div>
            </div>
            <div className="mt-3 rounded-xl bg-white/80 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</div>
              <div className="mt-1 text-sm text-slate-800">{parsedProfile.summary || "Not found"}</div>
            </div>
            <div className="mt-3 rounded-xl bg-white/80 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standardized Profile</div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">
                {parsedProfile.standardizedProfile || "Not found"}
              </pre>
            </div>
          </div>
        )}

        {showCvParse && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 mb-6">
            <h3 className="font-semibold text-violet-900 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> AI CV Parser
            </h3>
            <p className="text-sm text-violet-700 mb-3">You can upload a PDF for auto-fill, or paste raw CV text here as a fallback.</p>
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
              className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
            >
              {parsing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Parsing...</> : <><Sparkles className="w-4 h-4 mr-2" />Parse & Fill</>}
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
            <label className="text-sm font-semibold">CV / Resume <span className="font-normal text-slate-400">(PDF, optional)</span></label>
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (!file) {
                    setCvFile(null);
                    return;
                  }

                  const validationError = validatePdfResumeFile(file);
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
                    {parsing ? "PDF is being parsed automatically..." : "Fields are auto-filled after PDF analysis."}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      void parsePdfCv(cvFile);
                    }}
                    disabled={parsing}
                    className="rounded-lg gap-2"
                  >
                    {parsing ? <><Loader2 className="w-3 h-3 animate-spin" />Parsing PDF...</> : <><Sparkles className="w-3 h-3" />Parse Again</>}
                  </Button>
                </div>
              ) : (
                <div className="text-slate-400">
                  <Upload className="w-6 h-6 mx-auto mb-2" />
                  <p className="text-sm">Click to upload CV (PDF)</p>
                  <p className="text-xs mt-1">Candidate fields and standardized profile will be generated automatically.</p>
                </div>
              )}
            </div>
          </div>

          <Button disabled={parsing || isPending || uploading} type="submit" className="w-full h-12 rounded-xl mt-4 text-base shadow-md">
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
