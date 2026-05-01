import type { PromptStrategy } from "@test-evals/shared";
import type { StrategyPromptBundle } from "./types";
import { cotStrategy } from "./prompt-strategies/cot";
import { fewShotStrategy } from "./prompt-strategies/few-shot";
import { zeroShotStrategy } from "./prompt-strategies/zero-shot";

const registeredStrategies = [zeroShotStrategy, fewShotStrategy, cotStrategy] as const;

const strategyMap: Record<PromptStrategy, StrategyPromptBundle> = Object.fromEntries(
  registeredStrategies.map((bundle) => [bundle.strategy, bundle]),
) as Record<PromptStrategy, StrategyPromptBundle>;

export function registerableStrategyTemplate(bundle: StrategyPromptBundle): StrategyPromptBundle {
  return bundle;
}

export function listStrategies(): PromptStrategy[] {
  return Object.keys(strategyMap) as PromptStrategy[];
}

export function getStrategyBundle(strategy: PromptStrategy): StrategyPromptBundle {
  const bundle = strategyMap[strategy];

  if (!bundle) {
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  return bundle;
}

export function renderUserPrompt(template: string, transcript: string): string {
  return template.replace("{{transcript}}", transcript);
}
