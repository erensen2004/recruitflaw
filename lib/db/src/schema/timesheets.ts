import { pgTable, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contractsTable } from "./contracts";

export const timesheetsTable = pgTable("timesheets", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").notNull().references(() => contractsTable.id),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  totalDays: integer("total_days").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const insertTimesheetSchema = createInsertSchema(timesheetsTable).omit({ id: true, submittedAt: true });
export type InsertTimesheet = z.infer<typeof insertTimesheetSchema>;
export type Timesheet = typeof timesheetsTable.$inferSelect;
