import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { invalidateCandidateQueries } from "@/lib/candidate-query";
import {
  acceptInterviewProposal,
  addInterviewMeeting,
  cancelInterviewMeeting,
  completeInterviewMeeting,
  createInterviewRequest,
  fetchCandidateInterviewBundle,
  formatInterviewSlot,
  submitInterviewProposal,
  type CandidateInterviewBundle,
  type InterviewProposalInput,
  type InterviewRole,
  type InterviewMeeting,
  type InterviewProposal,
  type InterviewInboxItem,
  fetchInterviewInbox,
  type InterviewInboxView,
} from "@/lib/interviews";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Loader2, MessageSquare, PartyPopper, Sparkles } from "lucide-react";

const DEFAULT_TIMEZONE = "Europe/Istanbul";

type ProposalDialogMode = "request" | "counter";

function getRoleLabel(role?: InterviewRole | null) {
  if (!role) return "Team";
  if (role === "admin") return "Admin";
  if (role === "client") return "Client";
  return "Vendor";
}

function formatActivityLabel(eventType: string) {
  switch (eventType) {
    case "process_opened":
      return "Process opened";
    case "meeting_added":
      return "Meeting added";
    case "proposal_created":
      return "Proposal created";
    case "proposal_accepted":
      return "Proposal accepted";
    case "meeting_completed":
      return "Meeting completed";
    case "meeting_cancelled":
      return "Meeting cancelled";
    case "process_closed":
      return "Process closed";
    default:
      return eventType.replace(/_/g, " ");
  }
}

function getLatestPendingProposal(meetings: InterviewMeeting[], proposals: InterviewProposal[]) {
  const activeMeetingIds = meetings.filter((meeting) => meeting.status !== "cancelled").map((meeting) => meeting.id);
  const sorted = [...proposals]
    .filter((proposal) => activeMeetingIds.includes(proposal.meetingId) && proposal.responseStatus === "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return sorted[0] ?? null;
}

function getActiveMeeting(meetings: InterviewMeeting[]) {
  return (
    [...meetings]
      .sort((left, right) => right.meetingIndex - left.meetingIndex || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .find((meeting) => meeting.status === "negotiating" || meeting.status === "scheduled") ?? null
  );
}

function useInterviewProposalForm(initialMode: ProposalDialogMode, initialDate?: string | null) {
  const [proposalType, setProposalType] = useState<"exact_slot" | "flexible_window">("exact_slot");
  const [proposedDate, setProposedDate] = useState(initialDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [windowLabel, setWindowLabel] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [durationMinutes, setDurationMinutes] = useState("45");
  const [note, setNote] = useState("");

  useEffect(() => {
    setProposalType("exact_slot");
    setProposedDate(initialDate ?? new Date().toISOString().slice(0, 10));
    setStartTime("");
    setEndTime("");
    setWindowLabel("");
    setTimezone(DEFAULT_TIMEZONE);
    setDurationMinutes("45");
    setNote("");
  }, [initialDate, initialMode]);

  return {
    proposalType,
    setProposalType,
    proposedDate,
    setProposedDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    windowLabel,
    setWindowLabel,
    timezone,
    setTimezone,
    durationMinutes,
    setDurationMinutes,
    note,
    setNote,
  };
}

function InterviewProposalDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialDate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initialDate?: string | null;
  onSubmit: (payload: InterviewProposalInput) => Promise<void>;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const form = useInterviewProposalForm("request", initialDate);
  const {
    setProposalType,
    setProposedDate,
    setStartTime,
    setEndTime,
    setWindowLabel,
    setTimezone,
    setDurationMinutes,
    setNote,
  } = form;

  useEffect(() => {
    if (!open) return;
    setProposalType("exact_slot");
    setProposedDate(initialDate ?? new Date().toISOString().slice(0, 10));
    setStartTime("");
    setEndTime("");
    setWindowLabel("");
    setTimezone(DEFAULT_TIMEZONE);
    setDurationMinutes("45");
    setNote("");
  }, [initialDate, open, setDurationMinutes, setEndTime, setNote, setProposalType, setProposedDate, setStartTime, setTimezone, setWindowLabel]);

  const submit = async () => {
    const durationMinutes = Number(form.durationMinutes);
    if (!form.proposedDate.trim()) {
      toast({ title: "Choose a date", description: "The meeting needs a date before it can be sent.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      toast({ title: "Choose a duration", description: "The meeting duration must be greater than zero.", variant: "destructive" });
      return;
    }
    if (form.proposalType === "exact_slot" && !form.startTime.trim()) {
      toast({ title: "Choose a start time", description: "Exact-slot proposals need a start time.", variant: "destructive" });
      return;
    }
    if (!form.timezone.trim()) {
      toast({ title: "Choose a timezone", description: "Please pick the working timezone for this request.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        proposalType: form.proposalType,
        proposedDate: form.proposedDate.trim(),
        startTime: form.startTime.trim() || null,
        endTime: form.endTime.trim() || null,
        windowLabel: form.proposalType === "flexible_window" ? form.windowLabel.trim() || null : null,
        timezone: form.timezone.trim(),
        durationMinutes,
        note: form.note.trim() || null,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Interview request failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-3xl border-slate-200">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Proposal type</label>
            <Select value={form.proposalType} onValueChange={(value) => setProposalType(value as "exact_slot" | "flexible_window")}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder="Choose proposal type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exact_slot">Exact slot</SelectItem>
                <SelectItem value="flexible_window">Flexible window</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Date</label>
            <Input type="date" value={form.proposedDate} onChange={(event) => setProposedDate(event.target.value)} className="h-10 rounded-xl" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Timezone</label>
            <Input value={form.timezone} onChange={(event) => setTimezone(event.target.value)} className="h-10 rounded-xl" placeholder="Europe/Istanbul" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Start time</label>
            <Input type="time" value={form.startTime} onChange={(event) => setStartTime(event.target.value)} className="h-10 rounded-xl" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Duration</label>
            <Input type="number" min={15} step={15} value={form.durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} className="h-10 rounded-xl" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Window label</label>
            <Input
              value={form.windowLabel}
              onChange={(event) => setWindowLabel(event.target.value)}
              className="h-10 rounded-xl"
              placeholder={form.proposalType === "flexible_window" ? "Morning / afternoon / custom window" : "Optional note for flexible requests"}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Note</label>
            <Textarea
              value={form.note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="resize-none rounded-xl"
              placeholder="Add a short scheduling note or context for the other side."
            />
          </div>

          {form.proposalType === "flexible_window" ? (
            <div className="md:col-span-2 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Flexible windows keep the thread structured while still giving the other side room to propose the exact slot.
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="rounded-xl gap-2" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InterviewWorkflowPanel({
  candidateId,
  candidateName,
  candidateStatus,
  roleTitle,
  roleId,
  vendorCompanyName,
  clientCompanyName,
  compact = false,
}: {
  candidateId: number;
  candidateName: string;
  candidateStatus: string;
  roleTitle: string;
  roleId: number;
  vendorCompanyName?: string | null;
  clientCompanyName?: string | null;
  compact?: boolean;
}) {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bundle, setBundle] = useState<CandidateInterviewBundle>({ process: null, meetings: [], proposals: [], activities: [] });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("Request interview");
  const [dialogDescription, setDialogDescription] = useState("Create a structured interview request for this candidate.");
  const [dialogSubmitLabel, setDialogSubmitLabel] = useState("Send request");
  const [dialogHandler, setDialogHandler] = useState<((payload: InterviewProposalInput) => Promise<void>) | null>(null);

  const currentRole = (me?.role ?? null) as InterviewRole | null;
  const isVendor = currentRole === "vendor";
  const isClient = currentRole === "client";
  const isAdmin = currentRole === "admin";
  const bundleProcess = bundle.process;
  const activeMeeting = useMemo(() => getActiveMeeting(bundle.meetings), [bundle.meetings]);
  const pendingProposal = useMemo(() => getLatestPendingProposal(bundle.meetings, bundle.proposals), [bundle.meetings, bundle.proposals]);

  const loadBundle = async () => {
    setLoading(true);
    try {
      const next = await fetchCandidateInterviewBundle(candidateId);
      setBundle(next);
    } catch (error) {
      toast({
        title: "Interview workflow unavailable",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, refreshKey]);

  const refresh = async () => {
    setRefreshKey((value) => value + 1);
    await invalidateCandidateQueries(queryClient, candidateId);
  };

  const openRequestDialog = (mode: ProposalDialogMode) => {
    setDialogTitle(mode === "request" ? "Request interview" : "Propose new time");
    setDialogDescription(
      mode === "request"
        ? `Send the first structured interview request for ${candidateName}.`
        : `Suggest another time for the current interview thread with ${candidateName}.`,
    );
    setDialogSubmitLabel(mode === "request" ? "Send request" : "Send proposal");
    setDialogHandler(() => async (payload: InterviewProposalInput) => {
      if (mode === "request" && (!bundleProcess || bundleProcess.status === "closed")) {
        await createInterviewRequest(candidateId, payload);
      } else if (mode === "request" && bundleProcess && !activeMeeting) {
        await addInterviewMeeting(bundleProcess.id, payload);
      } else {
        const meeting = activeMeeting ?? bundle.meetings[0];
        if (!meeting) {
          throw new Error("No active meeting was found for the interview thread.");
        }
        await submitInterviewProposal(meeting.id, payload);
      }
      await refresh();
      toast({ title: mode === "request" ? "Interview requested" : "Proposal sent" });
    });
    setDialogOpen(true);
  };

  const acceptProposal = async (proposalId: number) => {
    try {
      await acceptInterviewProposal(proposalId);
      await refresh();
      toast({ title: "Interview slot confirmed" });
    } catch (error) {
      toast({
        title: "Could not confirm interview",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const completeMeeting = async () => {
    if (!activeMeeting) return;
    try {
      const reason = window.prompt("Optional summary note for completion", "")?.trim() || null;
      await completeInterviewMeeting(activeMeeting.id, reason);
      await refresh();
      toast({ title: "Meeting marked complete" });
    } catch (error) {
      toast({
        title: "Could not complete the meeting",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const cancelMeeting = async () => {
    if (!activeMeeting) return;
    try {
      const reason = window.prompt("Optional cancellation reason", "")?.trim() || null;
      await cancelInterviewMeeting(activeMeeting.id, reason);
      await refresh();
      toast({ title: "Meeting cancelled" });
    } catch (error) {
      toast({
        title: "Could not cancel the meeting",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const canInitiate = isClient && (!bundleProcess || bundleProcess.status === "closed" || !activeMeeting);
  const canCounter = Boolean(activeMeeting && bundleProcess && bundleProcess.status === "open");
  const canActOnProposal = Boolean(pendingProposal && pendingProposal.responseStatus === "pending");
  const latestSlotLabel =
    bundleProcess?.nextScheduledDate || activeMeeting
      ? formatInterviewSlot({
          scheduledDate: bundleProcess?.nextScheduledDate ?? activeMeeting?.scheduledDate ?? null,
          scheduledStartTime: bundleProcess?.nextScheduledStartTime ?? activeMeeting?.scheduledStartTime ?? null,
          scheduledEndTime: bundleProcess?.nextScheduledEndTime ?? activeMeeting?.scheduledEndTime ?? null,
          timezone: bundleProcess?.nextScheduledTimezone ?? activeMeeting?.timezone ?? null,
        })
      : null;

  return (
    <div className={compact ? "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" : "rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Interview process</h3>
            <StatusBadge status={bundleProcess?.status ?? "open"} />
            {bundleProcess ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{bundle.meetings.length} meeting{bundle.meetings.length === 1 ? "" : "s"}</span> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {candidateName} {bundleProcess ? "already has a structured thread." : "has no interview thread yet."}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {vendorCompanyName ? `Vendor: ${vendorCompanyName}` : null}
            {clientCompanyName ? `${vendorCompanyName ? " • " : ""}Client: ${clientCompanyName}` : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {bundleProcess?.awaitingResponseFrom ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
              Awaiting {getRoleLabel(bundleProcess.awaitingResponseFrom)} response
            </span>
          ) : null}
          {latestSlotLabel ? <span className="text-right text-xs text-slate-500">{latestSlotLabel}</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current state</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{bundleProcess ? bundleProcess.status : "No active process"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next slot</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{latestSlotLabel || "Pending request"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Awaiting</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{bundleProcess?.awaitingResponseFrom ? getRoleLabel(bundleProcess.awaitingResponseFrom) : "No response needed"}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : !bundleProcess ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">No interview thread yet</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Use a structured request to start the process. The thread will keep the proposals, counters, and final scheduled slot together.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {canInitiate ? (
              <Button type="button" className="rounded-xl gap-2" onClick={() => openRequestDialog("request")}>
                <CalendarClock className="h-4 w-4" />
                Request Interview
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Active meeting</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {activeMeeting ? `Meeting #${activeMeeting.meetingIndex + 1}` : "No active meeting"}
                </p>
              </div>
              {activeMeeting ? <StatusBadge status={activeMeeting.status} /> : null}
            </div>
            {activeMeeting ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Scheduled slot</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {formatInterviewSlot({
                      scheduledDate: activeMeeting.scheduledDate,
                      scheduledStartTime: activeMeeting.scheduledStartTime,
                      scheduledEndTime: activeMeeting.scheduledEndTime,
                      timezone: activeMeeting.timezone,
                    })}
                  </p>
                </div>
                <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Latest proposal</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {pendingProposal
                      ? formatInterviewSlot({
                          proposedDate: pendingProposal.proposedDate,
                          startTime: pendingProposal.startTime,
                          endTime: pendingProposal.endTime,
                          timezone: pendingProposal.timezone,
                        })
                      : "No pending proposal"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Timeline</p>
                  <span className="text-xs text-slate-400">{bundle.activities.length} event{bundle.activities.length === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {bundle.activities.length ? (
                    bundle.activities.slice(0, 6).map((activity) => (
                      <div key={activity.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-800">{formatActivityLabel(activity.eventType)}</p>
                          <p className="text-xs text-slate-400">{new Date(activity.createdAt).toLocaleString()}</p>
                        </div>
                        {activity.actorRole ? (
                          <p className="mt-1 text-xs text-slate-500">{getRoleLabel(activity.actorRole)} team</p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">No interview events yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Meetings</p>
                <div className="mt-3 space-y-2">
                  {bundle.meetings.length ? (
                    bundle.meetings.map((meeting) => (
                      <div key={meeting.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Meeting #{meeting.meetingIndex + 1}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatInterviewSlot({
                                scheduledDate: meeting.scheduledDate,
                                scheduledStartTime: meeting.scheduledStartTime,
                                scheduledEndTime: meeting.scheduledEndTime,
                                timezone: meeting.timezone,
                              })}
                            </p>
                          </div>
                          <StatusBadge status={meeting.status} />
                        </div>
                        {meeting.summaryNote ? <p className="mt-2 text-sm leading-6 text-slate-600">{meeting.summaryNote}</p> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">Meetings will appear here once a request is sent.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Current proposal</p>
                  {pendingProposal ? <StatusBadge status={pendingProposal.responseStatus} /> : null}
                </div>
                {pendingProposal ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Proposed by</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{getRoleLabel(pendingProposal.proposedByRole)}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {formatInterviewSlot({
                          proposedDate: pendingProposal.proposedDate,
                          startTime: pendingProposal.startTime,
                          endTime: pendingProposal.endTime,
                          timezone: pendingProposal.timezone,
                        })}
                      </p>
                      {pendingProposal.note ? <p className="mt-2 text-sm leading-6 text-slate-500">{pendingProposal.note}</p> : null}
                    </div>

                    {pendingProposal.responseStatus === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        {(isClient || isAdmin || isVendor) ? (
                          <Button type="button" className="rounded-xl gap-2" onClick={() => void acceptProposal(pendingProposal.id)}>
                            <CheckCircle2 className="h-4 w-4" />
                            Accept
                          </Button>
                        ) : null}
                        {canCounter ? (
                          <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => openRequestDialog("counter")}>
                            <ArrowRight className="h-4 w-4" />
                            Counter
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">No pending proposal is waiting for action.</div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Actions</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canInitiate ? (
                    <Button type="button" className="rounded-xl gap-2" onClick={() => openRequestDialog("request")}>
                      <CalendarClock className="h-4 w-4" />
                      Request Interview
                    </Button>
                  ) : null}
                  {canCounter ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => openRequestDialog("counter")}>
                      <ArrowRight className="h-4 w-4" />
                      Propose New Time
                    </Button>
                  ) : null}
                  {activeMeeting?.status === "scheduled" && (isClient || isAdmin) ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => void completeMeeting()}>
                      <PartyPopper className="h-4 w-4" />
                      Mark Completed
                    </Button>
                  ) : null}
                  {activeMeeting && (isClient || isAdmin) ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => void cancelMeeting()}>
                      <AlertTriangle className="h-4 w-4" />
                      Cancel
                    </Button>
                  ) : null}
                </div>
                <p className="mt-3 text-xs leading-6 text-slate-400">
                  Interview scheduling stays structured and compact. The active process only closes when the candidate leaves the interview pipeline.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <InterviewProposalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={dialogTitle}
        description={dialogDescription}
        submitLabel={dialogSubmitLabel}
        initialDate={activeMeeting?.scheduledDate ?? bundleProcess?.nextScheduledDate ?? undefined}
        onSubmit={async (payload) => {
          if (!dialogHandler) return;
          await dialogHandler(payload);
        }}
      />
    </div>
  );
}

export function InterviewRequestDialog({
  open,
  onOpenChange,
  candidateName,
  roleTitle,
  onSubmit,
  submitLabel = "Send request",
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName: string;
  roleTitle: string;
  onSubmit: (payload: InterviewProposalInput) => Promise<void>;
  submitLabel?: string;
  description?: string;
}) {
  return (
    <InterviewProposalDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Interview request for ${candidateName}`}
      description={description ?? `Start a structured interview thread for ${roleTitle}.`}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
    />
  );
}

export function InterviewInboxPage({
  view,
  items,
  loading,
  onRefresh,
  roleBase,
  onViewChange,
}: {
  view: InterviewInboxView;
  items: InterviewInboxItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  roleBase: string;
  onViewChange: (view: InterviewInboxView) => void;
}) {
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (view === "needs_action") return item.needsAction || Boolean(item.awaitingResponseFrom);
      if (view === "scheduled") return item.currentMeeting?.status === "scheduled";
      if (view === "history") return item.process.status === "closed" || ["completed", "cancelled"].includes(item.currentMeeting?.status ?? "");
      return true;
    });

    return [...filtered].sort((left, right) => {
      const leftTime = left.latestActivityAt ?? left.process.updatedAt;
      const rightTime = right.latestActivityAt ?? right.process.updatedAt;
      return new Date(rightTime).getTime() - new Date(leftTime).getTime();
    });
  }, [items, view]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["needs_action", "Needs action"],
          ["scheduled", "Scheduled"],
          ["history", "History"],
          ["all", "All"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onViewChange(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${view === key ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-primary/30 hover:text-primary"}`}
          >
            {label}
          </button>
        ))}
        <Button type="button" variant="ghost" className="rounded-full text-slate-500" onClick={() => void onRefresh()}>
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="hidden border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] xl:gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Role</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Current state</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Next slot</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Awaiting</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Action</div>
        </div>

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : visibleItems.length ? (
          <div className="divide-y divide-slate-100">
            {visibleItems.map((item) => (
              <Link
                key={item.process.id}
                href={`${roleBase}/candidates/${item.candidate.id}`}
                className="block px-4 py-3 transition-colors hover:bg-slate-50/70"
              >
                <div className="grid gap-2 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] xl:items-center xl:gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {item.candidate.firstName} {item.candidate.lastName}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {item.candidate.email || "Email not provided"}
                    </div>
                  </div>
                  <div className="truncate text-[11px] text-slate-600 xl:text-xs">{item.role.title}</div>
                  <div className="xl:min-w-0">
                    <StatusBadge status={item.currentMeeting?.status ?? item.process.status} />
                  </div>
                  <div className="truncate text-[11px] text-slate-600 xl:text-xs">
                    {item.nextScheduledLabel || formatInterviewSlot({
                      scheduledDate: item.currentMeeting?.scheduledDate ?? item.process.nextScheduledDate ?? null,
                      scheduledStartTime: item.currentMeeting?.scheduledStartTime ?? item.process.nextScheduledStartTime ?? null,
                      scheduledEndTime: item.currentMeeting?.scheduledEndTime ?? item.process.nextScheduledEndTime ?? null,
                      timezone: item.currentMeeting?.timezone ?? item.process.nextScheduledTimezone ?? null,
                    })}
                  </div>
                  <div className="truncate text-[11px] text-slate-600 xl:text-xs">
                    {item.awaitingResponseFrom ? getRoleLabel(item.awaitingResponseFrom) : "No response"}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.needsAction ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {item.needsAction ? "Needs action" : "Open"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      Open <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-slate-500">
            <MessageSquare className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            No interview threads match this view yet.
          </div>
        )}
      </div>
    </div>
  );
}
