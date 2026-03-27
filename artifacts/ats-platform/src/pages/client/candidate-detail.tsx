import { useEffect, useMemo, useState } from "react";
import {
  useGetCandidate,
  useListCandidateHistory,
  useUpdateCandidateStatus,
  useGetMe,
  type Candidate,
} from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  ArrowLeft,
  FileText,
  Tag,
  MessageSquare,
  Download,
  Pencil,
  ShieldCheck,
  Sparkles,
  MapPin,
  BadgeCheck,
  Clock3,
} from "lucide-react";
import { useRoute, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import { PrivateObjectLink } from "@/components/private-object-link";
import { ReviewThreadPanel } from "@/components/review-thread-panel";
import {
  formatTurkishLira,
  getCandidateCompleteness,
  getCandidateExecutiveBrief,
  getCandidateDecisionGuidance,
  getCandidateReadinessSnapshot,
  getStatusReasonDescription,
  getStatusReasonTitle,
  parseCandidateTags,
  requiresStatusReason,
} from "@/lib/candidate-display";

const STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

type ReviewSignalTone = "emerald" | "amber" | "blue" | "slate" | "rose";

interface Note {
  id: number;
  authorName: string;
  content: string;
  createdAt: string;
}

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

function getParseBadge(parseStatus: string, confidence?: number | null, reviewRequired?: boolean) {
  if (parseStatus === "parsed" && !reviewRequired) {
    return {
      label: confidence != null ? `Ready (${confidence}%)` : "Ready",
      className: "bg-emerald-100 text-emerald-700",
    };
  }
  if (parseStatus === "partial" || reviewRequired) {
    return {
      label: confidence != null ? `Review recommended (${confidence}%)` : "Review recommended",
      className: "bg-amber-100 text-amber-700",
    };
  }
  return {
    label: "Manual review needed",
    className: "bg-slate-100 text-slate-700",
  };
}

function buildNormalizedProfileCards(candidate: Candidate) {
  const profileCards = [
    { label: "Headline", value: candidate.currentTitle || `${candidate.firstName} ${candidate.lastName}` },
    {
      label: "Contact",
      value: [candidate.email, candidate.phone].filter(Boolean).join("  •  ") || "Awaiting verified contact details",
    },
    { label: "Location", value: candidate.location || "Location pending admin normalization" },
    {
      label: "Experience",
      value:
        candidate.yearsExperience != null
          ? `${candidate.yearsExperience} years`
          : candidate.parsedExperience[0]?.title || "Experience depth needs review",
    },
    {
      label: "Skills",
      value:
        candidate.parsedSkills?.length
          ? candidate.parsedSkills.slice(0, 6).join(", ")
          : candidate.tags || "Skills pending structured review",
    },
    {
      label: "Education",
      value:
        candidate.education ||
        candidate.parsedEducation.map((item) => [item.degree, item.institution].filter(Boolean).join(" • ")).filter(Boolean).slice(0, 1)[0] ||
        "Education not finalized",
    },
    {
      label: "Languages",
      value: cleanSnapshotText(candidate.languages) || "Language coverage pending review",
    },
    {
      label: "Submitted By",
      value: candidate.vendorCompanyName || "Vendor company not linked",
    },
  ];

  return profileCards.filter((item) => item.value);
}

function buildAdminReviewSignals(candidate: Candidate) {
  return [
    {
      label: "Parse confidence",
      value: candidate.parseConfidence != null ? `${candidate.parseConfidence}%` : "Manual review",
      tone: (
        candidate.parseConfidence != null && candidate.parseConfidence >= 80
          ? "emerald"
          : candidate.parseConfidence != null && candidate.parseConfidence >= 60
            ? "amber"
            : "slate"
      ) as ReviewSignalTone,
    },
    {
      label: "Review state",
      value: candidate.parseReviewRequired ? "Admin review recommended" : "Ready for client-facing review",
      tone: (candidate.parseReviewRequired ? "amber" : "emerald") as ReviewSignalTone,
    },
    {
      label: "Client visibility",
      value: candidate.status === "pending_approval" ? "Held for admin approval" : "Visible in approved pipeline",
      tone: (candidate.status === "pending_approval" ? "slate" : "blue") as ReviewSignalTone,
    },
  ];
}

function getSignalClasses(tone: ReviewSignalTone) {
  switch (tone) {
    case "emerald":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "blue":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "rose":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

export default function ClientCandidateDetail() {
  const [, clientParams] = useRoute("/client/candidates/:id");
  const [, adminParams] = useRoute("/admin/candidates/:id");
  const params = clientParams ?? adminParams;
  const candidateId = Number(params?.id);
  const isAdminRoute = Boolean(adminParams?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusReasonOpen, setStatusReasonOpen] = useState(false);
  const [statusReasonTarget, setStatusReasonTarget] = useState<(typeof STATUSES)[number] | null>(null);
  const [statusReasonText, setStatusReasonText] = useState("");
  const [statusReasonError, setStatusReasonError] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    expectedSalary: "",
    currentTitle: "",
    location: "",
    summary: "",
    standardizedProfile: "",
    education: "",
    languages: "",
    tags: "",
  });

  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: history = [], isLoading: historyLoading } = useListCandidateHistory(candidateId);
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateCandidateStatus({
    mutation: {
      onSuccess: (updatedCandidate) => {
        setPendingStatus(null);
        syncCandidateAcrossCaches(queryClient, updatedCandidate);
        void invalidateCandidateQueries(queryClient, candidateId);
        toast({ title: "Status updated" });
      },
      onError: (error: Error) => {
        setPendingStatus(null);
        toast({
          title: "Status update failed",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const parseBadge = useMemo(
    () => getParseBadge(candidate?.parseStatus ?? "failed", candidate?.parseConfidence, candidate?.parseReviewRequired),
    [candidate?.parseConfidence, candidate?.parseReviewRequired, candidate?.parseStatus],
  );
  const { visibleTags, englishLevel } = useMemo(
    () => parseCandidateTags(candidate?.tags),
    [candidate?.tags],
  );
  const cleanSummary = cleanSnapshotText(candidate?.summary);
  const cleanStandardizedProfile = cleanSnapshotText(candidate?.standardizedProfile);
  const cleanLanguages = cleanSnapshotText(candidate?.languages);
  const readinessSnapshot = candidate ? getCandidateReadinessSnapshot(candidate) : null;
  const executiveBrief = candidate ? getCandidateExecutiveBrief(candidate) : null;

  const fetchNotes = async () => {
    setLoadingNotes(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch(`/api/candidates/${candidateId}/notes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error("Could not load candidate notes.");
      }
      setNotes(await res.json());
    } catch (error) {
      toast({
        title: "Notes unavailable",
        description: error instanceof Error ? error.message : "Could not load notes.",
        variant: "destructive",
      });
    } finally {
      setLoadingNotes(false);
    }
  };

  useEffect(() => {
    if (candidateId) {
      fetchNotes();
    }
  }, [candidateId]);

  useEffect(() => {
    if (!candidate) return;
    setEditForm({
      firstName: candidate.firstName ?? "",
      lastName: candidate.lastName ?? "",
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      expectedSalary: candidate.expectedSalary != null ? String(candidate.expectedSalary) : "",
      currentTitle: candidate.currentTitle ?? "",
      location: candidate.location ?? "",
      summary: candidate.summary ?? "",
      standardizedProfile: candidate.standardizedProfile ?? "",
      education: candidate.education ?? "",
      languages: candidate.languages ?? "",
      tags: candidate.tags ?? "",
    });
  }, [candidate]);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch(`/api/candidates/${candidateId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: noteText }),
      });
      if (!res.ok) throw new Error("Could not add note.");
      setNoteText("");
      await fetchNotes();
      toast({ title: "Note added" });
    } catch (error) {
      toast({
        title: "Note could not be saved",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAddingNote(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout allowedRoles={["client", "admin"]}>
        <div className="flex justify-center p-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!candidate) {
    return (
      <DashboardLayout allowedRoles={["client", "admin"]}>
        <div className="text-center text-slate-500 p-12">Candidate not found.</div>
      </DashboardLayout>
    );
  }

  const parsedSkills = candidate.parsedSkills?.length ? candidate.parsedSkills : visibleTags;
  const backHref = isAdminRoute || me?.role === "admin" ? "/admin/candidates" : "/client/candidates";
  const normalizedProfileCards = buildNormalizedProfileCards(candidate);
  const adminReviewSignals = buildAdminReviewSignals(candidate);
  const completenessScore = getCandidateCompleteness(candidate);
  const decisionGuidance = getCandidateDecisionGuidance(candidate);

  const submitStatusUpdate = (statusValue: (typeof STATUSES)[number], reason?: string) => {
    if (updatingStatus || candidate.status === statusValue) return;
    setPendingStatus(statusValue);
    updateStatus({
      id: candidateId,
      data: { status: statusValue, ...(reason ? { reason } : {}) },
    });
  };

  const handleStatusUpdate = (statusValue: (typeof STATUSES)[number]) => {
    if (updatingStatus || candidate.status === statusValue) return;
    if (requiresStatusReason(statusValue)) {
      setStatusReasonTarget(statusValue);
      setStatusReasonText("");
      setStatusReasonError("");
      setStatusReasonOpen(true);
      return;
    }

    submitStatusUpdate(statusValue);
  };

  const closeStatusReasonDialog = () => {
    setStatusReasonOpen(false);
    setStatusReasonTarget(null);
    setStatusReasonText("");
    setStatusReasonError("");
  };

  const saveStatusReason = () => {
    if (!statusReasonTarget) return;
    const reason = statusReasonText.trim();
    if (!reason) {
      setStatusReasonError(`${getStatusReasonTitle(statusReasonTarget)} is required.`);
      return;
    }

    closeStatusReasonDialog();
    submitStatusUpdate(statusReasonTarget, reason);
  };

  const handleSaveProfile = async () => {
    if (!candidate || !isAdminRoute) return;

    setSavingProfile(true);
    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch(`/api/candidates/${candidateId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
          email: editForm.email.trim().toLowerCase(),
          phone: editForm.phone.trim() || null,
          expectedSalary: editForm.expectedSalary ? Number(editForm.expectedSalary) : null,
          currentTitle: editForm.currentTitle.trim() || null,
          location: editForm.location.trim() || null,
          summary: editForm.summary.trim() || null,
          standardizedProfile: editForm.standardizedProfile.trim() || null,
          education: editForm.education.trim() || null,
          languages: editForm.languages.trim() || null,
          tags: editForm.tags.trim() || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Candidate profile could not be updated");
      }

      const updatedCandidate = await response.json();
      syncCandidateAcrossCaches(queryClient, updatedCandidate);
      await invalidateCandidateQueries(queryClient, candidateId);
      setEditDialogOpen(false);
      toast({ title: "Candidate profile updated" });
    } catch (error) {
      toast({
        title: "Profile update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleExportStandardizedCv = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const { exportStandardizedCandidatePdf } = await import("@/lib/standardized-cv");
      await exportStandardizedCandidatePdf(candidate);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "The standardized CV could not be generated.",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <DashboardLayout allowedRoles={["client", "admin"]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href={backHref}
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Candidates
        </Link>

        <div className="grid gap-6 xl:grid-cols-[1.6fr,1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-lg shadow-black/5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-bold text-slate-900">
                      {candidate.firstName} {candidate.lastName}
                    </h1>
                    <StatusBadge status={candidate.status} />
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${parseBadge.className}`}>
                      {parseBadge.label}
                    </span>
                  </div>
                  <p className="mt-2 text-slate-500">{candidate.email}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
                    {candidate.currentTitle ? <span>{candidate.currentTitle}</span> : null}
                    {candidate.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {candidate.location}
                      </span>
                    ) : null}
                    {candidate.yearsExperience != null ? <span>{candidate.yearsExperience} years experience</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isAdminRoute ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl gap-2"
                      onClick={() => setEditDialogOpen(true)}
                    >
                      <Pencil className="h-4 w-4" /> Edit Normalized Fields
                    </Button>
                  ) : null}
                  {candidate.cvUrl ? (
                    <PrivateObjectLink
                      objectPath={candidate.cvUrl}
                      className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-xl gap-2" })}
                    >
                      <FileText className="h-4 w-4" /> View Original CV
                    </PrivateObjectLink>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-2"
                    disabled={exportingPdf}
                    onClick={handleExportStandardizedCv}
                  >
                    {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download Standardized CV
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Role", value: candidate.roleTitle },
                  { label: "Company", value: candidate.vendorCompanyName },
                  { label: "Phone", value: candidate.phone || "Not provided" },
                  { label: "English level", value: englishLevel || "Not provided" },
                  {
                    label: "Expected Salary",
                    value: formatTurkishLira(candidate.expectedSalary),
                  },
                  {
                    label: "Parse Provider",
                    value: candidate.parseProvider || "Fallback/manual",
                  },
                  {
                    label: "Submitted",
                    value: new Date(candidate.submittedAt).toLocaleDateString(),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Profile completeness</p>
                      <p className="mt-2 text-3xl font-bold text-slate-900">{completenessScore}%</p>
                    </div>
                    <div className="h-16 w-16 rounded-full border-4 border-primary/15 bg-white flex items-center justify-center text-sm font-bold text-primary shadow-sm">
                      {completenessScore}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {[
                      { label: "Contact", ready: Boolean(candidate.email && candidate.phone) },
                      { label: "Compensation", ready: candidate.expectedSalary != null },
                      { label: "Languages", ready: Boolean(cleanLanguages) },
                      { label: "Structured experience", ready: candidate.parsedExperience.length > 0 },
                      { label: "Structured education", ready: candidate.parsedEducation.length > 0 },
                      { label: "Recruiter summary", ready: Boolean(cleanSummary) },
                    ].map((item: { label: string; ready: boolean }) => (
                      <div key={item.label} className={`rounded-xl px-3 py-2 text-sm font-medium ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {item.ready ? "✓" : "•"} {item.label}
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`rounded-2xl border p-5 ${getSignalClasses(decisionGuidance.tone)}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em]">Decision guidance</p>
                  <p className="mt-2 text-lg font-bold">{decisionGuidance.label}</p>
                  <p className="mt-3 text-sm leading-6">{decisionGuidance.body}</p>
                </div>
              </div>

              {readinessSnapshot ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Salary readiness",
                      value: readinessSnapshot.salaryLabel,
                      tone: (readinessSnapshot.compensationReady ? "emerald" : "amber") as ReviewSignalTone,
                    },
                    {
                      label: "Language readiness",
                      value: readinessSnapshot.languageLabel,
                      tone: (readinessSnapshot.languageReady ? "emerald" : "amber") as ReviewSignalTone,
                    },
                    {
                      label: "Risk posture",
                      value: readinessSnapshot.riskLevel === "low" ? "Low risk" : readinessSnapshot.riskLevel === "medium" ? "Moderate risk" : "High risk",
                      tone: (readinessSnapshot.riskLevel === "low" ? "emerald" : readinessSnapshot.riskLevel === "medium" ? "amber" : "rose") as ReviewSignalTone,
                    },
                    {
                      label: "Next action",
                      value: readinessSnapshot.nextAction,
                      tone: (readinessSnapshot.riskLevel === "low" ? "emerald" : readinessSnapshot.riskLevel === "medium" ? "amber" : "rose") as ReviewSignalTone,
                    },
                  ].map((item: { label: string; value: string; tone: ReviewSignalTone }) => (
                    <div key={item.label} className={`rounded-2xl border p-4 ${getSignalClasses(item.tone)}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold leading-6">{item.value}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {executiveBrief ? (
                <div className="mt-5 rounded-3xl border border-slate-100 bg-gradient-to-br from-sky-50 via-white to-emerald-50/70 p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Executive intelligence</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{executiveBrief.fitLabel}</p>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{executiveBrief.fitSummary}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Fit score</p>
                      <p className="mt-1 text-3xl font-bold text-slate-900">{executiveBrief.fitScore}</p>
                      <p className="text-xs text-slate-500">out of 100</p>
                    </div>
                  </div>

                  {executiveBrief.strengths.length ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Top strengths</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {executiveBrief.strengths.map((strength) => (
                          <span key={strength} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                            {strength}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">Risk flags</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {executiveBrief.riskFlags.length ? (
                          executiveBrief.riskFlags.map((flag) => (
                            <span key={flag} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
                              {flag}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            No critical flags
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-500">Normalization notes</p>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                        {executiveBrief.normalizationNotes.length ? (
                          executiveBrief.normalizationNotes.map((note) => (
                            <p key={note} className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                              {note}
                            </p>
                          ))
                        ) : (
                          <p className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                            Profile is already normalized enough for a quick handoff.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

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

            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-[1px] shadow-2xl shadow-slate-900/10">
              <div className="rounded-[calc(1.5rem-1px)] bg-white p-8">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-emerald-600" />
                      <h2 className="text-lg font-bold text-slate-900">Admin review console</h2>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      This is the normalized candidate brief the client sees after the admin team verifies the profile, polishes the summary, and approves the final pipeline record.
                    </p>
                  </div>
                  {isAdminRoute ? (
                    <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-primary">Admin authority active</p>
                      <p className="mt-1 text-slate-500">You can finalize the normalized record before the client-facing handoff.</p>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {adminReviewSignals.map((signal) => (
                    <div key={signal.label} className={`rounded-2xl border p-4 ${getSignalClasses(signal.tone)}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{signal.label}</p>
                      <p className="mt-2 text-sm font-semibold">{signal.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
                  <div className="rounded-2xl bg-emerald-50/70 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recruiter-ready summary</p>
                    <p className="mt-3 text-sm leading-7 text-slate-800">
                      {cleanSummary || (candidate.parseReviewRequired ? "Awaiting admin approval for the final summary." : "Summary not available yet.")}
                    </p>
                    <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 p-4 text-sm text-slate-600">
                      <p className="font-semibold text-slate-800">Why this matters</p>
                      <p className="mt-1 leading-6">
                        A strong summary gives the client a fast, polished briefing instead of forcing them to read the raw CV first.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin-normalized profile</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {normalizedProfileCards.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm shadow-slate-200/40">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-800">{item.value}</p>
                        </div>
                      ))}
                    </div>
                    {cleanStandardizedProfile ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Compact export line</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{cleanStandardizedProfile}</p>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Experience</p>
                  {candidate.parsedExperience.length ? (
                    <div className="space-y-3">
                      {candidate.parsedExperience.map((item, index) => (
                        <div key={`${item.title}-${item.company}-${index}`} className="rounded-xl bg-slate-50 p-3">
                          <p className="font-semibold text-slate-900">{item.title || "Role not found"}</p>
                          <p className="text-sm text-slate-500">{item.company || "Company not found"}</p>
                          {(item.startDate || item.endDate) && (
                            <p className="mt-1 text-xs text-slate-400">
                              {[item.startDate, item.endDate].filter(Boolean).join(" - ")}
                            </p>
                          )}
                          {item.highlights?.length ? (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                              {item.highlights.map((highlight, highlightIndex) => (
                                <li key={`${highlight}-${highlightIndex}`}>{highlight}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No structured experience extracted yet.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-100 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Education & languages</p>
                  {candidate.parsedEducation.length ? (
                    <div className="space-y-3">
                      {candidate.parsedEducation.map((item, index) => (
                        <div key={`${item.institution}-${index}`} className="rounded-xl bg-slate-50 p-3">
                          <p className="font-semibold text-slate-900">{item.degree || "Degree not found"}</p>
                          <p className="text-sm text-slate-600">
                            {[item.fieldOfStudy, item.institution].filter(Boolean).join(" • ") || "Education details not found"}
                          </p>
                          {(item.startDate || item.endDate) ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {[item.startDate, item.endDate].filter(Boolean).join(" - ")}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                      {candidate.parseReviewRequired ? "Education needs a quick manual review." : "No structured education extracted yet."}
                    </div>
                  )}
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Languages</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {cleanLanguages || (candidate.parseReviewRequired ? "Needs review" : "Not available")}
                    </p>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
                <ShieldCheck className="h-5 w-5 text-primary" /> Admin-approved status workflow
              </h2>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((statusValue) => (
                  <button
                    key={statusValue}
                    disabled={updatingStatus || candidate.status === statusValue}
                    onClick={() => handleStatusUpdate(statusValue)}
                    aria-pressed={candidate.status === statusValue}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${
                      candidate.status === statusValue
                        ? "border-primary bg-primary text-white shadow-sm"
                        : pendingStatus === statusValue
                          ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-sm"
                    }`}
                    >
                      {pendingStatus === statusValue ? "Updating..." : STATUS_LABELS[statusValue]}
                    </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Interview and rejection steps require a short note so the admin-approved workflow stays documented.
              </p>

              <div className="mt-6">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Clock3 className="h-4 w-4 text-primary" /> Status history
                </p>
                {historyLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : history.length ? (
                  <div className="space-y-3">
                    {history.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-800">
                          {item.previousStatus ? `${item.previousStatus} -> ${item.nextStatus}` : item.nextStatus}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.changedByName} • {new Date(item.createdAt).toLocaleString()}
                        </p>
                        {item.reason ? <p className="mt-2 text-sm text-slate-700">{item.reason}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No status history yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
                <MessageSquare className="h-5 w-5 text-primary" /> Shared notes & activity
              </h2>

              <div className="mb-4 flex gap-3">
                <Textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder="Add a shared note for the admin and client review team..."
                  rows={3}
                  className="flex-1 resize-none rounded-xl"
                />
              </div>
              <Button onClick={handleAddNote} disabled={addingNote || !noteText.trim()} className="w-full rounded-xl gap-2">
                {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Save note
              </Button>

              <div className="mt-6 space-y-3">
                {loadingNotes ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
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
              actorRole={isAdminRoute ? "admin" : "client"}
              title="Scoped review thread"
              description="Keep candidate-specific clarifications, approval notes, and next-step feedback attached to this profile."
            />
          </div>
        </div>

        <Dialog open={statusReasonOpen} onOpenChange={(open) => (open ? setStatusReasonOpen(true) : closeStatusReasonDialog())}>
          <DialogContent className="sm:max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle>{getStatusReasonTitle(statusReasonTarget)}</DialogTitle>
              <DialogDescription>{getStatusReasonDescription(statusReasonTarget)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Textarea
                value={statusReasonText}
                onChange={(event) => {
                  setStatusReasonText(event.target.value);
                  if (statusReasonError) setStatusReasonError("");
                }}
                rows={5}
                className="resize-none rounded-xl"
                placeholder={
                  statusReasonTarget === "rejected"
                    ? "Example: Rejected due to missing role-specific experience and inconsistent availability."
                    : "Example: Strong technical background, ready for a structured interview with the client team."
                }
              />
              {statusReasonError ? <p className="text-sm text-rose-600">{statusReasonError}</p> : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className="rounded-xl" onClick={closeStatusReasonDialog}>
                Cancel
              </Button>
              <Button type="button" className="rounded-xl" onClick={saveStatusReason}>
                Save & update status
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-3xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit normalized candidate profile</DialogTitle>
              <DialogDescription>
                Finalize the candidate record before approving it into the client-facing pipeline.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">First Name</label>
                <Input value={editForm.firstName} onChange={(e) => setEditForm((current) => ({ ...current, firstName: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Last Name</label>
                <Input value={editForm.lastName} onChange={(e) => setEditForm((current) => ({ ...current, lastName: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Email</label>
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm((current) => ({ ...current, email: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Phone</label>
                <Input value={editForm.phone} onChange={(e) => setEditForm((current) => ({ ...current, phone: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Expected Salary (TL)</label>
                <Input type="number" value={editForm.expectedSalary} onChange={(e) => setEditForm((current) => ({ ...current, expectedSalary: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Current Title</label>
                <Input value={editForm.currentTitle} onChange={(e) => setEditForm((current) => ({ ...current, currentTitle: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Location</label>
                <Input value={editForm.location} onChange={(e) => setEditForm((current) => ({ ...current, location: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Tags / Skills</label>
                <Input value={editForm.tags} onChange={(e) => setEditForm((current) => ({ ...current, tags: e.target.value }))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Summary</label>
                <Textarea value={editForm.summary} onChange={(e) => setEditForm((current) => ({ ...current, summary: e.target.value }))} rows={4} className="rounded-xl resize-none" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Standardized Profile</label>
                <Textarea value={editForm.standardizedProfile} onChange={(e) => setEditForm((current) => ({ ...current, standardizedProfile: e.target.value }))} rows={4} className="rounded-xl resize-none" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Education</label>
                <Textarea value={editForm.education} onChange={(e) => setEditForm((current) => ({ ...current, education: e.target.value }))} rows={3} className="rounded-xl resize-none" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-semibold">Languages</label>
                <Input value={editForm.languages} onChange={(e) => setEditForm((current) => ({ ...current, languages: e.target.value }))} className="h-11 rounded-xl" />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" className="rounded-xl" disabled={savingProfile} onClick={handleSaveProfile}>
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                Save profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
