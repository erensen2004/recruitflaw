# RecruitFlow Rate-Limit Reduction Review

Date: 2026-04-29
Issue: REC-8
Scope: CV parsing and candidate enrichment pipeline

## Meeting Outcome

The current rate-limit pressure is concentrated in CV parsing, not general product traffic.

The highest-value changes are:

1. Stop unnecessary second AI parses for the same resume.
2. Add cheap gating before recruiter-enrichment calls.
3. Add request-level dedupe and short-lived parse result caching.
4. Keep a single preferred provider/model path for normal traffic and reserve fallbacks for explicit failure cases.

## What The Repo Shows

### 1. The client can trigger two parse calls for one upload

In [`artifacts/ats-platform/src/lib/resume-parse.ts`](/Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/ats-platform/src/lib/resume-parse.ts:419), the browser uploads the file to `/api/cv-parse` first.

If that server result looks weak, the client extracts text in the browser and calls `/api/cv-parse` again with JSON text at lines [`442`](</Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/ats-platform/src/lib/resume-parse.ts:442>)-[`443`](</Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/ats-platform/src/lib/resume-parse.ts:443>).

That means one resume can consume two AI parse requests before enrichment.

### 2. The server has several fallback paths that can multiply provider calls

In [`artifacts/api-server/src/routes/cv-parse.ts`](/Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/api-server/src/routes/cv-parse.ts:3243):

- document uploads try direct Gemini document parsing first
- then text extraction
- then Gemini text parsing
- then OpenAI-compatible fallback text parsing

This is correct for resilience, but expensive under load if most resumes are routed through the full chain.

### 3. OpenAI-compatible parsing can retry across multiple models

`MAX_PROVIDER_MODEL_ATTEMPTS` defaults to `2` in [`cv-parse.ts`](/Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/api-server/src/routes/cv-parse.ts:38), and `parseWithOpenAiText` iterates active models at lines [`2735`](</Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/api-server/src/routes/cv-parse.ts:2735>)-[`2768`](</Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/api-server/src/routes/cv-parse.ts:2768>).

When the fallback provider is rate-limited, one parse request can become multiple provider attempts.

### 4. Enrichment is a separate AI spend lane

`enrichWithOpenAi` in [`cv-parse.ts`](/Users/erensen/Documents/New project/cv-parsing-deneme-main/artifacts/api-server/src/routes/cv-parse.ts:2992) makes another model call when candidate output is weak.

This means total AI usage is not just "parse once"; it can be parse + fallback parse + enrichment.

### 5. There is no visible fingerprint cache or idempotent dedupe around parse requests

The current flow does not show a short-lived cache keyed by document hash or normalized text hash before AI parsing.

That leaves the system exposed to repeated uploads, user retries, refresh loops, and browser fallback replays.

## Best Possible Solutions Ranked

### A. Highest priority: remove duplicate parses for the same resume

Change the client fallback policy so the second `/api/cv-parse` call only happens when the first response is truly unusable, not just "thin".

Use tighter criteria than `looksWeak()` for the second server call. The current threshold is broad enough to convert many partial-but-usable parses into another paid AI request.

Expected effect: immediate reduction in parse call volume with low product risk.

### B. Add parse dedupe by fingerprint

Hash the binary upload or normalized extracted text and cache the parse result for a short TTL.

Recommended behavior:

- same company + same fingerprint within TTL returns cached parse
- concurrent identical requests share one in-flight promise
- cache stores provider, confidence, warnings, and normalized candidate payload

Expected effect: protects against retries, double-submits, and browser fallback duplication.

### C. Make one provider path the default, reserve fallback for hard failures only

Treat fallback providers as emergency paths, not routine quality-improvement paths.

Recommended policy:

- use one primary model/provider for normal traffic
- fallback only on timeout, 429, transport failure, or invalid JSON
- do not fallback only because the result is "thin" if it is structurally usable

Expected effect: fewer multi-provider bursts during traffic spikes.

### D. Tighten enrichment gating

Run enrichment only when output fails recruiter-safe minimums, not whenever it is merely imperfect.

Recommended gating examples:

- missing summary plus missing structured experience
- parse confidence below a hard threshold
- no recruiter headline and no usable snapshot

Expected effect: lower secondary model traffic without blocking candidate intake.

### E. Add operational limits before scaling usage

Recommended controls:

- per-company parse concurrency cap
- bounded retry budget per request
- explicit 429 telemetry by provider/model
- dashboard counters for parse attempts per upload

Expected effect: predictable spend and faster diagnosis when limits hit.

## Smallest Safe Next Step

Implement measurement first, then the lowest-risk traffic cut:

1. Instrument `/api/cv-parse` so each request logs:
   - upload fingerprint
   - whether direct document parse ran
   - whether Gemini text ran
   - whether OpenAI fallback ran
   - whether enrichment ran
   - total provider attempts
2. Tighten client fallback so a second parse call only happens for `failed` or near-empty results.

This order gives a fast usage reduction without weakening the product blindly.

## Decision

Do not start with broad infrastructure work.

Start with:

1. client-side duplicate parse reduction
2. server-side parse attempt instrumentation
3. short-lived dedupe cache

That sequence is the best balance of impact, safety, and engineering cost.
