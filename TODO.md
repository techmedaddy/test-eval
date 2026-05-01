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
- [ ] Create server/web env files
- [ ] Add Anthropic key + DB URL + runtime URLs

## Notes
- Per user instruction: one root `docker-compose.yml` for everything.
- No manual DB setup.
- No Dockerfiles.
