import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken } from "../lib/auth.js";
import { validate } from "../middlewares/validate.js";
import { ChangePasswordSchema, LoginSchema, SetupPasswordSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";
import { consumePasswordSetupToken, getPasswordSetupTokenDetails } from "../lib/password-setup.js";

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
      if (user && !user.isActive) {
        Errors.forbidden(res, "Account is not activated yet. Use your setup link to create a password.");
        return;
      }
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

router.get("/password-setup/:token", async (req, res) => {
  try {
    const setup = await getPasswordSetupTokenDetails(req.params.token);

    if (!setup) {
      Errors.unauthorized(res, "Setup link is invalid or expired");
      return;
    }

    if (setup.isActive) {
      Errors.badRequest(res, "This account is already activated");
      return;
    }

    res.json({
      email: setup.email,
      name: setup.name,
      role: setup.role,
      purpose: setup.purpose,
      expiresAt: setup.expiresAt,
    });
  } catch (err) {
    console.error(err);
    Errors.unauthorized(res, "Setup link is invalid or expired");
  }
});

router.post("/password-setup/:token", async (req, res) => {
  try {
    const parsed = SetupPasswordSchema.safeParse({ token: req.params.token, password: req.body?.password });
    if (!parsed.success) {
      Errors.badRequest(res, parsed.error.issues[0]?.message || "Password is required");
      return;
    }

    const { token, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await consumePasswordSetupToken({ token, passwordHash });

    if (!updatedUser) {
      Errors.unauthorized(res, "Setup link is invalid or expired");
      return;
    }

    let companyName: string | null = null;
    if (updatedUser.companyId) {
      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, updatedUser.companyId));
      companyName = company?.name ?? null;
    }

    const authToken = signToken({
      userId: updatedUser.userId,
      role: updatedUser.role,
      companyId: updatedUser.companyId ?? null,
    });

    res.json({
      token: authToken,
      user: {
        id: updatedUser.userId,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        companyId: updatedUser.companyId ?? null,
        companyName,
      },
    });
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message.includes("token")) {
      Errors.unauthorized(res, "Setup link is invalid or expired");
      return;
    }
    Errors.internal(res);
  }
});

router.post("/change-password", requireAuth, validate(ChangePasswordSchema), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const [user] = await db
      .select({
        id: usersTable.id,
        passwordHash: usersTable.passwordHash,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId));

    if (!user) {
      Errors.notFound(res, "User not found");
      return;
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatch) {
      Errors.unauthorized(res, "Current password is incorrect");
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, user.id));

    res.json({ ok: true });
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
