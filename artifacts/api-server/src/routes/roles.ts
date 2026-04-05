import { Router } from "express";
import { db, jobRolesTable, companiesTable, candidatesTable } from "@workspace/db";
import { eq, count, ne, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveRoleAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateRoleSchema, UpdateRoleSchema, RoleStatusSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

type WorkModeValue = "full-office" | "hybrid" | "full-remote";
type EmploymentTypeValue = "full-time" | "part-time" | "other" | "contract" | "freelance";
type RoleStatusValue = "draft" | "pending_approval" | "published" | "on_hold" | "closed";
const CLIENT_MANAGED_ROLE_STATUSES = new Set<RoleStatusValue>(["published", "on_hold", "closed"]);
const PRE_APPROVAL_ROLE_STATUSES = new Set<RoleStatusValue>(["draft", "pending_approval"]);

function normalizeWorkMode(value: string | null | undefined): WorkModeValue | null {
  if (!value) return null;
  if (value === "full-office" || value === "hybrid" || value === "full-remote") return value;
  if (value === "full office") return "full-office";
  if (value === "full remote") return "full-remote";
  if (value === "remote-friendly") return "full-remote";
  return null;
}

function normalizeEmploymentType(value: string | null | undefined): EmploymentTypeValue | null {
  if (!value) return null;
  if (value === "full_time") return "full-time";
  if (value === "part_time") return "part-time";
  if (value === "full-time" || value === "part-time" || value === "other" || value === "contract" || value === "freelance") {
    return value;
  }
  return null;
}

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
  status: RoleStatusValue;
  companyId: number;
  createdAt: Date;
  updatedAt: Date;
  workMode?: WorkModeValue | null;
  otherEmploymentTypeDescription?: string | null;
}, companyName: string, candidateCount: number) {
  const workMode = role.workMode ?? (role.isRemote ? "full-remote" : "full-office");
  return {
    id: role.id,
    title: role.title,
    description: role.description,
    skills: role.skills,
    salaryMin: role.salaryMin ? Number(role.salaryMin) : null,
    salaryMax: role.salaryMax ? Number(role.salaryMax) : null,
    location: role.location,
    employmentType: normalizeEmploymentType(role.employmentType),
    workMode,
    otherEmploymentTypeDescription: role.otherEmploymentTypeDescription ?? null,
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
    .where(and(eq(candidatesTable.roleId, roleId), ne(candidatesTable.status, "withdrawn")));
  return Number(cnt);
}

async function getVisibleCandidateCount(roleId: number, userRole: string): Promise<number> {
  const conditions = [eq(candidatesTable.roleId, roleId), ne(candidatesTable.status, "withdrawn")];
  if (userRole === "client") {
    conditions.push(ne(candidatesTable.status, "pending_approval"));
  }
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(candidatesTable)
    .where(and(...conditions));
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

    const candidateConditions = [ne(candidatesTable.status, "withdrawn")];
    if (userRole === "client") {
      candidateConditions.push(ne(candidatesTable.status, "pending_approval"));
    }

    const candidateCounts = await db
      .select({ roleId: candidatesTable.roleId, cnt: count() })
      .from(candidatesTable)
      .where(and(...candidateConditions))
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

    const candidateCount = await getVisibleCandidateCount(id, userRole);
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
      const {
        title,
        description,
        skills,
        salaryMin,
        salaryMax,
        location,
        employmentType,
        workMode,
        otherEmploymentTypeDescription,
        isRemote,
      } = req.body;
      const { role: userRole } = req.user!;

      const companyId =
        userRole === "admin" ? (req.body.companyId ?? req.user!.companyId) : req.user!.companyId;

      if (!companyId) {
        Errors.badRequest(res, "User has no associated company");
        return;
      }

      const normalizedWorkMode = normalizeWorkMode(workMode ?? null);
      const normalizedEmploymentType = normalizeEmploymentType(employmentType ?? null);

      const [role] = await db
        .insert(jobRolesTable)
        .values({
          title,
          description: description ?? null,
          skills: skills ?? null,
          salaryMin: salaryMin != null ? String(salaryMin) : null,
          salaryMax: salaryMax != null ? String(salaryMax) : null,
          location: location ?? null,
          employmentType: normalizedEmploymentType,
          isRemote: normalizedWorkMode ? normalizedWorkMode === "full-remote" : isRemote ?? false,
          status: "draft",
          companyId,
        })
        .returning();

      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      res.status(201).json(
        formatRole(
          {
            ...role,
            workMode: normalizedWorkMode,
            otherEmploymentTypeDescription: otherEmploymentTypeDescription ?? null,
          },
          company?.name ?? "",
          0,
        ),
      );
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

      const {
        title,
        description,
        skills,
        salaryMin,
        salaryMax,
        location,
        employmentType,
        workMode,
        otherEmploymentTypeDescription,
        isRemote,
      } = req.body;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (skills !== undefined) updates.skills = skills;
      if (salaryMin !== undefined) updates.salaryMin = salaryMin != null ? String(salaryMin) : null;
      if (salaryMax !== undefined) updates.salaryMax = salaryMax != null ? String(salaryMax) : null;
      if (location !== undefined) updates.location = location;
      if (employmentType !== undefined) updates.employmentType = normalizeEmploymentType(employmentType);
      if (workMode !== undefined || isRemote !== undefined) {
        const normalizedWorkMode = normalizeWorkMode(workMode ?? null);
        updates.isRemote = normalizedWorkMode
          ? normalizedWorkMode === "full-remote"
          : isRemote ?? false;
      }
      if (req.user!.role === "client") {
        if (CLIENT_MANAGED_ROLE_STATUSES.has(access.status as RoleStatusValue)) {
          Errors.forbidden(
            res,
            "Clients cannot edit approved roles directly. Use role actions to move them on hold, closed, or back to published.",
          );
          return;
        }
        updates.status = "draft";
      }

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
      res.json(
        formatRole(
          {
            ...role,
            workMode: normalizeWorkMode(workMode ?? null),
            otherEmploymentTypeDescription: otherEmploymentTypeDescription ?? null,
          },
          company?.name ?? "",
          candidateCount,
        ),
      );
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

      if (userRole === "client") {
        const currentStatus = access.status as RoleStatusValue;
        const nextStatus = status as RoleStatusValue;
        const currentIsPublishedLifecycle = CLIENT_MANAGED_ROLE_STATUSES.has(currentStatus);
        const nextIsPublishedLifecycle = CLIENT_MANAGED_ROLE_STATUSES.has(nextStatus);
        const currentIsPreApproval = PRE_APPROVAL_ROLE_STATUSES.has(currentStatus);
        const nextIsPreApproval = PRE_APPROVAL_ROLE_STATUSES.has(nextStatus);

        if (currentIsPreApproval && nextIsPublishedLifecycle) {
          Errors.forbidden(res, "Only admins can publish a new role for the first time");
          return;
        }

        if (currentIsPublishedLifecycle && nextIsPreApproval) {
          Errors.forbidden(res, "Approved roles cannot be moved back to draft by clients");
          return;
        }

        if (!currentIsPreApproval && !currentIsPublishedLifecycle) {
          Errors.forbidden(res, "Clients cannot manage this role status");
          return;
        }

        if (!nextIsPreApproval && !nextIsPublishedLifecycle) {
          Errors.forbidden(res, "Clients can only move approved roles between published, on hold, or closed");
          return;
        }
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

router.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "client"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = await resolveRoleAccess(req, res, id);
      if (!access) return;

      const candidateCount = await getCandidateCount(id);
      if (candidateCount > 0) {
        Errors.badRequest(
          res,
          "This role already has submitted candidates, so it cannot be deleted.",
        );
        return;
      }

      await db.delete(jobRolesTable).where(eq(jobRolesTable.id, id));
      res.status(204).end();
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
