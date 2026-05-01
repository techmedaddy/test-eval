import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@test-evals/db";
import { extractionCache, runAttempts, runCases, runs } from "@test-evals/db/schema/eval";
import { createAnthropicExtractionClient, createClinicalExtractor, RateLimitError } from "@test-evals/llm";
import type { ClinicalExtraction, PromptStrategy } from "@test-evals/shared";
import type { RunCreateRequest } from "@test-evals/shared";
import { env } from "@test-evals/env/server";
import { aggregateEvaluations } from "../evaluate/aggregate.service";
import { evaluateCaseWithGrounding } from "../evaluate/evaluate.service";
import { estimateCostUsd } from "./cost";
import { listDatasetCaseIds, loadDatasetCase } from "./dataset";
import { runnerProgressBus } from "./progress-bus";

const MAX_CASE_CONCURRENCY = 5;
const MAX_RATE_LIMIT_RETRIES = 4;
const BASE_BACKOFF_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(base: number): number {
  return Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.3)));
}

function sumAttemptUsage(
  attempts: Array<{
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    };
  }>,
) {
  return attempts.reduce(
    (acc, attempt) => {
      acc.inputTokens += attempt.tokenUsage.inputTokens;
      acc.outputTokens += attempt.tokenUsage.outputTokens;
      acc.cacheReadInputTokens += attempt.tokenUsage.cacheReadInputTokens;
      acc.cacheWriteInputTokens += attempt.tokenUsage.cacheWriteInputTokens;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
  );
}

export class RunnerService {
  private readonly extractor = createClinicalExtractor(
    createAnthropicExtractionClient({
      apiKey: env.ANTHROPIC_API_KEY,
    }),
  );

  async startRun(payload: RunCreateRequest): Promise<{ runId: string; status: string }> {
    const availableCaseIds = await listDatasetCaseIds();
    const selectedCaseIds =
      payload.datasetFilter && payload.datasetFilter.length > 0
        ? availableCaseIds.filter((id) => payload.datasetFilter?.includes(id))
        : availableCaseIds;

    const runId = randomUUID();
    const now = new Date();

    await db.insert(runs).values({
      id: runId,
      strategy: payload.strategy,
      model: payload.model,
      promptHash: "pending",
      datasetFilter: payload.datasetFilter ?? [],
      force: payload.force ?? false,
      totalCases: selectedCaseIds.length,
      completedCases: 0,
      failedCases: 0,
      status: "queued",
      startedAt: now,
    });

    if (selectedCaseIds.length > 0) {
      await db.insert(runCases).values(
        selectedCaseIds.map((transcriptId) => ({
          id: randomUUID(),
          runId,
          transcriptId,
          status: "queued" as const,
        })),
      );
    }

    void this.executeRun(runId);

    return {
      runId,
      status: "queued",
    };
  }

  async resumeRun(runId: string): Promise<{ runId: string; status: string }> {
    const runRow = await db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!runRow) {
      throw new Error(`Run not found: ${runId}`);
    }

    await db
      .update(runs)
      .set({
        status: "running",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    void this.executeRun(runId);

    return {
      runId,
      status: "running",
    };
  }

  private async executeRun(runId: string): Promise<void> {
    try {
      await db
        .update(runs)
        .set({
          status: "running",
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId));

      const runRow = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
      if (!runRow) return;

      runnerProgressBus.publish(runId, {
        type: "run_started",
        runId,
        at: new Date().toISOString(),
      });

      const pendingCases = await db.query.runCases.findMany({
        where: and(eq(runCases.runId, runId), inArray(runCases.status, ["queued", "running"])),
        orderBy: (table, { asc }) => [asc(table.createdAt)],
      });

      if (pendingCases.length === 0) {
        await this.finalizeRun(runId);
        return;
      }

      let cursor = 0;
      const workerCount = Math.min(MAX_CASE_CONCURRENCY, pendingCases.length);

      const worker = async () => {
        while (cursor < pendingCases.length) {
          const currentIdx = cursor;
          cursor += 1;

          const runCase = pendingCases[currentIdx];
          if (!runCase) continue;

          await this.processRunCase({
            model: runRow.model,
            strategy: runRow.strategy as PromptStrategy,
            runId,
            runCaseId: runCase.id,
            transcriptId: runCase.transcriptId,
            force: runRow.force,
          });
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      await this.finalizeRun(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run execution failed";

      await db
        .update(runs)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId));

      runnerProgressBus.publish(runId, {
        type: "run_failed",
        runId,
        status: "failed",
        error: message,
        at: new Date().toISOString(),
      });
    }
  }

  private async extractCaseWithBackoff(params: {
    transcript: string;
    strategy: PromptStrategy;
    model: string;
    runId: string;
    transcriptId: string;
  }) {
    for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        return await this.extractor.extractWithRetry({
          transcript: params.transcript,
          strategy: params.strategy,
          model: params.model,
          maxAttempts: 3,
        });
      } catch (error) {
        const isRateLimit = error instanceof RateLimitError;

        if (!isRateLimit || attempt === MAX_RATE_LIMIT_RETRIES - 1) {
          throw error;
        }

        const delay = BASE_BACKOFF_MS * 2 ** attempt + jitterMs(BASE_BACKOFF_MS);
        console.warn(
          JSON.stringify({
            event: "runner.rate_limit_backoff",
            runId: params.runId,
            transcriptId: params.transcriptId,
            strategy: params.strategy,
            model: params.model,
            retryAttempt: attempt + 1,
            maxRetries: MAX_RATE_LIMIT_RETRIES,
            delayMs: delay,
          }),
        );
        await sleep(delay);
      }
    }

    throw new Error("Unreachable backoff state");
  }

  private async tryUseCachedExtraction(params: {
    strategy: PromptStrategy;
    model: string;
    transcriptId: string;
    force: boolean;
  }): Promise<{ extraction: ClinicalExtraction; promptHash: string } | null> {
    if (params.force) {
      return null;
    }

    const cached = await db.query.extractionCache.findFirst({
      where: and(
        eq(extractionCache.strategy, params.strategy),
        eq(extractionCache.model, params.model),
        eq(extractionCache.transcriptId, params.transcriptId),
      ),
      orderBy: (table) => [desc(table.lastUsedAt)],
    });

    if (!cached) {
      return null;
    }

    await db
      .update(extractionCache)
      .set({
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(extractionCache.id, cached.id));

    return {
      extraction: cached.extraction as ClinicalExtraction,
      promptHash: cached.promptHash,
    };
  }

  private async publishCaseProgress(params: {
    runId: string;
    transcriptId: string;
    cacheHit: boolean;
    source: "cache" | "fresh";
  }): Promise<void> {
    const row = await db.query.runs.findFirst({ where: eq(runs.id, params.runId) });
    if (!row) return;

    runnerProgressBus.publish(params.runId, {
      type: "case_completed",
      runId: params.runId,
      transcriptId: params.transcriptId,
      completed: row.completedCases,
      total: row.totalCases,
      cacheHit: params.cacheHit,
      source: params.source,
      at: new Date().toISOString(),
    });
  }

  private async processRunCase(params: {
    model: string;
    strategy: PromptStrategy;
    runId: string;
    runCaseId: string;
    transcriptId: string;
    force: boolean;
  }): Promise<void> {
    const startedMs = Date.now();

    await db
      .update(runCases)
      .set({
        status: "running",
        startedAt: new Date(),
        error: null,
      })
      .where(eq(runCases.id, params.runCaseId));

    await db.delete(runAttempts).where(eq(runAttempts.runCaseId, params.runCaseId));

    try {
      const data = await loadDatasetCase(params.transcriptId);
      const cached = await this.tryUseCachedExtraction({
        strategy: params.strategy,
        model: params.model,
        transcriptId: params.transcriptId,
        force: params.force,
      });

      if (cached) {
        const scored = evaluateCaseWithGrounding(data.transcript, cached.extraction, data.gold);

        await db
          .update(runCases)
          .set({
            status: "completed",
            cacheHit: true,
            prediction: cached.extraction,
            gold: data.gold,
            evaluation: scored.evaluation,
            aggregateScore: scored.evaluation.aggregateScore,
            chiefComplaintScore: scored.evaluation.chiefComplaintScore,
            vitalsScore: scored.evaluation.vitalsScore,
            medicationsPrecision: scored.evaluation.medications.precision,
            medicationsRecall: scored.evaluation.medications.recall,
            medicationsF1: scored.evaluation.medications.f1,
            diagnosesPrecision: scored.evaluation.diagnoses.precision,
            diagnosesRecall: scored.evaluation.diagnoses.recall,
            diagnosesF1: scored.evaluation.diagnoses.f1,
            diagnosesIcdBonus: scored.evaluation.diagnoses.icdBonus,
            planPrecision: scored.evaluation.plan.precision,
            planRecall: scored.evaluation.plan.recall,
            planF1: scored.evaluation.plan.f1,
            followUpScore: scored.evaluation.followUpScore,
            schemaInvalidEscaped: false,
            hallucinationCount: scored.hallucination.count,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            costUsd: 0,
            wallTimeMs: Date.now() - startedMs,
            completedAt: new Date(),
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(runCases.id, params.runCaseId));

        await db
          .update(runs)
          .set({
            completedCases: sql`${runs.completedCases} + 1`,
            promptHash: cached.promptHash,
            hallucinationCount: sql`${runs.hallucinationCount} + ${scored.hallucination.count}`,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, params.runId));

        await this.publishCaseProgress({
          runId: params.runId,
          transcriptId: params.transcriptId,
          cacheHit: true,
          source: "cache",
        });
        return;
      }

      const extraction = await this.extractCaseWithBackoff({
        transcript: data.transcript,
        strategy: params.strategy,
        model: params.model,
        runId: params.runId,
        transcriptId: params.transcriptId,
      });

      if (!extraction.promptHash) {
        throw new Error("Missing prompt hash from extraction");
      }

      await db
        .update(runs)
        .set({
          promptHash: extraction.promptHash,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, params.runId));

      if (extraction.attempts.length > 0) {
        await db.insert(runAttempts).values(
          extraction.attempts.map((attempt) => ({
            id: randomUUID(),
            runCaseId: params.runCaseId,
            attemptNumber: attempt.attempt,
            requestSystemPrompt: attempt.request.systemPrompt,
            requestUserPrompt: attempt.request.userPrompt,
            responseText: attempt.responseText,
            parsedOutput: attempt.parsedOutput,
            schemaValid: attempt.schemaValid,
            schemaErrors: attempt.schemaErrors,
            inputTokens: attempt.tokenUsage.inputTokens,
            outputTokens: attempt.tokenUsage.outputTokens,
            cacheReadInputTokens: attempt.tokenUsage.cacheReadInputTokens,
            cacheWriteInputTokens: attempt.tokenUsage.cacheWriteInputTokens,
            latencyMs: attempt.latencyMs,
            createdAt: new Date(attempt.createdAt),
          })),
        );
      }

      const usage = sumAttemptUsage(extraction.attempts);
      const wallTimeMs = Date.now() - startedMs;
      const costUsd = estimateCostUsd(params.model, usage);

      if (!extraction.extraction || !extraction.schemaValid) {
        await db
          .update(runCases)
          .set({
            status: "failed",
            cacheHit: false,
            prediction: extraction.extraction,
            gold: data.gold,
            evaluation: null,
            schemaInvalidEscaped: true,
            hallucinationCount: 0,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
            costUsd,
            wallTimeMs,
            completedAt: new Date(),
            error: "Schema invalid after retry loop",
            updatedAt: new Date(),
          })
          .where(eq(runCases.id, params.runCaseId));

        await db
          .update(runs)
          .set({
            completedCases: sql`${runs.completedCases} + 1`,
            failedCases: sql`${runs.failedCases} + 1`,
            schemaFailureCount: sql`${runs.schemaFailureCount} + 1`,
            totalInputTokens: sql`${runs.totalInputTokens} + ${usage.inputTokens}`,
            totalOutputTokens: sql`${runs.totalOutputTokens} + ${usage.outputTokens}`,
            totalCacheReadInputTokens: sql`${runs.totalCacheReadInputTokens} + ${usage.cacheReadInputTokens}`,
            totalCacheWriteInputTokens: sql`${runs.totalCacheWriteInputTokens} + ${usage.cacheWriteInputTokens}`,
            totalCostUsd: sql`${runs.totalCostUsd} + ${costUsd}`,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, params.runId));

        await this.publishCaseProgress({
          runId: params.runId,
          transcriptId: params.transcriptId,
          cacheHit: false,
          source: "fresh",
        });
        return;
      }

      await db
        .insert(extractionCache)
        .values({
          id: randomUUID(),
          strategy: params.strategy,
          model: params.model,
          transcriptId: params.transcriptId,
          promptHash: extraction.promptHash,
          extraction: extraction.extraction,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
          costUsd,
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            extractionCache.strategy,
            extractionCache.model,
            extractionCache.transcriptId,
            extractionCache.promptHash,
          ],
          set: {
            extraction: extraction.extraction,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
            costUsd,
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      const scored = evaluateCaseWithGrounding(data.transcript, extraction.extraction, data.gold);

      await db
        .update(runCases)
        .set({
          status: "completed",
          cacheHit: false,
          prediction: extraction.extraction,
          gold: data.gold,
          evaluation: scored.evaluation,
          aggregateScore: scored.evaluation.aggregateScore,
          chiefComplaintScore: scored.evaluation.chiefComplaintScore,
          vitalsScore: scored.evaluation.vitalsScore,
          medicationsPrecision: scored.evaluation.medications.precision,
          medicationsRecall: scored.evaluation.medications.recall,
          medicationsF1: scored.evaluation.medications.f1,
          diagnosesPrecision: scored.evaluation.diagnoses.precision,
          diagnosesRecall: scored.evaluation.diagnoses.recall,
          diagnosesF1: scored.evaluation.diagnoses.f1,
          diagnosesIcdBonus: scored.evaluation.diagnoses.icdBonus,
          planPrecision: scored.evaluation.plan.precision,
          planRecall: scored.evaluation.plan.recall,
          planF1: scored.evaluation.plan.f1,
          followUpScore: scored.evaluation.followUpScore,
          schemaInvalidEscaped: false,
          hallucinationCount: scored.hallucination.count,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
          costUsd,
          wallTimeMs,
          completedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(runCases.id, params.runCaseId));

      await db
        .update(runs)
        .set({
          completedCases: sql`${runs.completedCases} + 1`,
          hallucinationCount: sql`${runs.hallucinationCount} + ${scored.hallucination.count}`,
          totalInputTokens: sql`${runs.totalInputTokens} + ${usage.inputTokens}`,
          totalOutputTokens: sql`${runs.totalOutputTokens} + ${usage.outputTokens}`,
          totalCacheReadInputTokens: sql`${runs.totalCacheReadInputTokens} + ${usage.cacheReadInputTokens}`,
          totalCacheWriteInputTokens: sql`${runs.totalCacheWriteInputTokens} + ${usage.cacheWriteInputTokens}`,
          totalCostUsd: sql`${runs.totalCostUsd} + ${costUsd}`,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, params.runId));

      await this.publishCaseProgress({
        runId: params.runId,
        transcriptId: params.transcriptId,
        cacheHit: false,
        source: "fresh",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Case execution failed";

      const wallTimeMs = Date.now() - startedMs;

      await db
        .update(runCases)
        .set({
          status: "failed",
          cacheHit: false,
          completedAt: new Date(),
          wallTimeMs,
          error: message,
          updatedAt: new Date(),
        })
        .where(eq(runCases.id, params.runCaseId));

      await db
        .update(runs)
        .set({
          completedCases: sql`${runs.completedCases} + 1`,
          failedCases: sql`${runs.failedCases} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, params.runId));

      await this.publishCaseProgress({
        runId: params.runId,
        transcriptId: params.transcriptId,
        cacheHit: false,
        source: "fresh",
      });
    }
  }

  private async finalizeRun(runId: string): Promise<void> {
    const allCases = await db.query.runCases.findMany({
      where: eq(runCases.runId, runId),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });

    const evaluatedCases = allCases
      .filter((row) => row.evaluation)
      .map((row) => ({
        transcriptId: row.transcriptId,
        evaluation: row.evaluation as any,
        tokenUsage: {
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadInputTokens: row.cacheReadInputTokens,
          cacheWriteInputTokens: row.cacheWriteInputTokens,
        },
        costUsd: row.costUsd,
        wallTimeMs: row.wallTimeMs ?? 0,
      }));

    const aggregated = aggregateEvaluations(evaluatedCases as any);

    const failedCases = allCases.filter((row) => row.status === "failed").length;
    const finalStatus = failedCases > 0 ? "failed" : "completed";

    await db
      .update(runs)
      .set({
        status: finalStatus,
        aggregateScore: aggregated.perField.aggregateScore,
        chiefComplaintScore: aggregated.perField.chiefComplaintScore,
        vitalsScore: aggregated.perField.vitalsScore,
        medicationsF1: aggregated.perField.medicationsF1,
        diagnosesF1: aggregated.perField.diagnosesF1,
        diagnosesIcdBonus: aggregated.perField.diagnosesIcdBonus,
        planF1: aggregated.perField.planF1,
        followUpScore: aggregated.perField.followUpScore,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    if (finalStatus === "failed") {
      runnerProgressBus.publish(runId, {
        type: "run_failed",
        runId,
        status: "failed",
        at: new Date().toISOString(),
      });
      return;
    }

    runnerProgressBus.publish(runId, {
      type: "run_completed",
      runId,
      status: "completed",
      at: new Date().toISOString(),
    });
  }
}

let singletonRunnerService: RunnerService | null = null;

export function getRunnerService(): RunnerService {
  if (!singletonRunnerService) {
    singletonRunnerService = new RunnerService();
  }

  return singletonRunnerService;
}
