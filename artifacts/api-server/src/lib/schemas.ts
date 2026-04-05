import { z } from "zod";

const TagsInputSchema = z.union([
  z.string().max(500),
  z.array(z.string().max(200)).max(100),
]);

const NonEmptyOptionalStringSchema = z.string().trim().min(1);
const CandidateStatusValueSchema = z.enum(["submitted", "screening", "interview", "offer", "hired", "rejected"]);
const InterviewProposalTypeSchema = z.enum(["exact_slot", "flexible_window"]);
const InterviewListViewSchema = z.enum(["needs_action", "scheduled", "history", "all"]);
const RoleWorkModeSchema = z.enum(["full-office", "hybrid", "full-remote"]);
const RoleEmploymentTypeSchema = z.enum(["full-time", "part-time", "other"]);
const LegacyRoleEmploymentTypeSchema = z.enum(["contract", "freelance"]);
const RoleEmploymentTypeInputSchema = z.union([RoleEmploymentTypeSchema, LegacyRoleEmploymentTypeSchema]);
const PasswordSchema = z.string().min(8, "Password must be at least 8 characters long").max(200);
const NullableStringArraySchema = z.array(z.string().max(500)).max(100).nullable().optional();
const CandidateLanguageItemSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  level: z.string().max(100).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().max(100).nullable().optional(),
});
const CandidateFieldConfidenceSchema = z.object({
  contact: z.number().int().min(0).max(100).nullable().optional(),
  experience: z.number().int().min(0).max(100).nullable().optional(),
  education: z.number().int().min(0).max(100).nullable().optional(),
  languages: z.number().int().min(0).max(100).nullable().optional(),
  compensation: z.number().int().min(0).max(100).nullable().optional(),
  summary: z.number().int().min(0).max(100).nullable().optional(),
});
const CandidateParsedExperienceItemSchema = z.object({
  company: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  startDate: z.string().max(50).nullable().optional(),
  endDate: z.string().max(50).nullable().optional(),
  highlights: z.array(z.string().max(500)).max(20).nullable().optional(),
  scope: z.string().max(1000).nullable().optional(),
  techStack: z.array(z.string().max(200)).max(20).nullable().optional(),
  impactHighlights: z.array(z.string().max(500)).max(20).nullable().optional(),
  current: z.boolean().nullable().optional(),
  seniorityContribution: z.string().max(200).nullable().optional(),
});
const CandidateParsedEducationItemSchema = z.object({
  institution: z.string().max(300).nullable().optional(),
  degree: z.string().max(300).nullable().optional(),
  fieldOfStudy: z.string().max(300).nullable().optional(),
  startDate: z.string().max(50).nullable().optional(),
  endDate: z.string().max(50).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
});

// ─── Auth ────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password required"),
});

export const SetupPasswordSchema = z.object({
  token: z.string().min(1, "Setup token required"),
  password: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword: PasswordSchema,
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ─── Candidates ──────────────────────────────────────────────────────────────

export const CreateCandidateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: NonEmptyOptionalStringSchema.max(50),
  expectedSalary: z.number().positive(),
  roleId: z.number().int().positive(),
  cvUrl: z.string().max(2048).nullable().optional(),
  originalCvFileName: z.string().max(500).nullable().optional(),
  originalCvMimeType: z.string().max(100).nullable().optional(),
  tags: TagsInputSchema.nullable().optional(),
  currentTitle: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  education: z.string().max(5000).nullable().optional(),
  languages: z.string().max(1000).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  standardizedProfile: z.string().max(10000).nullable().optional(),
  executiveHeadline: z.string().max(500).nullable().optional(),
  professionalSnapshot: z.string().max(5000).nullable().optional(),
  domainFocus: NullableStringArraySchema,
  senioritySignal: z.string().max(200).nullable().optional(),
  candidateStrengths: NullableStringArraySchema,
  candidateRisks: NullableStringArraySchema,
  notableAchievements: NullableStringArraySchema,
  inferredWorkModel: z.string().max(200).nullable().optional(),
  locationFlexibility: z.string().max(300).nullable().optional(),
  salarySignal: z.string().max(300).nullable().optional(),
  languageItems: z.array(CandidateLanguageItemSchema).max(20).nullable().optional(),
  fieldConfidence: CandidateFieldConfidenceSchema.nullable().optional(),
  evidence: NullableStringArraySchema,
  parseStatus: z.enum(["not_started", "processing", "parsed", "partial", "failed"]).optional(),
  parseConfidence: z.number().int().min(0).max(100).nullable().optional(),
  parseReviewRequired: z.boolean().optional(),
  parseProvider: z.string().max(100).nullable().optional(),
  parsedSkills: z.array(z.string().max(200)).max(100).nullable().optional(),
  parsedExperience: z.array(CandidateParsedExperienceItemSchema).max(50).nullable().optional(),
  parsedEducation: z.array(CandidateParsedEducationItemSchema).max(50).nullable().optional(),
});

const CandidateStatusBaseSchema = z.object({
  status: CandidateStatusValueSchema,
});

const ReviewThreadScopeTypeSchema = z.enum(["role", "candidate"]);
const ReviewThreadVisibilitySchema = z.enum(["admin", "client", "vendor", "shared"]);
const ReviewThreadStatusSchema = z.enum(["open", "resolved"]);

const CandidateStatusWithOptionalReasonSchema = CandidateStatusBaseSchema.extend({
  reason: z.string().trim().max(1000).nullable().optional(),
});

const CandidateStatusWithRequiredReasonSchema = CandidateStatusBaseSchema.extend({
  reason: NonEmptyOptionalStringSchema.max(1000),
});

export const CandidateStatusSchema = z.union([
  CandidateStatusWithOptionalReasonSchema.extend({ status: z.literal("submitted") }),
  CandidateStatusWithOptionalReasonSchema.extend({ status: z.literal("screening") }),
  CandidateStatusWithRequiredReasonSchema.extend({ status: z.literal("interview") }),
  CandidateStatusWithOptionalReasonSchema.extend({ status: z.literal("offer") }),
  CandidateStatusWithOptionalReasonSchema.extend({ status: z.literal("hired") }),
  CandidateStatusWithRequiredReasonSchema.extend({ status: z.literal("rejected") }),
]);

export const UpdateCandidateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: NonEmptyOptionalStringSchema.max(50).nullable().optional(),
  expectedSalary: z.number().positive().nullable().optional(),
  cvUrl: z.string().max(2048).nullable().optional(),
  originalCvFileName: z.string().max(500).nullable().optional(),
  originalCvMimeType: z.string().max(100).nullable().optional(),
  tags: TagsInputSchema.nullable().optional(),
  currentTitle: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  education: z.string().max(5000).nullable().optional(),
  languages: z.string().max(1000).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  standardizedProfile: z.string().max(10000).nullable().optional(),
  executiveHeadline: z.string().max(500).nullable().optional(),
  professionalSnapshot: z.string().max(5000).nullable().optional(),
  domainFocus: NullableStringArraySchema,
  senioritySignal: z.string().max(200).nullable().optional(),
  candidateStrengths: NullableStringArraySchema,
  candidateRisks: NullableStringArraySchema,
  notableAchievements: NullableStringArraySchema,
  inferredWorkModel: z.string().max(200).nullable().optional(),
  locationFlexibility: z.string().max(300).nullable().optional(),
  salarySignal: z.string().max(300).nullable().optional(),
  languageItems: z.array(CandidateLanguageItemSchema).max(20).nullable().optional(),
  fieldConfidence: CandidateFieldConfidenceSchema.nullable().optional(),
  evidence: NullableStringArraySchema,
  parseStatus: z.enum(["not_started", "processing", "parsed", "partial", "failed"]).optional(),
  parseConfidence: z.number().int().min(0).max(100).nullable().optional(),
  parseReviewRequired: z.boolean().optional(),
  parseProvider: z.string().max(100).nullable().optional(),
  parsedSkills: z.array(z.string().max(200)).max(100).nullable().optional(),
  parsedExperience: z.array(CandidateParsedExperienceItemSchema).max(50).nullable().optional(),
  parsedEducation: z.array(CandidateParsedEducationItemSchema).max(50).nullable().optional(),
});

export const WithdrawCandidateSchema = z.object({
  reason: z.string().max(1000).nullable().optional(),
});

const InterviewScheduleInputSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  proposalType: InterviewProposalTypeSchema.default("exact_slot"),
  proposedDate: z.string().trim().min(1).max(50),
  startTime: z.string().trim().max(20).nullable().optional(),
  endTime: z.string().trim().max(20).nullable().optional(),
  windowLabel: z.string().trim().max(200).nullable().optional(),
  timezone: z.string().trim().min(1).max(100),
  durationMinutes: z.number().int().min(5).max(1440),
  note: z.string().trim().max(2000).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.proposalType === "exact_slot" && !data.startTime?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startTime"],
      message: "Start time is required for exact slot proposals",
    });
  }

  if (data.proposalType === "flexible_window" && !data.windowLabel?.trim() && !data.note?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["windowLabel"],
      message: "Flexible window proposals need a short label or note",
    });
  }
});

export const CreateInterviewRequestSchema = InterviewScheduleInputSchema;
export const CreateInterviewMeetingSchema = InterviewScheduleInputSchema;
export const CreateInterviewProposalSchema = InterviewScheduleInputSchema;

export const AcceptInterviewProposalSchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
});

export const CompleteInterviewMeetingSchema = z.object({
  summaryNote: z.string().trim().max(2000).nullable().optional(),
});

export const CancelInterviewMeetingSchema = z.object({
  reason: z.string().trim().max(2000).nullable().optional(),
});

export const InterviewListQuerySchema = z.object({
  view: InterviewListViewSchema.default("needs_action"),
  countOnly: z.boolean().default(false),
  candidateId: z.number().int().positive().nullable().optional(),
  roleId: z.number().int().positive().nullable().optional(),
});

// ─── Roles ───────────────────────────────────────────────────────────────────

export const CreateRoleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  skills: z.string().max(1000).nullable().optional(),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  workMode: RoleWorkModeSchema.nullable().optional(),
  employmentType: RoleEmploymentTypeInputSchema.nullable().optional(),
  otherEmploymentTypeDescription: z.string().max(1000).nullable().optional(),
  isRemote: z.boolean().optional(),
  companyId: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (data.employmentType === "other" && !data.otherEmploymentTypeDescription?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["otherEmploymentTypeDescription"],
      message: "Other employment type description is required when employment type is other",
    });
  }
});

export const UpdateRoleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  skills: z.string().max(1000).nullable().optional(),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  workMode: RoleWorkModeSchema.nullable().optional(),
  employmentType: RoleEmploymentTypeInputSchema.nullable().optional(),
  otherEmploymentTypeDescription: z.string().max(1000).nullable().optional(),
  isRemote: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.employmentType === "other" && !data.otherEmploymentTypeDescription?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["otherEmploymentTypeDescription"],
      message: "Other employment type description is required when employment type is other",
    });
  }
});

export const RoleStatusSchema = z.object({
  status: z.enum(["draft", "pending_approval", "published", "on_hold", "closed"]),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(["admin", "client", "vendor"]),
  companyId: z.number().int().positive().nullable().optional(),
});

// ─── Notes ───────────────────────────────────────────────────────────────────

export const CreateNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── Review Threads ────────────────────────────────────────────────────────

export const CreateReviewThreadSchema = z.object({
  scopeType: ReviewThreadScopeTypeSchema,
  scopeId: z.number().int().positive(),
  visibility: ReviewThreadVisibilitySchema.optional(),
  message: z.string().trim().min(1).max(5000),
});

export const AddReviewThreadMessageSchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

export const UpdateReviewThreadSchema = z.object({
  status: ReviewThreadStatusSchema,
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
  cvText: z.string().min(1).max(24000),
});

export const CvParseBodySchema = z.object({
  cvText: z.string().min(1).max(40000),
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
  executiveHeadline: z.string().nullable().optional(),
  professionalSnapshot: z.string().nullable().optional(),
  domainFocus: z.array(z.string()).nullable().optional(),
  senioritySignal: z.string().nullable().optional(),
  candidateStrengths: z.array(z.string()).nullable().optional(),
  candidateRisks: z.array(z.string()).nullable().optional(),
  notableAchievements: z.array(z.string()).nullable().optional(),
  inferredWorkModel: z.string().nullable().optional(),
  locationFlexibility: z.string().nullable().optional(),
  salarySignal: z.string().nullable().optional(),
  languageItems: z.array(CandidateLanguageItemSchema).nullable().optional(),
  fieldConfidence: CandidateFieldConfidenceSchema.nullable().optional(),
  evidence: z.array(z.string()).nullable().optional(),
  parsedSkills: z.array(z.string()).nullable().optional(),
  parsedExperience: z.array(CandidateParsedExperienceItemSchema).nullable().optional(),
  parsedEducation: z.array(CandidateParsedEducationItemSchema).nullable().optional(),
  parseConfidence: z.number().int().min(0).max(100).nullable().optional(),
  parseReviewRequired: z.boolean().nullable().optional(),
  parseStatus: z.enum(["not_started", "processing", "parsed", "partial", "failed"]).nullable().optional(),
  parseProvider: z.string().nullable().optional(),
  warnings: z.array(z.string()).nullable().optional(),
  extractionMethod: z.string().nullable().optional(),
  extractionFallbackUsed: z.boolean().optional(),
  extractionFailureClass: z.enum(["runtime", "timeout", "empty_text", "oversized", "ocr_required"]).nullable().optional(),
  sourceTextLength: z.number().int().nonnegative().nullable().optional(),
  sourceTextTruncated: z.boolean().optional(),
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
