import { createHash } from "node:crypto";
import type { StrategyPromptBundle } from "./types";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);

  return `{${entries.join(",")}}`;
}

export function createPromptHash(bundle: StrategyPromptBundle): string {
  const canonical = stableStringify({
    strategy: bundle.strategy,
    systemPrompt: bundle.systemPrompt,
    userPromptTemplate: bundle.userPromptTemplate,
    fewShotExamples: bundle.fewShotExamples,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
