import { useState } from "react";
import { useGetRole, useListCandidates, useUpdateCandidateStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CalendarClock } from "lucide-react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";
import { ReviewThreadPanel } from "@/components/review-thread-panel";
import { InterviewIntakeRequestDialog } from "@/components/interview-workflow";
import {
  formatTurkishLira,
  getStatusReasonTitle,
  requiresStatusReason,
} from "@/lib/candidate-display";
import { getRoleSummaryLines } from "@/lib/role-display";
import { PrivateObjectLink } from "@/components/private-object-link";

const CANDIDATE_STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

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
  const [interviewDialogOpen, setInterviewDialogOpen] = useState(false);
  const [selectedInterviewCandidateIds, setSelectedInterviewCandidateIds] = useState<number[]>([]);
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

  const openInterviewDialog = (candidateId?: number) => {
    if (candidateId != null) setSelectedInterviewCandidateIds([candidateId]);
    setInterviewDialogOpen(true);
  };

  const toggleInterviewCandidate = (candidateId: number, checked: boolean) => {
    setSelectedInterviewCandidateIds((current) => {
      if (checked) return Array.from(new Set([...current, candidateId]));
      return current.filter((id) => id !== candidateId);
    });
  };

  const backHref = isAdminRoute ? "/admin/roles" : "/client/roles";
  const detailHrefBase = isAdminRoute ? "/admin/candidates" : "/client/candidates";
  const roleCandidatesHref = isAdminRoute ? `/admin/roles/${roleId}/candidates` : `/client/roles/${roleId}/candidates`;
  const roleDetails = role ? getRoleSummaryLines(role) : null;
  const selectedInterviewCandidate =
    selectedInterviewCandidateIds.length === 1 ? candidates?.find((candidate) => candidate.id === selectedInterviewCandidateIds[0]) ?? null : null;
  const selectedInterviewCandidates = (candidates ?? [])
    .filter((candidate) => selectedInterviewCandidateIds.includes(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      name: `${candidate.firstName} ${candidate.lastName}`.trim(),
      email: candidate.email ?? null,
    }));

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
          <p className="text-slate-500 mt-1">Review candidates and keep the shortlist moving.</p>
        </div>

        {role ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{role.title}</h2>
                  <StatusBadge status={role.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
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
            </div>

            <div className="mt-3 rounded-xl bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Brief:</span>{" "}
              {roleDetails?.descriptionBody || "No brief yet."}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-700">Skills:</span>{" "}
              {role.skills || "None listed"}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-900">{selectedInterviewCandidateIds.length} selected</p>
            <p className="text-xs text-slate-500">Select multiple candidates for one admin-managed interview request.</p>
          </div>
          {!isAdminRoute ? (
            <Button type="button" className="rounded-xl gap-2" disabled={!selectedInterviewCandidateIds.length} onClick={() => openInterviewDialog()}>
              <CalendarClock className="h-4 w-4" />
              Request interviews
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 xl:grid xl:grid-cols-[36px_minmax(0,2.3fr)_minmax(140px,1fr)_minmax(110px,0.8fr)_minmax(110px,0.9fr)_minmax(88px,0.7fr)_minmax(240px,1.45fr)] xl:gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"></div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted by</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Salary</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">CV</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Actions</div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : candidates?.length === 0 ? (
            <div className="p-10 text-center">
              <UserCircle className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-500">No candidates submitted yet</p>
              <p className="mt-1 text-sm text-slate-400">Approved vendor submissions will appear here for this role.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {(candidates ?? []).map((candidate) => {
                return (
                  <div
                    key={candidate.id}
                    className="px-4 py-1.5 transition-colors hover:bg-slate-50/70"
                  >
                    <div className="flex flex-col gap-2 xl:grid xl:grid-cols-[36px_minmax(0,2.15fr)_minmax(130px,0.95fr)_minmax(98px,0.75fr)_minmax(98px,0.8fr)_minmax(84px,0.65fr)_minmax(220px,1.35fr)] xl:items-center xl:gap-2.5">
                      <div className="hidden xl:flex">
                        {!isAdminRoute ? (
                          <Checkbox
                            checked={selectedInterviewCandidateIds.includes(candidate.id)}
                            onCheckedChange={(checked) => toggleInterviewCandidate(candidate.id, checked === true)}
                            aria-label={`Select ${candidate.firstName} ${candidate.lastName}`}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                            <UserCircle className="h-4.5 w-4.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {candidate.firstName} {candidate.lastName}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">
                              {candidate.email}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="truncate text-[11px] font-medium text-slate-600 xl:text-xs">
                        {candidate.vendorCompanyName || "—"}
                      </div>

                      <div className="text-[11px] text-slate-600 xl:text-xs">
                        {formatTurkishLira(candidate.expectedSalary)}
                      </div>

                      <div className="xl:min-w-0">
                        <StatusBadge status={candidate.status} />
                      </div>

                      <div className="text-[11px] xl:text-xs">
                        {candidate.cvUrl ? (
                          <PrivateObjectLink
                            objectPath={candidate.cvUrl}
                            className="inline-flex items-center gap-1 text-primary transition-all hover:text-primary/80 hover:underline active:scale-[0.98]"
                          >
                            <FileText className="h-3.5 w-3.5" /> CV
                          </PrivateObjectLink>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 xl:justify-end">
                        {!isAdminRoute ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-[30px] rounded-lg border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 hover:border-primary hover:text-primary"
                            onClick={() => openInterviewDialog(candidate.id)}
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Interview
                          </Button>
                        ) : null}
                        <Link
                          href={`${detailHrefBase}/${candidate.id}?back=${encodeURIComponent(roleCandidatesHref)}`}
                          className="inline-flex h-[30px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Details
                        </Link>
                        <Select
                          value={candidate.status}
                          onValueChange={(value) => requestStatusUpdate(candidate.id, value as CandidateStatusValue)}
                          disabled={updatingStatus && pendingCandidateId === candidate.id}
                        >
                          <SelectTrigger
                            className={cn(
                              "h-[30px] min-w-[132px] rounded-lg text-[11px] transition-all",
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <ReviewThreadPanel
          scopeType="role"
          scopeId={roleId}
          actorRole={isAdminRoute ? "admin" : "client"}
          title="Role notes"
          description="Use this thread for shortlist notes."
        />

        <Dialog open={statusReasonOpen} onOpenChange={(open) => (open ? setStatusReasonOpen(true) : closeStatusReasonDialog())}>
          <DialogContent className="sm:max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle>{getStatusReasonTitle(statusReasonTarget)}</DialogTitle>
              <DialogDescription>Keep it to one short reason.</DialogDescription>
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
                placeholder={statusReasonTarget === "rejected" ? "Short rejection reason." : "Short reason for the status change."}
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

        <InterviewIntakeRequestDialog
          open={interviewDialogOpen}
          onOpenChange={(open) => {
            setInterviewDialogOpen(open);
            if (!open) setSelectedInterviewCandidateIds([]);
          }}
          roleId={roleId}
          roleTitle={role?.title || "Role"}
          candidates={selectedInterviewCandidates.length ? selectedInterviewCandidates : selectedInterviewCandidate ? [{
            id: selectedInterviewCandidate.id,
            name: `${selectedInterviewCandidate.firstName} ${selectedInterviewCandidate.lastName}`.trim(),
            email: selectedInterviewCandidate.email ?? null,
          }] : []}
        />
      </div>
    </DashboardLayout>
  );
}
