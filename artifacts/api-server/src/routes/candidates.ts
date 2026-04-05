import { Router } from "express";
import { db, candidatesTable, candidateStatusHistoryTable, jobRolesTable, companiesTable } from "@workspace/db";
import { eq, and, desc, ilike, or, isNull, isNotNull, gte, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import {
  CreateCandidateSchema,
  CandidateStatusSchema,
  UpdateCandidateSchema,
  WithdrawCandidateSchema,
} from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";
import {
  candidateStatusShouldCloseInterviewProcess,
  closeOpenInterviewProcessesForCandidate,
  getActorLabel,
} from "../lib/interviews.js";

const router = Router();

function isUndefinedRelationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01",
  );
}

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
  professionalSnapshot?: string | null;
  executiveHeadline?: string | null;
  parsedSkills?: string[] | null;
  domainFocus?: string[] | null;
}) {
  if (input.parseStatus) return input.parseStatus;
  const hasSignals = Boolean(
    input.currentTitle ||
      input.summary ||
      input.professionalSnapshot ||
      input.executiveHeadline ||
      (Array.isArray(input.parsedSkills) && input.parsedSkills.length > 0) ||
      (Array.isArray(input.domainFocus) && input.domainFocus.length > 0),
  );
  if (!hasSignals) return "not_started";
  if (input.parseReviewRequired) return "partial";
  if (typeof input.parseConfidence === "number" && input.parseConfidence < 65) return "partial";
  return "parsed";
}

function normalizeNullableString(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmailForDuplicateCheck(value: string | null | undefined) {
  return normalizeNullableString(value)?.toLowerCase() ?? null;
}

function normalizePhoneForDuplicateCheck(value: string | null | undefined) {
  const normalized = normalizeNullableString(value)?.replace(/[^\d+]/g, "") ?? null;
  return normalized || null;
}

function normalizeTags(value: string | string[] | null | undefined) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(", ");
    return joined ? joined : null;
  }
  return normalizeNullableString(value);
}

async function findDuplicateCandidateForRole(input: {
  roleId: number;
  email?: string | null;
  phone?: string | null;
  excludeCandidateId?: number;
}) {
  const normalizedEmail = normalizeEmailForDuplicateCheck(input.email);
  const normalizedPhone = normalizePhoneForDuplicateCheck(input.phone);

  if (!normalizedEmail && !normalizedPhone) return null;

  const rows = await db
    .select({
      id: candidatesTable.id,
      firstName: candidatesTable.firstName,
      lastName: candidatesTable.lastName,
      email: candidatesTable.email,
      phone: candidatesTable.phone,
      status: candidatesTable.status,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.roleId, input.roleId));

  return (
    rows.find((row) => {
      if (input.excludeCandidateId && row.id === input.excludeCandidateId) return false;
      if (row.status === "withdrawn") return false;

      const rowEmail = normalizeEmailForDuplicateCheck(row.email);
      const rowPhone = normalizePhoneForDuplicateCheck(row.phone);

      return Boolean(
        (normalizedEmail && rowEmail && normalizedEmail === rowEmail) ||
          (normalizedPhone && rowPhone && normalizedPhone === rowPhone),
      );
    }) ?? null
  );
}

function buildDuplicateCandidateMessage(input: {
  duplicate: {
    firstName: string;
    lastName: string;
    status: string;
  };
  roleTitle: string;
}) {
  const candidateName = `${input.duplicate.firstName} ${input.duplicate.lastName}`.trim();
  return `${candidateName || "This candidate"} is already in the ${input.roleTitle} pipeline with status "${input.duplicate.status}".`;
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
  executiveHeadline?: string | null;
  professionalSnapshot?: string | null;
  domainFocus?: string[] | null;
  senioritySignal?: string | null;
  candidateStrengths?: string[] | null;
  candidateRisks?: string[] | null;
  notableAchievements?: string[] | null;
  inferredWorkModel?: string | null;
  locationFlexibility?: string | null;
  salarySignal?: string | null;
  languageItems?: unknown[] | null;
  fieldConfidence?: Record<string, unknown> | null;
  evidence?: string[] | null;
  parsedSkills?: string[] | null;
  parsedExperience?: unknown[] | null;
  parsedEducation?: unknown[] | null;
  tags?: string | null;
  submittedAt: Date;
  updatedAt: Date;
}, roleTitle: string, vendorCompanyName: string, roleStatus?: string | null) {
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
    roleStatus: roleStatus ?? null,
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
    executiveHeadline: c.executiveHeadline ?? null,
    professionalSnapshot: c.professionalSnapshot ?? null,
    domainFocus: c.domainFocus ?? [],
    senioritySignal: c.senioritySignal ?? null,
    candidateStrengths: c.candidateStrengths ?? [],
    candidateRisks: c.candidateRisks ?? [],
    notableAchievements: c.notableAchievements ?? [],
    inferredWorkModel: c.inferredWorkModel ?? null,
    locationFlexibility: c.locationFlexibility ?? null,
    salarySignal: c.salarySignal ?? null,
    languageItems: c.languageItems ?? [],
    fieldConfidence: c.fieldConfidence ?? null,
    evidence: c.evidence ?? [],
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
      conditions.push(ne(candidatesTable.status, "pending_approval"));
      conditions.push(ne(candidatesTable.status, "withdrawn"));
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
        executiveHeadline: candidatesTable.executiveHeadline,
        professionalSnapshot: candidatesTable.professionalSnapshot,
        domainFocus: candidatesTable.domainFocus,
        senioritySignal: candidatesTable.senioritySignal,
        candidateStrengths: candidatesTable.candidateStrengths,
        candidateRisks: candidatesTable.candidateRisks,
        notableAchievements: candidatesTable.notableAchievements,
        inferredWorkModel: candidatesTable.inferredWorkModel,
        locationFlexibility: candidatesTable.locationFlexibility,
        salarySignal: candidatesTable.salarySignal,
        languageItems: candidatesTable.languageItems,
        fieldConfidence: candidatesTable.fieldConfidence,
        evidence: candidatesTable.evidence,
        parsedSkills: candidatesTable.parsedSkills,
        parsedExperience: candidatesTable.parsedExperience,
        parsedEducation: candidatesTable.parsedEducation,
        tags: candidatesTable.tags,
        submittedAt: candidatesTable.submittedAt,
        updatedAt: candidatesTable.updatedAt,
        roleTitle: jobRolesTable.title,
        roleStatus: jobRolesTable.status,
        vendorCompanyName: companiesTable.name,
      })
      .from(candidatesTable)
      .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
      .leftJoin(companiesTable, eq(candidatesTable.vendorCompanyId, companiesTable.id));

    const rows = await (whereClause ? query.where(whereClause) : query).orderBy(desc(candidatesTable.submittedAt));

    res.json(filteredByStatuses(rows, statusFilters).map((c) => formatCandidate(c, c.roleTitle ?? "", c.vendorCompanyName ?? "", c.roleStatus ?? null)));
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

    if (req.user?.role === "client" && access.status === "withdrawn") {
      Errors.notFound(res, "Candidate not found");
      return;
    }

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
    if (isUndefinedRelationError(err)) {
      console.warn("candidate_status_history table is missing; returning empty history");
      res.json([]);
      return;
    }
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
        executiveHeadline: candidatesTable.executiveHeadline,
        professionalSnapshot: candidatesTable.professionalSnapshot,
        domainFocus: candidatesTable.domainFocus,
        senioritySignal: candidatesTable.senioritySignal,
        candidateStrengths: candidatesTable.candidateStrengths,
        candidateRisks: candidatesTable.candidateRisks,
        notableAchievements: candidatesTable.notableAchievements,
        inferredWorkModel: candidatesTable.inferredWorkModel,
        locationFlexibility: candidatesTable.locationFlexibility,
        salarySignal: candidatesTable.salarySignal,
        languageItems: candidatesTable.languageItems,
        fieldConfidence: candidatesTable.fieldConfidence,
        evidence: candidatesTable.evidence,
        parsedSkills: candidatesTable.parsedSkills,
        parsedExperience: candidatesTable.parsedExperience,
        parsedEducation: candidatesTable.parsedEducation,
        tags: candidatesTable.tags,
        submittedAt: candidatesTable.submittedAt,
        updatedAt: candidatesTable.updatedAt,
        roleTitle: jobRolesTable.title,
        roleStatus: jobRolesTable.status,
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

    res.json(formatCandidate(row, row.roleTitle ?? "", row.vendorCompanyName ?? "", row.roleStatus ?? null));
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
        executiveHeadline,
        professionalSnapshot,
        domainFocus,
        senioritySignal,
        candidateStrengths,
        candidateRisks,
        notableAchievements,
        inferredWorkModel,
        locationFlexibility,
        salarySignal,
        languageItems,
        fieldConfidence,
        evidence,
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

      const normalizedEmail = normalizeEmailForDuplicateCheck(email);
      const normalizedPhone = normalizePhoneForDuplicateCheck(phone);
      const storedPhone = normalizeNullableString(phone);
      if (!normalizedEmail) {
        Errors.badRequest(res, "Candidate email is required");
        return;
      }
      const duplicate = await findDuplicateCandidateForRole({
        roleId,
        email: normalizedEmail,
        phone: normalizedPhone,
      });

      if (duplicate) {
        Errors.conflict(
          res,
          buildDuplicateCandidateMessage({
            duplicate,
            roleTitle: role.title,
          }),
        );
        return;
      }

      const actorName = await getActorLabel(req.user!.userId);
      const effectiveParseStatus = inferParseStatus({
        parseStatus,
        parseReviewRequired,
        parseConfidence,
        currentTitle,
        summary,
        professionalSnapshot,
        executiveHeadline,
        parsedSkills,
        domainFocus,
      });

      const [candidate] = await db
        .insert(candidatesTable)
        .values({
          firstName,
          lastName,
          email: normalizedEmail,
          phone: storedPhone,
          expectedSalary: expectedSalary != null ? String(expectedSalary) : null,
          status: "pending_approval",
          roleId,
          vendorCompanyId: companyId,
          cvUrl: cvUrl ?? null,
          originalCvFileName: originalCvFileName ?? null,
          originalCvMimeType: originalCvMimeType ?? null,
          tags: normalizeTags(tags),
          currentTitle: currentTitle ?? null,
          location: location ?? null,
          yearsExperience: yearsExperience ?? null,
          education: education ?? null,
          languages: languages ?? null,
          summary: summary ?? null,
          standardizedProfile: standardizedProfile ?? null,
          executiveHeadline: executiveHeadline ?? null,
          professionalSnapshot: professionalSnapshot ?? null,
          domainFocus: domainFocus ?? null,
          senioritySignal: senioritySignal ?? null,
          candidateStrengths: candidateStrengths ?? null,
          candidateRisks: candidateRisks ?? null,
          notableAchievements: notableAchievements ?? null,
          inferredWorkModel: inferredWorkModel ?? null,
          locationFlexibility: locationFlexibility ?? null,
          salarySignal: salarySignal ?? null,
          languageItems: languageItems ?? null,
          fieldConfidence: fieldConfidence ?? null,
          evidence: evidence ?? null,
          parseStatus: effectiveParseStatus as any,
          parseConfidence: parseConfidence ?? null,
          parseReviewRequired: parseReviewRequired ?? false,
          parseProvider: parseProvider ?? null,
          parsedSkills: parsedSkills ?? null,
          parsedExperience: parsedExperience ?? null,
          parsedEducation: parsedEducation ?? null,
        })
        .returning();

      try {
        await db.insert(candidateStatusHistoryTable).values({
          candidateId: candidate.id,
          previousStatus: null,
          nextStatus: "pending_approval",
          reason: "Candidate submitted by vendor",
          changedByUserId: req.user!.userId,
          changedByName: actorName,
        });
      } catch (historyError) {
        if (!isUndefinedRelationError(historyError)) {
          throw historyError;
        }
        console.warn("candidate_status_history table is missing; submission history entry skipped");
      }

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      res.status(201).json(formatCandidate(candidate, role.title, vendorCompany?.name ?? "", role.status));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "vendor"),
  validate(UpdateCandidateSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = await resolveCandidateAccess(req, res, id);
      if (!access) return;

      const actorRole = req.user!.role;
      if (
        actorRole === "vendor" &&
        !["pending_approval", "submitted", "screening"].includes(access.status)
      ) {
        Errors.forbidden(
          res,
          "Only candidates in pending approval, submitted or screening can be edited by the vendor.",
        );
        return;
      }

      const {
        firstName,
        lastName,
        email,
        phone,
        expectedSalary,
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
        executiveHeadline,
        professionalSnapshot,
        domainFocus,
        senioritySignal,
        candidateStrengths,
        candidateRisks,
        notableAchievements,
        inferredWorkModel,
        locationFlexibility,
        salarySignal,
        languageItems,
        fieldConfidence,
        evidence,
        parseStatus,
        parseConfidence,
        parseReviewRequired,
        parseProvider,
        parsedSkills,
        parsedExperience,
        parsedEducation,
      } = req.body;

      const finalPhone = phone !== undefined ? normalizeNullableString(phone) : access.phone;
      const finalPhoneForDuplicateCheck = normalizePhoneForDuplicateCheck(finalPhone);
      const finalExpectedSalary =
        expectedSalary !== undefined
          ? expectedSalary != null
            ? String(expectedSalary)
            : null
          : access.expectedSalary;

      if (!finalPhone || finalExpectedSalary == null) {
        Errors.badRequest(
          res,
          "Candidate contact information and expected salary must be provided before saving.",
        );
        return;
      }

      const finalEmail = email !== undefined ? normalizeEmailForDuplicateCheck(email) : access.email;
      if (!finalEmail) {
        Errors.badRequest(res, "Candidate email is required");
        return;
      }
      const duplicate = await findDuplicateCandidateForRole({
        roleId: access.roleId,
        email: finalEmail,
        phone: finalPhoneForDuplicateCheck,
        excludeCandidateId: id,
      });

      if (duplicate) {
        Errors.conflict(
          res,
          buildDuplicateCandidateMessage({
            duplicate,
            roleTitle: access.roleTitle ?? "selected role",
          }),
        );
        return;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (firstName !== undefined) updates.firstName = firstName.trim();
      if (lastName !== undefined) updates.lastName = lastName.trim();
      if (email !== undefined) updates.email = finalEmail;
      if (phone !== undefined) updates.phone = finalPhone;
      if (expectedSalary !== undefined) updates.expectedSalary = expectedSalary != null ? String(expectedSalary) : null;
      if (cvUrl !== undefined) updates.cvUrl = normalizeNullableString(cvUrl);
      if (originalCvFileName !== undefined) updates.originalCvFileName = normalizeNullableString(originalCvFileName);
      if (originalCvMimeType !== undefined) updates.originalCvMimeType = normalizeNullableString(originalCvMimeType);
      if (tags !== undefined) updates.tags = normalizeTags(tags);
      if (currentTitle !== undefined) updates.currentTitle = normalizeNullableString(currentTitle);
      if (location !== undefined) updates.location = normalizeNullableString(location);
      if (yearsExperience !== undefined) updates.yearsExperience = yearsExperience;
      if (education !== undefined) updates.education = normalizeNullableString(education);
      if (languages !== undefined) updates.languages = normalizeNullableString(languages);
      if (summary !== undefined) updates.summary = normalizeNullableString(summary);
      if (standardizedProfile !== undefined) updates.standardizedProfile = normalizeNullableString(standardizedProfile);
      if (executiveHeadline !== undefined) updates.executiveHeadline = normalizeNullableString(executiveHeadline);
      if (professionalSnapshot !== undefined) updates.professionalSnapshot = normalizeNullableString(professionalSnapshot);
      if (domainFocus !== undefined) updates.domainFocus = domainFocus;
      if (senioritySignal !== undefined) updates.senioritySignal = normalizeNullableString(senioritySignal);
      if (candidateStrengths !== undefined) updates.candidateStrengths = candidateStrengths;
      if (candidateRisks !== undefined) updates.candidateRisks = candidateRisks;
      if (notableAchievements !== undefined) updates.notableAchievements = notableAchievements;
      if (inferredWorkModel !== undefined) updates.inferredWorkModel = normalizeNullableString(inferredWorkModel);
      if (locationFlexibility !== undefined) updates.locationFlexibility = normalizeNullableString(locationFlexibility);
      if (salarySignal !== undefined) updates.salarySignal = normalizeNullableString(salarySignal);
      if (languageItems !== undefined) updates.languageItems = languageItems;
      if (fieldConfidence !== undefined) updates.fieldConfidence = fieldConfidence;
      if (evidence !== undefined) updates.evidence = evidence;
      if (parseStatus !== undefined) updates.parseStatus = parseStatus;
      if (parseConfidence !== undefined) updates.parseConfidence = parseConfidence;
      if (parseReviewRequired !== undefined) updates.parseReviewRequired = parseReviewRequired;
      if (parseProvider !== undefined) updates.parseProvider = normalizeNullableString(parseProvider);
      if (parsedSkills !== undefined) updates.parsedSkills = parsedSkills;
      if (parsedExperience !== undefined) updates.parsedExperience = parsedExperience;
      if (parsedEducation !== undefined) updates.parsedEducation = parsedEducation;

      const [candidate] = await db
        .update(candidatesTable)
        .set(updates)
        .where(eq(candidatesTable.id, id))
        .returning();

      const [role] = await db
        .select({ title: jobRolesTable.title, status: jobRolesTable.status })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId));

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, candidate.vendorCompanyId));

      res.json(formatCandidate(candidate, role?.title ?? "", vendorCompany?.name ?? "", role?.status ?? null));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

router.post(
  "/:id/withdraw",
  requireAuth,
  requireRole("vendor"),
  validate(WithdrawCandidateSchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = await resolveCandidateAccess(req, res, id);
      if (!access) return;

      if (!["pending_approval", "submitted", "screening"].includes(access.status)) {
        Errors.forbidden(
          res,
          "Only candidates in pending approval, submitted or screening can be withdrawn by the vendor.",
        );
        return;
      }

      const actorName = await getActorLabel(req.user!.userId);
      const [candidate] = await db
        .update(candidatesTable)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(eq(candidatesTable.id, id))
        .returning();

      try {
        await db.insert(candidateStatusHistoryTable).values({
          candidateId: candidate.id,
          previousStatus: access.status,
          nextStatus: "withdrawn",
          reason: req.body.reason?.trim() || "Candidate withdrawn by vendor",
          changedByUserId: req.user!.userId,
          changedByName: actorName,
        });
      } catch (historyError) {
        if (!isUndefinedRelationError(historyError)) {
          throw historyError;
        }
        console.warn("candidate_status_history table is missing; withdraw history entry skipped");
      }

      await closeOpenInterviewProcessesForCandidate({
        candidateId: candidate.id,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as "admin" | "client" | "vendor",
        reason: req.body.reason?.trim() || "Candidate withdrawn by vendor",
      });

      const [role] = await db
        .select({ title: jobRolesTable.title, status: jobRolesTable.status })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId));

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, candidate.vendorCompanyId));

      res.json(formatCandidate(candidate, role?.title ?? "", vendorCompany?.name ?? "", role?.status ?? null));
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

      const actorName = await getActorLabel(req.user!.userId);
      const [candidate] = await db
        .update(candidatesTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(candidatesTable.id, id))
        .returning();

      if (status !== "interview") {
        await closeOpenInterviewProcessesForCandidate({
          candidateId: candidate.id,
          reason: `Candidate moved to ${status}`,
          actorUserId: req.user!.userId,
          actorRole: req.user!.role as "admin" | "client" | "vendor",
        });
      }

      try {
        await db.insert(candidateStatusHistoryTable).values({
          candidateId: candidate.id,
          previousStatus: access.status,
          nextStatus: status,
          reason: reason?.trim() || null,
          changedByUserId: req.user!.userId,
          changedByName: actorName,
        });
      } catch (historyError) {
        if (!isUndefinedRelationError(historyError)) {
          throw historyError;
        }
        console.warn("candidate_status_history table is missing; status history entry skipped");
      }

      const [role] = await db
        .select({ title: jobRolesTable.title, status: jobRolesTable.status })
        .from(jobRolesTable)
        .where(eq(jobRolesTable.id, candidate.roleId));

      const [vendorCompany] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, candidate.vendorCompanyId));

      res.json(formatCandidate(candidate, role?.title ?? "", vendorCompany?.name ?? "", role?.status ?? null));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

export default router;
