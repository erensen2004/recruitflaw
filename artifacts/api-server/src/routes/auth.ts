import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken } from "../lib/auth.js";
import { validate } from "../middlewares/validate.js";
import { LoginSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();

router.post("/login", validate(LoginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        passwordHash: usersTable.passwordHash,
        role: usersTable.role,
        companyId: usersTable.companyId,
        isActive: usersTable.isActive,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()));

    if (!user || !user.isActive) {
      Errors.unauthorized(res, "Invalid email or password");
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      Errors.unauthorized(res, "Invalid email or password");
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

    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        companyName,
      },
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        companyId: usersTable.companyId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId));

    if (!user) {
      Errors.notFound(res, "User not found");
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
