import type { StrategyPromptBundle } from "../types";

export const USER_PROMPT_TEMPLATE = `You are given a synthetic doctor-patient transcript.\n\nReturn the extraction by calling the provided tool exactly once.\nOnly include facts supported by the transcript.\nIf a value is not present, use null (or empty array where appropriate).\n\nTranscript:\n{{transcript}}`;

export const BASE_SYSTEM_PROMPT = `Task: structured clinical extraction for one encounter.\n\nCritical rules:\n1) Never hallucinate. Use only transcript-grounded facts.\n2) Keep wording concise and clinically neutral.\n3) Use null for unknown scalar values.\n4) Keep plan items atomic (one action per array item).\n5) Do not emit explanatory prose; respond via tool call payload only.`;

export function buildBundle(bundle: StrategyPromptBundle): StrategyPromptBundle {
  return bundle;
}
