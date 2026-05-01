import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const runCaseStatusEnum = pgEnum("run_case_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    datasetFilter: jsonb("dataset_filter").$type<string[]>().default([]).notNull(),
    force: boolean("force").default(false).notNull(),
    status: runStatusEnum("status").default("queued").notNull(),

    totalCases: integer("total_cases").default(0).notNull(),
    completedCases: integer("completed_cases").default(0).notNull(),
    failedCases: integer("failed_cases").default(0).notNull(),

    schemaFailureCount: integer("schema_failure_count").default(0).notNull(),
    hallucinationCount: integer("hallucination_count").default(0).notNull(),

    aggregateScore: doublePrecision("aggregate_score"),
    chiefComplaintScore: doublePrecision("chief_complaint_score"),
    vitalsScore: doublePrecision("vitals_score"),
    medicationsPrecision: doublePrecision("medications_precision"),
    medicationsRecall: doublePrecision("medications_recall"),
    medicationsF1: doublePrecision("medications_f1"),
    diagnosesPrecision: doublePrecision("diagnoses_precision"),
    diagnosesRecall: doublePrecision("diagnoses_recall"),
    diagnosesF1: doublePrecision("diagnoses_f1"),
    diagnosesIcdBonus: doublePrecision("diagnoses_icd_bonus"),
    planPrecision: doublePrecision("plan_precision"),
    planRecall: doublePrecision("plan_recall"),
    planF1: doublePrecision("plan_f1"),
    followUpScore: doublePrecision("follow_up_score"),

    totalInputTokens: integer("total_input_tokens").default(0).notNull(),
    totalOutputTokens: integer("total_output_tokens").default(0).notNull(),
    totalCacheReadInputTokens: integer("total_cache_read_input_tokens").default(0).notNull(),
    totalCacheWriteInputTokens: integer("total_cache_write_input_tokens").default(0).notNull(),

    totalCostUsd: doublePrecision("total_cost_usd").default(0).notNull(),

    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    error: text("error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("runs_status_idx").on(table.status),
    index("runs_strategy_model_idx").on(table.strategy, table.model),
    index("runs_created_at_idx").on(table.createdAt),
  ],
);

export const runCases = pgTable(
  "run_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),

    status: runCaseStatusEnum("status").default("queued").notNull(),
    cacheHit: boolean("cache_hit").default(false).notNull(),

    prediction: jsonb("prediction").$type<unknown | null>(),
    gold: jsonb("gold").$type<unknown | null>(),
    evaluation: jsonb("evaluation").$type<unknown | null>(),

    aggregateScore: doublePrecision("aggregate_score"),
    chiefComplaintScore: doublePrecision("chief_complaint_score"),
    vitalsScore: doublePrecision("vitals_score"),
    medicationsPrecision: doublePrecision("medications_precision"),
    medicationsRecall: doublePrecision("medications_recall"),
    medicationsF1: doublePrecision("medications_f1"),
    diagnosesPrecision: doublePrecision("diagnoses_precision"),
    diagnosesRecall: doublePrecision("diagnoses_recall"),
    diagnosesF1: doublePrecision("diagnoses_f1"),
    diagnosesIcdBonus: doublePrecision("diagnoses_icd_bonus"),
    planPrecision: doublePrecision("plan_precision"),
    planRecall: doublePrecision("plan_recall"),
    planF1: doublePrecision("plan_f1"),
    followUpScore: doublePrecision("follow_up_score"),

    schemaInvalidEscaped: boolean("schema_invalid_escaped").default(false).notNull(),
    hallucinationCount: integer("hallucination_count").default(0).notNull(),

    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0).notNull(),
    cacheWriteInputTokens: integer("cache_write_input_tokens").default(0).notNull(),

    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    wallTimeMs: integer("wall_time_ms"),

    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    error: text("error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("run_cases_run_transcript_uidx").on(table.runId, table.transcriptId),
    index("run_cases_run_id_idx").on(table.runId),
    index("run_cases_status_idx").on(table.status),
    index("run_cases_transcript_id_idx").on(table.transcriptId),
  ],
);

export const runAttempts = pgTable(
  "run_attempts",
  {
    id: text("id").primaryKey(),
    runCaseId: text("run_case_id")
      .notNull()
      .references(() => runCases.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),

    requestSystemPrompt: text("request_system_prompt").notNull(),
    requestUserPrompt: text("request_user_prompt").notNull(),

    responseText: text("response_text").notNull(),
    parsedOutput: jsonb("parsed_output").$type<unknown | null>(),

    schemaValid: boolean("schema_valid").default(false).notNull(),
    schemaErrors: jsonb("schema_errors").$type<string[]>().default([]).notNull(),

    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0).notNull(),
    cacheWriteInputTokens: integer("cache_write_input_tokens").default(0).notNull(),

    latencyMs: integer("latency_ms").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("run_attempts_case_attempt_uidx").on(table.runCaseId, table.attemptNumber),
    index("run_attempts_run_case_idx").on(table.runCaseId),
  ],
);

export const extractionCache = pgTable(
  "extraction_cache",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    transcriptId: text("transcript_id").notNull(),
    promptHash: text("prompt_hash").notNull(),

    extraction: jsonb("extraction").$type<unknown>().notNull(),

    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0).notNull(),
    cacheWriteInputTokens: integer("cache_write_input_tokens").default(0).notNull(),

    costUsd: doublePrecision("cost_usd").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("extraction_cache_lookup_uidx").on(
      table.strategy,
      table.model,
      table.transcriptId,
      table.promptHash,
    ),
    index("extraction_cache_last_used_idx").on(table.lastUsedAt),
  ],
);

export const runsRelations = relations(runs, ({ many }) => ({
  cases: many(runCases),
}));

export const runCasesRelations = relations(runCases, ({ one, many }) => ({
  run: one(runs, {
    fields: [runCases.runId],
    references: [runs.id],
  }),
  attempts: many(runAttempts),
}));

export const runAttemptsRelations = relations(runAttempts, ({ one }) => ({
  runCase: one(runCases, {
    fields: [runAttempts.runCaseId],
    references: [runCases.id],
  }),
}));
