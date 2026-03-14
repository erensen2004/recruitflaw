import express from "express";
import cors from "cors";
import router from "./routes/index.js";

function normalizeOrigin(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }

  return `https://${trimmed.replace(/\/$/, "")}`;
}

function getPlatformOrigins(): string[] {
  const rawOrigins = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  return Array.from(
    new Set(
      rawOrigins
        .map((origin) => (origin ? normalizeOrigin(origin) : null))
        .filter((origin): origin is string => Boolean(origin)),
    ),
  );
}

function buildCorsOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ?? "";
  const configuredOrigins = allowedOriginsEnv
    .split(",")
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => Boolean(o));
  const allowedOrigins = Array.from(
    new Set([...configuredOrigins, ...getPlatformOrigins()]),
  );

  if (isProd && allowedOrigins.length === 0) {
    throw new Error(
      "ALLOWED_ORIGINS or Vercel deployment URLs must be set in production. " +
        "Refusing to start with open CORS policy."
    );
  }

  const devDefaults = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:25964",
  ];

  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isReplitDomain =
        origin.endsWith(".replit.dev") ||
        origin.endsWith(".repl.co") ||
        origin.endsWith(".pike.replit.dev");

      const normalizedOrigin = normalizeOrigin(origin);
      const inWhitelist = normalizedOrigin ? allowedOrigins.includes(normalizedOrigin) : false;

      const inDevDefaults = !isProd && devDefaults.includes(origin);

      if (isReplitDomain || inWhitelist || inDevDefaults) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin not allowed: ${origin}`));
      }
    },
    credentials: true,
  });
}

const app = express();

app.use(buildCorsOptions());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
