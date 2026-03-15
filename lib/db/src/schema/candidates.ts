import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobRolesTable } from "./job_roles";
import { companiesTable } from "./companies";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  expectedSalary: numeric("expected_salary", { precision: 10, scale: 2 }),
  status: text("status", { enum: ["submitted", "screening", "interview", "offer", "hired", "rejected"] }).notNull().default("submitted"),
  roleId: integer("role_id").notNull().references(() => jobRolesTable.id),
  vendorCompanyId: integer("vendor_company_id").notNull().references(() => companiesTable.id),
  cvUrl: text("cv_url"),
  tags: text("tags"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({ id: true, submittedAt: true, updatedAt: true });
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
