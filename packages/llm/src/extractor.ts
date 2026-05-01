import type { ExtractionAttempt } from "@test-evals/shared";
import type { ExtractionCallResult } from "./client";
import { StructuredOutputError } from "./client";
import type { AnthropicExtractionClient } from "./client";
import { validateClinicalExtraction } from "./validator";

export interface ExtractWithRetryParams {
  transcript: string;
  strategy: "zero_shot" | "few_shot" | "cot";
  model?: string;
  maxTokens?: number;
  maxAttempts?: number;
}

export interface ExtractWithRetryResult {
  extraction: ExtractionCallResult["extraction"] | null;
  attempts: ExtractionAttempt[];
  promptHash: string | null;
  strategy: ExtractWithRetryParams["strategy"];
  model: string;
  schemaValid: boolean;
}

function feedbackFromErrors(errors: string[], previousOutput: unknown): string {
  const normalizedErrors = errors.map((error, index) => `${index + 1}. ${error}`).join("\n");
  const outputPreview = JSON.stringify(previousOutput, null, 2);

  return `Your previous tool output failed JSON Schema validation.\n\nErrors:\n${normalizedErrors}\n\nPrevious output:\n${outputPreview}\n\nFix only the issues above and return a corrected tool payload.`;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function isRateLimitLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const anyError = error as { status?: number; message?: string; error?: { type?: string; message?: string } };
  const status = anyError.status;
  const message = `${anyError.message ?? ""} ${anyError.error?.message ?? ""}`.toLowerCase();

  return status === 429 || message.includes("rate limit") || message.includes("429");
}

export class ClinicalExtractor {
  constructor(private readonly client: Pick<AnthropicExtractionClient, "extract">) {}

  async extractWithRetry(params: ExtractWithRetryParams): Promise<ExtractWithRetryResult> {
    const maxAttempts = Math.max(1, Math.min(params.maxAttempts ?? 3, 3));
    const attempts: ExtractionAttempt[] = [];
    let feedback: string | undefined;
    let promptHash: string | null = null;
    let resolvedModel = params.model ?? "claude-haiku-4-5-20251001";

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      let callResult: ExtractionCallResult;
      let schemaErrors: string[] = [];
      let schemaValid = false;
      let parsedOutput: unknown | null = null;

      try {
        callResult = await this.client.extract({
          transcript: params.transcript,
          strategy: params.strategy,
          model: params.model,
          maxTokens: params.maxTokens,
          feedback,
        });

        promptHash = callResult.promptHash;
        resolvedModel = callResult.model;
        parsedOutput = callResult.extraction;

        const validation = validateClinicalExtraction(callResult.extraction);
        schemaValid = validation.valid;
        schemaErrors = validation.errors;

        attempts.push({
          attempt: attemptNumber,
          request: {
            systemPrompt: callResult.requestSystemPrompt,
            userPrompt: callResult.requestUserPrompt,
          },
          responseText: callResult.rawText,
          parsedOutput,
          schemaValid,
          schemaErrors,
          tokenUsage: callResult.tokenUsage,
          latencyMs: callResult.latencyMs,
          createdAt: new Date().toISOString(),
        });

        if (schemaValid) {
          return {
            extraction: callResult.extraction,
            attempts,
            promptHash,
            strategy: params.strategy,
            model: resolvedModel,
            schemaValid: true,
          };
        }

        feedback = feedbackFromErrors(schemaErrors, parsedOutput);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown extraction failure";
        const structured = error instanceof StructuredOutputError;

        if (isRateLimitLikeError(error)) {
          throw new RateLimitError(message);
        }

        attempts.push({
          attempt: attemptNumber,
          request: {
            systemPrompt: "[unknown: request failed before payload capture]",
            userPrompt: feedback ?? "[initial attempt]",
          },
          responseText: "",
          parsedOutput: null,
          schemaValid: false,
          schemaErrors: [structured ? message : `runtime: ${message}`],
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
          },
          latencyMs: 0,
          createdAt: new Date().toISOString(),
        });

        feedback = `The previous attempt failed: ${message}. Return a valid structured tool payload.`;
      }
    }

    return {
      extraction: null,
      attempts,
      promptHash,
      strategy: params.strategy,
      model: resolvedModel,
      schemaValid: false,
    };
  }
}

export function createClinicalExtractor(client: Pick<AnthropicExtractionClient, "extract">) {
  return new ClinicalExtractor(client);
}
