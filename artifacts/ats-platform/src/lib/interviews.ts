export type InterviewRole = "admin" | "client" | "vendor";

export type InterviewProcessStatus = "open" | "closed";
export type InterviewMeetingStatus = "negotiating" | "scheduled" | "completed" | "cancelled";
export type InterviewProposalType = "exact_slot" | "flexible_window";
export type InterviewProposalResponseStatus = "pending" | "accepted" | "superseded" | "withdrawn";
export type InterviewActivityEventType =
  | "process_opened"
  | "meeting_added"
  | "proposal_created"
  | "proposal_accepted"
  | "meeting_completed"
  | "meeting_cancelled"
  | "process_closed";

export type InterviewProposalInput = {
  proposalType: InterviewProposalType;
  proposedDate: string;
  startTime?: string | null;
  endTime?: string | null;
  windowLabel?: string | null;
  timezone: string;
  durationMinutes: number;
  note?: string | null;
};

export type InterviewProcess = {
  id: number;
  candidateId: number;
  roleId: number;
  clientCompanyId: number;
  vendorCompanyId: number;
  status: InterviewProcessStatus;
  openedAt: string;
  closedAt: string | null;
  closedReason: string | null;
  createdByUserId: number;
  updatedAt: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  roleTitle?: string | null;
  roleStatus?: string | null;
  clientCompanyName?: string | null;
  vendorCompanyName?: string | null;
  activeMeetingId?: number | null;
  activeMeetingStatus?: InterviewMeetingStatus | null;
  awaitingResponseFrom?: InterviewRole | null;
  nextScheduledDate?: string | null;
  nextScheduledStartTime?: string | null;
  nextScheduledEndTime?: string | null;
  nextScheduledTimezone?: string | null;
  latestActivityAt?: string | null;
  meetingCount?: number;
  proposalCount?: number;
};

export type InterviewMeeting = {
  id: number;
  processId: number;
  status: InterviewMeetingStatus;
  meetingIndex: number;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  timezone: string | null;
  createdByUserId: number;
  confirmedProposalId: number | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  summaryNote: string | null;
  createdAt: string;
  updatedAt: string;
  latestProposal?: InterviewProposal | null;
};

export type InterviewProposal = {
  id: number;
  meetingId: number;
  proposedByRole: InterviewRole;
  proposedByUserId: number;
  proposalType: InterviewProposalType;
  proposedDate: string;
  startTime: string | null;
  endTime: string | null;
  windowLabel: string | null;
  timezone: string;
  durationMinutes: number;
  note: string | null;
  responseStatus: InterviewProposalResponseStatus;
  createdAt: string;
};

export type InterviewActivity = {
  id: number;
  processId: number;
  meetingId: number | null;
  actorUserId: number | null;
  actorRole: InterviewRole;
  eventType: InterviewActivityEventType | string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type CandidateInterviewBundle = {
  process: InterviewProcess | null;
  meetings: InterviewMeeting[];
  proposals: InterviewProposal[];
  activities: InterviewActivity[];
};

export type InterviewInboxItem = {
  process: InterviewProcess;
  candidate: {
    id: number;
    firstName: string;
    lastName: string;
    email: string | null;
    status: string;
  };
  role: {
    id: number;
    title: string;
  };
  clientCompanyName: string | null;
  vendorCompanyName: string | null;
  currentMeeting: InterviewMeeting | null;
  awaitingResponseFrom: InterviewRole | null;
  nextScheduledLabel: string | null;
  latestActivityAt: string | null;
  needsAction: boolean;
};

export type InterviewInboxView = "needs_action" | "scheduled" | "history" | "all";

function getAuthHeaders(extraHeaders?: HeadersInit) {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("ats_token") : null;
  const headers = new Headers(extraHeaders);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: getAuthHeaders(init?.headers),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Interview workflow request failed");
  }

  return response.json() as Promise<T>;
}

function normalizeMeeting(raw: any): InterviewMeeting {
  return {
    id: Number(raw.id),
    processId: Number(raw.processId ?? raw.process_id ?? raw.processID ?? 0),
    status: raw.status ?? raw.meetingStatus ?? raw.meeting_status ?? "negotiating",
    meetingIndex: Number(raw.meetingIndex ?? raw.meeting_index ?? 0),
    scheduledDate: raw.scheduledDate ?? raw.scheduled_date ?? null,
    scheduledStartTime: raw.scheduledStartTime ?? raw.scheduled_start_time ?? null,
    scheduledEndTime: raw.scheduledEndTime ?? raw.scheduled_end_time ?? null,
    timezone: raw.timezone ?? null,
    createdByUserId: Number(raw.createdByUserId ?? raw.created_by_user_id ?? 0),
    confirmedProposalId:
      raw.confirmedProposalId != null || raw.confirmed_proposal_id != null
        ? Number(raw.confirmedProposalId ?? raw.confirmed_proposal_id)
        : null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    cancelledAt: raw.cancelledAt ?? raw.cancelled_at ?? null,
    cancelReason: raw.cancelReason ?? raw.cancel_reason ?? null,
    summaryNote: raw.summaryNote ?? raw.summary_note ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),
    latestProposal:
      raw.latestProposal ?? raw.latest_proposal
        ? normalizeProposal(raw.latestProposal ?? raw.latest_proposal)
        : null,
  };
}

function normalizeProposal(raw: any): InterviewProposal {
  return {
    id: Number(raw.id),
    meetingId: Number(raw.meetingId ?? raw.meeting_id ?? 0),
    proposedByRole: raw.proposedByRole ?? raw.proposed_by_role,
    proposedByUserId: Number(raw.proposedByUserId ?? raw.proposed_by_user_id ?? 0),
    proposalType: raw.proposalType ?? raw.proposal_type,
    proposedDate: raw.proposedDate ?? raw.proposed_date ?? "",
    startTime: raw.startTime ?? raw.start_time ?? null,
    endTime: raw.endTime ?? raw.end_time ?? null,
    windowLabel: raw.windowLabel ?? raw.window_label ?? null,
    timezone: raw.timezone ?? "Europe/Istanbul",
    durationMinutes: Number(raw.durationMinutes ?? raw.duration_minutes ?? 0),
    note: raw.note ?? null,
    responseStatus: raw.responseStatus ?? raw.response_status ?? "pending",
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  };
}

function normalizeActivity(raw: any): InterviewActivity {
  return {
    id: Number(raw.id),
    processId: Number(raw.processId ?? raw.process_id ?? 0),
    meetingId: raw.meetingId ?? raw.meeting_id ?? null,
    actorUserId: raw.actorUserId ?? raw.actor_user_id ?? null,
    actorRole: raw.actorRole ?? raw.actor_role ?? "client",
    eventType: raw.eventType ?? raw.event_type,
    payload: raw.payload ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  };
}

function normalizeProcess(raw: any): InterviewProcess {
  const activeMeetingId = raw.activeMeetingId ?? raw.active_meeting_id;
  const meetingCount = raw.meetingCount ?? raw.meeting_count;
  const proposalCount = raw.proposalCount ?? raw.proposal_count;

  return {
    id: Number(raw.id),
    candidateId: Number(raw.candidateId ?? raw.candidate_id ?? 0),
    roleId: Number(raw.roleId ?? raw.role_id ?? 0),
    clientCompanyId: Number(raw.clientCompanyId ?? raw.client_company_id ?? 0),
    vendorCompanyId: Number(raw.vendorCompanyId ?? raw.vendor_company_id ?? 0),
    status: raw.status ?? raw.processStatus ?? raw.process_status ?? "open",
    openedAt: raw.openedAt ?? raw.opened_at ?? new Date().toISOString(),
    closedAt: raw.closedAt ?? raw.closed_at ?? null,
    closedReason: raw.closedReason ?? raw.closed_reason ?? null,
    createdByUserId: Number(raw.createdByUserId ?? raw.created_by_user_id ?? 0),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),
    candidateName: raw.candidateName ?? raw.candidate_name ?? null,
    candidateEmail: raw.candidateEmail ?? raw.candidate_email ?? null,
    roleTitle: raw.roleTitle ?? raw.role_title ?? null,
    roleStatus: raw.roleStatus ?? raw.role_status ?? null,
    clientCompanyName: raw.clientCompanyName ?? raw.client_company_name ?? null,
    vendorCompanyName: raw.vendorCompanyName ?? raw.vendor_company_name ?? null,
    activeMeetingId: activeMeetingId != null ? Number(activeMeetingId) : raw.activeMeetingId == null && (raw.meetingId ?? raw.meeting_id) != null ? Number(raw.meetingId ?? raw.meeting_id) : null,
    activeMeetingStatus: raw.activeMeetingStatus ?? raw.active_meeting_status ?? raw.meetingStatus ?? raw.meeting_status ?? null,
    awaitingResponseFrom: raw.awaitingResponseFrom ?? raw.awaiting_response_from ?? null,
    nextScheduledDate: raw.nextScheduledDate ?? raw.next_scheduled_date ?? null,
    nextScheduledStartTime: raw.nextScheduledStartTime ?? raw.next_scheduled_start_time ?? null,
    nextScheduledEndTime: raw.nextScheduledEndTime ?? raw.next_scheduled_end_time ?? null,
    nextScheduledTimezone: raw.nextScheduledTimezone ?? raw.next_scheduled_timezone ?? raw.timezone ?? null,
    latestActivityAt: raw.latestActivityAt ?? raw.latest_activity_at ?? null,
    meetingCount: meetingCount != null ? Number(meetingCount) : 0,
    proposalCount: proposalCount != null ? Number(proposalCount) : 0,
  };
}

function normalizeBundlePayload(payload: any): CandidateInterviewBundle {
  const processValue =
    payload?.process ??
    payload?.currentProcess ??
    payload?.items?.[0] ??
    payload?.data?.process ??
    payload?.data?.items?.[0] ??
    null;
  const meetingsValue =
    payload?.meetings ??
    payload?.data?.meetings ??
    processValue?.meetings ??
    [];
  const proposalsValue =
    payload?.proposals ??
    payload?.data?.proposals ??
    (Array.isArray(processValue?.meetings)
      ? processValue.meetings.flatMap((meeting: any) => meeting?.proposals ?? [])
      : []);
  const activitiesValue =
    payload?.activities ??
    payload?.timeline ??
    payload?.data?.activities ??
    processValue?.activity ??
    processValue?.activities ??
    [];

  return {
    process: processValue ? normalizeProcess(processValue) : null,
    meetings: Array.isArray(meetingsValue) ? meetingsValue.map(normalizeMeeting) : [],
    proposals: Array.isArray(proposalsValue) ? proposalsValue.map(normalizeProposal) : [],
    activities: Array.isArray(activitiesValue) ? activitiesValue.map(normalizeActivity) : [],
  };
}

function normalizeInboxPayload(payload: any): InterviewInboxItem[] {
  const items = payload?.items ?? payload?.processes ?? payload?.data ?? payload ?? [];
  if (!Array.isArray(items)) return [];

  return items
    .map((raw) => {
      const process = normalizeProcess(raw.process ?? raw);
      const currentMeeting = raw.currentMeeting ?? raw.current_meeting
        ? normalizeMeeting(raw.currentMeeting ?? raw.current_meeting)
        : (raw.meetingId ?? raw.meeting_id ?? raw.meetingStatus ?? raw.meeting_status)
          ? normalizeMeeting({
              id: raw.meetingId ?? raw.meeting_id ?? process.activeMeetingId ?? 0,
              processId: process.id,
              meetingIndex: raw.meetingIndex ?? raw.meeting_index ?? 0,
              title: raw.meetingTitle ?? raw.meeting_title ?? null,
              status: raw.meetingStatus ?? raw.meeting_status ?? process.activeMeetingStatus ?? process.status,
              scheduledDate: process.nextScheduledDate ?? null,
              scheduledStartTime: process.nextScheduledStartTime ?? null,
              scheduledEndTime: process.nextScheduledEndTime ?? null,
              timezone: process.nextScheduledTimezone ?? null,
            })
          : null;
      return {
        process,
        candidate: {
          id: Number(raw.candidate?.id ?? raw.candidateId ?? raw.candidate_id ?? process.candidateId),
          firstName: raw.candidate?.firstName ?? raw.candidate_first_name ?? raw.candidateName?.split(" ")?.[0] ?? "Candidate",
          lastName: raw.candidate?.lastName ?? raw.candidate_last_name ?? raw.candidateName?.split(" ")?.slice(1).join(" ") ?? "",
          email: raw.candidate?.email ?? raw.candidate_email ?? process.candidateEmail ?? null,
          status: raw.candidate?.status ?? raw.candidate_status ?? "interview",
        },
        role: {
          id: Number(raw.role?.id ?? raw.roleId ?? raw.role_id ?? process.roleId),
          title: raw.role?.title ?? raw.role_title ?? process.roleTitle ?? "Role",
        },
        clientCompanyName: raw.clientCompanyName ?? raw.client_company_name ?? process.clientCompanyName ?? null,
        vendorCompanyName: raw.vendorCompanyName ?? raw.vendor_company_name ?? process.vendorCompanyName ?? null,
        currentMeeting,
        awaitingResponseFrom: raw.awaitingResponseFrom ?? raw.awaiting_response_from ?? process.awaitingResponseFrom ?? null,
        nextScheduledLabel:
          raw.nextScheduledLabel ??
          raw.next_scheduled_label ??
          raw.nextSlotLabel ??
          raw.next_slot_label ??
          null,
        latestActivityAt: raw.latestActivityAt ?? raw.latest_activity_at ?? process.latestActivityAt ?? null,
        needsAction: Boolean(raw.needsAction ?? raw.needs_action ?? false),
      } satisfies InterviewInboxItem;
    })
    .filter(Boolean);
}

export async function fetchCandidateInterviewBundle(candidateId: number) {
  return normalizeBundlePayload(await requestJson(`/api/candidates/${candidateId}/interviews`));
}

export async function fetchInterviewInbox(view: InterviewInboxView = "needs_action") {
  return normalizeInboxPayload(await requestJson(`/api/interviews?view=${encodeURIComponent(view)}`));
}

export async function createInterviewRequest(candidateId: number, data: InterviewProposalInput) {
  return normalizeBundlePayload(
    await requestJson(`/api/candidates/${candidateId}/interviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}

export async function addInterviewMeeting(processId: number, data: InterviewProposalInput) {
  return normalizeMeeting(
    await requestJson(`/api/interviews/${processId}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}

export async function submitInterviewProposal(meetingId: number, data: InterviewProposalInput) {
  return normalizeProposal(
    await requestJson(`/api/meetings/${meetingId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}

export async function acceptInterviewProposal(proposalId: number) {
  return normalizeBundlePayload(
    await requestJson(`/api/proposals/${proposalId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

export async function completeInterviewMeeting(meetingId: number, summaryNote?: string | null) {
  return normalizeMeeting(
    await requestJson(`/api/meetings/${meetingId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summaryNote: summaryNote ?? null }),
    }),
  );
}

export async function cancelInterviewMeeting(meetingId: number, cancelReason?: string | null) {
  return normalizeMeeting(
    await requestJson(`/api/meetings/${meetingId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelReason: cancelReason ?? null }),
    }),
  );
}

export function formatInterviewSlot(value: {
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  proposedDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
}) {
  const date = value.scheduledDate ?? value.proposedDate;
  const startTime = value.scheduledStartTime ?? value.startTime;
  const endTime = value.scheduledEndTime ?? value.endTime;
  const timezone = value.timezone?.trim();

  if (!date && !startTime) {
    return "Time pending";
  }

  const base = [date, [startTime, endTime].filter(Boolean).join(" - ")].filter(Boolean).join(" ");
  return timezone ? `${base} (${timezone})` : base;
}
