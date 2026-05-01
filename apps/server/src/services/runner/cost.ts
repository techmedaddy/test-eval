import type { LLMTokenUsage } from "@test-evals/shared";

// Approximate list pricing (USD per 1M tokens). Update as needed.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
  },
};

const DEFAULT_PRICING = {
  input: 1.0,
  output: 5.0,
};

export function estimateCostUsd(model: string, usage: LLMTokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;

  const billableInputTokens = Math.max(0, usage.inputTokens - usage.cacheReadInputTokens);
  const inputCost = (billableInputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}
