import type { StrategyPromptBundle } from "../types";
import { BASE_SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, buildBundle } from "./common";

export const fewShotStrategy = buildBundle({
  strategy: "few_shot",
  systemPrompt: `${BASE_SYSTEM_PROMPT}\n\nMode: few-shot\n- Match output style and normalization shown in examples.\n- Keep dosage/frequency normalized but faithful to text.`,
  userPromptTemplate: USER_PROMPT_TEMPLATE,
  fewShotExamples: [
    {
      transcript:
        "Patient reports sore throat and low-grade fever for 3 days. HR 98, temp 100.4F, SpO2 99%. Taking ibuprofen 200 mg BID by mouth. Assessment viral pharyngitis. Plan rest, hydration, return in 7 days if not improving.",
      output: {
        chief_complaint: "Sore throat with low-grade fever for 3 days",
        vitals: { bp: null, hr: 98, temp_f: 100.4, spo2: 99 },
        medications: [{ name: "ibuprofen", dose: "200 mg", frequency: "BID", route: "PO" }],
        diagnoses: [{ description: "Viral pharyngitis" }],
        plan: ["Rest", "Hydration"],
        follow_up: { interval_days: 7, reason: "If not improving" },
      },
    },
    {
      transcript:
        "Follow-up for hypertension. BP 148/92 in clinic. Denies chest pain or shortness of breath. Continues lisinopril 10mg once daily PO. Add home BP log and low-salt diet. Recheck in 14 days.",
      output: {
        chief_complaint: "Follow-up for hypertension",
        vitals: { bp: "148/92", hr: null, temp_f: null, spo2: null },
        medications: [
          { name: "lisinopril", dose: "10 mg", frequency: "once daily", route: "PO" },
        ],
        diagnoses: [{ description: "Hypertension" }],
        plan: ["Maintain home blood pressure log", "Low-salt diet"],
        follow_up: { interval_days: 14, reason: "Blood pressure reassessment" },
      },
    },
  ],
}) satisfies StrategyPromptBundle;
