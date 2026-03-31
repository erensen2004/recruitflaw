import { pgTable, serial, text, timestamp, integer, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobRolesTable } from "./job_roles";
import { companiesTable } from "./companies";

export type CandidateExperienceItem = {
  company?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  highlights?: string[] | null;
  scope?: string | null;
  techStack?: string[] | null;
  impactHighlights?: string[] | null;
  current?: boolean | null;
  seniorityContribution?: string | null;
};

export type CandidateEducationItem = {
  institution?: string | null;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  confidence?: number | null;
};

export type CandidateLanguageItem = {
  name?: string | null;
  level?: string | null;
  confidence?: number | null;
  source?: string | null;
};

export type CandidateFieldConfidence = {
  contact?: number | null;
  experience?: number | null;
  education?: number | null;
  languages?: number | null;
  compensation?: number | null;
  summary?: number | null;
};

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  expectedSalary: numeric("expected_salary", { precision: 10, scale: 2 }),
  status: text("status", {
    enum: [
      "pending_approval",
      "submitted",
      "screening",
      "interview",
      "offer",
      "hired",
      "rejected",
      "withdrawn",
    ],
  }).notNull().default("pending_approval"),
  roleId: integer("role_id").notNull().references(() => jobRolesTable.id),
  vendorCompanyId: integer("vendor_company_id").notNull().references(() => companiesTable.id),
  cvUrl: text("cv_url"),
  originalCvFileName: text("original_cv_file_name"),
  originalCvMimeType: text("original_cv_mime_type"),
  standardizedCvUrl: text("standardized_cv_url"),
  parseStatus: text("parse_status", { enum: ["not_started", "processing", "parsed", "partial", "failed"] })
    .notNull()
    .default("not_started"),
  parseConfidence: integer("parse_confidence"),
  parseReviewRequired: boolean("parse_review_required").notNull().default(false),
  parseProvider: text("parse_provider"),
  currentTitle: text("current_title"),
  location: text("location"),
  yearsExperience: integer("years_experience"),
  education: text("education"),
  languages: text("languages"),
  summary: text("summary"),
  standardizedProfile: text("standardized_profile"),
  executiveHeadline: text("executive_headline"),
  professionalSnapshot: text("professional_snapshot"),
  domainFocus: jsonb("domain_focus").$type<string[] | null>(),
  senioritySignal: text("seniority_signal"),
  candidateStrengths: jsonb("candidate_strengths").$type<string[] | null>(),
  candidateRisks: jsonb("candidate_risks").$type<string[] | null>(),
  notableAchievements: jsonb("notable_achievements").$type<string[] | null>(),
  inferredWorkModel: text("inferred_work_model"),
  locationFlexibility: text("location_flexibility"),
  salarySignal: text("salary_signal"),
  languageItems: jsonb("language_items").$type<CandidateLanguageItem[] | null>(),
  fieldConfidence: jsonb("field_confidence").$type<CandidateFieldConfidence | null>(),
  evidence: jsonb("evidence").$type<string[] | null>(),
  parsedSkills: jsonb("parsed_skills").$type<string[] | null>(),
  parsedExperience: jsonb("parsed_experience").$type<CandidateExperienceItem[] | null>(),
  parsedEducation: jsonb("parsed_education").$type<CandidateEducationItem[] | null>(),
  tags: text("tags"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({ id: true, submittedAt: true, updatedAt: true });
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
