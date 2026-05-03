import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
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
  cancelInterviewRequest,
  cancelInterviewMeeting,
  completeInterviewMeeting,
  createInterviewRequest,
  createInterviewRequestBatch,
  declineInterviewProposal,
  dispatchInterviewRequest,
  fetchCandidateInterviewBundle,
  formatInterviewSlot,
  replyToInterviewRequestCandidate,
  scheduleInterviewRequestCandidate,
  submitInterviewProposal,
  type CandidateInterviewBundle,
  type InterviewRequestInput,
  type InterviewRequestDispatchInput,
  type InterviewRequestItem,
  type InterviewRequestInboxView,
  type InterviewRequestCandidate,
  type InterviewProposalInput,
  type InterviewRole,
  type InterviewMeeting,
  type InterviewProposal,
  type InterviewInboxItem,
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

function getSchedulingStateLabel(status?: string | null) {
  switch (status) {
    case "admin_review":
      return "Admin review";
    case "sent_to_vendor":
      return "Sent to vendor";
    case "vendor_replied":
      return "Vendor suggested another time";
    case "pending_admin":
      return "Admin review";
    case "scheduled":
      return "Scheduled";
    case "negotiating":
      return "Coordinating";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "closed":
      return "Closed";
    case "open":
      return "Open";
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Not available";
    case "superseded":
      return "Replaced";
    case "withdrawn":
      return "Withdrawn";
    default:
      return status ? status.replace(/_/g, " ") : "Pending";
  }
}

function getRequestOwnerLabel(status?: string | null) {
  switch (status) {
    case "admin_review":
    case "vendor_replied":
      return "Admin";
    case "sent_to_vendor":
      return "Vendor";
    case "scheduled":
    case "cancelled":
    case "closed":
      return "Closed";
    default:
      return "Admin";
  }
}

function getRequestNextAction(status?: string | null) {
  switch (status) {
    case "admin_review":
      return "Clean the client request and send it to vendors.";
    case "sent_to_vendor":
      return "Waiting for vendor availability.";
    case "vendor_replied":
      return "Review vendor reply and confirm or send an update.";
    case "scheduled":
      return "Interview details are confirmed.";
    case "cancelled":
      return "Request was cancelled.";
    case "closed":
      return "Request is closed.";
    default:
      return "Review scheduling request.";
  }
}

function getCandidateNextAction(roleBase: string, status?: string | null) {
  if (roleBase === "/vendor" && status === "sent_to_vendor") return "Reply to admin";
  if (roleBase === "/admin" && status === "pending_admin") return "Send vendor message";
  if (roleBase === "/admin" && status === "vendor_replied") return "Review reply";
  if (roleBase === "/admin" && status === "sent_to_vendor") return "Await vendor";
  if (status === "scheduled") return "Scheduled";
  if (status === "cancelled") return "Cancelled";
  if (status === "closed") return "Closed";
  return getSchedulingStateLabel(status);
}

function formatRelativeAge(value?: string | null) {
  if (!value) return "New";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "New";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatRelativeTimestamp(value?: string | null) {
  const age = formatRelativeAge(value);
  return age === "Just now" || age === "New" ? age : `${age} ago`;
}

function formatRelativeInline(value?: string | null) {
  const age = formatRelativeAge(value);
  return age === "Just now" ? "just now" : age.toLowerCase();
}

function getAgeToneClass(value?: string | null, isActionable = false) {
  const diffMs = value ? Date.now() - new Date(value).getTime() : 0;
  const hours = diffMs / 3_600_000;
  if (!isActionable) return "bg-slate-100 text-slate-600";
  if (hours >= 48) return "bg-rose-50 text-rose-700";
  if (hours >= 24) return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}

function getLatestRequestActivityMessage(request: InterviewRequestItem) {
  const latest = [...request.activity]
    .reverse()
    .find((activity) => {
      const payload = activity.payload ?? {};
      return typeof payload.messageText === "string" || typeof payload.finalDetails === "string";
    });
  const payload = latest?.payload ?? {};
  const message =
    typeof payload.finalDetails === "string"
      ? payload.finalDetails
      : typeof payload.messageText === "string"
        ? payload.messageText
        : null;
  return message?.trim() || null;
}

function getRequestActionTone(status?: string | null) {
  if (status === "admin_review" || status === "vendor_replied") return "Admin action";
  if (status === "sent_to_vendor") return "Vendor action";
  if (status === "scheduled") return "Scheduled";
  if (status === "cancelled" || status === "closed") return "Closed";
  return "Tracking";
}

function formatActivityLabel(eventType: string) {
  switch (eventType) {
    case "process_opened":
      return "Scheduling opened";
    case "meeting_added":
    case "meeting_opened":
      return "Meeting added";
    case "proposal_created":
      return "Time proposed";
    case "proposal_accepted":
      return "Slot confirmed";
    case "proposal_declined":
      return "Time declined";
    case "meeting_completed":
      return "Meeting completed";
    case "meeting_cancelled":
      return "Meeting cancelled";
    case "process_closed":
      return "Scheduling closed";
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
              placeholder={form.proposalType === "flexible_window" ? "Morning / afternoon / custom window" : "Optional note"}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Note</label>
            <Textarea
              value={form.note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="resize-none rounded-xl"
              placeholder="Short scheduling note."
            />
          </div>

          {form.proposalType === "flexible_window" ? (
            <div className="md:col-span-2 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Use a flexible window when the other side should reply with the exact slot.
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

export function InterviewIntakeRequestDialog({
  open,
  onOpenChange,
  roleId,
  roleTitle,
  candidates,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: number;
  roleTitle: string;
  candidates: Array<{ id: number; name: string; email?: string | null }>;
  onSubmitted?: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequestText("");
  }, [open]);

  const submit = async () => {
    const candidateIds = candidates.map((candidate) => candidate.id);
    if (!candidateIds.length) {
      toast({ title: "Select candidates", description: "Choose at least one candidate for the interview request.", variant: "destructive" });
      return;
    }
    if (!requestText.trim()) {
      toast({ title: "Add request details", description: "Write what the client wants the admin desk to coordinate.", variant: "destructive" });
      return;
    }

    const payload: InterviewRequestInput = {
      roleId,
      candidateIds,
      requestText: requestText.trim(),
    };

    setSubmitting(true);
    try {
      await createInterviewRequestBatch(payload);
      await onSubmitted?.();
      toast({ title: "Interview request sent", description: "The admin scheduling desk will coordinate the next step." });
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
          <DialogTitle>Request interviews</DialogTitle>
          <DialogDescription>
            Send a simple scheduling request to the admin desk. No exact slot is needed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Role</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{roleTitle}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((candidate) => (
                <span key={candidate.id} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  {candidate.name}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Request</label>
            <Textarea
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
              rows={5}
              className="resize-none rounded-xl"
              placeholder="Example: We can meet these three candidates next Wednesday afternoon. Please coordinate with the vendors and confirm workable options."
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="rounded-xl gap-2" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Send to admin desk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InterviewMessageDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  submitting,
  onSubmit,
  showReplyType = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (value: { messageText: string; replyType: "can_work" | "suggest_alternative" | "not_available" }) => Promise<void>;
  showReplyType?: boolean;
}) {
  const [messageText, setMessageText] = useState("");
  const [replyType, setReplyType] = useState<"can_work" | "suggest_alternative" | "not_available">("suggest_alternative");

  useEffect(() => {
    if (!open) return;
    setMessageText("");
    setReplyType("suggest_alternative");
  }, [open]);

  const submit = async () => {
    await onSubmit({ messageText: messageText.trim(), replyType });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl rounded-3xl border-slate-200">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {showReplyType ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Reply type</label>
              <Select value={replyType} onValueChange={(value) => setReplyType(value as typeof replyType)}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="can_work">Can work</SelectItem>
                  <SelectItem value="suggest_alternative">Suggest alternative</SelectItem>
                  <SelectItem value="not_available">Not available for now</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</label>
            <Textarea
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              rows={6}
              className="resize-none rounded-xl"
              placeholder={placeholder}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="rounded-xl gap-2" onClick={submit} disabled={submitting || !messageText.trim()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
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
  summaryOnly = false,
  inboxHref,
  onRequestInterview,
}: {
  candidateId: number;
  candidateName: string;
  candidateStatus: string;
  roleTitle: string;
  roleId: number;
  vendorCompanyName?: string | null;
  clientCompanyName?: string | null;
  compact?: boolean;
  summaryOnly?: boolean;
  inboxHref?: string;
  onRequestInterview?: () => void;
}) {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bundle, setBundle] = useState<CandidateInterviewBundle>({ process: null, meetings: [], proposals: [], activities: [] });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("Request interview");
  const [dialogDescription, setDialogDescription] = useState("Request an interview for this candidate.");
  const [dialogSubmitLabel, setDialogSubmitLabel] = useState("Send request");
  const [dialogHandler, setDialogHandler] = useState<((payload: InterviewProposalInput) => Promise<void>) | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  const currentRole = (me?.role ?? null) as InterviewRole | null;
  const isVendor = currentRole === "vendor";
  const isClient = currentRole === "client";
  const isAdmin = currentRole === "admin";
  const bundleProcess = bundle.process;
  const activeMeeting = useMemo(() => getActiveMeeting(bundle.meetings), [bundle.meetings]);
  const pendingProposal = useMemo(() => getLatestPendingProposal(bundle.meetings, bundle.proposals), [bundle.meetings, bundle.proposals]);
  const recentActivities = useMemo(() => bundle.activities.slice(0, 3), [bundle.activities]);

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
    setDialogTitle(mode === "request" ? "Request interview" : "Suggest another time");
    setDialogDescription(
      mode === "request"
        ? `Request a slot for ${candidateName}.`
        : `Send a cleaner alternative slot for ${candidateName}.`,
    );
    setDialogSubmitLabel(mode === "request" ? "Send request" : "Send suggestion");
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
      toast({ title: mode === "request" ? "Interview requested" : "Suggested time sent" });
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

  const declineProposal = async (proposalId: number) => {
    try {
      await declineInterviewProposal(proposalId, "Not available for now");
      await refresh();
      toast({ title: "Availability sent", description: "The admin desk can coordinate a new option." });
    } catch (error) {
      toast({
        title: "Could not decline proposal",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const completeMeeting = async () => {
    if (!activeMeeting) return;
    try {
      await completeInterviewMeeting(activeMeeting.id, null);
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
      const reason = "Cancelled from the interview workflow";
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

  const canInitiate = isAdmin && (!bundleProcess || bundleProcess.status === "closed" || !activeMeeting);
  const canRequestViaAdmin =
    isClient &&
    Boolean(onRequestInterview) &&
    ["submitted", "screening"].includes(candidateStatus) &&
    (!bundleProcess || bundleProcess.status === "closed" || !activeMeeting);
  const canCounter = Boolean((isAdmin || isVendor) && activeMeeting && bundleProcess && bundleProcess.status === "open");
  const canActOnProposal = Boolean((isAdmin || isVendor) && pendingProposal && pendingProposal.responseStatus === "pending" && pendingProposal.proposedByRole !== currentRole);
  const latestSlotLabel =
    bundleProcess?.nextScheduledDate || activeMeeting
      ? formatInterviewSlot({
          scheduledDate: bundleProcess?.nextScheduledDate ?? activeMeeting?.scheduledDate ?? null,
          scheduledStartTime: bundleProcess?.nextScheduledStartTime ?? activeMeeting?.scheduledStartTime ?? null,
          scheduledEndTime: bundleProcess?.nextScheduledEndTime ?? activeMeeting?.scheduledEndTime ?? null,
          timezone: bundleProcess?.nextScheduledTimezone ?? activeMeeting?.timezone ?? null,
        })
      : null;
  const primaryInboxHref = inboxHref ?? (isAdmin ? "/admin/interviews" : isVendor ? "/vendor/interviews" : "/client/interviews");
  const shellClassName = compact
    ? "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    : "rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5";

  return (
    <>
    <div className={shellClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Interview</h3>
            <StatusBadge status={bundleProcess?.status ?? "open"} />
            {bundleProcess ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{bundle.meetings.length} meeting{bundle.meetings.length === 1 ? "" : "s"}</span> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {candidateName} {bundleProcess ? "has an active scheduling thread." : candidateStatus === "interview" ? "has an active admin scheduling request." : "has no scheduling thread yet."}
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">State</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{bundleProcess ? getSchedulingStateLabel(bundleProcess.status) : "No active process"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next</p>
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
              <p className="text-sm font-semibold text-slate-900">
                {candidateStatus === "interview" ? "Admin desk is coordinating" : "No thread yet"}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {candidateStatus === "interview"
                  ? "The interview request is active. Continue from Interview Requests."
                  : "Start with a request to open the thread."}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {canInitiate || canRequestViaAdmin ? (
              <Button type="button" className="rounded-xl gap-2" onClick={() => (canRequestViaAdmin ? onRequestInterview?.() : openRequestDialog("request"))}>
                <CalendarClock className="h-4 w-4" />
                Request interview
              </Button>
            ) : null}
          </div>
        </div>
      ) : true ? (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Coordination</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {bundleProcess.awaitingResponseFrom
                  ? `Waiting for ${getRoleLabel(bundleProcess.awaitingResponseFrom).toLowerCase()}`
                  : activeMeeting?.status === "scheduled"
                    ? "Interview scheduled"
                    : "Admin scheduling desk active"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {latestSlotLabel && latestSlotLabel !== "Time pending"
                  ? latestSlotLabel
                  : "Use Interview Requests for the full coordination thread."}
              </p>
            </div>
            {activeMeeting ? <StatusBadge status={activeMeeting.status} /> : null}
          </div>
          {!summaryOnly && recentActivities.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="rounded-xl bg-white px-3 py-2 text-xs">
                  <p className="truncate font-medium text-slate-700">{formatActivityLabel(activity.eventType)}</p>
                  <p className="mt-0.5 whitespace-nowrap text-slate-400">{new Date(activity.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={primaryInboxHref}
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
            >
              View coordination
            </Link>
            {(canInitiate || canRequestViaAdmin) && !summaryOnly ? (
              <Button type="button" className="rounded-xl gap-2" onClick={() => (canRequestViaAdmin ? onRequestInterview?.() : openRequestDialog("request"))}>
                <CalendarClock className="h-4 w-4" />
                Request interview
              </Button>
            ) : null}
            {canCounter && !summaryOnly ? (
              <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => openRequestDialog("counter")}>
                <ArrowRight className="h-4 w-4" />
                Suggest another time
              </Button>
            ) : null}
            {canActOnProposal && !summaryOnly ? (
              <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => void acceptProposal(pendingProposal!.id)}>
                <CheckCircle2 className="h-4 w-4" />
                Accept
              </Button>
            ) : null}
            {canActOnProposal && !summaryOnly ? (
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => void declineProposal(pendingProposal!.id)}>
                Not available
              </Button>
            ) : null}
            {activeMeeting?.status === "scheduled" && isAdmin && !summaryOnly ? (
              <Button type="button" variant="outline" className="rounded-xl gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => setCompleteDialogOpen(true)}>
                <PartyPopper className="h-4 w-4" />
                Complete
              </Button>
            ) : null}
            {activeMeeting && isAdmin && !summaryOnly ? (
              <Button type="button" variant="outline" className="rounded-xl gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setCancelDialogOpen(true)}>
                <AlertTriangle className="h-4 w-4" />
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Active</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {activeMeeting ? `Meeting #${activeMeeting!.meetingIndex}` : "No active meeting"}
                </p>
              </div>
              {activeMeeting ? <StatusBadge status={activeMeeting!.status} /> : null}
            </div>
            {activeMeeting ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Scheduled slot</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {formatInterviewSlot({
                      scheduledDate: activeMeeting!.scheduledDate,
                      scheduledStartTime: activeMeeting!.scheduledStartTime,
                      scheduledEndTime: activeMeeting!.scheduledEndTime,
                      timezone: activeMeeting!.timezone,
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
                          windowLabel: pendingProposal.windowLabel,
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
                            <p className="text-sm font-semibold text-slate-800">Meeting #{meeting.meetingIndex}</p>
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
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">Meetings appear after the first request.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Proposal</p>
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
                          windowLabel: pendingProposal.windowLabel,
                          timezone: pendingProposal.timezone,
                        })}
                      </p>
                      {pendingProposal.note ? <p className="mt-2 text-sm leading-6 text-slate-500">{pendingProposal.note}</p> : null}
                    </div>

                    {pendingProposal.responseStatus === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        {canActOnProposal ? (
                          <Button type="button" className="rounded-xl gap-2" onClick={() => void acceptProposal(pendingProposal.id)}>
                            <CheckCircle2 className="h-4 w-4" />
                            Accept
                          </Button>
                        ) : null}
                        {canActOnProposal ? (
                          <Button type="button" variant="outline" className="rounded-xl" onClick={() => void declineProposal(pendingProposal.id)}>
                            Not available
                          </Button>
                        ) : null}
                        {canCounter ? (
                          <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => openRequestDialog("counter")}>
                            <ArrowRight className="h-4 w-4" />
                            Suggest another time
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">No active proposal.</div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Actions</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canInitiate || canRequestViaAdmin ? (
                    <Button type="button" className="rounded-xl gap-2" onClick={() => (canRequestViaAdmin ? onRequestInterview?.() : openRequestDialog("request"))}>
                      <CalendarClock className="h-4 w-4" />
                      Request interview
                    </Button>
                  ) : null}
                  {canCounter ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2" onClick={() => openRequestDialog("counter")}>
                      <ArrowRight className="h-4 w-4" />
                      Suggest another time
                    </Button>
                  ) : null}
                  {activeMeeting?.status === "scheduled" && isAdmin ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => setCompleteDialogOpen(true)}>
                      <PartyPopper className="h-4 w-4" />
                      Complete
                    </Button>
                  ) : null}
                  {activeMeeting && isAdmin ? (
                    <Button type="button" variant="outline" className="rounded-xl gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setCancelDialogOpen(true)}>
                      <AlertTriangle className="h-4 w-4" />
                      Cancel
                    </Button>
                  ) : null}
                </div>
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
      <ConfirmActionDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel interview?"
        description="The active slot will be cancelled."
        confirmLabel="Cancel interview"
        onConfirm={() => {
          void cancelMeeting();
        }}
      />
      <ConfirmActionDialog
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        title="Mark meeting complete?"
        description="The meeting will move to history and the scheduling desk will no longer show it as active."
        confirmLabel="Mark complete"
        onConfirm={() => {
          void completeMeeting();
        }}
      />
    </>
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
      title={`Interview for ${candidateName}`}
      description={description ?? `Start a request for ${roleTitle}.`}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
    />
  );
}

export function InterviewInboxPage({
  view,
  items,
  requestItems = [],
  loading,
  onRefresh,
  roleBase,
  onViewChange,
}: {
  view: InterviewRequestInboxView;
  items: InterviewInboxItem[];
  requestItems?: InterviewRequestItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  roleBase: string;
  onViewChange: (view: InterviewRequestInboxView) => void;
}) {
  const { toast } = useToast();
  const [dispatchTarget, setDispatchTarget] = useState<{
    request: InterviewRequestItem;
    candidate: InterviewRequestCandidate;
  } | null>(null);
  const [replyTarget, setReplyTarget] = useState<{
    request: InterviewRequestItem;
    candidate: InterviewRequestCandidate;
  } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    request: InterviewRequestItem;
    candidate: InterviewRequestCandidate;
  } | null>(null);
  const [cancelRequestTarget, setCancelRequestTarget] = useState<InterviewRequestItem | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

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

  const visibleRequests = useMemo(() => {
    return [...requestItems].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [requestItems]);

  const submitDispatch = async ({ messageText }: { messageText: string }) => {
    if (!dispatchTarget) return;
    if (!messageText.trim()) {
      toast({ title: "Add vendor message", description: "Write the scheduling message before sending.", variant: "destructive" });
      return;
    }
    const dispatchPayload: InterviewRequestDispatchInput = {
      requestCandidateId: dispatchTarget.candidate.id,
      messageText: messageText.trim(),
      adminNote: messageText.trim(),
    };
    setActionSubmitting(true);
    try {
      await dispatchInterviewRequest(dispatchTarget.request.id, [dispatchPayload]);
      toast({ title: "Sent to vendor", description: `${dispatchTarget.candidate.candidateName} is now in the scheduling flow.` });
      setDispatchTarget(null);
      await onRefresh();
    } catch (error) {
      toast({
        title: "Could not dispatch request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionSubmitting(false);
    }
  };

  const submitVendorReply = async ({ messageText, replyType }: { messageText: string; replyType: "can_work" | "suggest_alternative" | "not_available" }) => {
    if (!replyTarget) return;
    if (!messageText.trim()) {
      toast({ title: "Add reply", description: "Write a short availability reply for the admin desk.", variant: "destructive" });
      return;
    }
    setActionSubmitting(true);
    try {
      await replyToInterviewRequestCandidate(replyTarget.request.id, replyTarget.candidate.id, {
        replyType,
        messageText: messageText.trim(),
      });
      toast({ title: "Reply sent", description: "The admin desk can now coordinate the next step." });
      setReplyTarget(null);
      await onRefresh();
    } catch (error) {
      toast({
        title: "Could not send reply",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionSubmitting(false);
    }
  };

  const submitScheduledDetails = async ({ messageText }: { messageText: string }) => {
    if (!scheduleTarget) return;
    if (!messageText.trim()) {
      toast({ title: "Add confirmed details", description: "Write the agreed interview details before scheduling.", variant: "destructive" });
      return;
    }
    setActionSubmitting(true);
    try {
      await scheduleInterviewRequestCandidate(scheduleTarget.request.id, scheduleTarget.candidate.id, messageText.trim());
      toast({ title: "Interview marked scheduled", description: `${scheduleTarget.candidate.candidateName} now has confirmed interview details.` });
      setScheduleTarget(null);
      await onRefresh();
    } catch (error) {
      toast({
        title: "Could not mark scheduled",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    if (!cancelRequestTarget) return;
    setActionSubmitting(true);
    try {
      await cancelInterviewRequest(cancelRequestTarget.id, "Cancelled from the scheduling desk");
      toast({
        title: "Request cancelled",
        description: "The candidate pipeline status was not changed automatically. Review it if a follow-up decision is needed.",
      });
      setCancelRequestTarget(null);
      await onRefresh();
    } catch (error) {
      toast({
        title: "Could not cancel request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["needs_action", "Action needed"],
          ["admin_review", "Admin review"],
          ["awaiting_vendor", "Sent to vendor"],
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

      {visibleRequests.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Coordination desk</p>
                <p className="text-xs text-slate-500">Client request, current owner, and next action in one place.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {visibleRequests.length} request{visibleRequests.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {visibleRequests.map((request) => {
              const latestMessage = getLatestRequestActivityMessage(request);
              const ownerLabel = getRequestOwnerLabel(request.status);
              const nextAction = getRequestNextAction(request.status);
              const isExpanded = expandedRequestId === request.id;
              const hasPipelineReminder =
                ["cancelled", "closed"].includes(request.status) &&
                request.candidates.some((candidate) => candidate.candidateStatus === "interview");
              return (
              <div key={request.id} className="px-4 py-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)_minmax(170px,0.75fr)_minmax(280px,1.35fr)] xl:items-start">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{request.roleTitle}</p>
                    <p className="mt-1 text-xs text-slate-500">{request.clientCompanyName ?? "Client"} • {request.candidates.length} candidate{request.candidates.length === 1 ? "" : "s"} • updated {formatRelativeTimestamp(request.updatedAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusBadge status={request.status} />
                      {request.needsAction ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Action needed</span> : null}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Client request</p>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-700">{request.requestText}</p>
                    {latestMessage ? (
                      <p className="mt-2 line-clamp-1 border-t border-slate-200 pt-2 text-xs text-slate-500">
                        Latest: {latestMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Owner</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{ownerLabel}</p>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${getAgeToneClass(request.updatedAt, request.needsAction)}`}>
                      {request.needsAction ? "Waiting " : "Updated "}{formatRelativeInline(request.updatedAt)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{nextAction}</p>
                    {request.candidates.map((candidate) => (
                      <div key={candidate.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">{candidate.candidateName}</p>
                          <p className="truncate text-[11px] text-slate-500">{candidate.vendorCompanyName ?? "Vendor"} • {getCandidateNextAction(roleBase, candidate.status)}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          {roleBase === "/admin" && ["pending_admin", "vendor_replied"].includes(candidate.status) ? (
                            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg px-2 text-[11px]" onClick={() => setDispatchTarget({ request, candidate })}>
                              {candidate.status === "vendor_replied" ? "Send update" : "Send to vendor"}
                            </Button>
                          ) : null}
                          {roleBase === "/admin" && ["sent_to_vendor", "vendor_replied"].includes(candidate.status) ? (
                            <Button type="button" size="sm" className="h-8 rounded-lg px-2 text-[11px]" onClick={() => setScheduleTarget({ request, candidate })}>
                              Mark scheduled
                            </Button>
                          ) : null}
                          {roleBase === "/vendor" && candidate.status === "sent_to_vendor" ? (
                            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg px-2 text-[11px]" onClick={() => setReplyTarget({ request, candidate })}>
                              Reply
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            className="text-[11px] font-medium text-primary hover:text-primary/80"
                            onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                          >
                            Interview details
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      {roleBase === "/admin" && !["scheduled", "cancelled", "closed"].includes(request.status) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => setCancelRequestTarget(request)}
                        >
                          Cancel request
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                    {hasPipelineReminder ? (
                      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        This request is closed, but at least one candidate is still marked Interview. Admin should update the candidate pipeline when the hiring decision is clear.
                      </div>
                    ) : null}
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="rounded-xl bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Candidate states</p>
                        <div className="mt-2 space-y-2">
                          {request.candidates.map((candidate) => (
                            <div key={candidate.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate font-medium text-slate-700">{candidate.candidateName}</span>
                              <div className="flex flex-shrink-0 items-center gap-2">
                                <StatusBadge status={candidate.status} />
                                {candidate.candidateStatus ? <StatusBadge status={candidate.candidateStatus} /> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Recent activity</p>
                        <div className="mt-2 space-y-2">
                          {request.activity.slice(-4).reverse().map((activity) => {
                            const payload = activity.payload ?? {};
                            const message =
                              typeof payload.finalDetails === "string"
                                ? payload.finalDetails
                                : typeof payload.messageText === "string"
                                  ? payload.messageText
                                  : typeof payload.reason === "string"
                                    ? payload.reason
                                    : null;
                            return (
                              <div key={activity.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-slate-700">{formatActivityLabel(activity.eventType)}</span>
                                  <span className="text-slate-400">{formatRelativeTimestamp(activity.createdAt)}</span>
                                </div>
                                {message ? <p className="mt-1 line-clamp-2 leading-5 text-slate-500">{message}</p> : null}
                              </div>
                            );
                          })}
                          {!request.activity.length ? <p className="text-xs text-slate-500">No activity recorded yet.</p> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {items.length ? (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="hidden border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] xl:gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Role</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">State</div>
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
                href={`${roleBase}/candidates/${item.candidate.id}?back=${encodeURIComponent(`${roleBase}/interviews`)}&focus=interview`}
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
                    {item.awaitingResponseFrom ? getRoleLabel(item.awaitingResponseFrom) : "No action"}
                  </div>
                <div className="flex items-center justify-end gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.needsAction ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {item.needsAction ? "Action needed" : "Tracking"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      View coordination <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-slate-500">
            <MessageSquare className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            No threads in this view.
          </div>
        )}
      </div>
      ) : null}

      {!visibleRequests.length && !items.length && !loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          <MessageSquare className="mx-auto mb-2 h-10 w-10 text-slate-300" />
          No interview requests in this view.
        </div>
      ) : null}

      <InterviewMessageDialog
        open={Boolean(dispatchTarget)}
        onOpenChange={(open) => {
          if (!open) setDispatchTarget(null);
        }}
        title={dispatchTarget ? `Message vendor for ${dispatchTarget.candidate.candidateName}` : "Message vendor"}
        description="Clean up the client request into a concise vendor-facing scheduling message."
        label="Message to vendor"
        placeholder="Example: The client would like to meet this candidate next Wednesday afternoon. Could you please confirm availability or suggest workable alternatives?"
        submitLabel="Send to vendor"
        submitting={actionSubmitting}
        onSubmit={(value) => submitDispatch(value)}
      />
      <InterviewMessageDialog
        open={Boolean(replyTarget)}
        onOpenChange={(open) => {
          if (!open) setReplyTarget(null);
        }}
        title={replyTarget ? `Reply for ${replyTarget.candidate.candidateName}` : "Reply to admin"}
        description="Send availability or an alternative back to the admin scheduling desk."
        label="Reply"
        placeholder="Example: Wednesday afternoon can work after 15:00, or Thursday between 10:00 and 12:00 is better."
        submitLabel="Send reply"
        submitting={actionSubmitting}
        showReplyType
        onSubmit={(value) => submitVendorReply(value)}
      />
      <InterviewMessageDialog
        open={Boolean(scheduleTarget)}
        onOpenChange={(open) => {
          if (!open) setScheduleTarget(null);
        }}
        title={scheduleTarget ? `Mark scheduled for ${scheduleTarget.candidate.candidateName}` : "Mark scheduled"}
        description="Record the agreed interview details in plain language."
        label="Confirmed details"
        placeholder="Example: Confirmed for Wednesday afternoon, 15:30 Istanbul time. Vendor will brief the candidate before the call."
        submitLabel="Mark scheduled"
        submitting={actionSubmitting}
        onSubmit={(value) => submitScheduledDetails(value)}
      />
      <ConfirmActionDialog
        open={Boolean(cancelRequestTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelRequestTarget(null);
        }}
        title="Cancel interview request?"
        description="The scheduling request will move to history. Candidate pipeline status will not be changed automatically."
        confirmLabel={actionSubmitting ? "Cancelling..." : "Cancel request"}
        onConfirm={() => {
          void cancelRequest();
        }}
      />
    </div>
  );
}
