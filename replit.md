# ATS Platform (RecruitFlow)

## Overview

A full-stack Applicant Tracking System (ATS) with 3 user roles:
- **Admin** — Manages companies, users, approves job roles, sees all data, analytics dashboard
- **Client HR** — Creates job positions (with salary/location/remote), reviews/evaluates candidates, adds notes, exports PDF
- **Vendor** — Views open positions, submits candidates with tags, CV parsing via AI, tracks placements, submits timesheets

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/ats-platform) - served at /
- **API framework**: Express 5 (artifacts/api-server) - served at /api
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Build**: esbuild (CJS bundle)
- **PDF export**: jsPDF (frontend, candidate profile export)
- **AI**: OpenRouter / OpenAI-compatible CV parsing with PDF text extraction and CV normalization

## Default Credentials

- Admin: admin@ats.com / admin123
- Client HR: hr@techcorp.com / client123
- Vendor: vendor@staffingpro.com / vendor123

## Database Schema

8 tables:
- `companies` — client and vendor companies
- `users` — all users with role (admin|client|vendor) and company link
- `job_roles` — positions with status (draft→pending_approval→published→closed), salary range, location, employment type, isRemote
- `candidates` — submitted candidates with pipeline status, tags (comma-separated), cvUrl
- `candidate_notes` — internal notes/activity log per candidate
- `contracts` — placement contracts with daily rate
- `timesheets` — monthly timesheet submissions

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080, path /api)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── auth.ts        # JWT middleware (requireAuth, signToken)
│   │       │   ├── authz.ts       # Ownership helpers (requireRole, resolveCandidateAccess, resolveRoleAccess)
│   │       │   ├── errors.ts      # Centralized API error helpers (Errors.*)
│   │       │   ├── schemas.ts     # All Zod validation schemas
│   │       │   ├── objectAcl.ts   # GCS ACL policies
│   │       │   └── objectStorage.ts # GCS service wrapper
│   │       ├── middlewares/
│   │       │   └── validate.ts    # Reusable Zod validation middleware
│   │       └── routes/            # auth, companies, users, roles, candidates, contracts, timesheets, notes, analytics, cv-parse, storage
│   └── ats-platform/       # React + Vite frontend (port 25964, path /)
│       └── src/
│           ├── pages/
│           │   ├── login.tsx
│           │   ├── admin/       # companies, users, roles, candidates, contracts, timesheets, analytics
│           │   ├── client/      # roles (extended form), candidates (list+detail+notes+PDF), timesheets
│           │   └── vendor/      # positions, submit-candidate (tags+AI parse), candidates (tags), contracts, timesheets
│           └── components/
│               └── layout/DashboardLayout.tsx
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks (with JWT injection in custom-fetch)
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
└── scripts/                # Utility scripts
```

## Key API Endpoints

- POST /api/auth/login — Login (returns JWT)
- GET  /api/auth/me — Current user
- GET/POST /api/companies — Company management (admin)
- GET/POST /api/users — User management (admin)
- GET/POST /api/roles — Job roles (with salary, location, employmentType, isRemote)
- PATCH /api/roles/:id/status — Approve/publish role
- GET/POST /api/candidates — Candidates (with tags)
- GET /api/candidates/:id — Single candidate detail
- PATCH /api/candidates/:id/status — Move through pipeline
- GET/POST /api/candidates/:id/notes — Candidate notes
- GET /api/analytics — Platform analytics (totals, by-status breakdowns, top roles)
- POST /api/cv-parse — AI CV parsing and CV normalization (needs OPENROUTER_API_KEY or OPENAI_API_KEY)
- GET/POST /api/contracts — Contracts (admin creates)
- GET/POST /api/timesheets — Timesheets (vendor submits)

## Role-Based Access

- Admin: All endpoints + Analytics
- Client: Own company's roles and candidates (with notes, PDF export), timesheets
- Vendor: Published roles only, own candidates (with tags + AI CV parsing), own contracts/timesheets

## CV Parsing

Requires `OPENROUTER_API_KEY` or `OPENAI_API_KEY` environment variable.
Two modes:
1. **Text mode**: POST /api/cv-parse with JSON body `{ cvText: "..." }`
2. **PDF mode**: POST /api/cv-parse with `Content-Type: application/pdf` and binary PDF body (extracts text locally via pdf-parse, then sends the normalized text to the AI model)
Only accessible to vendors. AI response is validated with Zod before returning.

Recommended Replit Secrets:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional; defaults to `nvidia/nemotron-3-nano-30b-a3b:free,nvidia/nemotron-3-super-120b-a12b:free,liquid/lfm-2.5-1.2b-instruct:free`)
- `OPENROUTER_SITE_URL` (optional)
- `OPENROUTER_APP_NAME` (optional)
- `DATABASE_URL`
- `PRIVATE_OBJECT_DIR`
- `JWT_SECRET`

The parser now returns a normalized intake snapshot in addition to basic ATS fields:
- `currentTitle`
- `location`
- `yearsExperience`
- `education`
- `languages`
- `summary`
- `standardizedProfile`

## Local Dev Mode

You can now run the API locally without Replit-specific storage by enabling:
- `LOCAL_DEV=1`
- `STORAGE_BACKEND=local`

Behavior in local mode:
- Database defaults to local Postgres database `cv_parsing_local` if `DATABASE_URL` is not set
- Object storage uses the local filesystem instead of the Replit sidecar
- Uploaded CVs are stored under `.local-storage/`

Example local API command:
```bash
LOCAL_DEV=1 \
STORAGE_BACKEND=local \
JWT_SECRET=local-dev-secret \
OPENROUTER_API_KEY=... \
PORT=8080 \
pnpm --filter @workspace/api-server run dev
```

## Important: Rebuilding Packages After Changes

After modifying the DB schema or running API codegen, rebuild the affected lib packages:
```bash
# Rebuild DB declarations (after schema changes)
cd lib/db && npx tsc -p tsconfig.json

# Rebuild API client declarations (after codegen)
cd lib/api-client-react && npx tsc -p tsconfig.json
```
These dist folders are required for TypeScript type resolution across the monorepo.

## Role Permissions (POST /api/roles)

Both `admin` and `client` roles can create job roles. Admin can specify a `companyId` in the request body; clients automatically use their own company.

## Security: Route Access Control

- GET/POST `/api/analytics` → Admin only
- GET/POST `/api/candidates/:id/notes` → Admin + Client only (vendors cannot add notes)
- PATCH `/api/candidates/:id/status` → Admin + Client only (vendors cannot change pipeline status)
- POST `/api/roles` → Admin + Client only
- GET/POST `/api/companies`, GET/POST `/api/users` → Admin only
- GET `/api/roles` → All (vendor sees published only; client sees own company's; admin sees all)
- GET `/api/candidates` → All (each role sees filtered results)
- GET `/api/timesheets`, `/api/contracts` → All (filtered by role internally)
- GET `/api/storage/objects/*` → Aligned with candidate authorization
  - Resolves objectPath → candidateId (via cvUrl match)
  - Checks candidate ownership (admin/client/vendor)
  - Serves CV only if user is authorized to view the candidate

## File Access Authorization

CV file access is **aligned with candidate authorization**:
- **Admin**: Full access to all CVs
- **Client**: Can view CVs for candidates whose roles belong to their company
- **Vendor**: Can view CVs for candidates they submitted
- **Others**: 403 Forbidden

Implementation: `GET /api/storage/objects/*` performs three checks:
1. Find candidate by matching cvUrl/objectPath (DB lookup)
2. Verify user can view that candidate (resolveCandidateAccess)
3. Serve file only if authorized
