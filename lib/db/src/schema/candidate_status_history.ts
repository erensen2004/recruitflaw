import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { candidatesTable } from "./candidates";
import { usersTable } from "./users";

export const candidateStatusHistoryTable = pgTable("candidate_status_history", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  previousStatus: text("previous_status"),
  nextStatus: text("next_status").notNull(),
  reason: text("reason"),
  changedByUserId: integer("changed_by_user_id").notNull().references(() => usersTable.id),
  changedByName: text("changed_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCandidateStatusHistorySchema = createInsertSchema(candidateStatusHistoryTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCandidateStatusHistory = z.infer<typeof insertCandidateStatusHistorySchema>;
export type CandidateStatusHistory = typeof candidateStatusHistoryTable.$inferSelect;
