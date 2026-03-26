import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type SslConfig = NonNullable<pg.PoolConfig["ssl"]>;

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.trim();
  }

  if (process.env.LOCAL_DEV === "1") {
    return "postgresql:///cv_parsing_local";
  }

  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function getSearchPath(): string {
  const raw = process.env.DB_SEARCH_PATH?.trim();
  if (!raw) return "public";

  const unquoted = raw.replace(/^"(.*)"$/, "$1").trim();
  const normalized = unquoted.replace(/\\n/g, "").trim();
  return normalized || "public";
}

function isLocalDatabaseHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  );
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null || value === "") return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getSslConfig(databaseUrl: string): SslConfig | undefined {
  const explicitSslDisabled = parseBooleanEnv(process.env.DB_SSL_DISABLED);
  if (explicitSslDisabled) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return undefined;
  }

  if (isLocalDatabaseHost(parsed.hostname)) {
    return undefined;
  }

  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  const requiresSsl =
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full" ||
    parseBooleanEnv(process.env.DB_SSL) === true;

  if (!requiresSsl) {
    return undefined;
  }

  const rejectUnauthorized =
    parseBooleanEnv(process.env.DB_SSL_REJECT_UNAUTHORIZED) ?? false;

  return { rejectUnauthorized };
}

function shouldAllowSelfSignedTls(databaseUrl: string): boolean {
  const explicit = parseBooleanEnv(process.env.DB_TLS_ALLOW_SELF_SIGNED);
  if (explicit != null) {
    return explicit;
  }

  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname.endsWith(".supabase.com");
  } catch {
    return false;
  }
}

function getPoolConfig(): pg.PoolConfig {
  const connectionString = getDatabaseUrl();
  if (shouldAllowSelfSignedTls(connectionString)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";
  }
  return {
    connectionString,
    options: `--search_path=${getSearchPath()}`,
    ssl: getSslConfig(connectionString),
  };
}

export const pool = new Pool(getPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
