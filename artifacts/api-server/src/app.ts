import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

function buildCorsOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ?? "";
  const allowedOrigins = allowedOriginsEnv
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProd && allowedOrigins.length === 0) {
    throw new Error(
      "ALLOWED_ORIGINS must be set in production. " +
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

      const inWhitelist = allowedOrigins.includes(origin);

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

const app: Express = express();

app.use(buildCorsOptions());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
