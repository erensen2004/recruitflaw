import { Router } from "express";
import {
  db,
  candidatesTable,
  candidateStatusHistoryTable,
  jobRolesTable,
  companiesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, ilike, or, isNull, isNotNull, gte } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateCandidateSchema, CandidateStatusSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

function splitCsv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBooleanParam(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function inferParseStatus(input: {
  parseStatus?: string;
  parseReviewRequired?: boolean;
  parseConfidence?: number | null;
  currentTitle?: string | null;
  summary?: string | null;
  parsedSkills?: string[] | null;
}) {
  if (input.parseStatus) return input.parseStatus;
  const hasSignals = Boolean(
    input.currentTitle ||
      input.summary ||
      (Array.isArray(input.parsedSkills) && input.parsedSkills.length > 0),
  );
  if (!hasSignals) return "not_started";
  if (input.parseReviewRequired) return "partial";
  if (typeof input.parseConfidence === "number" && input.parseConfidence < 65) return "partial";
  return "parsed";
}

async function getActorName(userId: number): Promise<string> {
  const [userRow] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return userRow?.name ?? "Unknown";
}

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
  originalCvFileName?: string | null;
  originalCvMimeType?: string | null;
  standardizedCvUrl?: string | null;
  parseStatus?: string | null;
  parseConfidence?: number | null;
  parseReviewRequired?: boolean | null;
  parseProvider?: string | null;
  currentTitle?: string | null;
  location?: string | null;
  yearsExperience?: number | null;
  education?: string | null;
  languages?: string | null;
  summary?: string | null;
  standardizedProfile?: string | null;
  parsedSkills?: string[] | null;
  parsedExperience?: unknown[] | null;
  parsedEducation?: unknown[] | null;
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
    originalCvFileName: c.originalCvFileName ?? null,
    originalCvMimeType: c.originalCvMimeType ?? null,
    standardizedCvUrl: c.standardizedCvUrl ?? null,
    parseStatus: c.parseStatus ?? "not_started",
    parseConfidence: c.parseConfidence ?? null,
    parseReviewRequired: c.parseReviewRequired ?? false,
    parseProvider: c.parseProvider ?? null,
    currentTitle: c.currentTitle ?? null,
    location: c.location ?? null,
    yearsExperience: c.yearsExperience ?? null,
    education: c.education ?? null,
    languages: c.languages ?? null,
    summary: c.summary ?? null,
    standardizedProfile: c.standardizedProfile ?? null,
    parsedSkills: c.parsedSkills ?? [],
    parsedExperience: c.parsedExperience ?? [],
    parsedEducation: c.parsedEducation ?? [],
    tags: c.tags ?? null,
    submittedAt: c.submittedAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role: userRole, companyId } = req.user!;
    const roleIdFilter = req.query.roleId ? Number(req.query.roleId) : undefined;
    const vendorCompanyIdFilter = req.query.vendorCompanyId ? Number(req.query.vendorCompanyId) : undefined;
    const minExperience = req.query.minExperience ? Number(req.query.minExperience) : undefined;
    const statusFilters = splitCsv(req.query.status);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const skill = typeof req.query.skill === "string" ? req.query.skill.trim() : "";
    const hasCv = parseBooleanParam(req.query.hasCv);
    const reviewRequired = parseBooleanParam(req.query.reviewRequired);

    const conditions = [];

    if (roleIdFilter) conditions.push(eq(candidatesTable.roleId, roleIdFilter));
    if (vendorCompanyIdFilter) conditions.push(eq(candidatesTable.vendorCompanyId, vendorCompanyIdFilter));
    if (statusFilters.length === 1) conditions.push(eq(candidatesTable.status, statusFilters[0] as any));
    if (minExperience != null && !Number.isNaN(minExperience)) {
      conditions.push(gte(candidatesTable.yearsExperience, minExperience));
    }
    if (hasCv === true) conditions.push(isNotNull(candidatesTable.cvUrl));
    if (hasCv === false) conditions.push(isNull(candidatesTable.cvUrl));
    if (reviewRequired === true) conditions.push(eq(candidatesTable.parseReviewRequired, true));
    if (reviewRequired === false) conditions.push(eq(candidatesTable.parseReviewRequired, false));
    if (userRole === "vendor" && companyId) {
      conditions.push(eq(candidatesTable.vendorCompanyId, companyId));
    } else if (userRole === "client" && companyId) {
      conditions.push(eq(jobRolesTable.companyId, companyId));
    }
    if (skill) {
      const like = `%${skill}%`;
      conditions.push(
        or(
          ilike(candidatesTable.tags, like),
          ilike(candidatesTable.standardizedProfile, like),
        )!,
      );
    }
    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(candidatesTable.firstName, like),
          ilike(candidatesTable.lastName, like),
          ilike(candidatesTable.email, like),
          ilike(candidatesTable.tags, like),
          ilike(candidatesTable.currentTitle, like),
          ilike(jobRolesTable.title, like),
          ilike(companiesTable.name, like),
        )!,
      );
    }

    const whereClause = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

    const query = db
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
        originalCvFileName: candidatesTable.originalCvFileName,
        originalCvMimeType: candidatesTable.originalCvMimeType,
        standardizedCvUrl: candidatesTable.standardizedCvUrl,
        parseStatus: candidatesTable.parseStatus,
        parseConfidence: candidatesTable.parseConfidence,
        parseReviewRequired: candidatesTable.parseReviewRequired,
        parseProvider: candidatesTable.parseProvider,
        currentTitle: candidatesTable.currentTitle,
        location: candidatesTable.location,
        yearsExperience: candidatesTable.yearsExperience,
        education: candidatesTable.education,
        languages: candidatesTable.languages,
        summary: candidatesTable.summary,
        standardizedProfile: candidatesTable.standardizedProfile,
        parsedSkills: candidatesTable.parsedSkills,
        parsedExperience: candidatesTable.parsedExperience,
        parsedEducation: candidatesTable.parsedEducation,
        tags: candidatesTable.tags,
        submittedAt: candidatesTable.submittedAt,
        updatedAt: candidatesTable.updatedAt,
        roleTitle: jobRolesTable.title,
        vendorCompanyName: companiesTable.name,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .leftJoin(companiesTable, eq(candidatesTable.vendorCompanyId, companiesTable.id));

    const rows = await (whereClause ? query.where(whereClause) : query).orderBy(desc(candidatesTable.submittedAt));

    res.json(filteredByStatuses(rows, statusFilters).map((c) => formatCandidate(c, c.roleTitle ?? "", c.vendorCompanyName ?? "")));
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

function filteredByStatuses<T extends { status: string }>(rows: T[], statusFilters: string[]) {
  if (!statusFilters.length) return rows;
  if (statusFilters.length === 1) return rows;
  return rows.filter((row) => statusFilters.includes(row.status));
}

router.get("/:id/history", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await resolveCandidateAccess(req, res, id);
    if (!access) return;

    const rows = await db
      .select()
      .from(candidateStatusHistoryTable)
      .where(eq(candidateStatusHistoryTable.candidateId, id))
      .orderBy(desc(candidateStatusHistoryTable.createdAt));

    res.json(
      rows.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        previousStatus: row.previousStatus,
        nextStatus: row.nextStatus,
        reason: row.reason,
        changedByUserId: row.changedByUserId,
        changedByName: row.changedByName,
        createdAt: row.createdAt.toISOString(),
      })),
    );
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
        originalCvFileName: candidatesTable.originalCvFileName,
        originalCvMimeType: candidatesTable.originalCvMimeType,
        standardizedCvUrl: candidatesTable.standardizedCvUrl,
        parseStatus: candidatesTable.parseStatus,
        parseConfidence: candidatesTable.parseConfidence,
        parseReviewRequired: candidatesTable.parseReviewRequired,
        parseProvider: candidatesTable.parseProvider,
        currentTitle: candidatesTable.currentTitle,
        location: candidatesTable.location,
        yearsExperience: candidatesTable.yearsExperience,
        education: candidatesTable.education,
        languages: candidatesTable.languages,
        summary: candidatesTable.summary,
        standardizedProfile: candidatesTable.standardizedProfile,
        parsedSkills: candidatesTable.parsedSkills,
        parsedExperience: candidatesTable.parsedExperience,
        parsedEducation: candidatesTable.parsedEducation,
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
      const {
        firstName,
        lastName,
        email,
        phone,
        expectedSalary,
        roleId,
        cvUrl,
        originalCvFileName,
        originalCvMimeType,
        tags,
        currentTitle,
        location,
        yearsExperience,
        education,
        languages,
        summary,
        standardizedProfile,
        parseStatus,
        parseConfidence,
        parseReviewRequired,
        parseProvider,
        parsedSkills,
        parsedExperience,
        parsedEducation,
      } = req.body;
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

      const normalizedEmail = email.toLowerCase();
      const [duplicate] = await db
        .select()
        .from(candidatesTable)
        .where(and(eq(candidatesTable.email, normalizedEmail), eq(candidatesTable.roleId, roleId)));

      if (duplicate) {
        Errors.conflict(res, "This candidate has already been submitted for this role");
        return;
      }

      const actorName = await getActorName(req.user!.userId);
      const effectiveParseStatus = inferParseStatus({
        parseStatus,
        parseReviewRequired,
        parseConfidence,
        currentTitle,
        summary,
        parsedSkills,
      });

      const [candidate] = await db
        .insert(candidatesTable)
        .values({
          firstName,
          lastName,
          email: normalizedEmail,
          phone: phone ?? null,
          expectedSalary: expectedSalary != null ? String(expectedSalary) : null,
          status: "submitted",
          roleId,
          vendorCompanyId: companyId,
          cvUrl: cvUrl ?? null,
          originalCvFileName: originalCvFileName ?? null,
          originalCvMimeType: originalCvMimeType ?? null,
          tags: tags ?? null,
          currentTitle: currentTitle ?? null,
          location: location ?? null,
          yearsExperience: yearsExperience ?? null,
          education: education ?? null,
          languages: languages ?? null,
          summary: summary ?? null,
          standardizedProfile: standardizedProfile ?? null,
          parseStatus: effectiveParseStatus as any,
          parseConfidence: parseConfidence ?? null,
          parseReviewRequired: parseReviewRequired ?? false,
          parseProvider: parseProvider ?? null,
          parsedSkills: parsedSkills ?? null,
          parsedExperience: parsedExperience ?? null,
          parsedEducation: parsedEducation ?? null,
        })
        .returning();

      await db.insert(candidateStatusHistoryTable).values({
        candidateId: candidate.id,
        previousStatus: null,
        nextStatus: "submitted",
        reason: "Candidate submitted by vendor",
        changedByUserId: req.user!.userId,
        changedByName: actorName,
      });

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      res.status(201).json(formatCandidate(candidate, role.title, vendorCompany?.name ?? ""));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

router.patch(
  "/:id/status",
  requireAuth,
  requireRole("admin", "client"),
  validate(CandidateStatusSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status, reason } = req.body;

      const access = await resolveCandidateAccess(req, res, id);
      if (!access) return;

      const actorName = await getActorName(req.user!.userId);
      const [candidate] = await db
        .update(candidatesTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(candidatesTable.id, id))
        .returning();

      await db.insert(candidateStatusHistoryTable).values({
        candidateId: candidate.id,
        previousStatus: access.status,
        nextStatus: status,
        reason: reason?.trim() || null,
        changedByUserId: req.user!.userId,
        changedByName: actorName,
      });

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
  },
);

export default router;
