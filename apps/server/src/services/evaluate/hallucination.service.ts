import type { ClinicalExtraction } from "@test-evals/shared";
import { normalizeText, tokenize } from "./normalize";

export interface HallucinationFlag {
  fieldPath: string;
  value: string;
  grounded: boolean;
  score: number;
  method: "substring" | "token-coverage" | "none";
}

function fuzzyTokenCoverageScore(candidate: string, transcript: string): number {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 1;

  const transcriptTokenSet = new Set(tokenize(transcript));
  if (transcriptTokenSet.size === 0) return 0;

  let found = 0;
  for (const token of candidateTokens) {
    if (transcriptTokenSet.has(token)) {
      found += 1;
    }
  }

  return found / candidateTokens.length;
}

function checkGrounding(value: string, transcript: string): Omit<HallucinationFlag, "fieldPath" | "value"> {
  const normalizedValue = normalizeText(value);
  const normalizedTranscript = normalizeText(transcript);

  if (!normalizedValue) {
    return {
      grounded: true,
      score: 1,
      method: "none",
    };
  }

  if (normalizedTranscript.includes(normalizedValue)) {
    return {
      grounded: true,
      score: 1,
      method: "substring",
    };
  }

  const coverage = fuzzyTokenCoverageScore(normalizedValue, normalizedTranscript);
  const grounded = coverage >= 0.75;

  return {
    grounded,
    score: coverage,
    method: "token-coverage",
  };
}

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  return "";
}

export function detectHallucinations(
  prediction: ClinicalExtraction,
  transcript: string,
): {
  flags: HallucinationFlag[];
  count: number;
} {
  const entries: Array<{ fieldPath: string; rawValue: unknown }> = [
    { fieldPath: "chief_complaint", rawValue: prediction.chief_complaint },
    { fieldPath: "vitals.bp", rawValue: prediction.vitals.bp },
    { fieldPath: "vitals.hr", rawValue: prediction.vitals.hr },
    { fieldPath: "vitals.temp_f", rawValue: prediction.vitals.temp_f },
    { fieldPath: "vitals.spo2", rawValue: prediction.vitals.spo2 },
    { fieldPath: "follow_up.interval_days", rawValue: prediction.follow_up.interval_days },
    { fieldPath: "follow_up.reason", rawValue: prediction.follow_up.reason },
  ];

  prediction.medications.forEach((med, index) => {
    entries.push({ fieldPath: `medications[${index}].name`, rawValue: med.name });
    entries.push({ fieldPath: `medications[${index}].dose`, rawValue: med.dose });
    entries.push({ fieldPath: `medications[${index}].frequency`, rawValue: med.frequency });
    entries.push({ fieldPath: `medications[${index}].route`, rawValue: med.route });
  });

  prediction.diagnoses.forEach((dx, index) => {
    entries.push({ fieldPath: `diagnoses[${index}].description`, rawValue: dx.description });
    entries.push({ fieldPath: `diagnoses[${index}].icd10`, rawValue: dx.icd10 ?? "" });
  });

  prediction.plan.forEach((item, index) => {
    entries.push({ fieldPath: `plan[${index}]`, rawValue: item });
  });

  const flags: HallucinationFlag[] = entries
    .map(({ fieldPath, rawValue }) => {
      const value = toStringValue(rawValue);
      if (!normalizeText(value)) {
        return null;
      }

      const check = checkGrounding(value, transcript);
      return {
        fieldPath,
        value,
        ...check,
      } as HallucinationFlag;
    })
    .filter((flag): flag is HallucinationFlag => Boolean(flag));

  return {
    flags,
    count: flags.filter((flag) => !flag.grounded).length,
  };
}
