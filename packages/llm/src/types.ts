import type { ClinicalExtraction, PromptStrategy } from "@test-evals/shared";

export interface PromptMessageBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

export interface FewShotExample {
  transcript: string;
  output: ClinicalExtraction;
}

export interface StrategyPromptBundle {
  strategy: PromptStrategy;
  systemPrompt: string;
  userPromptTemplate: string;
  fewShotExamples: FewShotExample[];
}

export interface PromptStrategyModule {
  strategy: PromptStrategy;
  createBundle: () => StrategyPromptBundle;
}

export interface ExtractInput {
  transcript: string;
  strategy: PromptStrategy;
  model: string;
  maxTokens?: number;
}

export interface ExtractAttemptResult {
  rawText: string;
  parsed: unknown | null;
  schemaErrors: string[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  latencyMs: number;
}
