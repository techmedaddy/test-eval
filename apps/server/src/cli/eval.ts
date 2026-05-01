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

function printUsage() {
  console.log(
    "Usage: bun run eval -- --strategy=zero_shot|few_shot|cot [--model=<model>] [--extract-case=case_001] [--retry-smoke]",
  );
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

const strategyArg = parseArg("strategy") ?? "zero_shot";
const modelArg = parseArg("model") ?? "claude-haiku-4-5-20251001";
const caseArg = parseArg("extract-case");
const retrySmoke = hasFlag("retry-smoke");

if (!listStrategies().includes(strategyArg as PromptStrategy)) {
  console.error(`Invalid strategy: ${strategyArg}`);
  printUsage();
  process.exit(1);
}

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

console.log("status=ok");
console.log("note=Extractor + retry + schema validation are wired. Use --retry-smoke or --extract-case=case_001.");
