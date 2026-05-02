import { eq } from "drizzle-orm";
import {
  createAnthropicExtractionClient,
  createClinicalExtractor,
  getStrategyBundle,
  listStrategies,
  type ExtractionCallResult,
} from "@test-evals/llm";
import type { ClinicalExtraction, PromptStrategy } from "@test-evals/shared";

function parseArg(name: string): string | undefined {
  const arg = Bun.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

function parseDatasetFilter(value: string | undefined): string[] | undefined {
  if (!value) return undefined;

  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return ids.length > 0 ? ids : undefined;
}

function printUsage() {
  console.log(
    "Usage: bun run eval -- --strategy=zero_shot|few_shot|cot [--model=<model>] [--dataset-filter=case_001,case_002] [--force] [--all-strategies] [--extract-case=case_001] [--retry-smoke]",
  );
}

function formatNumber(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(decimals);
}

function formatDurationMs(value: number | null): string {
  if (value === null) return "-";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

function calcDurationMs(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

type RunRow = {
  id: string;
  strategy: string;
  model: string;
  status: string;
  promptHash: string;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  schemaFailureCount: number;
  hallucinationCount: number;
  aggregateScore: number | null;
  chiefComplaintScore: number | null;
  vitalsScore: number | null;
  medicationsF1: number | null;
  diagnosesF1: number | null;
  diagnosesIcdBonus: number | null;
  planF1: number | null;
  followUpScore: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheWriteInputTokens: number;
  totalCostUsd: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
};

function printRunSummary(row: RunRow) {
  const durationMs = calcDurationMs(row.startedAt, row.completedAt);

  console.log("\n[eval:summary]");
  console.table([
    { metric: "aggregate_score", value: formatNumber(row.aggregateScore) },
    { metric: "chief_complaint", value: formatNumber(row.chiefComplaintScore) },
    { metric: "vitals", value: formatNumber(row.vitalsScore) },
    { metric: "medications_f1", value: formatNumber(row.medicationsF1) },
    { metric: "diagnoses_f1", value: formatNumber(row.diagnosesF1) },
    { metric: "diagnoses_icd_bonus", value: formatNumber(row.diagnosesIcdBonus) },
    { metric: "plan_f1", value: formatNumber(row.planF1) },
    { metric: "follow_up", value: formatNumber(row.followUpScore) },
    { metric: "schema_failures", value: row.schemaFailureCount },
    { metric: "hallucinations", value: row.hallucinationCount },
    { metric: "total_cost_usd", value: formatNumber(row.totalCostUsd, 6) },
    { metric: "input_tokens", value: row.totalInputTokens },
    { metric: "output_tokens", value: row.totalOutputTokens },
    { metric: "cache_read_input_tokens", value: row.totalCacheReadInputTokens },
    { metric: "cache_write_input_tokens", value: row.totalCacheWriteInputTokens },
    { metric: "duration", value: formatDurationMs(durationMs) },
    { metric: "status", value: row.status },
    { metric: "run_id", value: row.id },
    { metric: "prompt_hash", value: row.promptHash },
  ]);
}

async function runRetrySmoke(strategy: PromptStrategy, model: string) {
  let callCount = 0;

  const mockTransport = {
    async extract(): Promise<ExtractionCallResult> {
      callCount += 1;

      const invalidExtraction = {
        chief_complaint: "Cough",
        vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
        medications: [],
        diagnoses: [],
        plan: [],
        follow_up: { interval_days: "7", reason: null },
      } as unknown as ClinicalExtraction;

      const validExtraction: ClinicalExtraction = {
        chief_complaint: "Cough",
        vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
        medications: [],
        diagnoses: [],
        plan: ["Hydration"],
        follow_up: { interval_days: 7, reason: "If not improved" },
      };

      const extraction = callCount === 1 ? invalidExtraction : validExtraction;

      return {
        extraction,
        rawText: "mock-response",
        requestSystemPrompt: "mock-system",
        requestUserPrompt: "mock-user",
        promptHash: "mock-hash",
        strategy,
        model,
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadInputTokens: callCount > 1 ? 80 : 0,
          cacheWriteInputTokens: callCount === 1 ? 80 : 0,
        },
        latencyMs: 120,
      };
    },
  };

  const extractor = createClinicalExtractor(mockTransport);
  const result = await extractor.extractWithRetry({
    transcript: "mock transcript",
    strategy,
    model,
    maxAttempts: 3,
  });

  console.log("[eval:retry-smoke]");
  console.log(`schema_valid=${result.schemaValid}`);
  console.log(`attempts=${result.attempts.length}`);
  console.log(`prompt_hash=${result.promptHash}`);
  console.log(JSON.stringify(result.attempts, null, 2));
}

async function runSingleCase(strategy: PromptStrategy, model: string, caseId: string) {
  const transcriptPath = new URL(`../../../../data/transcripts/${caseId}.txt`, import.meta.url);
  const transcript = await Bun.file(transcriptPath).text();

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === "placeholder") {
    console.error("ANTHROPIC_API_KEY is missing or placeholder; cannot run real extraction.");
    process.exit(1);
  }

  const client = createAnthropicExtractionClient({ apiKey, defaultModel: model });
  const extractor = createClinicalExtractor(client);

  const result = await extractor.extractWithRetry({
    transcript,
    strategy,
    model,
    maxAttempts: 3,
  });

  console.log("[eval:single-case]");
  console.log(`case_id=${caseId}`);
  console.log(`schema_valid=${result.schemaValid}`);
  console.log(`attempts=${result.attempts.length}`);
  console.log(`prompt_hash=${result.promptHash}`);
  console.log(`model=${result.model}`);
  console.log(JSON.stringify(result.extraction, null, 2));
  console.log("attempt_logs=");
  console.log(JSON.stringify(result.attempts, null, 2));
}

async function waitForRunCompletion(runId: string): Promise<RunRow> {
  const pollIntervalMs = 1_500;
  let lastCompleted = -1;

  const [{ db }, { runs }] = await Promise.all([import("@test-evals/db"), import("@test-evals/db/schema/eval")]);

  for (;;) {
    const row = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!row) {
      throw new Error(`Run not found while polling: ${runId}`);
    }

    if (row.completedCases !== lastCompleted) {
      lastCompleted = row.completedCases;
      console.log(`[eval:progress] run=${runId} status=${row.status} ${row.completedCases}/${row.totalCases}`);
    }

    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
      return row;
    }

    await Bun.sleep(pollIntervalMs);
  }
}

async function runFullDatasetEval(params: {
  strategy: PromptStrategy;
  model: string;
  datasetFilter?: string[];
  force: boolean;
}): Promise<RunRow> {
  const { getRunnerService } = await import("../services/runner/runner.service");
  const runner = getRunnerService();

  const started = await runner.startRun({
    strategy: params.strategy,
    model: params.model,
    datasetFilter: params.datasetFilter,
    force: params.force,
  });

  console.log("[eval:run-started]");
  console.log(`run_id=${started.runId}`);
  console.log(`strategy=${params.strategy}`);
  console.log(`model=${params.model}`);
  console.log(`dataset_filter=${params.datasetFilter?.join(",") ?? "ALL"}`);
  console.log(`force=${params.force}`);

  const row = await waitForRunCompletion(started.runId);
  printRunSummary(row);

  if (row.status !== "completed") {
    console.error(`[eval:error] run ended with status=${row.status} error=${row.error ?? "n/a"}`);
    process.exit(1);
  }

  return row;
}

async function runAllStrategies(params: { model: string; datasetFilter?: string[]; force: boolean }) {
  const strategies = listStrategies();
  const rows: RunRow[] = [];

  for (const strategy of strategies) {
    const row = await runFullDatasetEval({
      strategy,
      model: params.model,
      datasetFilter: params.datasetFilter,
      force: params.force,
    });

    rows.push(row);
  }

  console.log("\n[eval:strategy-comparison]");
  console.table(
    rows.map((row) => ({
      strategy: row.strategy,
      model: row.model,
      status: row.status,
      aggregate: formatNumber(row.aggregateScore),
      chiefComplaint: formatNumber(row.chiefComplaintScore),
      vitals: formatNumber(row.vitalsScore),
      medicationsF1: formatNumber(row.medicationsF1),
      diagnosesF1: formatNumber(row.diagnosesF1),
      planF1: formatNumber(row.planF1),
      followUp: formatNumber(row.followUpScore),
      totalCostUsd: formatNumber(row.totalCostUsd, 6),
      inputTokens: row.totalInputTokens,
      outputTokens: row.totalOutputTokens,
      cacheReadInputTokens: row.totalCacheReadInputTokens,
      cacheWriteInputTokens: row.totalCacheWriteInputTokens,
      duration: formatDurationMs(calcDurationMs(row.startedAt, row.completedAt)),
      runId: row.id,
    })),
  );
}

const strategyArg = parseArg("strategy") ?? "zero_shot";
const modelArg = parseArg("model") ?? "claude-haiku-4-5-20251001";
const caseArg = parseArg("extract-case");
const retrySmoke = hasFlag("retry-smoke");
const allStrategies = hasFlag("all-strategies");
const force = hasFlag("force");
const datasetFilter = parseDatasetFilter(parseArg("dataset-filter"));

if (!allStrategies && !listStrategies().includes(strategyArg as PromptStrategy)) {
  console.error(`Invalid strategy: ${strategyArg}`);
  printUsage();
  process.exit(1);
}

if (allStrategies && (retrySmoke || caseArg)) {
  console.error("--all-strategies cannot be combined with --retry-smoke or --extract-case");
  process.exit(1);
}

if (!allStrategies) {
  const strategy = strategyArg as PromptStrategy;
  const bundle = getStrategyBundle(strategy);

  console.log("[eval:bootstrap]");
  console.log(`strategy=${strategy}`);
  console.log(`model=${modelArg}`);
  console.log(`few_shot_examples=${bundle.fewShotExamples.length}`);

  if (retrySmoke) {
    await runRetrySmoke(strategy, modelArg);
    process.exit(0);
  }

  if (caseArg) {
    await runSingleCase(strategy, modelArg, caseArg);
    process.exit(0);
  }

  await runFullDatasetEval({
    strategy,
    model: modelArg,
    datasetFilter,
    force,
  });
  process.exit(0);
}

console.log("[eval:bootstrap]");
console.log("mode=all-strategies");
console.log(`model=${modelArg}`);
console.log(`strategies=${listStrategies().join(",")}`);

await runAllStrategies({
  model: modelArg,
  datasetFilter,
  force,
});
