import crypto from "node:crypto";
import { pool } from "@workspace/db";

const PASSWORD_SETUP_TTL_HOURS = 72;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildExpiryDate(hours = PASSWORD_SETUP_TTL_HOURS) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function createPasswordSetupToken(input: {
  userId: number;
  createdByUserId?: number | null;
  purpose?: "invite" | "reset";
  ttlHours?: number;
}) {
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = buildExpiryDate(input.ttlHours);
  const purpose = input.purpose ?? "invite";

  await pool.query(
    `
      UPDATE public.password_setup_tokens
      SET used_at = now()
      WHERE user_id = $1
        AND used_at IS NULL
        AND purpose = $2
    `,
    [input.userId, purpose],
  );

  await pool.query(
    `
      INSERT INTO public.password_setup_tokens (
        user_id,
        token_hash,
        purpose,
        expires_at,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [input.userId, tokenHash, purpose, expiresAt.toISOString(), input.createdByUserId ?? null],
  );

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    purpose,
  };
}

export async function getPasswordSetupTokenDetails(token: string) {
  const tokenHash = hashToken(token);
  const { rows } = await pool.query<{
    id: number;
    userId: number;
    purpose: "invite" | "reset";
    expiresAt: string;
    email: string;
    name: string;
    role: string;
    companyId: number | null;
    isActive: boolean;
  }>(
    `
      SELECT
        pst.id,
        pst.user_id AS "userId",
        pst.purpose,
        pst.expires_at AS "expiresAt",
        u.email,
        u.name,
        u.role,
        u.company_id AS "companyId",
        u.is_active AS "isActive"
      FROM public.password_setup_tokens pst
      INNER JOIN public.users u ON u.id = pst.user_id
      WHERE pst.token_hash = $1
        AND pst.used_at IS NULL
        AND pst.expires_at > now()
      ORDER BY pst.id DESC
      LIMIT 1
    `,
    [tokenHash],
  );

  return rows[0] ?? null;
}

export async function consumePasswordSetupToken(input: {
  token: string;
  passwordHash: string;
}) {
  const tokenHash = hashToken(input.token);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: number;
      userId: number;
      expiresAt: string;
      email: string;
      name: string;
      role: string;
      companyId: number | null;
    }>(
      `
        SELECT
          pst.id,
          pst.user_id AS "userId",
          pst.expires_at AS "expiresAt",
          u.email,
          u.name,
          u.role,
          u.company_id AS "companyId"
        FROM public.password_setup_tokens pst
        INNER JOIN public.users u ON u.id = pst.user_id
        WHERE pst.token_hash = $1
          AND pst.used_at IS NULL
          AND pst.expires_at > now()
        ORDER BY pst.id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [tokenHash],
    );

    const tokenRow = rows[0];
    if (!tokenRow) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
        UPDATE public.users
        SET password_hash = $2, is_active = true
        WHERE id = $1
      `,
      [tokenRow.userId, input.passwordHash],
    );

    await client.query(
      `
        UPDATE public.password_setup_tokens
        SET used_at = now()
        WHERE id = $1
      `,
      [tokenRow.id],
    );

    await client.query("COMMIT");
    return tokenRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
