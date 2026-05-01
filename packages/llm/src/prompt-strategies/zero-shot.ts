import type { StrategyPromptBundle } from "../types";
import { BASE_SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, buildBundle } from "./common";

export const zeroShotStrategy = buildBundle({
  strategy: "zero_shot",
  systemPrompt: `${BASE_SYSTEM_PROMPT}\n\nMode: zero-shot\n- Infer each field directly from transcript evidence.\n- Prefer abstention (null) over weak inference.`,
  userPromptTemplate: USER_PROMPT_TEMPLATE,
  fewShotExamples: [],
}) satisfies StrategyPromptBundle;
