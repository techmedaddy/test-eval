import Anthropic from "@anthropic-ai/sdk";
import {
  clinicalExtractionJsonSchema,
  type ClinicalExtraction,
  type PromptStrategy,
} from "@test-evals/shared";
import { cacheTextBlock, plainTextBlock, usageFromAnthropic } from "./cache";
import { createPromptHash } from "./hash";
import { getStrategyBundle, renderUserPrompt } from "./strategies";

const EXTRACTION_TOOL_NAME = "record_clinical_extraction";

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export interface AnthropicExtractionClientOptions {
  apiKey: string;
  defaultModel?: string;
  maxTokens?: number;
}

export interface ExtractionCallResult {
  extraction: ClinicalExtraction;
  rawText: string;
  requestSystemPrompt: string;
  requestUserPrompt: string;
  promptHash: string;
  strategy: PromptStrategy;
  model: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  latencyMs: number;
}

export class AnthropicExtractionClient {
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicExtractionClientOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.defaultModel ?? "claude-haiku-4-5-20251001";
    this.defaultMaxTokens = options.maxTokens ?? 1200;
  }

  async extract(params: {
    transcript: string;
    strategy: PromptStrategy;
    model?: string;
    maxTokens?: number;
    feedback?: string;
  }): Promise<ExtractionCallResult> {
    const model = params.model ?? this.defaultModel;
    const bundle = getStrategyBundle(params.strategy);
    const promptHash = createPromptHash(bundle);

    const systemBlocks = [cacheTextBlock(bundle.systemPrompt)];
    const baseUserPrompt = renderUserPrompt(bundle.userPromptTemplate, params.transcript);
    const userPrompt = params.feedback
      ? `${baseUserPrompt}\n\nValidation feedback from previous attempt:\n${params.feedback}\n\nReturn corrected output using the tool.`
      : baseUserPrompt;

    const fewShotMessages = bundle.fewShotExamples.flatMap((example) => {
      return [
        {
          role: "user" as const,
          content: [cacheTextBlock(`Transcript example:\n${example.transcript}`)],
        },
        {
          role: "assistant" as const,
          content: [cacheTextBlock(JSON.stringify(example.output))],
        },
      ];
    });

    const messages = [
      ...fewShotMessages,
      {
        role: "user" as const,
        content: [plainTextBlock(userPrompt)],
      },
    ];

    const startedAt = Date.now();

    const response: any = await this.client.messages.create({
      model,
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      system: systemBlocks,
      messages,
      tools: [
        {
          name: EXTRACTION_TOOL_NAME,
          description: "Return schema-conformant extraction JSON for the transcript.",
          input_schema: clinicalExtractionJsonSchema as any,
        },
      ],
      tool_choice: {
        type: "tool",
        name: EXTRACTION_TOOL_NAME,
      },
    });

    const latencyMs = Date.now() - startedAt;
    const extraction = this.extractToolPayload(response);

    return {
      extraction,
      rawText: this.extractText(response),
      requestSystemPrompt: bundle.systemPrompt,
      requestUserPrompt: userPrompt,
      promptHash,
      strategy: params.strategy,
      model,
      tokenUsage: usageFromAnthropic(response?.usage),
      latencyMs,
    };
  }

  private extractToolPayload(response: any): ClinicalExtraction {
    const blocks = Array.isArray(response?.content) ? response.content : [];

    const toolUse = blocks.find(
      (block: any) => block?.type === "tool_use" && block?.name === EXTRACTION_TOOL_NAME,
    );

    if (!toolUse) {
      throw new StructuredOutputError(
        "Model did not return required tool_use block for structured extraction output.",
      );
    }

    if (!toolUse.input || typeof toolUse.input !== "object") {
      throw new StructuredOutputError("Tool payload missing or malformed.");
    }

    return toolUse.input as ClinicalExtraction;
  }

  private extractText(response: any): string {
    const blocks = Array.isArray(response?.content) ? response.content : [];
    const textParts = blocks
      .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
      .map((block: any) => block.text.trim())
      .filter(Boolean);

    return textParts.join("\n");
  }
}

export function createAnthropicExtractionClient(options: AnthropicExtractionClientOptions) {
  return new AnthropicExtractionClient(options);
}
