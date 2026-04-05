import { db, candidatesTable, companiesTable, jobRolesTable, usersTable } from "@workspace/db";
import {
  interviewActivityTable,
  interviewMeetingsTable,
  interviewProcessesTable,
  interviewProposalsTable,
} from "../../../../lib/db/src/schema/interviews.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { Errors } from "./errors.js";

export type InterviewActorRole = "admin" | "client" | "vendor";

type InterviewAccessRow = {
  processId: number;
  candidateId: number;
  candidateStatus: string;
  candidateFirstName: string;
  candidateLastName: string;
  roleId: number;
  roleTitle: string | null;
  clientCompanyId: number;
  clientCompanyName: string | null;
  vendorCompanyId: number;
  vendorCompanyName: string | null;
  processStatus: string;
};

export type InterviewActor = {
  userId: number;
  role: InterviewActorRole;
  companyId: number | null;
  name: string;
  companyName: string | null;
  label: string;
};

export type CandidateInterviewAccess = {
  id: number;
  status: string;
  roleId: number;
  vendorCompanyId: number;
  roleCompanyId: number | null;
  roleTitle: string | null;
  email: string;
  phone: string | null;
  expectedSalary: string | null;
};

const ACTIVE_MEETING_STATUSES = new Set(["negotiating", "scheduled"]);
const EXIT_PIPELINE_STATUSES = new Set([
  "pending_approval",
  "submitted",
  "screening",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);

function getCompanyActorLabel(role: InterviewActorRole, name: string | null, fallbackName: string) {
  if (name?.trim()) return name.trim();
  if (role === "admin") return "Admin team";
  return fallbackName;
}

function canAccessInterviewRow(actor: { role: InterviewActorRole; companyId: number | null }, row: InterviewAccessRow) {
  if (actor.role === "admin") return true;
  if (actor.role === "client") {
    return actor.companyId != null && actor.companyId === row.clientCompanyId;
  }
  return actor.companyId != null && actor.companyId === row.vendorCompanyId;
}

function requireInterviewAccessRow(row: {
  processId: number | null;
  candidateId: number | null;
  candidateStatus: string | null;
  candidateFirstName: string | null;
  candidateLastName: string | null;
  roleId: number | null;
  roleTitle: string | null;
  clientCompanyId: number | null;
  clientCompanyName: string | null;
  vendorCompanyId: number | null;
  processStatus: string | null;
}) {
  if (
    row.processId == null ||
    row.candidateId == null ||
    row.candidateStatus == null ||
    row.candidateFirstName == null ||
    row.candidateLastName == null ||
    row.roleId == null ||
    row.clientCompanyId == null ||
    row.vendorCompanyId == null ||
    row.processStatus == null
  ) {
    return null;
  }

  return {
    processId: row.processId,
    candidateId: row.candidateId,
    candidateStatus: row.candidateStatus,
    candidateFirstName: row.candidateFirstName,
    candidateLastName: row.candidateLastName,
    roleId: row.roleId,
    roleTitle: row.roleTitle,
    clientCompanyId: row.clientCompanyId,
    clientCompanyName: row.clientCompanyName,
    vendorCompanyId: row.vendorCompanyId,
    vendorCompanyName: null as string | null,
    processStatus: row.processStatus,
  } satisfies InterviewAccessRow;
}

function formatProposalTimeLabel(input: {
  proposalType: string;
  proposedDate: string;
  startTime: string | null;
  endTime: string | null;
  windowLabel: string | null;
  timezone: string;
}) {
  if (input.proposalType === "exact_slot") {
    const times = [input.startTime, input.endTime].filter(Boolean).join(" - ");
    return [input.proposedDate, times, input.timezone].filter(Boolean).join(" • ");
  }

  const windowText = input.windowLabel === "custom_range"
    ? [input.startTime, input.endTime].filter(Boolean).join(" - ")
    : input.windowLabel?.replace(/_/g, " ") ?? "Flexible window";
  return [input.proposedDate, windowText, input.timezone].filter(Boolean).join(" • ");
}

export function getAwaitingResponseFromProposal(proposal: {
  responseStatus: string;
  proposedByRole: string;
} | null | undefined) {
  if (!proposal || proposal.responseStatus !== "pending") return null;
  if (proposal.proposedByRole === "vendor") return "client";
  if (proposal.proposedByRole === "client" || proposal.proposedByRole === "admin") return "vendor";
  return null;
}

export function actorNeedsInterviewAction(
  actorRole: InterviewActorRole,
  proposal: { responseStatus: string; proposedByRole: string } | null | undefined,
) {
  const awaiting = getAwaitingResponseFromProposal(proposal);
  if (!awaiting) return false;
  if (actorRole === "admin") return true;
  return awaiting === actorRole;
}

export function normalizeProposalResponseForSupersede(status: string) {
  return status === "accepted" ? "accepted" : "superseded";
}

export async function resolveInterviewActor(userId: number): Promise<InterviewActor | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      companyId: usersTable.companyId,
      name: usersTable.name,
      companyName: companiesTable.name,
    })
    .from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(eq(usersTable.id, userId));

  if (!row) return null;

  const role = row.role as InterviewActorRole;
  return {
    userId: row.id,
    role,
    companyId: row.companyId,
    name: row.name,
    companyName: row.companyName ?? null,
    label: getCompanyActorLabel(
      role,
      row.companyName ?? null,
      role === "client" ? "Client team" : role === "vendor" ? "Vendor team" : "Admin team",
    ),
  };
}

export async function getActorLabel(userId: number): Promise<string> {
  const actor = await resolveInterviewActor(userId);
  return actor?.label ?? "Review team";
}

export async function resolveInterviewProcessAccess(
  req: Request,
  res: Response,
  processId: number,
): Promise<InterviewAccessRow | null> {
  const [row] = await db
    .select({
      processId: interviewProcessesTable.id,
      candidateId: interviewProcessesTable.candidateId,
      candidateStatus: candidatesTable.status,
      candidateFirstName: candidatesTable.firstName,
      candidateLastName: candidatesTable.lastName,
      roleId: interviewProcessesTable.roleId,
      roleTitle: jobRolesTable.title,
      clientCompanyId: interviewProcessesTable.clientCompanyId,
      clientCompanyName: companiesTable.name,
      vendorCompanyId: interviewProcessesTable.vendorCompanyId,
      vendorCompanyName: companiesTable.name,
      processStatus: interviewProcessesTable.status,
    })
    .from(interviewProcessesTable)
    .leftJoin(candidatesTable, eq(interviewProcessesTable.candidateId, candidatesTable.id))
    .leftJoin(jobRolesTable, eq(interviewProcessesTable.roleId, jobRolesTable.id))
    .leftJoin(companiesTable, eq(interviewProcessesTable.clientCompanyId, companiesTable.id))
    .where(eq(interviewProcessesTable.id, processId));

  if (!row) {
    Errors.notFound(res, "Interview process not found");
    return null;
  }

  const accessRow = requireInterviewAccessRow(row);
  if (!accessRow) {
    Errors.notFound(res, "Interview process is missing its candidate or role");
    return null;
  }

  const vendorCompany = await db
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, accessRow.vendorCompanyId))
    .then((results) => results[0] ?? null);
  accessRow.vendorCompanyName = vendorCompany?.name ?? null;

  if (!canAccessInterviewRow(req.user! as { role: InterviewActorRole; companyId: number | null }, accessRow)) {
    if (req.user!.role === "client") {
      Errors.notFound(res, "Interview process not found");
      return null;
    }
    Errors.forbidden(res);
    return null;
  }

  return accessRow;
}

export async function resolveInterviewMeetingAccess(
  req: Request,
  res: Response,
  meetingId: number,
): Promise<(InterviewAccessRow & { meetingId: number; meetingStatus: string }) | null> {
  const [row] = await db
    .select({
      meetingId: interviewMeetingsTable.id,
      meetingStatus: interviewMeetingsTable.status,
      processId: interviewProcessesTable.id,
      candidateId: interviewProcessesTable.candidateId,
      candidateStatus: candidatesTable.status,
      candidateFirstName: candidatesTable.firstName,
      candidateLastName: candidatesTable.lastName,
      roleId: interviewProcessesTable.roleId,
      roleTitle: jobRolesTable.title,
      clientCompanyId: interviewProcessesTable.clientCompanyId,
      clientCompanyName: companiesTable.name,
      vendorCompanyId: interviewProcessesTable.vendorCompanyId,
      processStatus: interviewProcessesTable.status,
    })
    .from(interviewMeetingsTable)
    .leftJoin(interviewProcessesTable, eq(interviewMeetingsTable.processId, interviewProcessesTable.id))
    .leftJoin(candidatesTable, eq(interviewProcessesTable.candidateId, candidatesTable.id))
    .leftJoin(jobRolesTable, eq(interviewProcessesTable.roleId, jobRolesTable.id))
    .leftJoin(companiesTable, eq(interviewProcessesTable.clientCompanyId, companiesTable.id))
    .where(eq(interviewMeetingsTable.id, meetingId));

  if (!row) {
    Errors.notFound(res, "Interview meeting not found");
    return null;
  }

  const accessRow = requireInterviewAccessRow(row);
  if (!accessRow) {
    Errors.notFound(res, "Interview meeting is missing its process context");
    return null;
  }

  const vendorCompany = await db
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, accessRow.vendorCompanyId))
    .then((results) => results[0] ?? null);
  accessRow.vendorCompanyName = vendorCompany?.name ?? null;

  if (!canAccessInterviewRow(req.user! as { role: InterviewActorRole; companyId: number | null }, accessRow)) {
    if (req.user!.role === "client") {
      Errors.notFound(res, "Interview meeting not found");
      return null;
    }
    Errors.forbidden(res);
    return null;
  }

  return {
    ...accessRow,
    meetingId: row.meetingId,
    meetingStatus: row.meetingStatus,
  };
}

export async function resolveInterviewProposalAccess(
  req: Request,
  res: Response,
  proposalId: number,
): Promise<
  | (InterviewAccessRow & {
      proposalId: number;
      meetingId: number;
      meetingStatus: string;
      proposedByRole: string;
      responseStatus: string;
      proposalType: string;
      proposedDate: string;
      startTime: string | null;
      endTime: string | null;
      windowLabel: string | null;
      timezone: string;
      durationMinutes: number;
    })
  | null
> {
  const [row] = await db
    .select({
      proposalId: interviewProposalsTable.id,
      proposedByRole: interviewProposalsTable.proposedByRole,
      responseStatus: interviewProposalsTable.responseStatus,
      proposalType: interviewProposalsTable.proposalType,
      proposedDate: interviewProposalsTable.proposedDate,
      startTime: interviewProposalsTable.startTime,
      endTime: interviewProposalsTable.endTime,
      windowLabel: interviewProposalsTable.windowLabel,
      timezone: interviewProposalsTable.timezone,
      durationMinutes: interviewProposalsTable.durationMinutes,
      meetingId: interviewMeetingsTable.id,
      meetingStatus: interviewMeetingsTable.status,
      processId: interviewProcessesTable.id,
      candidateId: interviewProcessesTable.candidateId,
      candidateStatus: candidatesTable.status,
      candidateFirstName: candidatesTable.firstName,
      candidateLastName: candidatesTable.lastName,
      roleId: interviewProcessesTable.roleId,
      roleTitle: jobRolesTable.title,
      clientCompanyId: interviewProcessesTable.clientCompanyId,
      clientCompanyName: companiesTable.name,
      vendorCompanyId: interviewProcessesTable.vendorCompanyId,
      processStatus: interviewProcessesTable.status,
    })
    .from(interviewProposalsTable)
    .leftJoin(interviewMeetingsTable, eq(interviewProposalsTable.meetingId, interviewMeetingsTable.id))
    .leftJoin(interviewProcessesTable, eq(interviewMeetingsTable.processId, interviewProcessesTable.id))
    .leftJoin(candidatesTable, eq(interviewProcessesTable.candidateId, candidatesTable.id))
    .leftJoin(jobRolesTable, eq(interviewProcessesTable.roleId, jobRolesTable.id))
    .leftJoin(companiesTable, eq(interviewProcessesTable.clientCompanyId, companiesTable.id))
    .where(eq(interviewProposalsTable.id, proposalId));

  if (!row) {
    Errors.notFound(res, "Interview proposal not found");
    return null;
  }

  const accessRow = requireInterviewAccessRow(row);
  if (!accessRow) {
    Errors.notFound(res, "Interview proposal is missing its process context");
    return null;
  }

  if (row.meetingId == null || row.meetingStatus == null) {
    Errors.notFound(res, "Interview proposal is missing its meeting context");
    return null;
  }
  const meetingId = row.meetingId;
  const meetingStatus = row.meetingStatus;

  const vendorCompany = await db
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, accessRow.vendorCompanyId))
    .then((results) => results[0] ?? null);
  accessRow.vendorCompanyName = vendorCompany?.name ?? null;

  if (!canAccessInterviewRow(req.user! as { role: InterviewActorRole; companyId: number | null }, accessRow)) {
    if (req.user!.role === "client") {
      Errors.notFound(res, "Interview proposal not found");
      return null;
    }
    Errors.forbidden(res);
    return null;
  }

  return {
    ...accessRow,
    proposalId: row.proposalId,
    meetingId,
    meetingStatus,
    proposedByRole: row.proposedByRole,
    responseStatus: row.responseStatus,
    proposalType: row.proposalType,
    proposedDate: row.proposedDate,
    startTime: row.startTime ?? null,
    endTime: row.endTime ?? null,
    windowLabel: row.windowLabel ?? null,
    timezone: row.timezone,
    durationMinutes: row.durationMinutes,
  };
}

export async function listCandidateInterviewProcesses(candidateId: number) {
  const processes = await db
    .select({
      id: interviewProcessesTable.id,
      candidateId: interviewProcessesTable.candidateId,
      roleId: interviewProcessesTable.roleId,
      clientCompanyId: interviewProcessesTable.clientCompanyId,
      vendorCompanyId: interviewProcessesTable.vendorCompanyId,
      status: interviewProcessesTable.status,
      openedAt: interviewProcessesTable.openedAt,
      closedAt: interviewProcessesTable.closedAt,
      closedReason: interviewProcessesTable.closedReason,
      createdByUserId: interviewProcessesTable.createdByUserId,
      updatedAt: interviewProcessesTable.updatedAt,
      roleTitle: jobRolesTable.title,
      clientCompanyName: companiesTable.name,
      candidateFirstName: candidatesTable.firstName,
      candidateLastName: candidatesTable.lastName,
      candidateStatus: candidatesTable.status,
    })
    .from(interviewProcessesTable)
    .leftJoin(jobRolesTable, eq(interviewProcessesTable.roleId, jobRolesTable.id))
    .leftJoin(companiesTable, eq(interviewProcessesTable.clientCompanyId, companiesTable.id))
    .leftJoin(candidatesTable, eq(interviewProcessesTable.candidateId, candidatesTable.id))
    .where(eq(interviewProcessesTable.candidateId, candidateId))
    .orderBy(desc(interviewProcessesTable.openedAt));

  if (!processes.length) return [];

  const vendorNameMap = new Map<number, string | null>();
  const vendorIds = Array.from(new Set(processes.map((process) => process.vendorCompanyId)));
  if (vendorIds.length) {
    const vendors = await db
      .select({ id: companiesTable.id, name: companiesTable.name })
      .from(companiesTable)
      .where(inArray(companiesTable.id, vendorIds));
    for (const vendor of vendors) vendorNameMap.set(vendor.id, vendor.name ?? null);
  }

  const processIds = processes.map((process) => process.id);
  const meetings = await db
    .select()
    .from(interviewMeetingsTable)
    .where(inArray(interviewMeetingsTable.processId, processIds))
    .orderBy(asc(interviewMeetingsTable.meetingIndex), asc(interviewMeetingsTable.createdAt));

  const meetingIds = meetings.map((meeting) => meeting.id);
  const proposals = meetingIds.length
    ? await db
        .select()
        .from(interviewProposalsTable)
        .where(inArray(interviewProposalsTable.meetingId, meetingIds))
        .orderBy(asc(interviewProposalsTable.createdAt))
    : [];

  const activity = await db
    .select()
    .from(interviewActivityTable)
    .where(inArray(interviewActivityTable.processId, processIds))
    .orderBy(asc(interviewActivityTable.createdAt));

  const proposalsByMeeting = new Map<number, typeof proposals>();
  for (const proposal of proposals) {
    const current = proposalsByMeeting.get(proposal.meetingId) ?? [];
    current.push(proposal);
    proposalsByMeeting.set(proposal.meetingId, current);
  }

  const activityByProcess = new Map<number, typeof activity>();
  for (const item of activity) {
    const current = activityByProcess.get(item.processId) ?? [];
    current.push(item);
    activityByProcess.set(item.processId, current);
  }

  const meetingsByProcess = new Map<number, typeof meetings>();
  for (const meeting of meetings) {
    const current = meetingsByProcess.get(meeting.processId) ?? [];
    current.push(meeting);
    meetingsByProcess.set(meeting.processId, current);
  }

  return processes.map((process) => {
    const processMeetings = meetingsByProcess.get(process.id) ?? [];
    const formattedMeetings = processMeetings.map((meeting) => {
      const meetingProposals = proposalsByMeeting.get(meeting.id) ?? [];
      const latestPendingProposal = [...meetingProposals].reverse().find((proposal) => proposal.responseStatus === "pending") ?? null;
      return {
        id: meeting.id,
        processId: meeting.processId,
        meetingIndex: meeting.meetingIndex,
        title: meeting.title ?? null,
        status: meeting.status,
        scheduledDate: meeting.scheduledDate ?? null,
        scheduledStartTime: meeting.scheduledStartTime ?? null,
        scheduledEndTime: meeting.scheduledEndTime ?? null,
        timezone: meeting.timezone ?? null,
        confirmedProposalId: meeting.confirmedProposalId ?? null,
        summaryNote: meeting.summaryNote ?? null,
        cancelReason: meeting.cancelReason ?? null,
        completedAt: meeting.completedAt ? meeting.completedAt.toISOString() : null,
        cancelledAt: meeting.cancelledAt ? meeting.cancelledAt.toISOString() : null,
        createdAt: meeting.createdAt.toISOString(),
        updatedAt: meeting.updatedAt.toISOString(),
        awaitingResponseFrom: getAwaitingResponseFromProposal(latestPendingProposal),
        proposals: meetingProposals.map((proposal) => ({
          id: proposal.id,
          meetingId: proposal.meetingId,
          proposedByRole: proposal.proposedByRole,
          proposedByUserId: proposal.proposedByUserId,
          proposalType: proposal.proposalType,
          proposedDate: proposal.proposedDate,
          startTime: proposal.startTime ?? null,
          endTime: proposal.endTime ?? null,
          windowLabel: proposal.windowLabel ?? null,
          timezone: proposal.timezone,
          durationMinutes: proposal.durationMinutes,
          note: proposal.note ?? null,
          responseStatus: proposal.responseStatus,
          label: formatProposalTimeLabel(proposal),
          createdAt: proposal.createdAt.toISOString(),
        })),
      };
    });

    const activeMeeting =
      formattedMeetings.find((meeting) => meeting.status === "negotiating") ??
      formattedMeetings.find((meeting) => meeting.status === "scheduled") ??
      formattedMeetings.at(-1) ??
      null;

    return {
      id: process.id,
      candidateId: process.candidateId,
      candidateName: `${process.candidateFirstName} ${process.candidateLastName}`.trim(),
      candidateStatus: process.candidateStatus,
      roleId: process.roleId,
      roleTitle: process.roleTitle ?? "Role",
      clientCompanyId: process.clientCompanyId,
      clientCompanyName: process.clientCompanyName ?? null,
      vendorCompanyId: process.vendorCompanyId,
      vendorCompanyName: vendorNameMap.get(process.vendorCompanyId) ?? null,
      status: process.status,
      openedAt: process.openedAt.toISOString(),
      closedAt: process.closedAt ? process.closedAt.toISOString() : null,
      closedReason: process.closedReason ?? null,
      updatedAt: process.updatedAt.toISOString(),
      activeMeetingId: activeMeeting?.id ?? null,
      awaitingResponseFrom: activeMeeting?.awaitingResponseFrom ?? null,
      meetings: formattedMeetings,
      activity: (activityByProcess.get(process.id) ?? []).map((item) => ({
        id: item.id,
        processId: item.processId,
        meetingId: item.meetingId ?? null,
        actorUserId: item.actorUserId ?? null,
        actorRole: item.actorRole,
        eventType: item.eventType,
        payload: item.payload ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  });
}

export async function closeOpenInterviewProcessesForCandidate(input: {
  candidateId: number;
  reason: string;
  actorUserId: number | null;
  actorRole: InterviewActorRole | "system";
}) {
  const now = new Date();
  const processes = await db
    .select()
    .from(interviewProcessesTable)
    .where(and(eq(interviewProcessesTable.candidateId, input.candidateId), eq(interviewProcessesTable.status, "open")))
    .orderBy(desc(interviewProcessesTable.openedAt));

  if (!processes.length) return 0;

  await db.transaction(async (tx) => {
    for (const process of processes) {
      const meetings = await tx
        .select()
        .from(interviewMeetingsTable)
        .where(eq(interviewMeetingsTable.processId, process.id))
        .orderBy(desc(interviewMeetingsTable.meetingIndex));

      for (const meeting of meetings) {
        if (!ACTIVE_MEETING_STATUSES.has(meeting.status)) continue;

        await tx
          .update(interviewMeetingsTable)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelReason: input.reason,
            updatedAt: now,
          })
          .where(eq(interviewMeetingsTable.id, meeting.id));

        await tx
          .update(interviewProposalsTable)
          .set({ responseStatus: "superseded" })
          .where(and(eq(interviewProposalsTable.meetingId, meeting.id), eq(interviewProposalsTable.responseStatus, "pending")));

        await tx.insert(interviewActivityTable).values({
          processId: process.id,
          meetingId: meeting.id,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          eventType: "meeting_cancelled",
          payload: {
            reason: input.reason,
            cancelledBy: input.actorRole,
            automated: input.actorRole === "system",
          },
        });
      }

      await tx
        .update(interviewProcessesTable)
        .set({
          status: "closed",
          closedAt: now,
          closedReason: input.reason,
          updatedAt: now,
        })
        .where(eq(interviewProcessesTable.id, process.id));

      await tx.insert(interviewActivityTable).values({
        processId: process.id,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        eventType: "process_closed",
        payload: {
          reason: input.reason,
          automated: input.actorRole === "system",
        },
      });
    }
  });

  return processes.length;
}

export function candidateStatusShouldCloseInterviewProcess(status: string) {
  return EXIT_PIPELINE_STATUSES.has(status);
}

export async function ensureInterviewProcessForCandidate(input: {
  candidate: CandidateInterviewAccess;
  actorUserId: number;
  actorRole: InterviewActorRole;
}) {
  const [existing] = await db
    .select({ id: interviewProcessesTable.id })
    .from(interviewProcessesTable)
    .where(and(eq(interviewProcessesTable.candidateId, input.candidate.id), eq(interviewProcessesTable.status, "open")))
    .limit(1);

  if (existing) return existing;

  if (input.candidate.roleCompanyId == null) {
    throw new Error("Candidate role company is required to open an interview process");
  }

  const now = new Date();
  const [created] = await db
    .insert(interviewProcessesTable)
    .values({
      candidateId: input.candidate.id,
      roleId: input.candidate.roleId,
      clientCompanyId: input.candidate.roleCompanyId,
      vendorCompanyId: input.candidate.vendorCompanyId,
      status: "open",
      openedAt: now,
      createdByUserId: input.actorUserId,
      updatedAt: now,
    })
    .returning({ id: interviewProcessesTable.id });

  await db.insert(interviewActivityTable).values({
    processId: created.id,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    eventType: "process_opened",
    payload: {
      candidateId: input.candidate.id,
      roleId: input.candidate.roleId,
    },
  });

  return created;
}
