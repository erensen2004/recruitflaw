import { Router } from "express";
import {
  db,
  jobRolesTable,
  candidatesTable,
  companiesTable,
  usersTable,
  candidateNotesTable,
  candidateStatusHistoryTable,
  reviewThreadsTable,
  reviewThreadMessagesTable,
  interviewRequestsTable,
  interviewRequestCandidatesTable,
} from "@workspace/db";
import { eq, count, sql, desc, or, lt, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { Errors } from "../lib/errors.js";

const router = Router();

function isUndefinedRelationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01",
  );
}

router.get("/workbench", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const staleThreshold = sql`now() - interval '72 hours'`;

    const [
      [roleTotals],
      [candidateTotals],
      [pendingRoleReviews],
      [pendingCandidateReviews],
      [reviewRequiredCandidates],
      [interviewAdminReview],
      [interviewVendorReplied],
      [interviewAwaitingVendor],
      [scheduledInterviewRequests],
      staleRoles,
      staleCandidates,
      roleQueue,
      candidateQueue,
      parseReviewQueue,
      interviewQueue,
      recentScheduled,
    ] = await Promise.all([
      db.select({ count: count(jobRolesTable.id) }).from(jobRolesTable),
      db.select({ count: count(candidatesTable.id) }).from(candidatesTable),
      db
        .select({ count: count(jobRolesTable.id) })
        .from(jobRolesTable)
        .where(or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval"))),
      db
        .select({ count: count(candidatesTable.id) })
        .from(candidatesTable)
        .where(eq(candidatesTable.status, "pending_approval")),
      db
        .select({ count: count(candidatesTable.id) })
        .from(candidatesTable)
        .where(or(eq(candidatesTable.parseReviewRequired, true), eq(candidatesTable.parseStatus, "partial"))),
      db
        .select({ count: count(interviewRequestsTable.id) })
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.status, "admin_review")),
      db
        .select({ count: count(interviewRequestsTable.id) })
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.status, "vendor_replied")),
      db
        .select({ count: count(interviewRequestsTable.id) })
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.status, "sent_to_vendor")),
      db
        .select({ count: count(interviewRequestsTable.id) })
        .from(interviewRequestsTable)
        .where(eq(interviewRequestsTable.status, "scheduled")),
      db
        .select({
          id: jobRolesTable.id,
          title: jobRolesTable.title,
          companyName: companiesTable.name,
          status: jobRolesTable.status,
          createdAt: jobRolesTable.createdAt,
        })
        .from(jobRolesTable)
        .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
        .where(
          and(
            or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval")),
            lt(jobRolesTable.createdAt, staleThreshold),
          ),
        )
        .orderBy(jobRolesTable.createdAt)
        .limit(6),
      db
        .select({
          id: candidatesTable.id,
          name: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
          roleTitle: jobRolesTable.title,
          companyName: companiesTable.name,
          status: candidatesTable.status,
          submittedAt: candidatesTable.submittedAt,
        })
        .from(candidatesTable)
        .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
        .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
        .where(and(eq(candidatesTable.status, "pending_approval"), lt(candidatesTable.submittedAt, staleThreshold)))
        .orderBy(candidatesTable.submittedAt)
        .limit(6),
      db
        .select({
          id: jobRolesTable.id,
          title: jobRolesTable.title,
          companyName: companiesTable.name,
          status: jobRolesTable.status,
          updatedAt: jobRolesTable.updatedAt,
        })
        .from(jobRolesTable)
        .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
        .where(or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval")))
        .orderBy(desc(jobRolesTable.updatedAt))
        .limit(6),
      db
        .select({
          id: candidatesTable.id,
          name: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
          roleTitle: jobRolesTable.title,
          vendorCompanyName: companiesTable.name,
          status: candidatesTable.status,
          updatedAt: candidatesTable.updatedAt,
        })
        .from(candidatesTable)
        .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
        .leftJoin(companiesTable, eq(candidatesTable.vendorCompanyId, companiesTable.id))
        .where(eq(candidatesTable.status, "pending_approval"))
        .orderBy(desc(candidatesTable.updatedAt))
        .limit(6),
      db
        .select({
          id: candidatesTable.id,
          name: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
          roleTitle: jobRolesTable.title,
          parseStatus: candidatesTable.parseStatus,
          parseConfidence: candidatesTable.parseConfidence,
          updatedAt: candidatesTable.updatedAt,
        })
        .from(candidatesTable)
        .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
        .where(or(eq(candidatesTable.parseReviewRequired, true), eq(candidatesTable.parseStatus, "partial")))
        .orderBy(desc(candidatesTable.updatedAt))
        .limit(6),
      db
        .select({
          id: interviewRequestsTable.id,
          roleTitle: jobRolesTable.title,
          clientCompanyName: companiesTable.name,
          status: interviewRequestsTable.status,
          preferredDate: interviewRequestsTable.preferredDate,
          preferredWindow: interviewRequestsTable.preferredWindow,
          updatedAt: interviewRequestsTable.updatedAt,
        })
        .from(interviewRequestsTable)
        .leftJoin(jobRolesTable, eq(interviewRequestsTable.roleId, jobRolesTable.id))
        .leftJoin(companiesTable, eq(interviewRequestsTable.clientCompanyId, companiesTable.id))
        .where(inArray(interviewRequestsTable.status, ["admin_review", "vendor_replied", "sent_to_vendor"]))
        .orderBy(desc(interviewRequestsTable.updatedAt))
        .limit(8),
      db
        .select({
          id: interviewRequestsTable.id,
          roleTitle: jobRolesTable.title,
          clientCompanyName: companiesTable.name,
          status: interviewRequestsTable.status,
          resolvedAt: interviewRequestsTable.resolvedAt,
          updatedAt: interviewRequestsTable.updatedAt,
        })
        .from(interviewRequestsTable)
        .leftJoin(jobRolesTable, eq(interviewRequestsTable.roleId, jobRolesTable.id))
        .leftJoin(companiesTable, eq(interviewRequestsTable.clientCompanyId, companiesTable.id))
        .where(eq(interviewRequestsTable.status, "scheduled"))
        .orderBy(desc(interviewRequestsTable.updatedAt))
        .limit(6),
    ]);

    const interviewCandidateRows = interviewQueue.length
      ? await db
          .select({
            requestId: interviewRequestCandidatesTable.requestId,
            status: interviewRequestCandidatesTable.status,
            candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
            vendorCompanyName: companiesTable.name,
          })
          .from(interviewRequestCandidatesTable)
          .leftJoin(candidatesTable, eq(interviewRequestCandidatesTable.candidateId, candidatesTable.id))
          .leftJoin(companiesTable, eq(interviewRequestCandidatesTable.vendorCompanyId, companiesTable.id))
          .where(inArray(interviewRequestCandidatesTable.requestId, interviewQueue.map((item) => item.id)))
      : [];

    const candidatesByInterviewRequest = new Map<number, typeof interviewCandidateRows>();
    for (const row of interviewCandidateRows) {
      const current = candidatesByInterviewRequest.get(row.requestId) ?? [];
      current.push(row);
      candidatesByInterviewRequest.set(row.requestId, current);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        roles: Number(roleTotals.count),
        candidates: Number(candidateTotals.count),
      },
      queues: {
        roleApprovals: Number(pendingRoleReviews.count),
        candidateApprovals: Number(pendingCandidateReviews.count),
        parseReviews: Number(reviewRequiredCandidates.count),
        interviewAdminReview: Number(interviewAdminReview.count),
        interviewVendorReplied: Number(interviewVendorReplied.count),
        interviewAwaitingVendor: Number(interviewAwaitingVendor.count),
        scheduledInterviewRequests: Number(scheduledInterviewRequests.count),
      },
      roleQueue: roleQueue.map((role) => ({
        id: role.id,
        title: role.title,
        companyName: role.companyName ?? null,
        status: role.status,
        updatedAt: role.updatedAt.toISOString(),
      })),
      candidateQueue: candidateQueue.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        roleTitle: candidate.roleTitle ?? null,
        vendorCompanyName: candidate.vendorCompanyName ?? null,
        status: candidate.status,
        updatedAt: candidate.updatedAt.toISOString(),
      })),
      parseReviewQueue: parseReviewQueue.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        roleTitle: candidate.roleTitle ?? null,
        parseStatus: candidate.parseStatus,
        parseConfidence: candidate.parseConfidence,
        updatedAt: candidate.updatedAt.toISOString(),
      })),
      interviewQueue: interviewQueue.map((request) => ({
        id: request.id,
        roleTitle: request.roleTitle ?? null,
        clientCompanyName: request.clientCompanyName ?? null,
        status: request.status,
        preferredDate: request.preferredDate ?? null,
        preferredWindow: request.preferredWindow ?? null,
        updatedAt: request.updatedAt.toISOString(),
        candidates: (candidatesByInterviewRequest.get(request.id) ?? []).map((candidate) => ({
          name: candidate.candidateName,
          vendorCompanyName: candidate.vendorCompanyName ?? null,
          status: candidate.status,
        })),
      })),
      recentScheduled: recentScheduled.map((request) => ({
        id: request.id,
        roleTitle: request.roleTitle ?? null,
        clientCompanyName: request.clientCompanyName ?? null,
        status: request.status,
        resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
        updatedAt: request.updatedAt.toISOString(),
      })),
      stuckItems: {
        roles: staleRoles.map((role) => ({
          id: role.id,
          title: role.title,
          companyName: role.companyName ?? null,
          status: role.status,
          createdAt: role.createdAt.toISOString(),
        })),
        candidates: staleCandidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          roleTitle: candidate.roleTitle ?? null,
          companyName: candidate.companyName ?? null,
          status: candidate.status,
          submittedAt: candidate.submittedAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const [totals] = await db
      .select({
        totalCandidates: count(candidatesTable.id),
      })
      .from(candidatesTable);

    const [roleTotals] = await db
      .select({ totalRoles: count(jobRolesTable.id) })
      .from(jobRolesTable);

    const [companyTotals] = await db
      .select({ totalCompanies: count(companiesTable.id) })
      .from(companiesTable);

    const [userTotals] = await db
      .select({ totalUsers: count(usersTable.id) })
      .from(usersTable);

    const candidatesByStatus = await db
      .select({ status: candidatesTable.status, cnt: count() })
      .from(candidatesTable)
      .groupBy(candidatesTable.status);

    const rolesByStatus = await db
      .select({ status: jobRolesTable.status, cnt: count() })
      .from(jobRolesTable)
      .groupBy(jobRolesTable.status);

    const topRoles = await db
      .select({
        roleId: candidatesTable.roleId,
        roleTitle: jobRolesTable.title,
        cnt: count(),
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .groupBy(candidatesTable.roleId, jobRolesTable.title)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    const [interviewingTotals] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(eq(candidatesTable.status, "interview"));

    const [hiredTotals] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(eq(candidatesTable.status, "hired"));

    const [rejectedTotals] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(eq(candidatesTable.status, "rejected"));

    const staleThreshold = sql`now() - interval '72 hours'`;

    const [pendingRoleReviews] = await db
      .select({ count: count(jobRolesTable.id) })
      .from(jobRolesTable)
      .where(or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval")));

    const [pendingCandidateReviews] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(eq(candidatesTable.status, "pending_approval"));

    const [reviewRequiredCandidates] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(or(eq(candidatesTable.parseReviewRequired, true), eq(candidatesTable.parseStatus, "partial")));

    const [readyCandidates] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(or(eq(candidatesTable.status, "screening"), eq(candidatesTable.status, "interview"), eq(candidatesTable.status, "offer"), eq(candidatesTable.status, "hired")));

    const [staleRoleReviews] = await db
      .select({ count: count(jobRolesTable.id) })
      .from(jobRolesTable)
      .where(
        and(
          or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval")),
          lt(jobRolesTable.createdAt, staleThreshold),
        ),
      );

    const [staleCandidateReviews] = await db
      .select({ count: count(candidatesTable.id) })
      .from(candidatesTable)
      .where(
        and(
          eq(candidatesTable.status, "pending_approval"),
          lt(candidatesTable.submittedAt, staleThreshold),
        ),
      );

    const staleRoles = await db
      .select({
        roleId: jobRolesTable.id,
        title: jobRolesTable.title,
        status: jobRolesTable.status,
        companyName: companiesTable.name,
        createdAt: jobRolesTable.createdAt,
      })
      .from(jobRolesTable)
      .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
      .where(
        and(
          or(eq(jobRolesTable.status, "draft"), eq(jobRolesTable.status, "pending_approval")),
          lt(jobRolesTable.createdAt, staleThreshold),
        ),
      )
      .orderBy(jobRolesTable.createdAt)
      .limit(5);

    const staleCandidates = await db
      .select({
        candidateId: candidatesTable.id,
        candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
        roleTitle: jobRolesTable.title,
        companyName: companiesTable.name,
        status: candidatesTable.status,
        submittedAt: candidatesTable.submittedAt,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
      .where(
        and(
          eq(candidatesTable.status, "pending_approval"),
          lt(candidatesTable.submittedAt, staleThreshold),
        ),
      )
      .orderBy(candidatesTable.submittedAt)
      .limit(5);

    const [totalReviewThreads] = await db
      .select({ count: count(reviewThreadsTable.id) })
      .from(reviewThreadsTable);

    const [totalReviewMessages] = await db
      .select({ count: count(reviewThreadMessagesTable.id) })
      .from(reviewThreadMessagesTable);

    const reviewThreadsByVisibility = await db
      .select({ visibility: reviewThreadsTable.visibility, count: count() })
      .from(reviewThreadsTable)
      .groupBy(reviewThreadsTable.visibility);

    const reviewThreadsByScopeType = await db
      .select({ scopeType: reviewThreadsTable.scopeType, count: count() })
      .from(reviewThreadsTable)
      .groupBy(reviewThreadsTable.scopeType);

    const recentSubmissions = await db
      .select({
        candidateId: candidatesTable.id,
        candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
        roleTitle: jobRolesTable.title,
        createdAt: candidatesTable.submittedAt,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .orderBy(desc(candidatesTable.submittedAt))
      .limit(5);

    let recentStatusChanges: Array<{
      candidateId: number;
      candidateName: string | null;
      actorName: string;
      previousStatus: string | null;
      nextStatus: string;
      createdAt: Date;
    }> = [];

    try {
      recentStatusChanges = await db
        .select({
          candidateId: candidateStatusHistoryTable.candidateId,
          candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
          actorName: candidateStatusHistoryTable.changedByName,
          previousStatus: candidateStatusHistoryTable.previousStatus,
          nextStatus: candidateStatusHistoryTable.nextStatus,
          createdAt: candidateStatusHistoryTable.createdAt,
        })
        .from(candidateStatusHistoryTable)
        .leftJoin(candidatesTable, eq(candidateStatusHistoryTable.candidateId, candidatesTable.id))
        .orderBy(desc(candidateStatusHistoryTable.createdAt))
        .limit(5);
    } catch (historyError) {
      if (!isUndefinedRelationError(historyError)) {
        throw historyError;
      }
      console.warn("candidate_status_history table is missing; recent status changes omitted from analytics");
    }

    const recentNotes = await db
      .select({
        candidateId: candidateNotesTable.candidateId,
        candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
        actorName: candidateNotesTable.authorName,
        content: candidateNotesTable.content,
        createdAt: candidateNotesTable.createdAt,
      })
      .from(candidateNotesTable)
      .leftJoin(candidatesTable, eq(candidateNotesTable.candidateId, candidatesTable.id))
      .orderBy(desc(candidateNotesTable.createdAt))
      .limit(5);

    const recentActivity = [
      ...recentSubmissions.map((row) => ({
        type: "candidate_submitted",
        candidateId: row.candidateId,
        candidateName: row.candidateName,
        actorName: null,
        message: `Submitted for ${row.roleTitle ?? "role"}`,
        createdAt: row.createdAt.toISOString(),
      })),
      ...recentStatusChanges.map((row) => ({
        type: "candidate_status_changed",
        candidateId: row.candidateId,
        candidateName: row.candidateName,
        actorName: row.actorName,
        message: row.previousStatus
          ? `${row.previousStatus} -> ${row.nextStatus}`
          : `Status set to ${row.nextStatus}`,
        createdAt: row.createdAt.toISOString(),
      })),
      ...recentNotes.map((row) => ({
        type: "candidate_note_added",
        candidateId: row.candidateId,
        candidateName: row.candidateName,
        actorName: row.actorName,
        message: row.content.length > 120 ? `${row.content.slice(0, 117)}...` : row.content,
        createdAt: row.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);

    res.json({
      totalCandidates: Number(totals.totalCandidates),
      totalRoles: Number(roleTotals.totalRoles),
      totalCompanies: Number(companyTotals.totalCompanies),
      totalUsers: Number(userTotals.totalUsers),
      interviewingCandidates: Number(interviewingTotals.count),
      hiredCandidates: Number(hiredTotals.count),
      rejectedCandidates: Number(rejectedTotals.count),
      candidatesByStatus: candidatesByStatus.map((s) => ({ status: s.status, count: Number(s.cnt) })),
      rolesByStatus: rolesByStatus.map((s) => ({ status: s.status, count: Number(s.cnt) })),
      topRoles: topRoles.map((r) => ({ roleId: r.roleId, roleTitle: r.roleTitle ?? "", count: Number(r.cnt) })),
      reviewWorkload: {
        pendingRoleReviews: Number(pendingRoleReviews.count),
        pendingCandidateReviews: Number(pendingCandidateReviews.count),
        reviewRequiredCandidates: Number(reviewRequiredCandidates.count),
        readyCandidates: Number(readyCandidates.count),
        staleRoleReviews: Number(staleRoleReviews.count),
        staleCandidateReviews: Number(staleCandidateReviews.count),
      },
      reviewThreads: {
        totalThreads: Number(totalReviewThreads.count),
        totalMessages: Number(totalReviewMessages.count),
        byVisibility: reviewThreadsByVisibility.map((row) => ({ visibility: row.visibility, count: Number(row.count) })),
        byScopeType: reviewThreadsByScopeType.map((row) => ({ scopeType: row.scopeType, count: Number(row.count) })),
      },
      stuckItems: {
        roles: staleRoles.map((role) => ({
          roleId: role.roleId,
          title: role.title,
          companyName: role.companyName ?? "",
          status: role.status,
          createdAt: role.createdAt.toISOString(),
        })),
        candidates: staleCandidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          candidateName: candidate.candidateName,
          roleTitle: candidate.roleTitle ?? "",
          companyName: candidate.companyName ?? "",
          status: candidate.status,
          submittedAt: candidate.submittedAt.toISOString(),
        })),
      },
      recentActivity,
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

export default router;
