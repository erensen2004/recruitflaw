import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { candidatesTable } from "./candidates";
import { jobRolesTable } from "./job_roles";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

export const interviewProcessStatuses = ["open", "closed"] as const;
export const interviewMeetingStatuses = ["negotiating", "scheduled", "completed", "cancelled"] as const;
export const interviewProposalTypes = ["exact_slot", "flexible_window"] as const;
export const interviewProposalResponseStatuses = ["pending", "accepted", "superseded", "withdrawn"] as const;

export type InterviewProcessStatus = (typeof interviewProcessStatuses)[number];
export type InterviewMeetingStatus = (typeof interviewMeetingStatuses)[number];
export type InterviewProposalType = (typeof interviewProposalTypes)[number];
export type InterviewProposalResponseStatus = (typeof interviewProposalResponseStatuses)[number];

export const interviewProcessesTable = pgTable("interview_processes", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  roleId: integer("role_id").notNull().references(() => jobRolesTable.id),
  clientCompanyId: integer("client_company_id").notNull().references(() => companiesTable.id),
  vendorCompanyId: integer("vendor_company_id").notNull().references(() => companiesTable.id),
  status: text("status", { enum: interviewProcessStatuses }).notNull().default("open"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  closedReason: text("closed_reason"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const interviewMeetingsTable = pgTable("interview_meetings", {
  id: serial("id").primaryKey(),
  processId: integer("process_id").notNull().references(() => interviewProcessesTable.id),
  status: text("status", { enum: interviewMeetingStatuses }).notNull().default("negotiating"),
  meetingIndex: integer("meeting_index").notNull(),
  title: text("title"),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  timezone: text("timezone"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
  confirmedProposalId: integer("confirmed_proposal_id"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  summaryNote: text("summary_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const interviewProposalsTable = pgTable("interview_proposals", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => interviewMeetingsTable.id),
  proposedByRole: text("proposed_by_role", { enum: ["admin", "client", "vendor"] }).notNull(),
  proposedByUserId: integer("proposed_by_user_id").notNull().references(() => usersTable.id),
  proposalType: text("proposal_type", { enum: interviewProposalTypes }).notNull(),
  proposedDate: text("proposed_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  windowLabel: text("window_label"),
  timezone: text("timezone").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  note: text("note"),
  responseStatus: text("response_status", { enum: interviewProposalResponseStatuses }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const interviewActivityTable = pgTable("interview_activity", {
  id: serial("id").primaryKey(),
  processId: integer("process_id").notNull().references(() => interviewProcessesTable.id),
  meetingId: integer("meeting_id").references(() => interviewMeetingsTable.id),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  actorRole: text("actor_role").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInterviewProcessSchema = createInsertSchema(interviewProcessesTable).omit({
  id: true,
  openedAt: true,
  updatedAt: true,
});

export const insertInterviewMeetingSchema = createInsertSchema(interviewMeetingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInterviewProposalSchema = createInsertSchema(interviewProposalsTable).omit({
  id: true,
  createdAt: true,
});

export const insertInterviewActivitySchema = createInsertSchema(interviewActivityTable).omit({
  id: true,
  createdAt: true,
});

export type InsertInterviewProcess = z.infer<typeof insertInterviewProcessSchema>;
export type InsertInterviewMeeting = z.infer<typeof insertInterviewMeetingSchema>;
export type InsertInterviewProposal = z.infer<typeof insertInterviewProposalSchema>;
export type InsertInterviewActivity = z.infer<typeof insertInterviewActivitySchema>;

export type InterviewProcess = typeof interviewProcessesTable.$inferSelect;
export type InterviewMeeting = typeof interviewMeetingsTable.$inferSelect;
export type InterviewProposal = typeof interviewProposalsTable.$inferSelect;
export type InterviewActivity = typeof interviewActivityTable.$inferSelect;
