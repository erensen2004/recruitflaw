import { Router } from "express";
import {
  db,
  candidateStatusHistoryTable,
  candidatesTable,
  interviewActivityTable,
  interviewMeetingsTable,
  interviewProcessesTable,
  interviewProposalsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { Errors } from "../lib/errors.js";
import {
  candidateStatusShouldCloseInterviewProcess,
  closeOpenInterviewProcessesForCandidate,
  listCandidateInterviewProcesses,
  actorNeedsInterviewAction,
  resolveInterviewActor,
  resolveInterviewMeetingAccess,
  resolveInterviewProcessAccess,
  resolveInterviewProposalAccess,
} from "../lib/interviews.js";
import { validate } from "../middlewares/validate.js";
import {
  AcceptInterviewProposalSchema,
  CancelInterviewMeetingSchema,
  CompleteInterviewMeetingSchema,
  CreateInterviewMeetingSchema,
  CreateInterviewProposalSchema,
  CreateInterviewRequestSchema,
} from "../lib/schemas.js";

const router = Router();

function parsePositiveInt(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getQueryString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function flattenProposalFromBody(body: {
  proposalType: "exact_slot" | "flexible_window";
  proposedDate: string;
  startTime?: string | null;
  endTime?: string | null;
  windowLabel?: string | null;
  timezone: string;
  durationMinutes: number;
  note?: string | null;
}) {
  return {
    proposalType: body.proposalType,
    proposedDate: body.proposedDate,
    startTime: normalizeOptionalText(body.startTime),
    endTime: normalizeOptionalText(body.endTime),
    windowLabel: normalizeOptionalText(body.windowLabel),
    timezone: body.timezone.trim(),
    durationMinutes: body.durationMinutes,
    note: normalizeOptionalText(body.note),
  };
}

function getSelectedMeeting(process: Awaited<ReturnType<typeof listCandidateInterviewProcesses>>[number]) {
  return (
    process.meetings.find((meeting) => meeting.status === "negotiating") ??
    process.meetings.find((meeting) => meeting.status === "scheduled") ??
    process.meetings.at(-1) ??
    null
  );
}

router.get("/candidates/:id/interviews", requireAuth, async (req, res) => {
  try {
    const candidateId = parsePositiveInt(req.params.id);
    if (!candidateId) {
      Errors.badRequest(res, "Candidate id must be a positive integer");
      return;
    }

    const access = await resolveCandidateAccess(req, res, candidateId);
    if (!access) return;

    const items = await listCandidateInterviewProcesses(candidateId);
    res.json({ items });
  } catch (error) {
    console.error(error);
    Errors.internal(res);
  }
});

router.post(
  "/candidates/:id/interviews",
  requireAuth,
  requireRole("client"),
  validate(CreateInterviewRequestSchema),
  async (req, res) => {
    try {
      const candidateId = parsePositiveInt(req.params.id);
      if (!candidateId) {
        Errors.badRequest(res, "Candidate id must be a positive integer");
        return;
      }

      const access = await resolveCandidateAccess(req, res, candidateId);
      if (!access) return;

      if (!["submitted", "screening", "interview"].includes(access.status)) {
        Errors.badRequest(res, "Interview requests can only start for submitted, screening, or interview candidates");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor || actor.companyId == null) {
        Errors.forbidden(res);
        return;
      }

      if (access.roleCompanyId == null || access.roleCompanyId !== actor.companyId) {
        Errors.forbidden(res);
        return;
      }

      const [existingOpen] = await db
        .select({ id: interviewProcessesTable.id })
        .from(interviewProcessesTable)
        .where(and(eq(interviewProcessesTable.candidateId, candidateId), eq(interviewProcessesTable.status, "open")))
        .limit(1);

      if (existingOpen) {
        Errors.conflict(res, "This candidate already has an active interview process");
        return;
      }

      const proposalInput = flattenProposalFromBody(req.body);
      const title = normalizeOptionalText(req.body.title);
      const meetingNote = proposalInput.note;
      const now = new Date();

      const clientCompanyId = access.roleCompanyId;
      if (clientCompanyId == null) {
        Errors.badRequest(res, "Candidate role is missing a client company");
        return;
      }

      await db.transaction(async (tx) => {
        const [process] = await tx
          .insert(interviewProcessesTable)
          .values({
            candidateId,
            roleId: access.roleId,
            clientCompanyId,
            vendorCompanyId: access.vendorCompanyId,
            status: "open",
            openedAt: now,
            createdByUserId: req.user!.userId,
            updatedAt: now,
          })
          .returning();

        const [meeting] = await tx
          .insert(interviewMeetingsTable)
          .values({
            processId: process.id,
            meetingIndex: 1,
            status: "negotiating",
            title,
            timezone: proposalInput.timezone,
            createdByUserId: req.user!.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const [proposal] = await tx
          .insert(interviewProposalsTable)
          .values({
            meetingId: meeting.id,
            proposedByRole: actor.role,
            proposedByUserId: actor.userId,
            proposalType: proposalInput.proposalType,
            proposedDate: proposalInput.proposedDate,
            startTime: proposalInput.startTime,
            endTime: proposalInput.endTime,
            windowLabel: proposalInput.windowLabel,
            timezone: proposalInput.timezone,
            durationMinutes: proposalInput.durationMinutes,
            note: meetingNote,
            responseStatus: "pending",
            createdAt: now,
          })
          .returning();

        await tx.insert(interviewActivityTable).values([
          {
            processId: process.id,
            meetingId: meeting.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "process_opened",
            payload: {
              candidateId,
              roleId: access.roleId,
            },
          },
          {
            processId: process.id,
            meetingId: meeting.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "proposal_created",
            payload: {
              proposalId: proposal.id,
              proposalType: proposal.proposalType,
            },
          },
        ]);

        if (access.status !== "interview") {
          await tx
            .update(candidatesTable)
            .set({ status: "interview", updatedAt: now })
            .where(eq(candidatesTable.id, candidateId));

          await tx.insert(candidateStatusHistoryTable).values({
            candidateId,
            previousStatus: access.status,
            nextStatus: "interview",
            reason: "Interview process opened",
            changedByUserId: actor.userId,
            changedByName: actor.label,
          });
        }
      });

      const items = await listCandidateInterviewProcesses(candidateId);
      res.status(201).json({ process: items[0] ?? null, items });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/interviews/:processId/meetings",
  requireAuth,
  requireRole("client", "admin"),
  validate(CreateInterviewMeetingSchema),
  async (req, res) => {
    try {
      const processId = parsePositiveInt(req.params.processId);
      if (!processId) {
        Errors.badRequest(res, "Interview process id must be a positive integer");
        return;
      }

      const access = await resolveInterviewProcessAccess(req, res, processId);
      if (!access) return;
      if (access.processStatus !== "open") {
        Errors.badRequest(res, "New meetings can only be created in an open interview process");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const existingMeetings = await db
        .select()
        .from(interviewMeetingsTable)
        .where(eq(interviewMeetingsTable.processId, processId))
        .orderBy(desc(interviewMeetingsTable.meetingIndex));

      const activeMeeting = existingMeetings.find((meeting) => meeting.status === "negotiating" || meeting.status === "scheduled");
      if (activeMeeting) {
        Errors.conflict(res, "Finish or cancel the active meeting before starting a new one");
        return;
      }

      const nextIndex = (existingMeetings[0]?.meetingIndex ?? 0) + 1;
      const proposalInput = flattenProposalFromBody(req.body);
      const title = normalizeOptionalText(req.body.title);
      const now = new Date();

      await db.transaction(async (tx) => {
        const [meeting] = await tx
          .insert(interviewMeetingsTable)
          .values({
            processId,
            meetingIndex: nextIndex,
            title,
            status: "negotiating",
            timezone: proposalInput.timezone,
            createdByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const [proposal] = await tx
          .insert(interviewProposalsTable)
          .values({
            meetingId: meeting.id,
            proposedByRole: actor.role,
            proposedByUserId: actor.userId,
            proposalType: proposalInput.proposalType,
            proposedDate: proposalInput.proposedDate,
            startTime: proposalInput.startTime,
            endTime: proposalInput.endTime,
            windowLabel: proposalInput.windowLabel,
            timezone: proposalInput.timezone,
            durationMinutes: proposalInput.durationMinutes,
            note: proposalInput.note,
            responseStatus: "pending",
            createdAt: now,
          })
          .returning();

        await tx
          .update(interviewProcessesTable)
          .set({ updatedAt: now })
          .where(eq(interviewProcessesTable.id, processId));

        await tx.insert(interviewActivityTable).values([
          {
            processId,
            meetingId: meeting.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "meeting_opened",
            payload: {
              meetingId: meeting.id,
              meetingIndex: nextIndex,
              title,
            },
          },
          {
            processId,
            meetingId: meeting.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "proposal_created",
            payload: {
              proposalId: proposal.id,
              proposalType: proposal.proposalType,
            },
          },
        ]);
      });

      const items = await listCandidateInterviewProcesses(access.candidateId);
      res.status(201).json({ process: items.find((item) => item.id === processId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/meetings/:meetingId/proposals",
  requireAuth,
  requireRole("client", "vendor", "admin"),
  validate(CreateInterviewProposalSchema),
  async (req, res) => {
    try {
      const meetingId = parsePositiveInt(req.params.meetingId);
      if (!meetingId) {
        Errors.badRequest(res, "Interview meeting id must be a positive integer");
        return;
      }

      const access = await resolveInterviewMeetingAccess(req, res, meetingId);
      if (!access) return;
      if (access.processStatus !== "open" || access.meetingStatus !== "negotiating") {
        Errors.badRequest(res, "Only negotiating meetings can receive new proposals");
        return;
      }

      if (req.user!.role === "vendor" && access.vendorCompanyId !== req.user!.companyId) {
        Errors.forbidden(res);
        return;
      }
      if (req.user!.role === "client" && access.clientCompanyId !== req.user!.companyId) {
        Errors.forbidden(res);
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const existingProposals = await db
        .select()
        .from(interviewProposalsTable)
        .where(eq(interviewProposalsTable.meetingId, meetingId))
        .orderBy(desc(interviewProposalsTable.createdAt));

      const latestPending = existingProposals.find((proposal) => proposal.responseStatus === "pending");
      if (latestPending && latestPending.proposedByRole === actor.role) {
        Errors.conflict(res, "Wait for the other side to respond before sending another proposal");
        return;
      }

      const proposalInput = flattenProposalFromBody(req.body);
      const now = new Date();

      const [proposal] = await db.transaction(async (tx) => {
        if (latestPending) {
          await tx
            .update(interviewProposalsTable)
            .set({ responseStatus: "superseded" })
            .where(eq(interviewProposalsTable.id, latestPending.id));
        }

        const [createdProposal] = await tx
          .insert(interviewProposalsTable)
          .values({
            meetingId,
            proposedByRole: actor.role,
            proposedByUserId: actor.userId,
            proposalType: proposalInput.proposalType,
            proposedDate: proposalInput.proposedDate,
            startTime: proposalInput.startTime,
            endTime: proposalInput.endTime,
            windowLabel: proposalInput.windowLabel,
            timezone: proposalInput.timezone,
            durationMinutes: proposalInput.durationMinutes,
            note: proposalInput.note,
            responseStatus: "pending",
            createdAt: now,
          })
          .returning();

        await tx
          .update(interviewMeetingsTable)
          .set({ updatedAt: now })
          .where(eq(interviewMeetingsTable.id, meetingId));

        await tx
          .update(interviewProcessesTable)
          .set({ updatedAt: now })
          .where(eq(interviewProcessesTable.id, access.processId));

        await tx.insert(interviewActivityTable).values({
          processId: access.processId,
          meetingId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "proposal_created",
          payload: {
            proposalId: createdProposal.id,
            proposalType: createdProposal.proposalType,
            supersededProposalId: latestPending?.id ?? null,
          },
        });

        return [createdProposal];
      });

      const items = await listCandidateInterviewProcesses(access.candidateId);
      res.status(201).json({
        proposalId: proposal.id,
        process: items.find((item) => item.id === access.processId) ?? null,
      });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/proposals/:proposalId/accept",
  requireAuth,
  requireRole("client", "vendor", "admin"),
  validate(AcceptInterviewProposalSchema),
  async (req, res) => {
    try {
      const proposalId = parsePositiveInt(req.params.proposalId);
      if (!proposalId) {
        Errors.badRequest(res, "Interview proposal id must be a positive integer");
        return;
      }

      const access = await resolveInterviewProposalAccess(req, res, proposalId);
      if (!access) return;

      if (access.processStatus !== "open" || access.meetingStatus !== "negotiating") {
        Errors.badRequest(res, "Only proposals in negotiating meetings can be accepted");
        return;
      }
      if (access.responseStatus !== "pending") {
        Errors.badRequest(res, "This proposal is no longer pending");
        return;
      }
      if (access.proposalType !== "exact_slot") {
        Errors.badRequest(res, "Only exact slot proposals can be confirmed");
        return;
      }
      if (req.user!.role !== "admin" && req.user!.role === access.proposedByRole) {
        Errors.forbidden(res, "You cannot accept your own proposal");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const acceptanceNote = normalizeOptionalText(req.body.note);
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewProposalsTable)
          .set({
            responseStatus: "superseded",
          })
          .where(and(eq(interviewProposalsTable.meetingId, access.meetingId), eq(interviewProposalsTable.responseStatus, "pending")));

        await tx
          .update(interviewProposalsTable)
          .set({ responseStatus: "accepted" })
          .where(eq(interviewProposalsTable.id, proposalId));

        await tx
          .update(interviewMeetingsTable)
          .set({
            status: "scheduled",
            scheduledDate: access.proposedDate,
            scheduledStartTime: access.startTime,
            scheduledEndTime: access.endTime,
            timezone: access.timezone,
            confirmedProposalId: proposalId,
            updatedAt: now,
          })
          .where(eq(interviewMeetingsTable.id, access.meetingId));

        await tx
          .update(interviewProcessesTable)
          .set({ updatedAt: now })
          .where(eq(interviewProcessesTable.id, access.processId));

        await tx.insert(interviewActivityTable).values({
          processId: access.processId,
          meetingId: access.meetingId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "proposal_accepted",
          payload: {
            proposalId,
            acceptedNote: acceptanceNote,
            scheduledDate: access.proposedDate,
            scheduledStartTime: access.startTime,
            scheduledEndTime: access.endTime,
            timezone: access.timezone,
          },
        });
      });

      const items = await listCandidateInterviewProcesses(access.candidateId);
      res.json({ process: items.find((item) => item.id === access.processId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/meetings/:meetingId/complete",
  requireAuth,
  requireRole("client", "admin"),
  validate(CompleteInterviewMeetingSchema),
  async (req, res) => {
    try {
      const meetingId = parsePositiveInt(req.params.meetingId);
      if (!meetingId) {
        Errors.badRequest(res, "Interview meeting id must be a positive integer");
        return;
      }

      const access = await resolveInterviewMeetingAccess(req, res, meetingId);
      if (!access) return;
      if (access.meetingStatus !== "scheduled") {
        Errors.badRequest(res, "Only scheduled meetings can be completed");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const summaryNote = normalizeOptionalText(req.body.summaryNote);
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewMeetingsTable)
          .set({
            status: "completed",
            completedAt: now,
            summaryNote,
            updatedAt: now,
          })
          .where(eq(interviewMeetingsTable.id, meetingId));

        await tx
          .update(interviewProcessesTable)
          .set({ updatedAt: now })
          .where(eq(interviewProcessesTable.id, access.processId));

        await tx.insert(interviewActivityTable).values({
          processId: access.processId,
          meetingId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "meeting_completed",
          payload: {
            summaryNote,
          },
        });
      });

      const items = await listCandidateInterviewProcesses(access.candidateId);
      res.json({ process: items.find((item) => item.id === access.processId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/meetings/:meetingId/cancel",
  requireAuth,
  requireRole("client", "admin"),
  validate(CancelInterviewMeetingSchema),
  async (req, res) => {
    try {
      const meetingId = parsePositiveInt(req.params.meetingId);
      if (!meetingId) {
        Errors.badRequest(res, "Interview meeting id must be a positive integer");
        return;
      }

      const access = await resolveInterviewMeetingAccess(req, res, meetingId);
      if (!access) return;
      if (!["negotiating", "scheduled"].includes(access.meetingStatus)) {
        Errors.badRequest(res, "Only active meetings can be cancelled");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const reason = normalizeOptionalText(req.body.reason) ?? "Meeting cancelled";
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewMeetingsTable)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelReason: reason,
            updatedAt: now,
          })
          .where(eq(interviewMeetingsTable.id, meetingId));

        await tx
          .update(interviewProposalsTable)
          .set({ responseStatus: "superseded" })
          .where(and(eq(interviewProposalsTable.meetingId, meetingId), eq(interviewProposalsTable.responseStatus, "pending")));

        await tx
          .update(interviewProcessesTable)
          .set({ updatedAt: now })
          .where(eq(interviewProcessesTable.id, access.processId));

        await tx.insert(interviewActivityTable).values({
          processId: access.processId,
          meetingId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "meeting_cancelled",
          payload: { reason },
        });
      });

      const items = await listCandidateInterviewProcesses(access.candidateId);
      res.json({ process: items.find((item) => item.id === access.processId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.get("/interviews", requireAuth, async (req, res) => {
  try {
    const view = getQueryString(req.query.view) ?? "needs_action";
    const countOnly = getQueryString(req.query.countOnly) === "true";
    const candidateIdFilter = parsePositiveInt(getQueryString(req.query.candidateId));
    const roleIdFilter = parsePositiveInt(getQueryString(req.query.roleId));

    const conditions = [];
    if (req.user!.role === "client" && req.user!.companyId) {
      conditions.push(eq(interviewProcessesTable.clientCompanyId, req.user!.companyId));
    } else if (req.user!.role === "vendor" && req.user!.companyId) {
      conditions.push(eq(interviewProcessesTable.vendorCompanyId, req.user!.companyId));
    }
    if (candidateIdFilter) conditions.push(eq(interviewProcessesTable.candidateId, candidateIdFilter));
    if (roleIdFilter) conditions.push(eq(interviewProcessesTable.roleId, roleIdFilter));

    const processQuery = db
      .select({
        id: interviewProcessesTable.id,
        candidateId: interviewProcessesTable.candidateId,
      })
      .from(interviewProcessesTable);

    const processes = await (conditions.length ? processQuery.where(and(...conditions)) : processQuery)
      .orderBy(desc(interviewProcessesTable.updatedAt))
      .limit(200);

    const uniqueCandidateIds = Array.from(new Set(processes.map((process) => process.candidateId)));
    const bundles = (
      await Promise.all(uniqueCandidateIds.map((candidateId) => listCandidateInterviewProcesses(candidateId)))
    )
      .flat()
      .filter((bundle) => processes.some((process) => process.id === bundle.id));

    const items = bundles
      .map((process) => {
        const selectedMeeting = getSelectedMeeting(process);
        let latestPendingProposal = null;
        const proposals = selectedMeeting?.proposals ?? [];
        for (let index = proposals.length - 1; index >= 0; index -= 1) {
          const proposal = proposals[index];
          if (proposal.responseStatus === "pending") {
            latestPendingProposal = proposal;
            break;
          }
        }
        const needsAction = actorNeedsInterviewAction(req.user!.role as "admin" | "client" | "vendor", latestPendingProposal);
        const counterpartName =
          req.user!.role === "client"
            ? process.vendorCompanyName
            : req.user!.role === "vendor"
              ? process.clientCompanyName
              : `${process.clientCompanyName ?? "Client"} ↔ ${process.vendorCompanyName ?? "Vendor"}`;
        const nextSlotLabel =
          selectedMeeting?.status === "scheduled"
            ? [selectedMeeting.scheduledDate, [selectedMeeting.scheduledStartTime, selectedMeeting.scheduledEndTime].filter(Boolean).join(" - "), selectedMeeting.timezone].filter(Boolean).join(" • ")
            : latestPendingProposal?.label ?? null;

        return {
          id: process.id,
          candidateId: process.candidateId,
          candidateName: process.candidateName,
          candidateStatus: process.candidateStatus,
          roleId: process.roleId,
          roleTitle: process.roleTitle,
          counterpartName,
          processStatus: process.status,
          activeMeetingId: selectedMeeting?.id ?? null,
          meetingIndex: selectedMeeting?.meetingIndex ?? null,
          meetingTitle: selectedMeeting?.title ?? null,
          meetingStatus: selectedMeeting?.status ?? null,
          awaitingResponseFrom: process.awaitingResponseFrom,
          nextSlotLabel,
          needsAction,
          updatedAt: process.updatedAt,
          openedAt: process.openedAt,
          closedAt: process.closedAt,
        };
      })
      .filter((item) => {
        if (view === "all") return true;
        if (view === "needs_action") return item.needsAction;
        if (view === "scheduled") return item.meetingStatus === "scheduled";
        if (view === "history") return item.processStatus === "closed" || item.meetingStatus === "completed" || item.meetingStatus === "cancelled";
        return true;
      });

    if (countOnly) {
      res.json({ count: items.length });
      return;
    }

    res.json({ items });
  } catch (error) {
    console.error(error);
    Errors.internal(res);
  }
});

export async function maybeCloseInterviewProcessForCandidateStatusChange(input: {
  candidateId: number;
  nextStatus: string;
  actorUserId: number;
  actorRole: "admin" | "client" | "vendor";
}) {
  if (!candidateStatusShouldCloseInterviewProcess(input.nextStatus)) return 0;
  return closeOpenInterviewProcessesForCandidate({
    candidateId: input.candidateId,
    reason: `Candidate moved to ${input.nextStatus}`,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
  });
}

export default router;
