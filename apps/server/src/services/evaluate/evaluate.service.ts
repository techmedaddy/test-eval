import type { CaseEvaluation, ClinicalExtraction, Diagnosis, Medication } from "@test-evals/shared";
import { detectHallucinations, type HallucinationFlag } from "./hallucination.service";
import {
  normalizeBloodPressure,
  normalizeDose,
  normalizeMedicationFrequency,
  normalizeRoute,
  normalizeText,
  tokenize,
} from "./normalize";

const CHIEF_COMPLAINT_THRESHOLD = 0.2;
const ITEM_MATCH_THRESHOLD = 0.7;
const PLAN_MATCH_THRESHOLD = 0.55;
const DIAGNOSIS_MATCH_THRESHOLD = 0.65;
const TEMP_TOLERANCE_F = 0.2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, current) => acc + current, 0) / values.length;
}

export function fuzzyTokenSetScore(a: string | null | undefined, b: string | null | undefined): number {
  const setA = new Set(tokenize(a ?? ""));
  const setB = new Set(tokenize(b ?? ""));

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  return clamp01((2 * intersection) / (setA.size + setB.size));
}

function f1FromCounts(tp: number, predicted: number, gold: number): {
  precision: number;
  recall: number;
  f1: number;
} {
  if (predicted === 0 && gold === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }

  const precision = predicted === 0 ? 0 : tp / predicted;
  const recall = gold === 0 ? 0 : tp / gold;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision: clamp01(precision),
    recall: clamp01(recall),
    f1: clamp01(f1),
  };
}

function scoreChiefComplaint(predicted: string, gold: string): number {
  const score = fuzzyTokenSetScore(predicted, gold);
  return score < CHIEF_COMPLAINT_THRESHOLD ? 0 : score;
}

function equalNullableNumbers(
  predicted: number | null,
  gold: number | null,
  opts?: { tolerance?: number },
): number {
  if (predicted === null && gold === null) return 1;
  if (predicted === null || gold === null) return 0;

  if (typeof opts?.tolerance === "number") {
    return Math.abs(predicted - gold) <= opts.tolerance ? 1 : 0;
  }

  return predicted === gold ? 1 : 0;
}

function scoreVitals(predicted: ClinicalExtraction["vitals"], gold: ClinicalExtraction["vitals"]): number {
  const bpScore = normalizeBloodPressure(predicted.bp) === normalizeBloodPressure(gold.bp) ? 1 : 0;
  const hrScore = equalNullableNumbers(predicted.hr, gold.hr);
  const tempScore = equalNullableNumbers(predicted.temp_f, gold.temp_f, { tolerance: TEMP_TOLERANCE_F });
  const spo2Score = equalNullableNumbers(predicted.spo2, gold.spo2);

  return average([bpScore, hrScore, tempScore, spo2Score]);
}

function medicationsEquivalent(predicted: Medication, gold: Medication): boolean {
  const nameScore = fuzzyTokenSetScore(predicted.name, gold.name);
  const doseMatch = normalizeDose(predicted.dose) === normalizeDose(gold.dose);
  const frequencyMatch =
    normalizeMedicationFrequency(predicted.frequency) === normalizeMedicationFrequency(gold.frequency);

  if (nameScore < ITEM_MATCH_THRESHOLD) return false;
  if (!doseMatch || !frequencyMatch) return false;

  // Route disagreement does not fully reject when one side is missing.
  const predictedRoute = normalizeRoute(predicted.route);
  const goldRoute = normalizeRoute(gold.route);
  if (!predictedRoute || !goldRoute) return true;

  return predictedRoute === goldRoute;
}

function greedySetMatch<T>(
  predicted: T[],
  gold: T[],
  scoreFn: (p: T, g: T) => number,
  threshold: number,
): {
  truePositives: number;
  matchedPairs: Array<{ predicted: T; gold: T; score: number }>;
} {
  const matchedGold = new Set<number>();
  const matchedPairs: Array<{ predicted: T; gold: T; score: number }> = [];
  let truePositives = 0;

  predicted.forEach((predItem) => {
    let bestIdx = -1;
    let bestScore = 0;

    gold.forEach((goldItem, idx) => {
      if (matchedGold.has(idx)) return;

      const score = scoreFn(predItem, goldItem);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    if (bestIdx >= 0 && bestScore >= threshold) {
      matchedGold.add(bestIdx);
      truePositives += 1;
      matchedPairs.push({ predicted: predItem, gold: gold[bestIdx] as T, score: bestScore });
    }
  });

  return { truePositives, matchedPairs };
}

function scoreMedications(predicted: Medication[], gold: Medication[]) {
  const matched = greedySetMatch(
    predicted,
    gold,
    (p, g) => (medicationsEquivalent(p, g) ? 1 : fuzzyTokenSetScore(p.name, g.name)),
    1,
  );

  return f1FromCounts(matched.truePositives, predicted.length, gold.length);
}

function scoreDiagnoses(predicted: Diagnosis[], gold: Diagnosis[]) {
  const matched = greedySetMatch(
    predicted,
    gold,
    (p, g) => fuzzyTokenSetScore(p.description, g.description),
    DIAGNOSIS_MATCH_THRESHOLD,
  );

  const base = f1FromCounts(matched.truePositives, predicted.length, gold.length);

  const icdMatches = matched.matchedPairs.filter(({ predicted: p, gold: g }) => {
    const pIcd = normalizeText(p.icd10);
    const gIcd = normalizeText(g.icd10);

    if (!pIcd && !gIcd) return true;
    if (!pIcd || !gIcd) return false;

    return pIcd === gIcd;
  }).length;

  const icdBonus = gold.length === 0 ? 0 : clamp01((icdMatches / gold.length) * 0.1);

  return {
    precision: base.precision,
    recall: base.recall,
    f1: base.f1,
    icdBonus,
  };
}

function scorePlan(predicted: string[], gold: string[]) {
  const matched = greedySetMatch(predicted, gold, (p, g) => fuzzyTokenSetScore(p, g), PLAN_MATCH_THRESHOLD);
  return f1FromCounts(matched.truePositives, predicted.length, gold.length);
}

function scoreFollowUp(
  predicted: ClinicalExtraction["follow_up"],
  gold: ClinicalExtraction["follow_up"],
): number {
  const intervalScore = equalNullableNumbers(predicted.interval_days, gold.interval_days);

  const reasonScore =
    predicted.reason === null && gold.reason === null
      ? 1
      : fuzzyTokenSetScore(predicted.reason, gold.reason);

  return average([intervalScore, reasonScore]);
}

export function evaluateCase(
  predicted: ClinicalExtraction,
  gold: ClinicalExtraction,
  options?: { schemaInvalidEscaped?: boolean; hallucinationCount?: number },
): CaseEvaluation {
  const chiefComplaintScore = scoreChiefComplaint(predicted.chief_complaint, gold.chief_complaint);
  const vitalsScore = scoreVitals(predicted.vitals, gold.vitals);
  const medications = scoreMedications(predicted.medications, gold.medications);
  const diagnoses = scoreDiagnoses(predicted.diagnoses, gold.diagnoses);
  const plan = scorePlan(predicted.plan, gold.plan);
  const followUpScore = scoreFollowUp(predicted.follow_up, gold.follow_up);

  const aggregateScore = average([
    chiefComplaintScore,
    vitalsScore,
    medications.f1,
    clamp01(diagnoses.f1 + diagnoses.icdBonus),
    plan.f1,
    followUpScore,
  ]);

  return {
    aggregateScore,
    chiefComplaintScore,
    vitalsScore,
    medications,
    diagnoses,
    plan,
    followUpScore,
    hallucinationCount: options?.hallucinationCount ?? 0,
    schemaInvalidEscaped: options?.schemaInvalidEscaped ?? false,
  };
}

export function evaluateCaseWithGrounding(
  transcript: string,
  predicted: ClinicalExtraction,
  gold: ClinicalExtraction,
  options?: { schemaInvalidEscaped?: boolean },
): {
  evaluation: CaseEvaluation;
  hallucination: { flags: HallucinationFlag[]; count: number };
} {
  const hallucination = detectHallucinations(predicted, transcript);

  const evaluation = evaluateCase(predicted, gold, {
    schemaInvalidEscaped: options?.schemaInvalidEscaped ?? false,
    hallucinationCount: hallucination.count,
  });

  return {
    evaluation,
    hallucination,
  };
}
