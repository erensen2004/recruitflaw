import { Router } from "express";
import {
  db,
  jobRolesTable,
  candidatesTable,
  companiesTable,
  usersTable,
  candidateNotesTable,
  candidateStatusHistoryTable,
} from "@workspace/db";
import { eq, count, sql, desc } from "drizzle-orm";
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
      recentActivity,
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

export default router;
