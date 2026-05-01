import type { StrategyPromptBundle } from "../types";
import { BASE_SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, buildBundle } from "./common";

export const cotStrategy = buildBundle({
  strategy: "cot",
  systemPrompt: `${BASE_SYSTEM_PROMPT}\n\nMode: reasoning-first (private).\nUse an internal checklist before emitting output:\n- chief complaint grounded?\n- each vital explicit and schema-valid?\n- medications complete (name/dose/frequency/route)?\n- diagnoses grounded and non-duplicative?\n- plan items actionable and deduplicated?\n- follow-up interval/reason explicit or null?\n\nThink privately, then return only the tool payload.`,
  userPromptTemplate: USER_PROMPT_TEMPLATE,
  fewShotExamples: [],
}) satisfies StrategyPromptBundle;
