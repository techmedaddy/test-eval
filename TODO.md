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

## Blockers (update immediately)
- [ ] Missing real secrets for runtime execution: `ANTHROPIC_API_KEY`, production-grade `BETTER_AUTH_SECRET`
- [ ] DB credentials not yet validated for SQL auth (server reachable, but `psql` auth failed without password)
- [x] Root `docker-compose.yml` created (`postgres` + `server` + `web`, no Dockerfiles)

## Notes
- Per user instruction: one root `docker-compose.yml` for everything.
- No manual DB setup.
- No Dockerfiles.
