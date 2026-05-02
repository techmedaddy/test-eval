import { describe, expect, it } from "bun:test";
import { createClinicalExtractor, type ExtractionCallResult } from "./extractor";

describe("ClinicalExtractor", () => {
  it("retries after schema failure and succeeds on next valid payload", async () => {
    let calls = 0;

    const client = {
      async extract(): Promise<ExtractionCallResult> {
        calls += 1;

        if (calls === 1) {
          return {
            extraction: {
              chief_complaint: "Cough",
              vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
              medications: [],
              diagnoses: [],
              plan: ["Hydration"],
              follow_up: { interval_days: "7", reason: null },
            } as any,
            rawText: "invalid first response",
            requestSystemPrompt: "sys",
            requestUserPrompt: "user",
            promptHash: "hash-1",
            strategy: "zero_shot",
            model: "claude-haiku-4-5-20251001",
            tokenUsage: {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadInputTokens: 0,
              cacheWriteInputTokens: 0,
            },
            latencyMs: 50,
          };
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
          rawText: "valid second response",
          requestSystemPrompt: "sys",
          requestUserPrompt: "user-with-feedback",
          promptHash: "hash-1",
          strategy: "zero_shot",
          model: "claude-haiku-4-5-20251001",
          tokenUsage: {
            inputTokens: 110,
            outputTokens: 30,
            cacheReadInputTokens: 10,
            cacheWriteInputTokens: 0,
          },
          latencyMs: 70,
        };
      },
    };

    const extractor = createClinicalExtractor(client);

    const result = await extractor.extractWithRetry({
      transcript: "Patient has cough for 2 days",
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      maxAttempts: 3,
    });

    expect(calls).toBe(2);
    expect(result.schemaValid).toBe(true);
    expect(result.extraction?.follow_up.interval_days).toBe(7);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.schemaValid).toBe(false);
    expect(result.attempts[1]?.schemaValid).toBe(true);
  });
});
