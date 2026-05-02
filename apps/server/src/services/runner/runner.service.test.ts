import { describe, expect, it } from "bun:test";
import { RateLimitError } from "@test-evals/llm";

function setRequiredEnv() {
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/healosbench_test";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  process.env.BETTER_AUTH_SECRET ??= "12345678901234567890123456789012";
  process.env.BETTER_AUTH_URL ??= "http://localhost:8787";
  process.env.CORS_ORIGIN ??= "http://localhost:3000";
  process.env.NODE_ENV ??= "test";
}

describe("RunnerService", () => {
  it("resumes a run by setting status=running and re-triggering execution", async () => {
    setRequiredEnv();

    const [{ RunnerService }, { db }] = await Promise.all([
      import("./runner.service"),
      import("@test-evals/db"),
    ]);

    const updates: unknown[] = [];

    (db as any).query = {
      runs: {
        findFirst: async () => ({
          id: "run-1",
          strategy: "zero_shot",
          model: "claude-haiku-4-5-20251001",
        }),
      },
    };

    (db as any).update = () => ({
      set: (payload: unknown) => {
        updates.push(payload);
        return {
          where: async () => undefined,
        };
      },
    });

    const runner = new RunnerService();

    let executedRunId: string | null = null;
    (runner as any).executeRun = async (runId: string) => {
      executedRunId = runId;
    };

    const result = await runner.resumeRun("run-1");

    expect(result).toEqual({ runId: "run-1", status: "running" });
    expect(executedRunId).toBe("run-1");
    expect(updates.some((payload) => (payload as any)?.status === "running")).toBe(true);
  });

  it("uses cache when force=false and bypasses cache when force=true (idempotency behavior)", async () => {
    setRequiredEnv();

    const [{ RunnerService }, { db }] = await Promise.all([
      import("./runner.service"),
      import("@test-evals/db"),
    ]);

    let cacheLookupCalls = 0;
    let cacheUpdateCalls = 0;

    const cachedRow = {
      id: "cache-1",
      extraction: {
        chief_complaint: "Cough",
        vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
        medications: [],
        diagnoses: [],
        plan: ["Hydration"],
        follow_up: { interval_days: 7, reason: null },
      },
      promptHash: "prompt-hash-123",
    };

    (db as any).query = {
      extractionCache: {
        findFirst: async () => {
          cacheLookupCalls += 1;
          return cachedRow;
        },
      },
    };

    (db as any).update = () => ({
      set: () => ({
        where: async () => {
          cacheUpdateCalls += 1;
        },
      }),
    });

    const runner = new RunnerService();

    const cacheHit = await (runner as any).tryUseCachedExtraction({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcriptId: "case_001",
      force: false,
    });

    expect(cacheHit).toBeTruthy();
    expect(cacheHit.promptHash).toBe("prompt-hash-123");
    expect(cacheLookupCalls).toBe(1);
    expect(cacheUpdateCalls).toBe(1);

    const noCache = await (runner as any).tryUseCachedExtraction({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcriptId: "case_001",
      force: true,
    });

    expect(noCache).toBeNull();
    expect(cacheLookupCalls).toBe(1);
  });

  it("retries on 429-like failures with exponential backoff and then succeeds", async () => {
    setRequiredEnv();

    const [{ RunnerService }] = await Promise.all([import("./runner.service")]);

    const runner = new RunnerService();

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalRandom = Math.random;

    let attempts = 0;

    (runner as any).extractor = {
      extractWithRetry: async () => {
        attempts += 1;

        if (attempts < 3) {
          throw new RateLimitError("429 rate limit");
        }

        return {
          extraction: {
            chief_complaint: "Cough",
            vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
            medications: [],
            diagnoses: [],
            plan: ["Hydration"],
            follow_up: { interval_days: 7, reason: null },
          },
          attempts: [],
          promptHash: "hash",
          strategy: "zero_shot",
          model: "claude-haiku-4-5-20251001",
          schemaValid: true,
        };
      },
    };

    Math.random = () => 0;
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      delays.push(Number(timeout ?? 0));
      if (typeof handler === "function") {
        handler(...args);
      }
      return 0 as any;
    }) as typeof globalThis.setTimeout;

    try {
      const result = await (runner as any).extractCaseWithBackoff({
        transcript: "Patient with cough",
        strategy: "zero_shot",
        model: "claude-haiku-4-5-20251001",
        runId: "run-1",
        transcriptId: "case_001",
      });

      expect(result?.schemaValid).toBe(true);
      expect(attempts).toBe(3);
      expect(delays).toEqual([600, 1200]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      Math.random = originalRandom;
    }
  });
});
