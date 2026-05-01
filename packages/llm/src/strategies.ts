import type { PromptStrategy } from "@test-evals/shared";
import type { StrategyPromptBundle } from "./types";

const SYSTEM_BASE = `You are a clinical extraction engine.\nReturn only data captured in the transcript.\nDo not invent values.\nUse null when unknown.`;

const USER_TEMPLATE = `Extract structured clinical data from this transcript:\n\n{{transcript}}`;

const zeroShotBundle: StrategyPromptBundle = {
  strategy: "zero_shot",
  systemPrompt: `${SYSTEM_BASE}\n\nUse concise phrasing.`,
  userPromptTemplate: USER_TEMPLATE,
  fewShotExamples: [],
};

const fewShotBundle: StrategyPromptBundle = {
  strategy: "few_shot",
  systemPrompt: `${SYSTEM_BASE}\n\nFollow output patterns shown in examples.`,
  userPromptTemplate: USER_TEMPLATE,
  fewShotExamples: [
    {
      transcript:
        "Pt with sore throat x3 days, temp 100.4F, HR 98, SpO2 99%. Taking ibuprofen 200 mg BID PO. Dx viral pharyngitis. Plan rest and fluids; follow up in 7 days if worse.",
      output: {
        chief_complaint: "Sore throat for 3 days",
        vitals: { bp: null, hr: 98, temp_f: 100.4, spo2: 99 },
        medications: [
          { name: "ibuprofen", dose: "200 mg", frequency: "BID", route: "PO" },
        ],
        diagnoses: [{ description: "Viral pharyngitis" }],
        plan: ["Rest", "Hydration"],
        follow_up: { interval_days: 7, reason: "If symptoms worsen" },
      },
    },
  ],
};

const cotBundle: StrategyPromptBundle = {
  strategy: "cot",
  systemPrompt: `${SYSTEM_BASE}\n\nReason privately about each field, then provide the final structured tool output only.`,
  userPromptTemplate: USER_TEMPLATE,
  fewShotExamples: [],
};

const strategyMap: Record<PromptStrategy, StrategyPromptBundle> = {
  zero_shot: zeroShotBundle,
  few_shot: fewShotBundle,
  cot: cotBundle,
};

export function getStrategyBundle(strategy: PromptStrategy): StrategyPromptBundle {
  return strategyMap[strategy];
}

export function listStrategies(): PromptStrategy[] {
  return ["zero_shot", "few_shot", "cot"];
}

export function renderUserPrompt(template: string, transcript: string): string {
  return template.replace("{{transcript}}", transcript);
}
