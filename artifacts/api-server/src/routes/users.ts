import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { Errors } from "../lib/errors.js";
import { createPasswordSetupToken } from "../lib/password-setup.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { CreateUserSchema } from "../lib/schemas.js";
import { validate } from "../middlewares/validate.js";

const router = Router();

router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        companyId: usersTable.companyId,
        companyName: companiesTable.name,
        adminManaged: usersTable.adminManaged,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
      .orderBy(usersTable.createdAt);

    res.json(users);
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post("/", requireAuth, requireRole("admin"), validate(CreateUserSchema), async (req, res) => {
  try {
    const { email, name, role, companyId } = req.body;
    const temporaryPassword = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: email.toLowerCase(),
        name,
        passwordHash,
        role,
        companyId: companyId ?? null,
        adminManaged: true,
        isActive: true,
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        companyId: usersTable.companyId,
        adminManaged: usersTable.adminManaged,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      });

    const origin = process.env.PUBLIC_APP_URL?.trim();
    let resetEmail: { sent: boolean; error?: string | null; deliveryId?: string | null } = { sent: false };

    if (origin) {
      const reset = await createPasswordSetupToken({
        userId: user.id,
        createdByUserId: req.user!.userId,
        purpose: "reset",
      });
      const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(reset.token)}`, origin).toString();

      try {
        const delivery = await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl,
          expiresAt: reset.expiresAt,
        });
        resetEmail = { sent: true, deliveryId: delivery.id };
      } catch (error) {
        console.error("[users.create] onboarding reset email failed", error);
        resetEmail = {
          sent: false,
          error: error instanceof Error ? error.message : "Reset email could not be sent.",
        };
      }
    } else {
      resetEmail = {
        sent: false,
        error: "PUBLIC_APP_URL is not configured, so the onboarding reset email could not be sent.",
      };
    }

    res.status(201).json({
      ...user,
      companyName: null,
      temporaryPassword,
      resetEmail,
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      Errors.conflict(res, "Email already exists");
      return;
    }
    console.error(err);
    Errors.internal(res);
  }
});

router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, email, role, companyId, isActive, password } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase();
    if (role !== undefined) updates.role = role;
    if (companyId !== undefined) updates.companyId = companyId;
    if (isActive !== undefined) updates.isActive = isActive;
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);

    if (Object.keys(updates).length === 0) {
      Errors.badRequest(res, "No fields to update");
      return;
    }

    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        companyId: usersTable.companyId,
        adminManaged: usersTable.adminManaged,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      });

    if (!user) {
      Errors.notFound(res);
      return;
    }

    let companyName: string | null = null;
    if (user.companyId) {
      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, user.companyId));
      companyName = company?.name ?? null;
    }

    res.json({ ...user, companyName });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

export default router;
