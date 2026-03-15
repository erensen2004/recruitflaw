import { Router } from "express";
import { db, jobRolesTable, companiesTable, candidatesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveRoleAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateRoleSchema, UpdateRoleSchema, RoleStatusSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

function formatRole(role: {
  id: number;
  title: string;
  description: string | null;
  skills: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  location: string | null;
  employmentType: string | null;
  isRemote: boolean;
  status: string;
  companyId: number;
  createdAt: Date;
  updatedAt: Date;
}, companyName: string, candidateCount: number) {
  return {
    id: role.id,
    title: role.title,
    description: role.description,
    skills: role.skills,
    salaryMin: role.salaryMin ? Number(role.salaryMin) : null,
    salaryMax: role.salaryMax ? Number(role.salaryMax) : null,
    location: role.location,
    employmentType: role.employmentType,
    isRemote: role.isRemote,
    status: role.status,
    companyId: role.companyId,
    companyName,
    candidateCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

async function getCandidateCount(roleId: number): Promise<number> {
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(candidatesTable)
    .where(eq(candidatesTable.roleId, roleId));
  return Number(cnt);
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role: userRole, companyId } = req.user!;

    let rows = await db
      .select({
        id: jobRolesTable.id,
        title: jobRolesTable.title,
        description: jobRolesTable.description,
        skills: jobRolesTable.skills,
        salaryMin: jobRolesTable.salaryMin,
        salaryMax: jobRolesTable.salaryMax,
        location: jobRolesTable.location,
        employmentType: jobRolesTable.employmentType,
        isRemote: jobRolesTable.isRemote,
        status: jobRolesTable.status,
        companyId: jobRolesTable.companyId,
        companyName: companiesTable.name,
        createdAt: jobRolesTable.createdAt,
        updatedAt: jobRolesTable.updatedAt,
      })
      .from(jobRolesTable)
      .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id));

    if (userRole === "client" && companyId) {
      rows = rows.filter((r) => r.companyId === companyId);
    } else if (userRole === "vendor") {
      rows = rows.filter((r) => r.status === "published");
    }

    const candidateCounts = await db
      .select({ roleId: candidatesTable.roleId, cnt: count() })
      .from(candidatesTable)
      .groupBy(candidatesTable.roleId);

    const countMap = Object.fromEntries(candidateCounts.map((c) => [c.roleId, Number(c.cnt)]));

    res.json(
      rows.map((r) => {
        const { companyName, ...roleFields } = r;
        return formatRole(
          { ...roleFields, isRemote: roleFields.isRemote ?? false },
          companyName ?? "",
          countMap[r.id] ?? 0,
        );
      })
    );
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role: userRole } = req.user!;

    const [row] = await db
      .select({
        id: jobRolesTable.id,
        title: jobRolesTable.title,
        description: jobRolesTable.description,
        skills: jobRolesTable.skills,
        salaryMin: jobRolesTable.salaryMin,
        salaryMax: jobRolesTable.salaryMax,
        location: jobRolesTable.location,
        employmentType: jobRolesTable.employmentType,
        isRemote: jobRolesTable.isRemote,
        status: jobRolesTable.status,
        companyId: jobRolesTable.companyId,
        companyName: companiesTable.name,
        createdAt: jobRolesTable.createdAt,
        updatedAt: jobRolesTable.updatedAt,
      })
      .from(jobRolesTable)
      .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
      .where(eq(jobRolesTable.id, id));

    if (!row) {
      Errors.notFound(res);
      return;
    }

    if (userRole === "client") {
      const { companyId } = req.user!;
      if (!companyId || row.companyId !== companyId) {
        Errors.forbidden(res);
        return;
      }
    }

    if (userRole === "vendor" && row.status !== "published") {
      Errors.forbidden(res);
      return;
    }

    const candidateCount = await getCandidateCount(id);
    res.json(formatRole({ ...row, isRemote: row.isRemote ?? false }, row.companyName ?? "", candidateCount));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("admin", "client"),
  validate(CreateRoleSchema),
  async (req, res) => {
    try {
      const { title, description, skills, salaryMin, salaryMax, location, employmentType, isRemote } = req.body;
      const { role: userRole } = req.user!;

      const companyId =
        userRole === "admin" ? (req.body.companyId ?? req.user!.companyId) : req.user!.companyId;

      if (!companyId) {
        Errors.badRequest(res, "User has no associated company");
        return;
      }

      const [role] = await db
        .insert(jobRolesTable)
        .values({
          title,
          description: description ?? null,
          skills: skills ?? null,
          salaryMin: salaryMin != null ? String(salaryMin) : null,
          salaryMax: salaryMax != null ? String(salaryMax) : null,
          location: location ?? null,
          employmentType: employmentType ?? null,
          isRemote: isRemote ?? false,
          status: "draft",
          companyId,
        })
        .returning();

      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      res.status(201).json(formatRole(role, company?.name ?? "", 0));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "client"),
  validate(UpdateRoleSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = await resolveRoleAccess(req, res, id);
      if (!access) return;

      const { title, description, skills, salaryMin, salaryMax, location, employmentType, isRemote } = req.body;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (skills !== undefined) updates.skills = skills;
      if (salaryMin !== undefined) updates.salaryMin = salaryMin != null ? String(salaryMin) : null;
      if (salaryMax !== undefined) updates.salaryMax = salaryMax != null ? String(salaryMax) : null;
      if (location !== undefined) updates.location = location;
      if (employmentType !== undefined) updates.employmentType = employmentType;
      if (isRemote !== undefined) updates.isRemote = isRemote;

      const [role] = await db
        .update(jobRolesTable)
        .set(updates)
        .where(eq(jobRolesTable.id, id))
        .returning();

      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, role.companyId));

      const candidateCount = await getCandidateCount(id);
      res.json(formatRole(role, company?.name ?? "", candidateCount));
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
  validate(RoleStatusSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;
      const { role: userRole } = req.user!;

      const access = await resolveRoleAccess(req, res, id);
      if (!access) return;

      if (userRole === "client" && status !== "pending_approval") {
        Errors.forbidden(res, "Clients can only submit roles for approval");
        return;
      }

      if (status === "published" && userRole !== "admin") {
        Errors.forbidden(res, "Only admins can publish roles");
        return;
      }

      const [role] = await db
        .update(jobRolesTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(jobRolesTable.id, id))
        .returning();

      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, role.companyId));

      const candidateCount = await getCandidateCount(id);
      res.json(formatRole(role, company?.name ?? "", candidateCount));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
