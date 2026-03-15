import { pgTable, serial, text, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const jobRolesTable = pgTable("job_roles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  skills: text("skills"),
  salaryMin: numeric("salary_min", { precision: 10, scale: 2 }),
  salaryMax: numeric("salary_max", { precision: 10, scale: 2 }),
  location: text("location"),
  employmentType: text("employment_type", { enum: ["full-time", "part-time", "contract", "freelance"] }),
  isRemote: boolean("is_remote").notNull().default(false),
  status: text("status", { enum: ["draft", "pending_approval", "published", "closed"] }).notNull().default("draft"),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertJobRoleSchema = createInsertSchema(jobRolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobRole = z.infer<typeof insertJobRoleSchema>;
export type JobRole = typeof jobRolesTable.$inferSelect;
