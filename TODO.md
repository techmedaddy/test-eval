# TODO — test-evals assignment

## Execution Board

### ✅ Done
- [x] Phase 0.1 hard blocker fixed: `apps/server/src/services/runner/dataset.ts` (`return files...`)
- [x] `bun run check-types` passes from repo root
- [x] Focus branch created: `feat/eval-harness-finish`
- [x] Monorepo foundations in place (`apps/*`, `packages/*`, workspace wiring)
- [x] DB schema + migrations + persistence layer for runs/cases/attempts/cache
- [x] Prompt strategies implemented (`zero_shot`, `few_shot`, `cot`) as swappable modules
- [x] Structured extraction path implemented (tool/structured path; no free-form-only fallback)
- [x] Retry-with-validation-feedback loop implemented (max 3 attempts with attempt logs)
- [x] Prompt hash + token usage capture wired (including cache read/write token fields)
- [x] Evaluator core implemented (field-specific scoring + aggregate scoring)
- [x] Phase 3 evaluator verification completed:
  - [x] Metric mapping audited against assignment spec (chief complaint fuzzy, vitals exact+tolerance, meds set PRF1+normalization, diagnoses set F1+ICD bonus, plan set F1, follow-up interval exact + reason fuzzy)
  - [x] Hallucination validation run on positive/negative fixtures
  - [x] Case-level hallucination flags included in evaluation payload
  - [x] Run-level hallucination counts verified against summed case counts
- [x] Hallucination detector implemented and counted in run data
- [x] Runner core implemented with bounded concurrency + rate-limit backoff + jitter
- [x] Phase 2 hardening completed:
  - [x] Idempotency verified end-to-end (cache reused for same strategy+model+transcript unless `force=true`)
  - [x] Explicit extraction-source metadata exposed (`cacheHit` + `extractionSource` in case APIs and SSE case events)
  - [x] Resumability edge case verified (completed cases not rerun; resume processes only queued/running)
  - [x] 429 backoff logging added with structured fields (runId, transcriptId, retryAttempt, delayMs)
- [x] Run control endpoints implemented:
  - [x] `POST /api/v1/runs`
  - [x] `POST /api/v1/runs/:id/resume`

### 🔄 In Progress (remaining hard requirements)
- [x] Build run read APIs for dashboard consumption
  - [x] `GET /api/v1/runs` (list)
  - [x] `GET /api/v1/runs/:id` (summary + aggregates)
  - [x] `GET /api/v1/runs/:id/cases` (case table)
- [x] Add compare API for per-field deltas + winner
  - [x] `GET /api/v1/runs/compare?left=<id>&right=<id>`
- [x] Add SSE route for run progress stream
  - [x] `GET /api/v1/runs/:id/events`
- [ ] Dashboard implementation
  - [ ] Runs list UI
  - [ ] Run detail UI (transcript, gold vs prediction diff, attempt trace)
  - [ ] Compare view UI (per-field deltas + winner)
- [ ] CLI reproducibility completion
  - [ ] Full dataset eval mode from `bun run eval -- --strategy=... --model=...`
  - [ ] Print summary table (scores/tokens/cost/time)
- [ ] Test suite completion (>= 8 required)
  - [ ] Schema retry path
  - [ ] Fuzzy medication matching
  - [ ] Set-F1 correctness (synthetic)
  - [ ] Hallucination detector positive + negative
  - [ ] Resumability
  - [ ] Idempotency
  - [ ] 429 backoff behavior (mocked SDK)
  - [ ] Prompt-hash stability
- [ ] `NOTES.md` with 3-strategy results + findings

### ⛔ Blocked
- [ ] Real runtime secrets not yet provided for full E2E eval with Anthropic
  - [ ] `ANTHROPIC_API_KEY`
  - [ ] production-grade `BETTER_AUTH_SECRET`

---

## Stretch (only if extra time)
- [ ] Prompt diff view
- [ ] Active-learning hint (top disagreement cases)
- [ ] Cost guardrail
- [ ] Second model support in compare

---

## Notes
- Root `docker-compose.yml` approach retained (postgres + server + web).
- No Dockerfiles.
- Focus now: complete run read/compare/SSE APIs, then dashboard, then tests + NOTES.
