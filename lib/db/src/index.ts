import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.LOCAL_DEV === "1") {
    return "postgresql:///cv_parsing_local";
  }

  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function getSearchPath(): string {
  return process.env.DB_SEARCH_PATH || "public";
}

function getPoolConfig(): pg.PoolConfig {
  return {
    connectionString: getDatabaseUrl(),
    options: `--search_path=${getSearchPath()}`,
  };
}

export const pool = new Pool(getPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
