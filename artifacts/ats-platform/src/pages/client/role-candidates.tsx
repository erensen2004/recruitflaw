import { useState } from "react";
import { useGetRole, useListCandidates, useUpdateCandidateStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserCircle, Loader2, ArrowLeft, FileText, MapPin, Eye } from "lucide-react";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import { ReviewThreadPanel } from "@/components/review-thread-panel";
import {
  formatTurkishLira,
  getStatusReasonDescription,
  getStatusReasonTitle,
  parseCandidateTags,
  requiresStatusReason,
} from "@/lib/candidate-display";
import { getRoleSummaryLines } from "@/lib/role-display";
import { PrivateObjectLink } from "@/components/private-object-link";

const CANDIDATE_STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

function getParseBadge(parseStatus: string, reviewRequired: boolean) {
  if (parseStatus === "parsed" && !reviewRequired) {
    return { label: "Parsed", className: "bg-emerald-100 text-emerald-700" };
  }
  if (parseStatus === "partial" || reviewRequired) {
    return { label: "Review", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Manual", className: "bg-slate-100 text-slate-700" };
}

export default function ClientRoleCandidates() {
  const [, clientParams] = useRoute("/client/roles/:id/candidates");
  const [, adminParams] = useRoute("/admin/roles/:id/candidates");
  const params = clientParams ?? adminParams;
  const roleId = Number(params?.id);
  const isAdminRoute = Boolean(adminParams?.id);

  const { data: role } = useGetRole(roleId);
  const { data: candidates, isLoading } = useListCandidates({ roleId });
  const [pendingCandidateId, setPendingCandidateId] = useState<number | null>(null);
  const [statusReasonOpen, setStatusReasonOpen] = useState(false);
  const [statusReasonTarget, setStatusReasonTarget] = useState<CandidateStatusValue | null>(null);
  const [statusReasonCandidateId, setStatusReasonCandidateId] = useState<number | null>(null);
  const [statusReasonText, setStatusReasonText] = useState("");
  const [statusReasonError, setStatusReasonError] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const submitStatusUpdate = (candidateId: number, status: CandidateStatusValue, reason?: string) => {
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (updatingStatus || currentCandidate?.status === status) return;
    setPendingCandidateId(candidateId);
    updateStatus({ id: candidateId, data: { status, ...(reason ? { reason } : {}) } });
  };

  const requestStatusUpdate = (candidateId: number, status: CandidateStatusValue) => {
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (updatingStatus || currentCandidate?.status === status) return;
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

  const backHref = isAdminRoute ? "/admin/roles" : "/client/roles";
  const detailHrefBase = isAdminRoute ? "/admin/candidates" : "/client/candidates";
  const roleCandidatesHref = isAdminRoute ? `/admin/roles/${roleId}/candidates` : `/client/roles/${roleId}/candidates`;
  const roleDetails = role ? getRoleSummaryLines(role) : null;

  return (
    <DashboardLayout allowedRoles={["client", "admin"]}>
      <div className="space-y-6">
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Roles
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">{role?.title || "Role"} — Candidates</h1>
          <p className="text-slate-500 mt-1">
            Review the approved hiring brief, then move candidates through the shared admin-controlled workflow.
          </p>
        </div>

        {role ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-900">{role.title}</h2>
                  <StatusBadge status={role.status} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  {role.companyName ? <span>{role.companyName}</span> : null}
                  {role.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {role.location}
                    </span>
                  ) : null}
                  {roleDetails?.workModeLabel ? <span>{roleDetails.workModeLabel}</span> : null}
                  {roleDetails?.employmentTypeLabel ? <span>{roleDetails.employmentTypeLabel}</span> : null}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pipeline state</div>
                <div className="mt-1 text-xs font-semibold text-slate-800">
                  {role.status === "published" ? "Open for approved candidates" : role.status === "on_hold" ? "Temporarily paused" : role.status === "closed" ? "Closed role" : "Still under admin review"}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[2fr,1fr]">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Role brief</div>
                <div className="mt-1.5 line-clamp-3 text-xs leading-5 text-slate-700">
                  {roleDetails?.descriptionBody || "The admin team has not added a detailed hiring brief yet."}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Required skills</div>
                <div className="mt-1.5 line-clamp-3 text-xs leading-5 text-slate-700">{role.skills || "No skills specified"}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Candidate</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Submitted By</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Salary Req.</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">CV</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Submitted</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="w-56 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Update Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
                ) : candidates?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center">
                      <UserCircle className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      <p className="font-medium text-slate-500">No candidates submitted yet</p>
                      <p className="mt-1 text-sm text-slate-400">Approved vendor submissions will appear here for this role.</p>
                    </td>
                  </tr>
                ) : (candidates ?? []).map((candidate) => {
                  const parseBadge = getParseBadge(candidate.parseStatus, candidate.parseReviewRequired);
                  const { englishLevel } = parseCandidateTags(candidate.tags);
                  return (
                    <tr key={candidate.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                            <UserCircle className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{candidate.firstName} {candidate.lastName}</div>
                            <div className="text-xs text-slate-500">{candidate.email}{candidate.phone ? ` • ${candidate.phone}` : ""}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${parseBadge.className}`}>
                                {parseBadge.label}
                              </span>
                              {englishLevel ? (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                  English {englishLevel}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-600">{candidate.vendorCompanyName}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatTurkishLira(candidate.expectedSalary)}</td>
                      <td className="px-4 py-3">
                        {candidate.cvUrl ? (
                          <PrivateObjectLink
                            objectPath={candidate.cvUrl}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-all hover:text-primary/80 hover:underline active:scale-[0.98]"
                          >
                            <FileText className="h-4 w-4" /> View CV
                          </PrivateObjectLink>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{format(new Date(candidate.submittedAt), "MMM d, yyyy")}</td>
                      <td className="px-4 py-3"><StatusBadge status={candidate.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`${detailHrefBase}/${candidate.id}?back=${encodeURIComponent(roleCandidatesHref)}`}
                            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Link>
                          <Select
                            value={candidate.status}
                            onValueChange={(value) => requestStatusUpdate(candidate.id, value as CandidateStatusValue)}
                            disabled={updatingStatus && pendingCandidateId === candidate.id}
                          >
                            <SelectTrigger
                              className={cn(
                                "h-8 min-w-[132px] rounded-lg text-xs transition-all",
                                updatingStatus && pendingCandidateId === candidate.id && "border-primary/50 bg-primary/5 text-primary",
                              )}
                            >
                              <SelectValue placeholder={updatingStatus && pendingCandidateId === candidate.id ? "Updating..." : undefined} />
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
                  );
                })
                }
              </tbody>
            </table>
          </div>
        </div>

        <ReviewThreadPanel
          scopeType="role"
          scopeId={roleId}
          actorRole={isAdminRoute ? "admin" : "client"}
          title="Role review thread"
          description="Use this scoped thread for role clarifications, shortlist alignment, and decision feedback tied to this hiring brief."
        />

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
                    ? "Example: Missing required seniority for this role."
                    : "Example: Candidate is ready for a structured interview with the client team."
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
      </div>
    </DashboardLayout>
  );
}
