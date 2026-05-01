import type { PromptMessageBlock } from "./types";

export interface AnthropicLikeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function cacheTextBlock(text: string): PromptMessageBlock {
  return {
    type: "text",
    text,
    cache_control: {
      type: "ephemeral",
    },
  };
}

export function plainTextBlock(text: string): PromptMessageBlock {
  return {
    type: "text",
    text,
  };
}

export function usageFromAnthropic(usage: AnthropicLikeUsage | undefined) {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteInputTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}
