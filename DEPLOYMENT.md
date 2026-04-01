# Vercel Deployment

## Architecture

- Frontend: `artifacts/ats-platform` built by Vite and deployed as a static site.
- Backend: single Vercel Node function at `api/[[...route]].ts` that wraps the Express app.
- Database: external Postgres via `DATABASE_URL`.
- File storage: Vercel Blob in production via `STORAGE_BACKEND=vercel-blob`.

This keeps the existing monorepo structure intact while removing production dependencies on Replit runtime services and local disk.

## Required Vercel Environment Variables

Set these in the Vercel project before the first production deployment:

- `DATABASE_URL`
- `DB_SEARCH_PATH=public`
- `JWT_SECRET`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `STORAGE_BACKEND=vercel-blob`
- `BLOB_READ_WRITE_TOKEN`

Recommended:

- `ALLOWED_ORIGINS`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `MAX_UPLOAD_BYTES=4000000`
- `MAX_CV_PARSE_PDF_BYTES=4000000`

For Google OCR + Vertex Gemini in production, also set:

- `GOOGLE_VISION_API_KEY`
- `GOOGLE_GENAI_USE_VERTEXAI=true`
- `VERTEX_AI_PROJECT`
- `VERTEX_AI_LOCATION=global`
- `VERTEX_GEMINI_MODEL=gemini-2.5-flash-lite`
- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- `CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT=false`

Notes:

- `GOOGLE_VISION_API_KEY` powers OCR fallback and can be added independently of Vertex.
- Vertex on Vercel cannot use your local `gcloud` login; it needs a service account secret or a future workload identity setup.
- `gemini-2.5-flash-lite` is the recommended first production model for recruiter-brief enrichment because it is cheaper and less timeout-prone than `gemini-2.5-flash` for this payload shape.

## Vercel Setup

1. Create a new Vercel project from the repository root.
2. Keep the root directory as the monorepo root.
3. Make sure Vercel detects `pnpm`.
4. Connect a Blob store in Vercel Storage and expose `BLOB_READ_WRITE_TOKEN`.
5. Provision a Postgres database with a pooled connection string and set `DATABASE_URL`.
6. Add the environment variables from `.env.example`.
7. Run the schema migration locally or from CI:

```bash
pnpm install
pnpm --filter @workspace/db push
```

8. If you want the app preloaded with demo content, import the included SQL seed:

```bash
pnpm run db:load-demo
```

9. Deploy.

## Supabase Shortcut

If you want the fastest hosted Postgres option, Supabase works well:

1. Create a Supabase project.
2. Copy the pooled connection string into `DATABASE_URL`.
3. Run:

```bash
pnpm install
pnpm --filter @workspace/db push
pnpm run db:load-demo
```

4. Add the same `DATABASE_URL` to Vercel.

## Local Verification Before Deploying

```bash
pnpm install
pnpm run typecheck
pnpm run build:vercel
```

For local API smoke tests you can still use the standalone server:

```bash
LOCAL_DEV=1 \
STORAGE_BACKEND=local \
JWT_SECRET=local-dev-secret-123 \
DATABASE_URL=postgresql:///cv_parsing_local \
OPENROUTER_API_KEY=your-key \
pnpm --filter @workspace/api-server run dev
```

For frontend development:

```bash
API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/ats-platform run dev
```

## Production Notes

- Vercel server uploads are best for small private CV files. The app enforces a default `4MB` limit for upload and PDF parse requests to stay within Vercel-friendly request sizes.
- `ALLOWED_ORIGINS` can be left empty if you only use the Vercel project domains and same-origin requests, because the API also auto-allows `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`.
- Existing local/Replit flows still work for development via `STORAGE_BACKEND=local` or Replit object storage env vars.
- The repo now includes demo data in `db/seed-data.sql`, so you do not need to hand-create the sample users or starter records.
