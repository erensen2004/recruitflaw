import { useEffect, useMemo, useState } from "react";
import {
  useGetCandidate,
  useListCandidateHistory,
  useUpdateCandidateStatus,
  getGetCandidateQueryKey,
  getListCandidateHistoryQueryKey,
} from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  ArrowLeft,
  FileText,
  Tag,
  MessageSquare,
  Download,
  ShieldCheck,
  Sparkles,
  MapPin,
  BadgeCheck,
  Clock3,
} from "lucide-react";
import { useRoute, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getPrivateObjectUrl } from "@/lib/utils";
import { exportStandardizedCandidatePdf } from "@/lib/standardized-cv";

const STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

interface Note {
  id: number;
  authorName: string;
  content: string;
  createdAt: string;
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

export default function ClientCandidateDetail() {
  const [, params] = useRoute("/client/candidates/:id");
  const candidateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: history = [], isLoading: historyLoading } = useListCandidateHistory(candidateId);
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateCandidateStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) });
        queryClient.invalidateQueries({ queryKey: getListCandidateHistoryQueryKey(candidateId) });
        toast({ title: "Status updated" });
      },
      onError: (error: Error) => {
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
      <DashboardLayout allowedRoles={["client"]}>
        <div className="flex justify-center p-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!candidate) {
    return (
      <DashboardLayout allowedRoles={["client"]}>
        <div className="text-center text-slate-500 p-12">Candidate not found.</div>
      </DashboardLayout>
    );
  }

  const tags = candidate.tags ? candidate.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
  const parsedSkills = candidate.parsedSkills?.length ? candidate.parsedSkills : tags;

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href="/client/candidates"
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
                    <Download className="h-4 w-4" /> Download Standardized CV
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Role", value: candidate.roleTitle },
                  { label: "Vendor", value: candidate.vendorCompanyName },
                  { label: "Phone", value: candidate.phone || "Not provided" },
                  {
                    label: "Expected Salary",
                    value: candidate.expectedSalary ? `$${candidate.expectedSalary.toLocaleString()}` : "Not provided",
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

            <div className="rounded-2xl border border-emerald-100 bg-white p-8 shadow-lg shadow-black/5">
              <div className="mb-5 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">Recruiter-ready profile snapshot</h2>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl bg-emerald-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</p>
                  <p className="mt-2 text-sm leading-6 text-slate-800">{candidate.summary || "Summary not available yet."}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standardized profile</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-800">
                    {candidate.standardizedProfile || "Standardized profile not available yet."}
                  </pre>
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
                    <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No structured education extracted yet.</div>
                  )}
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Languages</p>
                    <p className="mt-1 text-sm text-slate-700">{candidate.languages || "Not found"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
                <ShieldCheck className="h-5 w-5 text-primary" /> Status workflow
              </h2>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((statusValue) => (
                  <button
                    key={statusValue}
                    disabled={updatingStatus || candidate.status === statusValue}
                    onClick={() => {
                      const reason = window.prompt("Optional reason for this status change:");
                      updateStatus({
                        id: candidateId,
                        data: { status: statusValue, reason: reason?.trim() || undefined },
                      });
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      candidate.status === statusValue
                        ? "border-primary bg-primary text-white"
                        : "border-slate-200 text-slate-600 hover:border-primary hover:text-primary"
                    }`}
                  >
                    {STATUS_LABELS[statusValue]}
                  </button>
                ))}
              </div>

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
                <MessageSquare className="h-5 w-5 text-primary" /> Recruiter notes
              </h2>

              <div className="mb-4 flex gap-3">
                <Textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder="Add a note about this candidate..."
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
                  <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No notes yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
