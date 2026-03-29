import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken } from "../lib/auth.js";
import { validate } from "../middlewares/validate.js";
import { ChangePasswordSchema, ForgotPasswordSchema, LoginSchema, SetupPasswordSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";
import { consumePasswordSetupToken, createPasswordSetupToken, getPasswordSetupTokenDetails } from "../lib/password-setup.js";
import { sendPasswordResetEmail } from "../lib/email.js";

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
        Errors.forbidden(res, "Account is not active yet. Ask your admin for help or use a valid reset link.");
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

async function respondWithPasswordTokenMeta(token: string, res: Parameters<typeof Errors.unauthorized>[0]) {
  try {
    const setup = await getPasswordSetupTokenDetails(token);

    if (!setup) {
      Errors.unauthorized(res, "Password link is invalid or expired");
      return false;
    }

    res.json({
      email: setup.email,
      name: setup.name,
      role: setup.role,
      purpose: setup.purpose,
      expiresAt: setup.expiresAt,
    });
    return true;
  } catch (err) {
    console.error(err);
    Errors.unauthorized(res, "Password link is invalid or expired");
    return false;
  }
}

router.get("/password-setup/:token", async (req, res) => {
  await respondWithPasswordTokenMeta(req.params.token, res);
});

router.get("/password-reset/:token", async (req, res) => {
  await respondWithPasswordTokenMeta(req.params.token, res);
});

async function consumePasswordToken(token: string, password: string, res: Parameters<typeof Errors.unauthorized>[0]) {
  try {
    const parsed = SetupPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      Errors.badRequest(res, parsed.error.issues[0]?.message || "Password is required");
      return false;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const updatedUser = await consumePasswordSetupToken({ token: parsed.data.token, passwordHash });

    if (!updatedUser) {
      Errors.unauthorized(res, "Password link is invalid or expired");
      return false;
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
    return true;
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message.includes("token")) {
      Errors.unauthorized(res, "Password link is invalid or expired");
      return false;
    }
    Errors.internal(res);
    return false;
  }
}

router.post("/password-setup/:token", async (req, res) => {
  await consumePasswordToken(req.params.token, req.body?.password, res);
});

router.post("/password-reset/:token", async (req, res) => {
  await consumePasswordToken(req.params.token, req.body?.password, res);
});

router.post("/forgot-password", validate(ForgotPasswordSchema), async (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (user) {
      const reset = await createPasswordSetupToken({
        userId: user.id,
        purpose: "reset",
      });
      const origin = process.env.PUBLIC_APP_URL?.trim();
      const resetUrl = origin
        ? new URL(`/reset-password?token=${encodeURIComponent(reset.token)}`, origin).toString()
        : null;

      if (resetUrl) {
        try {
          await sendPasswordResetEmail({
            to: user.email,
            name: user.name,
            resetUrl,
            expiresAt: reset.expiresAt,
          });
        } catch (emailError) {
          console.error("[forgot-password] email send failed", emailError);
        }
      } else {
        console.warn("[forgot-password] PUBLIC_APP_URL is not configured; reset email skipped");
      }
    }

    res.json({
      ok: true,
      message: "If that email exists in RecruitFlow, a password reset link has been sent.",
    });
  } catch (err) {
    console.error(err);
    res.json({
      ok: true,
      message: "If that email exists in RecruitFlow, a password reset link has been sent.",
    });
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
