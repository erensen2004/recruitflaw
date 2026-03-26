import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

export const reviewThreadScopeTypes = ["role", "candidate"] as const;
export const reviewThreadVisibilities = ["admin", "client", "vendor", "shared"] as const;
export const reviewThreadStatuses = ["open", "resolved"] as const;

export type ReviewThreadScopeType = (typeof reviewThreadScopeTypes)[number];
export type ReviewThreadVisibility = (typeof reviewThreadVisibilities)[number];
export type ReviewThreadStatus = (typeof reviewThreadStatuses)[number];

export const reviewThreadsTable = pgTable("review_threads", {
  id: serial("id").primaryKey(),
  scopeType: text("scope_type", { enum: reviewThreadScopeTypes }).notNull(),
  scopeId: integer("scope_id").notNull(),
  visibility: text("visibility", { enum: reviewThreadVisibilities }).notNull().default("shared"),
  status: text("status", { enum: reviewThreadStatuses }).notNull().default("open"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
  createdByName: text("created_by_name").notNull(),
  createdByRole: text("created_by_role", { enum: ["admin", "client", "vendor"] }).notNull(),
  createdByCompanyId: integer("created_by_company_id").references(() => companiesTable.id),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  resolvedByName: text("resolved_by_name"),
  resolvedByRole: text("resolved_by_role", { enum: ["admin", "client", "vendor"] }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reviewThreadMessagesTable = pgTable("review_thread_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => reviewThreadsTable.id),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role", { enum: ["admin", "client", "vendor"] }).notNull(),
  authorCompanyId: integer("author_company_id").references(() => companiesTable.id),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReviewThreadSchema = createInsertSchema(reviewThreadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});

export const insertReviewThreadMessageSchema = createInsertSchema(reviewThreadMessagesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertReviewThread = z.infer<typeof insertReviewThreadSchema>;
export type InsertReviewThreadMessage = z.infer<typeof insertReviewThreadMessageSchema>;
export type ReviewThread = typeof reviewThreadsTable.$inferSelect;
export type ReviewThreadMessage = typeof reviewThreadMessagesTable.$inferSelect;
