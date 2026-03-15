import { z } from "zod";

// ─── Auth ────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password required"),
});

// ─── Candidates ──────────────────────────────────────────────────────────────

export const CreateCandidateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(50).nullable().optional(),
  expectedSalary: z.number().positive().nullable().optional(),
  roleId: z.number().int().positive(),
  cvUrl: z.string().max(2048).nullable().optional(),
  originalCvFileName: z.string().max(500).nullable().optional(),
  originalCvMimeType: z.string().max(100).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  currentTitle: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  education: z.string().max(5000).nullable().optional(),
  languages: z.string().max(1000).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  standardizedProfile: z.string().max(10000).nullable().optional(),
  parseStatus: z.enum(["not_started", "processing", "parsed", "partial", "failed"]).optional(),
  parseConfidence: z.number().int().min(0).max(100).nullable().optional(),
  parseReviewRequired: z.boolean().optional(),
  parseProvider: z.string().max(100).nullable().optional(),
  parsedSkills: z.array(z.string().max(200)).max(100).nullable().optional(),
  parsedExperience: z.array(
    z.object({
      company: z.string().max(200).nullable().optional(),
      title: z.string().max(200).nullable().optional(),
      startDate: z.string().max(50).nullable().optional(),
      endDate: z.string().max(50).nullable().optional(),
      highlights: z.array(z.string().max(500)).max(20).nullable().optional(),
    }),
  ).max(50).nullable().optional(),
  parsedEducation: z.array(
    z.object({
      institution: z.string().max(300).nullable().optional(),
      degree: z.string().max(300).nullable().optional(),
      fieldOfStudy: z.string().max(300).nullable().optional(),
      startDate: z.string().max(50).nullable().optional(),
      endDate: z.string().max(50).nullable().optional(),
    }),
  ).max(50).nullable().optional(),
});

export const CandidateStatusSchema = z.object({
  status: z.enum(["submitted", "screening", "interview", "offer", "hired", "rejected"]),
  reason: z.string().max(1000).nullable().optional(),
});

// ─── Roles ───────────────────────────────────────────────────────────────────

export const CreateRoleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  skills: z.string().max(1000).nullable().optional(),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  employmentType: z.enum(["full-time", "part-time", "contract", "freelance"]).nullable().optional(),
  isRemote: z.boolean().optional(),
  companyId: z.number().int().positive().optional(),
});

export const UpdateRoleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  skills: z.string().max(1000).nullable().optional(),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  employmentType: z.enum(["full-time", "part-time", "contract", "freelance"]).nullable().optional(),
  isRemote: z.boolean().optional(),
});

export const RoleStatusSchema = z.object({
  status: z.enum(["draft", "pending_approval", "published", "closed"]),
});

// ─── Notes ───────────────────────────────────────────────────────────────────

export const CreateNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── Contracts ───────────────────────────────────────────────────────────────

export const CreateContractSchema = z.object({
  candidateId: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").nullable().optional(),
  dailyRate: z.number().positive(),
});

// ─── Timesheets ──────────────────────────────────────────────────────────────

export const CreateTimesheetSchema = z.object({
  contractId: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  totalDays: z.number().int().positive().max(31),
});

// ─── CV Parse ────────────────────────────────────────────────────────────────

export const CvParseTextSchema = z.object({
  cvText: z.string().min(1).max(20000),
});

export const CvParseBodySchema = z.object({
  cvText: z.string().min(1).max(20000),
});

export const CvParseResponseSchema = z.object({
  firstName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  skills: z.string().nullable().optional(),
  expectedSalary: z.number().nullable().optional(),
  currentTitle: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  yearsExperience: z.number().nonnegative().nullable().optional(),
  education: z.string().nullable().optional(),
  languages: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  standardizedProfile: z.string().nullable().optional(),
});

// ─── Storage ─────────────────────────────────────────────────────────────────

export const RequestUploadUrlSchema = z.object({
  name: z.string().min(1).max(500),
  size: z.number().int().positive().max(4 * 1024 * 1024),
  contentType: z.string().min(1).max(100),
});

export const ConfirmUploadSchema = z.object({
  objectPath: z.string().min(1),
});
