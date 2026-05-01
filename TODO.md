# TODO — test-evals assignment

## Scope Freeze (Phase 0.1)

### Priority: Hard requirements first
- [ ] Structured output/tool use (no raw JSON.parse path)
- [ ] Retry-with-validation-feedback loop (max 3), all attempts logged
- [ ] Prompt caching wired and visible (`cache_read_input_tokens`)
- [ ] Concurrency control (max 5) + documented 429 backoff behavior
- [ ] Resumable runs (`/runs/:id/resume`) + test
- [ ] Idempotency for same `{strategy, model, transcript_id}` unless `force=true`
- [ ] Correct per-field metrics (fuzzy/exact+tolerance/set-F1)
- [ ] Hallucination detection + reporting
- [ ] Compare view with per-field deltas and winner
- [ ] CLI eval command (`bun run eval -- --strategy=...`)
- [ ] >= 8 tests for required scenarios
- [ ] `NOTES.md` with 3-strategy results + findings

### Stretch (only if extra time)
- [ ] Prompt diff view
- [ ] Active-learning hint (top disagreement cases)
- [ ] Cost guardrail
- [ ] Second model support in compare

## Phase 0.2 Environment Sanity
- [x] Bun installed and available
- [x] Docker + Docker Compose available
- [x] Confirm required env vars from schema
- [x] Create server/web env files (`apps/server/.env.example`, `apps/web/.env.example`)
- [ ] Add real Anthropic key + DB URL + runtime URLs in runtime `.env` files

## Phase 0.3 Tracking Board + Exit Criteria
- [x] `TODO.md` created with hard requirements as checkboxes
- [x] Blockers section added and actively maintained
- [x] Project runs locally (validated by starting `apps/server` and `apps/web` dev servers)
- [x] DB reachable (validated network reachability on `localhost:5433`)

## Phase 1 — Monorepo foundation
- [x] Create `packages/shared` with extraction types + run/case/result/trace/token DTOs
- [x] Create `packages/llm` with Anthropic wrapper + strategy interface + prompt hash + cache hooks
- [x] Wire scripts (`bun run eval -- --strategy=...`) at root and server
- [x] Ensure `@test-evals/shared` / `@test-evals/llm` imports resolve in server + web
- [x] Install deps and verify with `bun run check-types`

## Phase 2 — DB model & persistence
- [x] 2.1 Schema design in Drizzle (`runs`, `run_cases`, `run_attempts`, `extraction_cache`)
- [x] 2.2 Persist all required fields: strategy/model/prompt hash/status/timestamps, per-field + aggregate scores, token buckets, cost/wall time, hallucination + schema-failure counts
- [x] Export schema via `packages/db/src/schema/index.ts`
- [x] Generate SQL migrations (`packages/db/src/migrations/0000_minor_grandmaster.sql`, `0001_conscious_juggernaut.sql`)
- [x] 2.3 Migrate + validate (`bun run db:push` + smoke insert/query)

## Phase 3 — Extractor foundation
- [x] 3.1 Prompt strategies implemented as swappable modules (`zero_shot`, `few_shot`, `cot`) via strategy registry
- [x] 3.2 Structured output path enforced via Anthropic tool use (no free-form JSON parse fallback)
- [x] 3.3 Retry-with-feedback implemented (AJV validation, validation-error feedback loop, max 3 attempts, attempt logs)
- [x] 3.4 Prompt caching instrumentation retained for static blocks and captured via token usage (`cache_read_input_tokens`, `cache_write_input_tokens`)
- [x] Exit criteria smoke: one-case retry flow returns schema-valid JSON with attempt logs (`bun run eval -- --strategy=zero_shot --retry-smoke`)

## Blockers (update immediately)
- [ ] Missing real secrets for runtime execution: `ANTHROPIC_API_KEY`, production-grade `BETTER_AUTH_SECRET`
- [x] DB credentials validated on compose-managed Postgres (`localhost:55433`) with successful smoke insert/query
- [x] Root `docker-compose.yml` created (`postgres` + `server` + `web`, no Dockerfiles)

## Notes
- Per user instruction: one root `docker-compose.yml` for everything.
- No manual DB setup.
- No Dockerfiles.
