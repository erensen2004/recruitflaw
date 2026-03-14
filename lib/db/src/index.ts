import { drizzle } from "drizzle-orm/node-postgres";
export { and, count, eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

function sanitizeEnvValue(value: string | undefined): string {
  return value ? value.replace(/\\n/g, "\n").trim() : "";
}

function getRawDatabaseUrl(): string {
  const databaseUrl = sanitizeEnvValue(process.env.DATABASE_URL);
  if (databaseUrl) {
    return databaseUrl;
  }

  if (process.env.LOCAL_DEV === "1") {
    return "postgresql:///cv_parsing_local";
  }

  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function getDatabaseUrl(): string {
  const databaseUrl = getRawDatabaseUrl();
  const parsedUrl = new URL(databaseUrl);
  parsedUrl.searchParams.delete("sslmode");
  parsedUrl.searchParams.delete("uselibpqcompat");
  return parsedUrl.toString();
}

function getSearchPath(): string {
  return sanitizeEnvValue(process.env.DB_SEARCH_PATH) || "public";
}

function getSslConfig(rawDatabaseUrl: string): pg.PoolConfig["ssl"] {
  if (rawDatabaseUrl.includes("sslmode=disable")) {
    return undefined;
  }

  if (
    rawDatabaseUrl.includes("sslmode=") ||
    rawDatabaseUrl.includes("supabase.co") ||
    rawDatabaseUrl.includes("pooler.supabase.com")
  ) {
    return {
      rejectUnauthorized: false,
    };
  }

  return undefined;
}

function getPoolConfig(): pg.PoolConfig {
  const rawDatabaseUrl = getRawDatabaseUrl();
  const databaseUrl = getDatabaseUrl();

  return {
    connectionString: databaseUrl,
    options: `--search_path=${getSearchPath()}`,
    ssl: getSslConfig(rawDatabaseUrl),
  };
}

export const pool = new Pool(getPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema/index.js";
