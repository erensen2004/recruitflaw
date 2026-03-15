#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before loading demo data." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to load demo data." >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

psql "$DATABASE_URL" <<'SQL'
TRUNCATE TABLE
  candidate_notes,
  candidates,
  contracts,
  timesheets,
  job_roles,
  users,
  companies
RESTART IDENTITY CASCADE;
SQL

psql "$DATABASE_URL" -f "$ROOT_DIR/db/seed-data.sql"
echo "Demo data loaded from db/seed-data.sql"
