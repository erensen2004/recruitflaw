import { defineConfig } from "drizzle-kit";
import path from "path";

function sanitizeEnvValue(value: string | undefined): string {
  return value ? value.replace(/\\n/g, "\n").trim() : "";
}

function getDatabaseUrl() {
  const databaseUrl = sanitizeEnvValue(process.env.DATABASE_URL);
  if (databaseUrl) {
    return databaseUrl;
  }

  if (process.env.LOCAL_DEV === "1") {
    return "postgresql:///cv_parsing_local";
  }

  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});
