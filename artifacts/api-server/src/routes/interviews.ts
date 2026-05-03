import { Router } from "express";
import {
  db,
  candidateStatusHistoryTable,
  candidatesTable,
  companiesTable,
  jobRolesTable,
} from "@workspace/db";
import {
  interviewActivityTable,
  interviewMeetingsTable,
  interviewProcessesTable,
  interviewProposalsTable,
  interviewRequestActivityTable,
  interviewRequestCandidatesTable,
  interviewRequestsTable,
} from "../../../../lib/db/src/schema/interviews.js";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess, resolveRoleAccess } from "../lib/authz.js";
import { Errors } from "../lib/errors.js";
import {
  candidateStatusShouldCloseInterviewProcess,
  closeOpenInterviewProcessesForCandidate,
  listCandidateInterviewProcesses,
  actorNeedsInterviewAction,
  ensureInterviewProcessForCandidate,
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
  CreateInterviewRequestBatchSchema,
  CreateInterviewMeetingSchema,
  CreateInterviewProposalSchema,
  CreateInterviewRequestSchema,
  DeclineInterviewProposalSchema,
  DispatchInterviewRequestSchema,
  ReplyInterviewRequestCandidateSchema,
  ScheduleInterviewRequestCandidateSchema,
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

async function refreshInterviewRequestStatus(requestId: number) {
  const rows = await db
    .select({ status: interviewRequestCandidatesTable.status })
    .from(interviewRequestCandidatesTable)
    .where(eq(interviewRequestCandidatesTable.requestId, requestId));

  if (!rows.length) return;

  const statuses: string[] = rows.map((row) => row.status);
  const finalCandidateStatuses = new Set(["scheduled", "cancelled", "closed"]);
  const nextStatus = statuses.every((status) => finalCandidateStatuses.has(status))
    ? statuses.some((status) => status === "scheduled")
      ? "scheduled"
      : "cancelled"
    : statuses.some((status) => status === "vendor_replied")
      ? "vendor_replied"
      : statuses.some((status) => status === "sent_to_vendor")
        ? "sent_to_vendor"
        : "admin_review";

  await db
    .update(interviewRequestsTable)
    .set({
      status: nextStatus,
      resolvedAt: nextStatus === "scheduled" || nextStatus === "cancelled" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(interviewRequestsTable.id, requestId));
}

const ACTIVE_REQUEST_CANDIDATE_STATUSES = ["pending_admin", "sent_to_vendor", "vendor_replied"] as const;

async function findActiveInterviewRequestCandidateIds(candidateIds: number[]) {
  if (!candidateIds.length) return new Set<number>();

  const rows = await db
    .select({ candidateId: interviewRequestCandidatesTable.candidateId })
    .from(interviewRequestCandidatesTable)
    .where(and(
      inArray(interviewRequestCandidatesTable.candidateId, candidateIds),
      inArray(interviewRequestCandidatesTable.status, [...ACTIVE_REQUEST_CANDIDATE_STATUSES]),
    ));

  return new Set(rows.map((row) => row.candidateId));
}

async function markRequestCandidateForMeeting(input: {
  meetingId: number;
  status: "sent_to_vendor" | "vendor_replied" | "scheduled" | "cancelled" | "closed";
  adminNote?: string | null;
  vendorNote?: string | null;
}) {
  const [row] = await db
    .select({
      id: interviewRequestCandidatesTable.id,
      requestId: interviewRequestCandidatesTable.requestId,
    })
    .from(interviewRequestCandidatesTable)
    .where(eq(interviewRequestCandidatesTable.interviewMeetingId, input.meetingId))
    .limit(1);

  if (!row) return;

  await db
    .update(interviewRequestCandidatesTable)
    .set({
      status: input.status,
      adminNote: input.adminNote ?? undefined,
      vendorNote: input.vendorNote ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(interviewRequestCandidatesTable.id, row.id));

  await refreshInterviewRequestStatus(row.requestId);
}

async function listInterviewRequestItems(input: {
  actorRole: "admin" | "client" | "vendor";
  companyId: number | null;
  view: string;
  roleIdFilter?: number | null;
}) {
  if ((input.actorRole === "client" || input.actorRole === "vendor") && input.companyId == null) {
    return [];
  }

  let allowedRequestIds: number[] | null = null;
  if (input.actorRole === "vendor") {
    const vendorRows = await db
      .select({
        requestId: interviewRequestCandidatesTable.requestId,
        status: interviewRequestCandidatesTable.status,
      })
      .from(interviewRequestCandidatesTable)
      .where(eq(interviewRequestCandidatesTable.vendorCompanyId, input.companyId!));
    allowedRequestIds = Array.from(
      new Set(
        vendorRows
          .filter((row) => row.status !== "pending_admin")
          .map((row) => row.requestId),
      ),
    );
    if (!allowedRequestIds.length) return [];
  }

  const conditions = [];
  if (input.actorRole === "client") {
    conditions.push(eq(interviewRequestsTable.clientCompanyId, input.companyId!));
  } else if (allowedRequestIds) {
    conditions.push(inArray(interviewRequestsTable.id, allowedRequestIds));
  }
  if (input.roleIdFilter) conditions.push(eq(interviewRequestsTable.roleId, input.roleIdFilter));

  const requestQuery = db
    .select({
      id: interviewRequestsTable.id,
      roleId: interviewRequestsTable.roleId,
      roleTitle: jobRolesTable.title,
      clientCompanyId: interviewRequestsTable.clientCompanyId,
      clientCompanyName: companiesTable.name,
      requestedByUserId: interviewRequestsTable.requestedByUserId,
      status: interviewRequestsTable.status,
      requestText: interviewRequestsTable.requestText,
      preferredDate: interviewRequestsTable.preferredDate,
      preferredWindow: interviewRequestsTable.preferredWindow,
      timezone: interviewRequestsTable.timezone,
      durationMinutes: interviewRequestsTable.durationMinutes,
      adminNote: interviewRequestsTable.adminNote,
      createdAt: interviewRequestsTable.createdAt,
      updatedAt: interviewRequestsTable.updatedAt,
      resolvedAt: interviewRequestsTable.resolvedAt,
    })
    .from(interviewRequestsTable)
    .leftJoin(jobRolesTable, eq(interviewRequestsTable.roleId, jobRolesTable.id))
    .leftJoin(companiesTable, eq(interviewRequestsTable.clientCompanyId, companiesTable.id));

  const requests = await (conditions.length ? requestQuery.where(and(...conditions)) : requestQuery)
    .orderBy(desc(interviewRequestsTable.updatedAt))
    .limit(100);

  if (!requests.length) return [];

  const requestIds = requests.map((request) => request.id);
  const candidateRows = await db
    .select({
      id: interviewRequestCandidatesTable.id,
      requestId: interviewRequestCandidatesTable.requestId,
      candidateId: interviewRequestCandidatesTable.candidateId,
      candidateFirstName: candidatesTable.firstName,
      candidateLastName: candidatesTable.lastName,
      candidateEmail: candidatesTable.email,
      candidateStatus: candidatesTable.status,
      vendorCompanyId: interviewRequestCandidatesTable.vendorCompanyId,
      vendorCompanyName: companiesTable.name,
      status: interviewRequestCandidatesTable.status,
      interviewProcessId: interviewRequestCandidatesTable.interviewProcessId,
      interviewMeetingId: interviewRequestCandidatesTable.interviewMeetingId,
      adminNote: interviewRequestCandidatesTable.adminNote,
      vendorNote: interviewRequestCandidatesTable.vendorNote,
      createdAt: interviewRequestCandidatesTable.createdAt,
      updatedAt: interviewRequestCandidatesTable.updatedAt,
    })
    .from(interviewRequestCandidatesTable)
    .leftJoin(candidatesTable, eq(interviewRequestCandidatesTable.candidateId, candidatesTable.id))
    .leftJoin(companiesTable, eq(interviewRequestCandidatesTable.vendorCompanyId, companiesTable.id))
    .where(inArray(interviewRequestCandidatesTable.requestId, requestIds))
    .orderBy(asc(interviewRequestCandidatesTable.id));

  const activityRows = await db
    .select()
    .from(interviewRequestActivityTable)
    .where(inArray(interviewRequestActivityTable.requestId, requestIds))
    .orderBy(asc(interviewRequestActivityTable.createdAt));

  const candidatesByRequest = new Map<number, typeof candidateRows>();
  for (const row of candidateRows) {
    if (input.actorRole === "vendor" && row.vendorCompanyId !== input.companyId) continue;
    const current = candidatesByRequest.get(row.requestId) ?? [];
    current.push(row);
    candidatesByRequest.set(row.requestId, current);
  }

  const activityByRequest = new Map<number, typeof activityRows>();
  for (const row of activityRows) {
    const current = activityByRequest.get(row.requestId) ?? [];
    current.push(row);
    activityByRequest.set(row.requestId, current);
  }

  return requests
    .map((request) => {
      const candidates = candidatesByRequest.get(request.id) ?? [];
      const needsAction =
        input.actorRole === "admin"
          ? request.status === "admin_review" || request.status === "vendor_replied" || candidates.some((candidate) => candidate.status === "pending_admin" || candidate.status === "vendor_replied")
          : input.actorRole === "vendor"
            ? candidates.some((candidate) => candidate.status === "sent_to_vendor")
            : ["admin_review", "sent_to_vendor", "vendor_replied"].includes(request.status);

      return {
        id: request.id,
        roleId: request.roleId,
        roleTitle: request.roleTitle ?? "Role",
        clientCompanyId: request.clientCompanyId,
        clientCompanyName: request.clientCompanyName ?? null,
        requestedByUserId: request.requestedByUserId,
        status: request.status,
        requestText: request.requestText,
        preferredDate: request.preferredDate ?? null,
        preferredWindow: request.preferredWindow ?? null,
        timezone: request.timezone ?? null,
        durationMinutes: request.durationMinutes ?? null,
        adminNote: request.adminNote ?? null,
        needsAction,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          requestId: candidate.requestId,
          candidateId: candidate.candidateId,
          candidateName: `${candidate.candidateFirstName ?? ""} ${candidate.candidateLastName ?? ""}`.trim(),
          candidateEmail: candidate.candidateEmail ?? null,
          candidateStatus: candidate.candidateStatus ?? null,
          vendorCompanyId: candidate.vendorCompanyId,
          vendorCompanyName: candidate.vendorCompanyName ?? null,
          status: candidate.status,
          interviewProcessId: candidate.interviewProcessId ?? null,
          interviewMeetingId: candidate.interviewMeetingId ?? null,
          adminNote: candidate.adminNote ?? null,
          vendorNote: candidate.vendorNote ?? null,
          createdAt: candidate.createdAt.toISOString(),
          updatedAt: candidate.updatedAt.toISOString(),
        })),
        activity: (activityByRequest.get(request.id) ?? []).map((activity) => ({
          id: activity.id,
          requestId: activity.requestId,
          requestCandidateId: activity.requestCandidateId ?? null,
          actorUserId: activity.actorUserId ?? null,
          actorRole: activity.actorRole,
          eventType: activity.eventType,
          payload: activity.payload ?? null,
          createdAt: activity.createdAt.toISOString(),
        })),
      };
    })
    .filter((item) => {
      if (input.view === "all") return true;
      if (input.view === "needs_action") return item.needsAction;
      if (input.view === "admin_review") return item.status === "admin_review";
      if (input.view === "awaiting_vendor") return item.status === "sent_to_vendor";
      if (input.view === "scheduled") return item.status === "scheduled";
      if (input.view === "history") return ["scheduled", "cancelled", "closed"].includes(item.status);
      return true;
    });
}

router.get("/interviews/action-counts", requireAuth, async (req, res) => {
  try {
    const actorRole = req.user!.role as "admin" | "client" | "vendor";
    if (!["admin", "client", "vendor"].includes(actorRole)) {
      Errors.forbidden(res);
      return;
    }

    const requestItems = await listInterviewRequestItems({
      actorRole,
      companyId: req.user!.companyId,
      view: "needs_action",
    });

    let processActionCount = 0;
    if (actorRole === "admin" || actorRole === "vendor") {
      if (actorRole === "vendor" && req.user!.companyId == null) {
        Errors.forbidden(res);
        return;
      }

      const pendingProposalConditions = [
        eq(interviewProposalsTable.responseStatus, "pending"),
        actorRole === "admin"
          ? eq(interviewProposalsTable.proposedByRole, "vendor")
          : inArray(interviewProposalsTable.proposedByRole, ["admin", "client"]),
      ];
      if (actorRole === "vendor") {
        pendingProposalConditions.push(eq(interviewProcessesTable.vendorCompanyId, req.user!.companyId!));
      }

      const [processActions] = await db
        .select({ count: count(interviewProposalsTable.id) })
        .from(interviewProposalsTable)
        .innerJoin(interviewMeetingsTable, eq(interviewProposalsTable.meetingId, interviewMeetingsTable.id))
        .innerJoin(interviewProcessesTable, eq(interviewMeetingsTable.processId, interviewProcessesTable.id))
        .where(and(...pendingProposalConditions));

      processActionCount = Number(processActions.count);
    }

    res.json({
      interviewRequests: requestItems.length,
      interviewProcesses: processActionCount,
      total: requestItems.length + processActionCount,
    });
  } catch (error) {
    console.error(error);
    Errors.internal(res);
  }
});

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

router.get("/interview-requests", requireAuth, async (req, res) => {
  try {
    const view = getQueryString(req.query.view) ?? "needs_action";
    const countOnly = getQueryString(req.query.countOnly) === "true";
    const roleIdFilter = parsePositiveInt(getQueryString(req.query.roleId));

    const items = await listInterviewRequestItems({
      actorRole: req.user!.role as "admin" | "client" | "vendor",
      companyId: req.user!.companyId ?? null,
      view,
      roleIdFilter,
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

router.post(
  "/interview-requests",
  requireAuth,
  requireRole("client", "admin"),
  validate(CreateInterviewRequestBatchSchema),
  async (req, res) => {
    try {
      const roleAccess = await resolveRoleAccess(req, res, req.body.roleId);
      if (!roleAccess) return;

      const candidateIds = Array.from(new Set(req.body.candidateIds as number[]));
      const candidates = await db
        .select({
          id: candidatesTable.id,
          status: candidatesTable.status,
          roleId: candidatesTable.roleId,
          vendorCompanyId: candidatesTable.vendorCompanyId,
          roleCompanyId: jobRolesTable.companyId,
        })
        .from(candidatesTable)
        .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
        .where(inArray(candidatesTable.id, candidateIds));

      if (candidates.length !== candidateIds.length) {
        Errors.badRequest(res, "One or more selected candidates could not be found");
        return;
      }

      const invalidCandidate = candidates.find((candidate) => (
        candidate.roleId !== req.body.roleId ||
        candidate.roleCompanyId !== roleAccess.companyId ||
        !["submitted", "screening", "interview"].includes(candidate.status)
      ));
      if (invalidCandidate) {
        Errors.forbidden(res, "Interview requests can only include approved candidates from the selected role");
        return;
      }

      const activeRequestCandidateIds = await findActiveInterviewRequestCandidateIds(candidateIds);
      if (activeRequestCandidateIds.size) {
        const activeNames = candidates
          .filter((candidate) => activeRequestCandidateIds.has(candidate.id))
          .map((candidate) => `#${candidate.id}`)
          .join(", ");
        Errors.conflict(res, `One or more selected candidates already have an active interview request${activeNames ? ` (${activeNames})` : ""}.`);
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const requestText = req.body.requestText.trim();
      const now = new Date();
      const [request] = await db.transaction(async (tx) => {
        const [createdRequest] = await tx
          .insert(interviewRequestsTable)
          .values({
            roleId: req.body.roleId,
            clientCompanyId: roleAccess.companyId,
            requestedByUserId: req.user!.userId,
            status: "admin_review",
            requestText,
            preferredDate: normalizeOptionalText(req.body.preferredDate),
            preferredWindow: normalizeOptionalText(req.body.preferredWindow),
            timezone: normalizeOptionalText(req.body.timezone) ?? "Europe/Istanbul",
            durationMinutes: req.body.durationMinutes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const createdCandidates = await tx
          .insert(interviewRequestCandidatesTable)
          .values(candidates.map((candidate) => ({
            requestId: createdRequest.id,
            candidateId: candidate.id,
            vendorCompanyId: candidate.vendorCompanyId,
            status: "pending_admin" as const,
            createdAt: now,
            updatedAt: now,
          })))
          .returning();

        const candidatesToMoveIntoInterview = candidates.filter((candidate) => ["submitted", "screening"].includes(candidate.status));
        if (candidatesToMoveIntoInterview.length) {
          await tx
            .update(candidatesTable)
            .set({ status: "interview", updatedAt: now })
            .where(inArray(candidatesTable.id, candidatesToMoveIntoInterview.map((candidate) => candidate.id)));

          await tx.insert(candidateStatusHistoryTable).values(
            candidatesToMoveIntoInterview.map((candidate) => ({
              candidateId: candidate.id,
              previousStatus: candidate.status,
              nextStatus: "interview",
              reason: actor.role === "client" ? "Interview request submitted by client" : "Interview request created by admin",
              changedByUserId: actor.userId,
              changedByName: actor.label,
            })),
          );
        }

        await tx.insert(interviewRequestActivityTable).values([
          {
            requestId: createdRequest.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "request_created",
            payload: {
              roleId: req.body.roleId,
              candidateIds,
            },
          },
          ...createdCandidates.map((candidate) => ({
            requestId: createdRequest.id,
            requestCandidateId: candidate.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "candidate_added",
            payload: {
              candidateId: candidate.candidateId,
            },
          })),
        ]);

        return [createdRequest];
      });

      const items = await listInterviewRequestItems({
        actorRole: req.user!.role as "admin" | "client" | "vendor",
        companyId: req.user!.companyId ?? null,
        view: "all",
        roleIdFilter: req.body.roleId,
      });

      res.status(201).json({ request: items.find((item) => item.id === request.id) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/interview-requests/:id/dispatch",
  requireAuth,
  requireRole("admin"),
  validate(DispatchInterviewRequestSchema),
  async (req, res) => {
    try {
      const requestId = parsePositiveInt(req.params.id);
      if (!requestId) {
        Errors.badRequest(res, "Interview request id must be a positive integer");
        return;
      }

      const [request] = await db
        .select()
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.id, requestId))
        .limit(1);

      if (!request) {
        Errors.notFound(res, "Interview request not found");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const requestCandidateIds = req.body.items.map((item: { requestCandidateId: number }) => item.requestCandidateId);
      const requestCandidates = await db
        .select()
        .from(interviewRequestCandidatesTable)
        .where(inArray(interviewRequestCandidatesTable.id, requestCandidateIds));

      if (requestCandidates.length !== requestCandidateIds.length || requestCandidates.some((item) => item.requestId !== requestId)) {
        Errors.badRequest(res, "One or more request candidates are not part of this request");
        return;
      }

      const itemByRequestCandidateId = new Map<number, (typeof req.body.items)[number]>(
        req.body.items.map((item: (typeof req.body.items)[number]) => [item.requestCandidateId, item]),
      );

      for (const requestCandidate of requestCandidates) {
        if (["scheduled", "cancelled", "closed"].includes(requestCandidate.status)) {
          Errors.conflict(res, "One or more selected candidates already have a final scheduling state");
          return;
        }

        const candidateAccess = await resolveCandidateAccess(req, res, requestCandidate.candidateId);
        if (!candidateAccess) return;
        if (candidateAccess.roleId !== request.roleId || candidateAccess.roleCompanyId !== request.clientCompanyId) {
          Errors.forbidden(res);
          return;
        }

        const process = await ensureInterviewProcessForCandidate({
          candidate: candidateAccess,
          actorUserId: actor.userId,
          actorRole: actor.role,
        });

        const existingMeetings = await db
          .select()
          .from(interviewMeetingsTable)
          .where(eq(interviewMeetingsTable.processId, process.id))
          .orderBy(desc(interviewMeetingsTable.meetingIndex));
        const activeMeeting = existingMeetings.find((meeting) => meeting.status === "negotiating" || meeting.status === "scheduled");
        if (activeMeeting && activeMeeting.id !== requestCandidate.interviewMeetingId) {
          Errors.conflict(res, "A selected candidate already has an active interview meeting");
          return;
        }
        if (activeMeeting?.status === "scheduled") {
          Errors.conflict(res, "This candidate already has a scheduled interview");
          return;
        }

        const item = itemByRequestCandidateId.get(requestCandidate.id);
        if (!item) continue;
        const messageText = item.messageText.trim();
        const adminNote = normalizeOptionalText(item.adminNote) ?? messageText;
        const now = new Date();
        const meetingIndex = activeMeeting?.meetingIndex ?? (existingMeetings[0]?.meetingIndex ?? 0) + 1;

        await db.transaction(async (tx) => {
          const [meeting] = activeMeeting
            ? [activeMeeting]
            : await tx
                .insert(interviewMeetingsTable)
                .values({
                  processId: process.id,
                  meetingIndex,
                  status: "negotiating",
                  createdByUserId: actor.userId,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();

          await tx
            .update(interviewProcessesTable)
            .set({ updatedAt: now })
            .where(eq(interviewProcessesTable.id, process.id));

          await tx
            .update(interviewMeetingsTable)
            .set({ status: "negotiating", updatedAt: now })
            .where(eq(interviewMeetingsTable.id, meeting.id));

          if (candidateAccess.status !== "interview") {
            await tx
              .update(candidatesTable)
              .set({ status: "interview", updatedAt: now })
              .where(eq(candidatesTable.id, candidateAccess.id));

            await tx.insert(candidateStatusHistoryTable).values({
              candidateId: candidateAccess.id,
              previousStatus: candidateAccess.status,
              nextStatus: "interview",
              reason: "Interview request dispatched by admin",
              changedByUserId: actor.userId,
              changedByName: actor.label,
            });
          }

          await tx
            .update(interviewRequestCandidatesTable)
            .set({
              status: "sent_to_vendor",
              interviewProcessId: process.id,
              interviewMeetingId: meeting.id,
              adminNote,
              updatedAt: now,
            })
            .where(eq(interviewRequestCandidatesTable.id, requestCandidate.id));

          await tx.insert(interviewActivityTable).values([
            ...(!activeMeeting ? [{
              processId: process.id,
              meetingId: meeting.id,
              actorUserId: actor.userId,
              actorRole: actor.role,
              eventType: "meeting_opened",
              payload: {
                meetingId: meeting.id,
                meetingIndex,
                sourceRequestId: requestId,
                requestCandidateId: requestCandidate.id,
              },
            }] : []),
            {
              processId: process.id,
              meetingId: meeting.id,
              actorUserId: actor.userId,
              actorRole: actor.role,
              eventType: "admin_message_sent",
              payload: {
                sourceRequestId: requestId,
                requestCandidateId: requestCandidate.id,
                messageText,
              },
            },
          ]);

          await tx.insert(interviewRequestActivityTable).values({
            requestId,
            requestCandidateId: requestCandidate.id,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: activeMeeting ? "admin_counter_sent" : "candidate_dispatched",
            payload: {
              candidateId: requestCandidate.candidateId,
              processId: process.id,
              meetingId: meeting.id,
              messageText,
            },
          });
        });
      }

      await refreshInterviewRequestStatus(requestId);
      const items = await listInterviewRequestItems({
        actorRole: "admin",
        companyId: req.user!.companyId ?? null,
        view: "all",
        roleIdFilter: request.roleId,
      });

      res.json({ request: items.find((item) => item.id === requestId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/interview-requests/:id/candidates/:requestCandidateId/reply",
  requireAuth,
  requireRole("vendor", "admin"),
  validate(ReplyInterviewRequestCandidateSchema),
  async (req, res) => {
    try {
      const requestId = parsePositiveInt(req.params.id);
      const requestCandidateId = parsePositiveInt(req.params.requestCandidateId);
      if (!requestId || !requestCandidateId) {
        Errors.badRequest(res, "Interview request and candidate ids must be positive integers");
        return;
      }

      const [requestCandidate] = await db
        .select()
        .from(interviewRequestCandidatesTable)
        .where(eq(interviewRequestCandidatesTable.id, requestCandidateId))
        .limit(1);

      if (!requestCandidate || requestCandidate.requestId !== requestId) {
        Errors.notFound(res, "Interview request candidate not found");
        return;
      }
      if (req.user!.role === "vendor" && requestCandidate.vendorCompanyId !== req.user!.companyId) {
        Errors.forbidden(res);
        return;
      }
      if (!["sent_to_vendor", "vendor_replied"].includes(requestCandidate.status)) {
        Errors.badRequest(res, "This candidate is not waiting on a vendor scheduling reply");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const messageText = req.body.messageText.trim();
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewRequestCandidatesTable)
          .set({
            status: "vendor_replied",
            vendorNote: messageText,
            updatedAt: now,
          })
          .where(eq(interviewRequestCandidatesTable.id, requestCandidate.id));

        if (requestCandidate.interviewMeetingId) {
          await tx
            .update(interviewMeetingsTable)
            .set({ status: "negotiating", updatedAt: now })
            .where(eq(interviewMeetingsTable.id, requestCandidate.interviewMeetingId));
        }
        if (requestCandidate.interviewProcessId) {
          await tx
            .update(interviewProcessesTable)
            .set({ updatedAt: now })
            .where(eq(interviewProcessesTable.id, requestCandidate.interviewProcessId));

          await tx.insert(interviewActivityTable).values({
            processId: requestCandidate.interviewProcessId,
            meetingId: requestCandidate.interviewMeetingId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "vendor_message_sent",
            payload: {
              sourceRequestId: requestId,
              requestCandidateId,
              replyType: req.body.replyType,
              messageText,
            },
          });
        }

        await tx.insert(interviewRequestActivityTable).values({
          requestId,
          requestCandidateId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "vendor_replied",
          payload: {
            candidateId: requestCandidate.candidateId,
            replyType: req.body.replyType,
            messageText,
          },
        });
      });

      await refreshInterviewRequestStatus(requestId);
      const items = await listInterviewRequestItems({
        actorRole: req.user!.role as "admin" | "client" | "vendor",
        companyId: req.user!.companyId ?? null,
        view: "all",
      });

      res.json({ request: items.find((item) => item.id === requestId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/interview-requests/:id/candidates/:requestCandidateId/schedule",
  requireAuth,
  requireRole("admin"),
  validate(ScheduleInterviewRequestCandidateSchema),
  async (req, res) => {
    try {
      const requestId = parsePositiveInt(req.params.id);
      const requestCandidateId = parsePositiveInt(req.params.requestCandidateId);
      if (!requestId || !requestCandidateId) {
        Errors.badRequest(res, "Interview request and candidate ids must be positive integers");
        return;
      }

      const [requestCandidate] = await db
        .select()
        .from(interviewRequestCandidatesTable)
        .where(eq(interviewRequestCandidatesTable.id, requestCandidateId))
        .limit(1);

      if (!requestCandidate || requestCandidate.requestId !== requestId) {
        Errors.notFound(res, "Interview request candidate not found");
        return;
      }
      if (["scheduled", "cancelled", "closed"].includes(requestCandidate.status)) {
        Errors.badRequest(res, "This candidate already has a final scheduling state");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const finalDetails = req.body.finalDetails.trim();
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewRequestCandidatesTable)
          .set({
            status: "scheduled",
            adminNote: finalDetails,
            updatedAt: now,
          })
          .where(eq(interviewRequestCandidatesTable.id, requestCandidate.id));

        if (requestCandidate.interviewMeetingId) {
          await tx
            .update(interviewMeetingsTable)
            .set({
              status: "scheduled",
              summaryNote: finalDetails,
              updatedAt: now,
            })
            .where(eq(interviewMeetingsTable.id, requestCandidate.interviewMeetingId));
        }
        if (requestCandidate.interviewProcessId) {
          await tx
            .update(interviewProcessesTable)
            .set({ updatedAt: now })
            .where(eq(interviewProcessesTable.id, requestCandidate.interviewProcessId));

          await tx.insert(interviewActivityTable).values({
            processId: requestCandidate.interviewProcessId,
            meetingId: requestCandidate.interviewMeetingId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            eventType: "meeting_scheduled",
            payload: {
              sourceRequestId: requestId,
              requestCandidateId,
              finalDetails,
            },
          });
        }

        await tx.insert(interviewRequestActivityTable).values({
          requestId,
          requestCandidateId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "candidate_scheduled",
          payload: {
            candidateId: requestCandidate.candidateId,
            finalDetails,
          },
        });
      });

      await refreshInterviewRequestStatus(requestId);
      const items = await listInterviewRequestItems({
        actorRole: "admin",
        companyId: req.user!.companyId ?? null,
        view: "all",
      });

      res.json({ request: items.find((item) => item.id === requestId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/interview-requests/:id/cancel",
  requireAuth,
  requireRole("client", "admin"),
  validate(CancelInterviewMeetingSchema),
  async (req, res) => {
    try {
      const requestId = parsePositiveInt(req.params.id);
      if (!requestId) {
        Errors.badRequest(res, "Interview request id must be a positive integer");
        return;
      }

      const [request] = await db
        .select()
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.id, requestId))
        .limit(1);

      if (!request) {
        Errors.notFound(res, "Interview request not found");
        return;
      }

      if (req.user!.role === "client" && request.clientCompanyId !== req.user!.companyId) {
        Errors.forbidden(res);
        return;
      }

      if (["scheduled", "cancelled", "closed"].includes(request.status)) {
        Errors.badRequest(res, "This interview request is already closed");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const reason = normalizeOptionalText(req.body.reason) ?? "Interview request cancelled";
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewRequestsTable)
          .set({
            status: "cancelled",
            adminNote: actor.role === "admin" ? reason : request.adminNote,
            updatedAt: now,
            resolvedAt: now,
          })
          .where(eq(interviewRequestsTable.id, requestId));

        await tx
          .update(interviewRequestCandidatesTable)
          .set({
            status: "cancelled",
            adminNote: actor.role === "admin" ? reason : undefined,
            updatedAt: now,
          })
          .where(eq(interviewRequestCandidatesTable.requestId, requestId));

        await tx.insert(interviewRequestActivityTable).values({
          requestId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          eventType: "request_cancelled",
          payload: { reason },
        });
      });

      const items = await listInterviewRequestItems({
        actorRole: req.user!.role as "admin" | "client" | "vendor",
        companyId: req.user!.companyId ?? null,
        view: "all",
        roleIdFilter: request.roleId,
      });

      res.json({ request: items.find((item) => item.id === requestId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/candidates/:id/interviews",
  requireAuth,
  requireRole("admin"),
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
      if (!actor) {
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
  requireRole("admin"),
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
  requireRole("vendor", "admin"),
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
      await markRequestCandidateForMeeting({
        meetingId,
        status: actor.role === "vendor" ? "vendor_replied" : "sent_to_vendor",
        vendorNote: actor.role === "vendor" ? proposalInput.note : null,
        adminNote: actor.role === "admin" ? proposalInput.note : null,
      });
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
  requireRole("vendor", "admin"),
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
      if (req.user!.role === access.proposedByRole) {
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
      await markRequestCandidateForMeeting({
        meetingId: access.meetingId,
        status: "scheduled",
        adminNote: actor.role === "admin" ? acceptanceNote : null,
        vendorNote: actor.role === "vendor" ? acceptanceNote : null,
      });
      res.json({ process: items.find((item) => item.id === access.processId) ?? null });
    } catch (error) {
      console.error(error);
      Errors.internal(res);
    }
  },
);

router.post(
  "/proposals/:proposalId/decline",
  requireAuth,
  requireRole("vendor", "admin"),
  validate(DeclineInterviewProposalSchema),
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
        Errors.badRequest(res, "Only proposals in negotiating meetings can be declined");
        return;
      }
      if (access.responseStatus !== "pending") {
        Errors.badRequest(res, "This proposal is no longer pending");
        return;
      }
      if (req.user!.role === access.proposedByRole) {
        Errors.forbidden(res, "You cannot decline your own proposal");
        return;
      }

      const actor = await resolveInterviewActor(req.user!.userId);
      if (!actor) {
        Errors.forbidden(res);
        return;
      }

      const note = normalizeOptionalText(req.body.note);
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(interviewProposalsTable)
          .set({ responseStatus: "rejected" })
          .where(eq(interviewProposalsTable.id, proposalId));

        await tx
          .update(interviewMeetingsTable)
          .set({ updatedAt: now })
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
          eventType: "proposal_declined",
          payload: {
            proposalId,
            note,
          },
        });
      });

      await markRequestCandidateForMeeting({
        meetingId: access.meetingId,
        status: "vendor_replied",
        vendorNote: actor.role === "vendor" ? note : null,
        adminNote: actor.role === "admin" ? note : null,
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
      await markRequestCandidateForMeeting({
        meetingId,
        status: "cancelled",
        adminNote: actor.role === "admin" ? reason : null,
      });
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
    if ((req.user!.role === "client" || req.user!.role === "vendor") && req.user!.companyId == null) {
      Errors.forbidden(res);
      return;
    }
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
