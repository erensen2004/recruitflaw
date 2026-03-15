import { Router } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { Errors } from "../lib/errors.js";

const router = Router();

router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.createdAt);
    res.json(companies);
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, type } = req.body;
    if (!name || !type || !["client", "vendor"].includes(type)) {
      Errors.badRequest(res, "name and type (client|vendor) required");
      return;
    }

    const [company] = await db
      .insert(companiesTable)
      .values({ name, type })
      .returning();

    res.status(201).json(company);
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, isActive } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      Errors.badRequest(res, "No fields to update");
      return;
    }

    const [company] = await db
      .update(companiesTable)
      .set(updates)
      .where(eq(companiesTable.id, id))
      .returning();

    if (!company) {
      Errors.notFound(res);
      return;
    }

    res.json(company);
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

export default router;
