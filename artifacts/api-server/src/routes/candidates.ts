import { Router } from "express";
import { db, candidatesTable, jobRolesTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateCandidateSchema, CandidateStatusSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

function formatCandidate(c: {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  expectedSalary: string | null;
  status: string;
  roleId: number;
  vendorCompanyId: number;
  cvUrl?: string | null;
  tags?: string | null;
  submittedAt: Date;
  updatedAt: Date;
}, roleTitle: string, vendorCompanyName: string) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    expectedSalary: c.expectedSalary ? Number(c.expectedSalary) : null,
    status: c.status,
    roleId: c.roleId,
    roleTitle,
    vendorCompanyId: c.vendorCompanyId,
    vendorCompanyName,
    cvUrl: c.cvUrl ?? null,
    tags: c.tags ?? null,
    submittedAt: c.submittedAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role: userRole, companyId } = req.user!;
    const roleIdFilter = req.query.roleId ? Number(req.query.roleId) : undefined;

    const rows = await db
      .select({
        id: candidatesTable.id,
        firstName: candidatesTable.firstName,
        lastName: candidatesTable.lastName,
        email: candidatesTable.email,
        phone: candidatesTable.phone,
        expectedSalary: candidatesTable.expectedSalary,
        status: candidatesTable.status,
        roleId: candidatesTable.roleId,
        vendorCompanyId: candidatesTable.vendorCompanyId,
        cvUrl: candidatesTable.cvUrl,
        tags: candidatesTable.tags,
        submittedAt: candidatesTable.submittedAt,
        updatedAt: candidatesTable.updatedAt,
        roleTitle: jobRolesTable.title,
        roleCompanyId: jobRolesTable.companyId,
        vendorCompanyName: companiesTable.name,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .leftJoin(companiesTable, eq(candidatesTable.vendorCompanyId, companiesTable.id));

    let filtered = rows;

    if (roleIdFilter) filtered = filtered.filter((c) => c.roleId === roleIdFilter);
    if (userRole === "vendor" && companyId) {
      filtered = filtered.filter((c) => c.vendorCompanyId === companyId);
    } else if (userRole === "client" && companyId) {
      filtered = filtered.filter((c) => c.roleCompanyId === companyId);
    }

    res.json(filtered.map((c) => formatCandidate(c, c.roleTitle ?? "", c.vendorCompanyName ?? "")));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await resolveCandidateAccess(req, res, id);
    if (!access) return;

    const [row] = await db
      .select({
        id: candidatesTable.id,
        firstName: candidatesTable.firstName,
        lastName: candidatesTable.lastName,
        email: candidatesTable.email,
        phone: candidatesTable.phone,
        expectedSalary: candidatesTable.expectedSalary,
        status: candidatesTable.status,
        roleId: candidatesTable.roleId,
        vendorCompanyId: candidatesTable.vendorCompanyId,
        cvUrl: candidatesTable.cvUrl,
        tags: candidatesTable.tags,
        submittedAt: candidatesTable.submittedAt,
        updatedAt: candidatesTable.updatedAt,
        roleTitle: jobRolesTable.title,
        vendorCompanyName: companiesTable.name,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .leftJoin(companiesTable, eq(candidatesTable.vendorCompanyId, companiesTable.id))
      .where(eq(candidatesTable.id, id));

    if (!row) {
      Errors.notFound(res);
      return;
    }

    res.json(formatCandidate(row, row.roleTitle ?? "", row.vendorCompanyName ?? ""));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("vendor"),
  validate(CreateCandidateSchema),
  async (req, res) => {
    try {
      const { firstName, lastName, email, phone, expectedSalary, roleId, cvUrl, tags } = req.body;
      const companyId = req.user!.companyId;

      if (!companyId) {
        Errors.badRequest(res, "Vendor has no associated company");
        return;
      }

      const [role] = await db.select().from(jobRolesTable).where(eq(jobRolesTable.id, roleId));
      if (!role) {
        Errors.notFound(res, "Role not found");
        return;
      }

      if (role.status !== "published") {
        Errors.badRequest(res, "Role is not open for submissions");
        return;
      }

      const [duplicate] = await db
        .select()
        .from(candidatesTable)
        .where(and(eq(candidatesTable.email, email.toLowerCase()), eq(candidatesTable.roleId, roleId)));

      if (duplicate) {
        Errors.conflict(res, "This candidate has already been submitted for this role");
        return;
      }

      const [candidate] = await db
        .insert(candidatesTable)
        .values({
          firstName,
          lastName,
          email: email.toLowerCase(),
          phone: phone ?? null,
          expectedSalary: expectedSalary != null ? String(expectedSalary) : null,
          status: "submitted",
          roleId,
          vendorCompanyId: companyId,
          cvUrl: cvUrl ?? null,
          tags: tags ?? null,
        })
        .returning();

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      res.status(201).json(formatCandidate(candidate, role.title, vendorCompany?.name ?? ""));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

router.patch(
  "/:id/status",
  requireAuth,
  requireRole("admin", "client"),
  validate(CandidateStatusSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;

      const access = await resolveCandidateAccess(req, res, id);
      if (!access) return;

      const [candidate] = await db
        .update(candidatesTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(candidatesTable.id, id))
        .returning();

      const [role] = await db
        .select({ title: jobRolesTable.title })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId));

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, candidate.vendorCompanyId));

      res.json(formatCandidate(candidate, role?.title ?? "", vendorCompany?.name ?? ""));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
