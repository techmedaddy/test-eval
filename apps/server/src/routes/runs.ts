import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "@test-evals/db";
import { runAttempts, runCases, runs } from "@test-evals/db/schema/eval";
import { listStrategies } from "@test-evals/llm";
import type { PromptStrategy } from "@test-evals/shared";
import { getRunnerService } from "../services/runner/runner.service";
import { runnerProgressBus } from "../services/runner/progress-bus";

const createRunSchema = z.object({
  strategy: z.custom<PromptStrategy>((value) => {
    return typeof value === "string" && listStrategies().includes(value as PromptStrategy);
  }, "Invalid strategy"),
  model: z.string().min(1),
  dataset_filter: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
});

const listCasesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["queued", "running", "completed", "failed", "skipped"]).optional(),
  include_attempts: z.coerce.boolean().default(false),
});

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function calcDurationMs(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function summarizeRun(row: typeof runs.$inferSelect) {
  return {
    id: row.id,
    strategy: row.strategy,
    model: row.model,
    status: row.status,
    promptHash: row.promptHash,
    totalCases: row.totalCases,
    completedCases: row.completedCases,
    failedCases: row.failedCases,
    schemaFailureCount: row.schemaFailureCount,
    hallucinationCount: row.hallucinationCount,
    aggregateScore: row.aggregateScore,
    totalCostUsd: row.totalCostUsd,
    tokenUsage: {
      inputTokens: row.totalInputTokens,
      outputTokens: row.totalOutputTokens,
      cacheReadInputTokens: row.totalCacheReadInputTokens,
      cacheWriteInputTokens: row.totalCacheWriteInputTokens,
    },
    startedAt: toIsoOrNull(row.startedAt),
    completedAt: toIsoOrNull(row.completedAt),
    durationMs: calcDurationMs(row.startedAt, row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function winnerLabel(left: number | null, right: number | null): "left" | "right" | "tie" {
  if (left === null && right === null) return "tie";
  if (left === null) return "right";
  if (right === null) return "left";
  if (left === right) return "tie";
  return left > right ? "left" : "right";
}

export const runsRoutes = new Hono();

runsRoutes.post("/api/v1/runs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createRunSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request payload",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const runner = getRunnerService();

  const response = await runner.startRun({
    strategy: parsed.data.strategy,
    model: parsed.data.model,
    datasetFilter: parsed.data.dataset_filter,
    force: parsed.data.force,
  });

  return c.json(response, 202);
});

runsRoutes.get("/api/v1/runs", async (c) => {
  const parsed = listRunsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.issues }, 400);
  }

  const whereClause = parsed.data.status ? eq(runs.status, parsed.data.status) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.query.runs.findMany({
      where: whereClause,
      orderBy: (table, { desc: descFn }) => [descFn(table.createdAt)],
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    }),
    db
      .select({ value: count() })
      .from(runs)
      .where(whereClause),
  ]);

  return c.json({
    items: rows.map((row) => summarizeRun(row)),
    pagination: {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      total: totalRows[0]?.value ?? 0,
    },
  });
});

runsRoutes.get("/api/v1/runs/compare", async (c) => {
  const left = c.req.query("left");
  const right = c.req.query("right");

  if (!left || !right) {
    return c.json({ error: "Missing compare ids. Required query params: left, right" }, 400);
  }

  const [leftRun, rightRun] = await Promise.all([
    db.query.runs.findFirst({ where: eq(runs.id, left) }),
    db.query.runs.findFirst({ where: eq(runs.id, right) }),
  ]);

  if (!leftRun || !rightRun) {
    return c.json(
      {
        error: "Run not found",
        details: {
          leftFound: Boolean(leftRun),
          rightFound: Boolean(rightRun),
        },
      },
      404,
    );
  }

  const fields = [
    {
      key: "aggregateScore",
      label: "Overall",
      left: leftRun.aggregateScore,
      right: rightRun.aggregateScore,
    },
    {
      key: "chiefComplaintScore",
      label: "Chief complaint",
      left: leftRun.chiefComplaintScore,
      right: rightRun.chiefComplaintScore,
    },
    {
      key: "vitalsScore",
      label: "Vitals",
      left: leftRun.vitalsScore,
      right: rightRun.vitalsScore,
    },
    {
      key: "medicationsF1",
      label: "Medications F1",
      left: leftRun.medicationsF1,
      right: rightRun.medicationsF1,
    },
    {
      key: "diagnosesF1",
      label: "Diagnoses F1",
      left: leftRun.diagnosesF1,
      right: rightRun.diagnosesF1,
    },
    {
      key: "diagnosesIcdBonus",
      label: "Diagnoses ICD bonus",
      left: leftRun.diagnosesIcdBonus,
      right: rightRun.diagnosesIcdBonus,
    },
    {
      key: "planF1",
      label: "Plan F1",
      left: leftRun.planF1,
      right: rightRun.planF1,
    },
    {
      key: "followUpScore",
      label: "Follow up",
      left: leftRun.followUpScore,
      right: rightRun.followUpScore,
    },
  ].map((entry) => {
    const winner = winnerLabel(entry.left, entry.right);

    return {
      ...entry,
      delta: entry.left !== null && entry.right !== null ? entry.right - entry.left : null,
      winner,
    };
  });

  const winnerSummary = fields.reduce(
    (acc, field) => {
      acc[field.winner] += 1;
      return acc;
    },
    { left: 0, right: 0, tie: 0 },
  );

  return c.json({
    left: summarizeRun(leftRun),
    right: summarizeRun(rightRun),
    fields,
    winnerSummary,
  });
});

runsRoutes.get("/api/v1/runs/:id", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    return c.json({ error: "Missing run id" }, 400);
  }

  const [row, byStatusRows, cacheStatsRows] = await Promise.all([
    db.query.runs.findFirst({ where: eq(runs.id, runId) }),
    db
      .select({
        status: runCases.status,
        value: count(),
      })
      .from(runCases)
      .where(eq(runCases.runId, runId))
      .groupBy(runCases.status),
    db
      .select({
        cacheHits: sql<number>`count(*) filter (where ${runCases.cacheHit} = true)::int`,
        freshExtractions: sql<number>`count(*) filter (where ${runCases.cacheHit} = false and ${runCases.status} = 'completed')::int`,
      })
      .from(runCases)
      .where(eq(runCases.runId, runId)),
  ]);

  if (!row) {
    return c.json({ error: "Run not found" }, 404);
  }

  const byStatus = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const stat of byStatusRows) {
    if (stat.status in byStatus) {
      byStatus[stat.status] = stat.value;
    }
  }

  const cacheStats = cacheStatsRows[0] ?? { cacheHits: 0, freshExtractions: 0 };

  return c.json({
    ...summarizeRun(row),
    perFieldAggregate: {
      aggregateScore: row.aggregateScore,
      chiefComplaintScore: row.chiefComplaintScore,
      vitalsScore: row.vitalsScore,
      medicationsPrecision: row.medicationsPrecision,
      medicationsRecall: row.medicationsRecall,
      medicationsF1: row.medicationsF1,
      diagnosesPrecision: row.diagnosesPrecision,
      diagnosesRecall: row.diagnosesRecall,
      diagnosesF1: row.diagnosesF1,
      diagnosesIcdBonus: row.diagnosesIcdBonus,
      planPrecision: row.planPrecision,
      planRecall: row.planRecall,
      planF1: row.planF1,
      followUpScore: row.followUpScore,
    },
    caseStatusCounts: byStatus,
    extractionSourceSummary: {
      cacheHits: cacheStats.cacheHits,
      freshExtractions: cacheStats.freshExtractions,
    },
    datasetFilter: row.datasetFilter,
    force: row.force,
    error: row.error,
  });
});

runsRoutes.get("/api/v1/runs/:id/cases", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    return c.json({ error: "Missing run id" }, 400);
  }

  const parsed = listCasesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.issues }, 400);
  }

  const runRow = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!runRow) {
    return c.json({ error: "Run not found" }, 404);
  }

  const baseWhere = parsed.data.status
    ? and(eq(runCases.runId, runId), eq(runCases.status, parsed.data.status))
    : eq(runCases.runId, runId);

  const [rows, totalRows] = await Promise.all([
    db.query.runCases.findMany({
      where: baseWhere,
      orderBy: (table) => [asc(table.createdAt)],
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    }),
    db
      .select({ value: count() })
      .from(runCases)
      .where(baseWhere),
  ]);

  const caseIds = rows.map((row) => row.id);

  const attemptsByCase = new Map<string, Array<typeof runAttempts.$inferSelect>>();
  if (parsed.data.include_attempts && caseIds.length > 0) {
    const attempts = await db.query.runAttempts.findMany({
      where: inArray(runAttempts.runCaseId, caseIds),
      orderBy: (table) => [asc(table.attemptNumber)],
    });

    for (const attempt of attempts) {
      const group = attemptsByCase.get(attempt.runCaseId) ?? [];
      group.push(attempt);
      attemptsByCase.set(attempt.runCaseId, group);
    }
  }

  const attemptCounts = new Map<string, number>();
  if (!parsed.data.include_attempts && caseIds.length > 0) {
    const counts = await db
      .select({
        runCaseId: runAttempts.runCaseId,
        value: sql<number>`count(*)::int`,
      })
      .from(runAttempts)
      .where(inArray(runAttempts.runCaseId, caseIds))
      .groupBy(runAttempts.runCaseId);

    for (const row of counts) {
      attemptCounts.set(row.runCaseId, row.value);
    }
  }

  return c.json({
    runId,
    items: rows.map((row) => ({
      id: row.id,
      transcriptId: row.transcriptId,
      status: row.status,
      cacheHit: row.cacheHit,
      extractionSource: row.cacheHit ? "cache" : "fresh",
      aggregateScore: row.aggregateScore,
      chiefComplaintScore: row.chiefComplaintScore,
      vitalsScore: row.vitalsScore,
      medications: {
        precision: row.medicationsPrecision,
        recall: row.medicationsRecall,
        f1: row.medicationsF1,
      },
      diagnoses: {
        precision: row.diagnosesPrecision,
        recall: row.diagnosesRecall,
        f1: row.diagnosesF1,
        icdBonus: row.diagnosesIcdBonus,
      },
      plan: {
        precision: row.planPrecision,
        recall: row.planRecall,
        f1: row.planF1,
      },
      followUpScore: row.followUpScore,
      schemaInvalidEscaped: row.schemaInvalidEscaped,
      hallucinationCount: row.hallucinationCount,
      tokenUsage: {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadInputTokens: row.cacheReadInputTokens,
        cacheWriteInputTokens: row.cacheWriteInputTokens,
      },
      costUsd: row.costUsd,
      wallTimeMs: row.wallTimeMs,
      startedAt: toIsoOrNull(row.startedAt),
      completedAt: toIsoOrNull(row.completedAt),
      error: row.error,
      prediction: row.prediction,
      gold: row.gold,
      evaluation: row.evaluation,
      attempts: parsed.data.include_attempts
        ? (attemptsByCase.get(row.id) ?? []).map((attempt) => ({
            id: attempt.id,
            attemptNumber: attempt.attemptNumber,
            requestSystemPrompt: attempt.requestSystemPrompt,
            requestUserPrompt: attempt.requestUserPrompt,
            responseText: attempt.responseText,
            parsedOutput: attempt.parsedOutput,
            schemaValid: attempt.schemaValid,
            schemaErrors: attempt.schemaErrors,
            tokenUsage: {
              inputTokens: attempt.inputTokens,
              outputTokens: attempt.outputTokens,
              cacheReadInputTokens: attempt.cacheReadInputTokens,
              cacheWriteInputTokens: attempt.cacheWriteInputTokens,
            },
            latencyMs: attempt.latencyMs,
            createdAt: attempt.createdAt.toISOString(),
          }))
        : undefined,
      attemptCount: parsed.data.include_attempts
        ? (attemptsByCase.get(row.id) ?? []).length
        : (attemptCounts.get(row.id) ?? 0),
    })),
    pagination: {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      total: totalRows[0]?.value ?? 0,
    },
    runStatus: runRow.status,
  });
});

runsRoutes.get("/api/v1/runs/:id/events", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    return c.json({ error: "Missing run id" }, 400);
  }

  const runRow = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!runRow) {
    return c.json({ error: "Run not found" }, 404);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (eventName: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      emit("connected", {
        runId,
        status: runRow.status,
        at: new Date().toISOString(),
      });

      const unsubscribe = runnerProgressBus.subscribe(runId, (event) => {
        emit(event.type, event);
      });

      const heartbeat = setInterval(() => {
        emit("ping", {
          runId,
          at: new Date().toISOString(),
        });
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore stream close races
        }
      };

      c.req.raw.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

runsRoutes.post("/api/v1/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    return c.json({ error: "Missing run id" }, 400);
  }

  const runner = getRunnerService();

  try {
    const response = await runner.resumeRun(runId);
    return c.json(response, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resume run";
    return c.json({ error: message }, 404);
  }
});
