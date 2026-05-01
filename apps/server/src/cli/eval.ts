import { getStrategyBundle, listStrategies } from "@test-evals/llm";
import type { PromptStrategy } from "@test-evals/shared";

function parseArg(name: string): string | undefined {
  const arg = Bun.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg.slice(name.length + 3);
}

function printUsage() {
  console.log("Usage: bun run eval -- --strategy=zero_shot|few_shot|cot [--model=<model>]");
}

const strategyArg = parseArg("strategy") ?? "zero_shot";
const modelArg = parseArg("model") ?? "claude-haiku-4-5-20251001";

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
console.log(`prompt_hash_pending=true`);
console.log(`few_shot_examples=${bundle.fewShotExamples.length}`);
console.log("status=ok");
console.log("note=CLI wiring complete; runner/evaluator implementation follows in next phases.");
