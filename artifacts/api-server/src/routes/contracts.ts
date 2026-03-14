import { Router } from "express";
import { db, contractsTable, candidatesTable, jobRolesTable, companiesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateContractSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

async function formatContract(c: typeof contractsTable.$inferSelect) {
  const [candidate] = await db
    .select({
      firstName: candidatesTable.firstName,
      lastName: candidatesTable.lastName,
      roleId: candidatesTable.roleId,
      vendorCompanyId: candidatesTable.vendorCompanyId,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, c.candidateId));

  const [role] = candidate
    ? await db
        .select({ title: jobRolesTable.title })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId))
    : [{ title: "" }];

  const [vendor] = candidate
    ? await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, candidate.vendorCompanyId))
    : [{ name: "" }];

  return {
    id: c.id,
    candidateId: c.candidateId,
    candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}` : "",
    roleTitle: role?.title ?? "",
    vendorCompanyName: vendor?.name ?? "",
    startDate: c.startDate,
    endDate: c.endDate ?? null,
    dailyRate: Number(c.dailyRate),
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
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

      const contracts = await db
        .select()
        .from(contractsTable)
        .where(inArray(contractsTable.candidateId, vendorCandidateIds))
        .orderBy(contractsTable.createdAt);

      res.json(await Promise.all(contracts.map(formatContract)));
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

      const contracts = await db
        .select()
        .from(contractsTable)
        .where(inArray(contractsTable.candidateId, clientCandidateIds))
        .orderBy(contractsTable.createdAt);

      res.json(await Promise.all(contracts.map(formatContract)));
      return;
    }

    const all = await db.select().from(contractsTable).orderBy(contractsTable.createdAt);
    res.json(await Promise.all(all.map(formatContract)));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  validate(CreateContractSchema),
  async (req, res) => {
    try {
      const { candidateId, startDate, endDate, dailyRate } = req.body;

      const [contract] = await db
        .insert(contractsTable)
        .values({
          candidateId,
          startDate,
          endDate: endDate ?? null,
          dailyRate: String(dailyRate),
          isActive: true,
        })
        .returning();

      res.status(201).json(await formatContract(contract));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
