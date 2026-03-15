import { Router } from "express";
import {
  db,
  timesheetsTable,
  contractsTable,
  candidatesTable,
  jobRolesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateTimesheetSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

async function formatTimesheet(t: typeof timesheetsTable.$inferSelect) {
  const [contract] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.id, t.contractId));

  const [candidate] = contract
    ? await db
        .select({
          firstName: candidatesTable.firstName,
          lastName: candidatesTable.lastName,
          roleId: candidatesTable.roleId,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, contract.candidateId))
    : [{ firstName: "", lastName: "", roleId: 0 }];

  const [role] = candidate?.roleId
    ? await db
        .select({ title: jobRolesTable.title })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId))
    : [{ title: "" }];

  return {
    id: t.id,
    contractId: t.contractId,
    candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}` : "",
    roleTitle: role?.title ?? "",
    month: t.month,
    year: t.year,
    totalDays: t.totalDays,
    totalAmount: Number(t.totalAmount),
    submittedAt: t.submittedAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role: userRole, companyId } = req.user!;

    if (userRole === "vendor" && companyId) {
      const vendorCandidateIds = (
        await db
          .select({ id: candidatesTable.id })
          .from(candidatesTable)
          .where(eq(candidatesTable.vendorCompanyId, companyId))
      ).map((c) => c.id);

      if (!vendorCandidateIds.length) { res.json([]); return; }

      const contractIds = (
        await db
          .select({ id: contractsTable.id })
          .from(contractsTable)
          .where(inArray(contractsTable.candidateId, vendorCandidateIds))
      ).map((c) => c.id);

      if (!contractIds.length) { res.json([]); return; }

      const timesheets = await db
        .select()
        .from(timesheetsTable)
        .where(inArray(timesheetsTable.contractId, contractIds))
        .orderBy(timesheetsTable.submittedAt);

      res.json(await Promise.all(timesheets.map(formatTimesheet)));
      return;
    }

    if (userRole === "client" && companyId) {
      const clientRoleIds = (
        await db
          .select({ id: jobRolesTable.id })
          .from(jobRolesTable)
          .where(eq(jobRolesTable.companyId, companyId))
      ).map((r) => r.id);

      if (!clientRoleIds.length) { res.json([]); return; }

      const clientCandidateIds = (
        await db
          .select({ id: candidatesTable.id })
          .from(candidatesTable)
          .where(inArray(candidatesTable.roleId, clientRoleIds))
      ).map((c) => c.id);

      if (!clientCandidateIds.length) { res.json([]); return; }

      const contractIds = (
        await db
          .select({ id: contractsTable.id })
          .from(contractsTable)
          .where(inArray(contractsTable.candidateId, clientCandidateIds))
      ).map((c) => c.id);

      if (!contractIds.length) { res.json([]); return; }

      const timesheets = await db
        .select()
        .from(timesheetsTable)
        .where(inArray(timesheetsTable.contractId, contractIds))
        .orderBy(timesheetsTable.submittedAt);

      res.json(await Promise.all(timesheets.map(formatTimesheet)));
      return;
    }

    const all = await db
      .select()
      .from(timesheetsTable)
      .orderBy(timesheetsTable.submittedAt);

    res.json(await Promise.all(all.map(formatTimesheet)));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("vendor"),
  validate(CreateTimesheetSchema),
  async (req, res) => {
    try {
      const { contractId, month, year, totalDays } = req.body;
      const companyId = req.user!.companyId;

      const [contract] = await db
        .select()
        .from(contractsTable)
        .where(eq(contractsTable.id, contractId));

      if (!contract || !contract.isActive) {
        Errors.badRequest(res, "Contract not found or not active");
        return;
      }

      if (companyId) {
        const [candidate] = await db
          .select({ vendorCompanyId: candidatesTable.vendorCompanyId })
          .from(candidatesTable)
          .where(eq(candidatesTable.id, contract.candidateId));

        if (!candidate || candidate.vendorCompanyId !== companyId) {
          Errors.forbidden(res, "This contract does not belong to your company");
          return;
        }
      }

      const totalAmount = Number(contract.dailyRate) * totalDays;

      const [timesheet] = await db
        .insert(timesheetsTable)
        .values({
          contractId,
          month,
          year,
          totalDays,
          totalAmount: String(totalAmount),
        })
        .returning();

      res.status(201).json(await formatTimesheet(timesheet));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
