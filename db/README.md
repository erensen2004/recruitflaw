# Demo Database Seed

This folder contains a ready-to-import PostgreSQL data dump for the working local demo dataset.

## What is inside

- 3 demo users
- 2 companies
- 3 roles
- 2 candidate submissions
- sequence values aligned with the inserted rows

## How to load it into Supabase or any Postgres database

1. Set `DATABASE_URL` to your target database.
2. Push the schema first:

```bash
pnpm --filter @workspace/db push
```

3. Load the demo data:

```bash
pnpm run db:load-demo
```

This script truncates the app tables, resets identities, and imports [`seed-data.sql`](./seed-data.sql).
