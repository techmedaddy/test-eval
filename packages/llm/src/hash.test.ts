import { describe, expect, it } from "bun:test";
import { createPromptHash } from "./hash";

describe("createPromptHash", () => {
  it("is stable for semantically identical prompt bundles and changes when content changes", () => {
    const base = {
      strategy: "few_shot" as const,
      systemPrompt: "You are a strict extractor.",
      userPromptTemplate: "Transcript: {{transcript}}",
      fewShotExamples: [
        {
          transcript: "t1",
          expectedExtraction: {
            chief_complaint: "Headache",
            vitals: { bp: null, hr: null, temp_f: null, spo2: null },
            medications: [],
            diagnoses: [],
            plan: ["Hydration"],
            follow_up: { interval_days: null, reason: null },
          },
        },
      ],
    };

    const reordered = {
      ...base,
      fewShotExamples: [
        {
          expectedExtraction: {
            medications: [],
            diagnoses: [],
            chief_complaint: "Headache",
            plan: ["Hydration"],
            vitals: { spo2: null, temp_f: null, hr: null, bp: null },
            follow_up: { reason: null, interval_days: null },
          },
          transcript: "t1",
        },
      ],
    } as any;

    const hashA = createPromptHash(base);
    const hashB = createPromptHash(reordered);

    expect(hashA).toBe(hashB);

    const changed = {
      ...base,
      systemPrompt: "You are a strict extractor!", // one-char meaningful change
    };

    const hashC = createPromptHash(changed);
    expect(hashC).not.toBe(hashA);
  });
});
