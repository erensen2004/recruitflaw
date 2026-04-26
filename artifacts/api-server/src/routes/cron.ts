import { Router, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { Errors } from "../lib/errors.js";

const router = Router();

function isAuthorizedCronRequest(authHeader: string | undefined) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return authHeader === `Bearer ${secret}`;
}

const supabaseKeepAliveHandler: RequestHandler = async (req, res) => {
  if (!isAuthorizedCronRequest(req.headers.authorization)) {
    Errors.unauthorized(res);
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.system_keepalive (
        id integer PRIMARY KEY,
        touched_at timestamptz NOT NULL DEFAULT now(),
        source text NOT NULL DEFAULT 'vercel-cron'
      )
    `);

    const result = await pool.query<{ touched_at: Date }>(`
      INSERT INTO public.system_keepalive (id, touched_at, source)
      VALUES (1, now(), 'vercel-cron')
      ON CONFLICT (id)
      DO UPDATE SET touched_at = EXCLUDED.touched_at, source = EXCLUDED.source
      RETURNING touched_at
    `);

    res.json({
      ok: true,
      touchedAt: result.rows[0]?.touched_at?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron] Supabase keep-alive failed", error);
    Errors.serviceUnavailable(res, "Supabase keep-alive failed");
  }
};

router.get("/cron/supabase-keepalive", supabaseKeepAliveHandler);

export default router;
