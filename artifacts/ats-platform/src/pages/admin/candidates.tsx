import { useDeferredValue, useMemo, useState } from "react";
import { useListCandidates, useUpdateCandidateStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserCircle, Loader2, FileText, AlertTriangle, Eye, CheckCircle2, XCircle, Search, Columns3, X } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import {
  getCandidateCompleteness,
  getStatusReasonDescription,
  getStatusReasonTitle,
  parseCandidateTags,
  requiresStatusReason,
} from "@/lib/candidate-display";
import { Input } from "@/components/ui/input";
import { PrivateObjectLink } from "@/components/private-object-link";

const CANDIDATE_STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];
type ReviewTab = "all" | "pending" | "normalize" | "ready";

function getParseBadge(parseStatus: string, reviewRequired: boolean) {
  if (parseStatus === "parsed" && !reviewRequired) {
    return { label: "Admin-ready", className: "bg-emerald-100 text-emerald-700" };
  }
  if (parseStatus === "partial" || reviewRequired) {
    return { label: "Admin review", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Manual intake", className: "bg-slate-100 text-slate-700" };
}

export default function AdminCandidates() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<ReviewTab>("all");
  const [search, setSearch] = useState("");
  const [hasCv, setHasCv] = useState("all");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [pendingCandidateId, setPendingCandidateId] = useState<number | null>(null);
  const [statusReasonOpen, setStatusReasonOpen] = useState(false);
  const [statusReasonTarget, setStatusReasonTarget] = useState<CandidateStatusValue | null>(null);
  const [statusReasonCandidateId, setStatusReasonCandidateId] = useState<number | null>(null);
  const [statusReasonText, setStatusReasonText] = useState("");
  const [statusReasonError, setStatusReasonError] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const { data: candidates, isLoading } = useListCandidates({
    search: deferredSearch || undefined,
    reviewRequired: activeTab === "normalize" ? true : undefined,
    hasCv: hasCv === "all" ? undefined : hasCv === "yes",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateCandidateStatus({
    mutation: {
      onSuccess: (updatedCandidate) => {
        setPendingCandidateId(null);
        syncCandidateAcrossCaches(queryClient, updatedCandidate);
        void invalidateCandidateQueries(queryClient, updatedCandidate.id);
        toast({ title: "Candidate status updated" });
      },
      onError: (error: Error) => {
        setPendingCandidateId(null);
        toast({
          title: "Status update failed",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const queueStats = {
    total: candidates?.length ?? 0,
    pendingApproval: candidates?.filter((candidate) => candidate.status === "pending_approval").length ?? 0,
    reviewSuggested: candidates?.filter((candidate) => candidate.parseReviewRequired).length ?? 0,
  };
  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];

    return candidates.filter((candidate) => {
      if (activeTab === "pending") return candidate.status === "pending_approval";
      if (activeTab === "normalize") return candidate.parseReviewRequired;
      if (activeTab === "ready") return candidate.status !== "pending_approval" && !candidate.parseReviewRequired;
      return true;
    });
  }, [activeTab, candidates]);

  const selectedCandidates = useMemo(
    () => (candidates ?? []).filter((candidate) => selectedCandidateIds.includes(candidate.id)).slice(0, 3),
    [candidates, selectedCandidateIds],
  );

  const toggleCandidateSelection = (candidateId: number) => {
    setSelectedCandidateIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }

      if (current.length >= 3) {
        toast({
          title: "Compare tray is full",
          description: "You can compare up to 3 candidates at a time.",
        });
        return current;
      }

      return [...current, candidateId];
    });
  };

  const clearSelection = () => setSelectedCandidateIds([]);

  const openCompare = () => {
    if (selectedCandidates.length < 2) {
      toast({
        title: "Pick at least two candidates",
        description: "Select 2-3 candidates to open the compare view.",
      });
      return;
    }

    setLocation(`/admin/compare?ids=${selectedCandidates.map((candidate) => candidate.id).join(",")}`);
  };

  const submitStatusUpdate = (candidateId: number, status: CandidateStatusValue, reason?: string) => {
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (updatingStatus || currentCandidate?.status === status) return;
    setPendingCandidateId(candidateId);
    updateStatus({ id: candidateId, data: { status, ...(reason ? { reason } : {}) } });
  };

  const requestStatusUpdate = (candidateId: number, status: CandidateStatusValue) => {
    if (updatingStatus) return;
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (currentCandidate?.status === status) return;
    if (requiresStatusReason(status)) {
      setStatusReasonCandidateId(candidateId);
      setStatusReasonTarget(status);
      setStatusReasonText("");
      setStatusReasonError("");
      setStatusReasonOpen(true);
      return;
    }

    submitStatusUpdate(candidateId, status);
  };

  const closeStatusReasonDialog = () => {
    setStatusReasonOpen(false);
    setStatusReasonTarget(null);
    setStatusReasonCandidateId(null);
    setStatusReasonText("");
    setStatusReasonError("");
  };

  const saveStatusReason = () => {
    if (!statusReasonTarget || statusReasonCandidateId == null) return;
    const reason = statusReasonText.trim();
    if (!reason) {
      setStatusReasonError(`${getStatusReasonTitle(statusReasonTarget)} is required.`);
      return;
    }

    closeStatusReasonDialog();
    submitStatusUpdate(statusReasonCandidateId, statusReasonTarget, reason);
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Review pending candidate submissions, normalize the profile where needed, then approve them into the client-facing pipeline.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              label: "Total queue",
              value: queueStats.total,
              tone: "border-slate-200 bg-slate-50 text-slate-800",
            },
            {
              label: "Awaiting admin approval",
              value: queueStats.pendingApproval,
              tone: "border-amber-200 bg-amber-50 text-amber-800",
            },
            {
              label: "Needs normalization",
              value: queueStats.reviewSuggested,
              tone: "border-sky-200 bg-sky-50 text-sky-800",
            },
          ].map((card) => (
            <div key={card.label} className={`rounded-2xl border px-4 py-3 ${card.tone}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{card.label}</p>
              <p className="mt-2 text-2xl font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all", label: "All queue" },
              { key: "pending", label: "Awaiting approval" },
              { key: "normalize", label: "Needs normalization" },
              { key: "ready", label: "Ready to publish" },
            ].map((tab) => (
              <Button
                key={tab.key}
                type="button"
                variant={activeTab === tab.key ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setActiveTab(tab.key as ReviewTab)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search candidate, role, company..."
                className="h-11 rounded-xl pl-11"
              />
            </div>
            <Select value={hasCv} onValueChange={setHasCv}>
              <SelectTrigger className="h-11 min-w-[160px] rounded-xl">
                <SelectValue placeholder="CV availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All CV states</SelectItem>
                <SelectItem value="yes">Has CV</SelectItem>
                <SelectItem value="no">Missing CV</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-500">Admin compare tray</p>
              <p className="mt-1 text-sm leading-6 text-indigo-900">
                Select up to 3 candidates from the queue to compare completeness, fit, risk flags, and executive brief quality side by side.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedCandidates.length ? (
                  selectedCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => toggleCandidateSelection(candidate.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      {candidate.firstName} {candidate.lastName}
                      <X className="h-3 w-3" />
                    </button>
                  ))
                ) : (
                  <span className="text-sm text-indigo-700">No candidates selected yet.</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={clearSelection}>
                Clear selection
              </Button>
              <Button type="button" className="rounded-full gap-2" disabled={selectedCandidates.length < 2} onClick={openCompare}>
                <Columns3 className="h-4 w-4" />
                Compare selected
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Select</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">CV</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={8} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={8} className="p-12 text-center text-slate-500">No candidates found.</td></tr>
              ) : filteredCandidates.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <Checkbox
                      checked={selectedCandidateIds.includes(c.id)}
                      onCheckedChange={() => toggleCandidateSelection(c.id)}
                      aria-label={`Select ${c.firstName} ${c.lastName} for compare`}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600">
                        <UserCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                        <div className="text-sm text-slate-500">{c.email}</div>
                        <div className="mt-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getParseBadge(c.parseStatus, c.parseReviewRequired).className}`}>
                            {getParseBadge(c.parseStatus, c.parseReviewRequired).label}
                          </span>
                          {(() => {
                            const { englishLevel } = parseCandidateTags(c.tags);
                            return englishLevel ? (
                              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                English {englishLevel}
                              </span>
                            ) : null;
                          })()}
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {getCandidateCompleteness(c)}% complete
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-700">{c.roleTitle}</td>
                  <td className="px-6 py-4 text-slate-600">{c.vendorCompanyName}</td>
                  <td className="px-6 py-4">
                    {c.cvUrl ? (
                      <PrivateObjectLink
                        objectPath={c.cvUrl}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="w-4 h-4" /> View CV
                      </PrivateObjectLink>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Missing
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(c.submittedAt), 'MMM d, yyyy')}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/candidates/${c.id}`}
                        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Eye className="h-3.5 w-3.5" /> Details
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100"
                        disabled={updatingStatus && pendingCandidateId === c.id}
                        onClick={() => requestStatusUpdate(c.id, c.status === "pending_approval" ? "screening" : "submitted")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> {c.status === "pending_approval" ? "Approve" : "Re-approve"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-1.5 border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100"
                        disabled={updatingStatus && pendingCandidateId === c.id}
                        onClick={() => requestStatusUpdate(c.id, "rejected")}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Select
                        value={c.status}
                        onValueChange={(value) => requestStatusUpdate(c.id, value as CandidateStatusValue)}
                        disabled={updatingStatus && pendingCandidateId === c.id}
                      >
                        <SelectTrigger className="h-9 min-w-[140px] rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder={updatingStatus && pendingCandidateId === c.id ? "Updating..." : undefined} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="screening">Screening</SelectItem>
                          <SelectItem value="interview">Interview</SelectItem>
                          <SelectItem value="offer">Offer</SelectItem>
                          <SelectItem value="hired">Hired</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                    ? "Example: Candidate does not yet meet the role's core requirements."
                    : "Example: Candidate is a strong match and should move to the screening stage."
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
      </DashboardLayout>
  );
}
