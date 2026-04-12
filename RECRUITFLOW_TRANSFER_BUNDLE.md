# RecruitFlow Codex Account Switch Bundle

Date: 2026-04-12
Primary workspace: `/Users/erensen/Documents/New project/cv-parsing-deneme-main`
Current git branch: `codex/local-sync-20260326`

## What This File Is

This is the canonical continuity document for switching Codex accounts on the same Mac while keeping RecruitFlow usable as if work is continuing from the same machine and project state.

This file is designed for:
- same Mac
- new premium ChatGPT/Codex account
- maximum working continuity
- no expectation of exact server-side chat history carry-over

Important reality:
- local repo state stays on disk
- local `.vercel` state stays on disk
- local OCR assets stay on disk
- local `~/.codex/skills` and most machine-level Codex config stay on disk
- but account-level chat history and memory do not become a natural merged history on the new account

Important connector distinction:
- local git remote and any macOS-stored git credentials may continue to work
- local `.vercel/project.json` and `.vercel/.env.production.local` remain on disk
- but Codex in-app connectors such as GitHub, Vercel, and Gmail may still need to be re-authorized on the new OpenAI account because those permissions are account-level

So the best continuity strategy is:
1. keep the same local workspace
2. preserve local Codex state
3. export chat data from the old account
4. give the new account this bundle first

## Current Repo Snapshot

Git remote:
- `origin https://github.com/erensen2004/recruitflaw.git`

Known important local-only files:
- `.vercel/project.json`
- `.vercel/.env.production.local`
- `artifacts/api-server/eng.traineddata`
- `artifacts/api-server/tur.traineddata`

Current machine-level Codex state lives under:
- `~/.codex/config.toml`
- `~/.codex/skills`
- `~/.codex/automations`
- `~/.codex/archived_sessions`
- `~/.codex/session_index.jsonl`

Do not rely on these as account-level history restore mechanisms:
- `~/.codex/auth.json`
- live `~/.codex/sessions` store
- account-side chat list in the OpenAI UI

## Continuity Pack

Use the local script below to generate a same-Mac account-switch pack:

- [output/codex-account-switch/build-continuity-pack.sh](/Users/erensen/Documents/New%20project/cv-parsing-deneme-main/output/codex-account-switch/build-continuity-pack.sh)

The generated pack includes:
- this bundle
- a startup prompt for the new account
- git branch / status / remote snapshot
- env var name inventory
- `.vercel/project.json`
- OCR traineddata files
- full `~/.codex/skills` tree
- `~/.codex/config.toml`
- `~/.codex/automations`
- `~/.codex/archived_sessions`
- `~/.codex/session_index.jsonl`
- optional external skill library zip if present at `/Users/erensen/Downloads/skills-main.zip`

The generated pack intentionally excludes:
- `~/.codex/auth.json`
- full `~/.codex/sessions` directory
- raw secret values from env files
- exact server-side chat history restoration

## Exact Same-Mac Switch Flow

### 1. Before sign-out
- Request ChatGPT data export from the old account.
- Run the continuity pack builder script.
- Confirm this file is present and readable.
- Confirm the repo opens and the branch is correct.

### 2. Sign-out / sign-in
- Sign out of the current Codex/OpenAI account.
- Sign in with the new premium account.
- Open the same local workspace folder again:
  - `/Users/erensen/Documents/New project/cv-parsing-deneme-main`

### 3. First message to the new account
Paste this first:

```text
Open RECRUITFLOW_TRANSFER_BUNDLE.md in the repo root and treat it as the continuity source of truth.
This is the same local Mac and same workspace, but a different Codex/OpenAI account.
Assume local files, local Vercel linkage, OCR assets, and ~/.codex skills are already present.
Summarize the current project state, current branch, local-only requirements, and the safest next step before making any changes.
```

### 4. Optional extra context
If you receive the old account data export:
- keep it as a history archive
- do not expect it to restore the natural chat list
- use it only as a reference for older reasoning and decisions

## What The New Account Should Verify First

Immediately after opening the workspace, the new account should verify:
- repo is visible
- current branch is preserved
- working tree is visible
- custom and built-in skills are visible from `~/.codex/skills`
- `.vercel/project.json` still points to `recruitflaw`
- OCR assets still exist
- git remote still points to GitHub correctly

## Environment Variables

Do not store real secrets in this file.

Important production vars still expected by the project:
- `DATABASE_URL`
- `DB_SEARCH_PATH`
- `JWT_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `GOOGLE_VISION_API_KEY`
- `GOOGLE_GENAI_USE_VERTEXAI`
- `VERTEX_AI_PROJECT`
- `VERTEX_AI_LOCATION`
- `VERTEX_GEMINI_MODEL`
- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- `CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `PUBLIC_APP_URL`

Important note:
- On the same Mac, these local files stay where they are unless you manually delete or overwrite them.
- The continuity pack is a safety and onboarding layer, not the main storage layer.

## Skills Continuity

The pack is intended to preserve the full local skills tree, including:
- built-in local skills under `~/.codex/skills`
- RecruitFlow custom skills
- the `recruitflow-master` orchestrator skill
- optional extra skill library archives that have not been installed yet but may be useful later

At the time of writing, RecruitFlow-specific skills include:
- `recruitflow-master`
- `recruitflow-design-review`
- `recruitflow-product-sense`
- `recruitflow-standardized-cv-quality`
- `recruitflow-client-ux-compactness`
- `recruitflow-live-acceptance`
- `recruitflow-notification-ux`
- `recruitflow-client-trust-copy`
- `recruitflow-ui-polish`
- `recruitflow-smoke-tests`
- `recruitflow-release-check`
- `recruitflow-deploy`
- `recruitflow-cv-intake`
- `recruitflow-worktrees`

## Working Expectation After Switch

Expected quality of continuity:
- code continuity: near-perfect
- deploy continuity: near-perfect
- skill continuity: near-perfect
- local config continuity: high
- server-side chat continuity: not exact
- decision continuity: high if this bundle is used first

The new account should be able to continue RecruitFlow on this Mac with minimal re-explaining, even though the old account's conversation list will not naturally appear as the same history.
