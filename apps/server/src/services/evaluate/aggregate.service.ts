import type { CaseEvaluation, LLMTokenUsage } from "@test-evals/shared";

export interface AggregateInputCase {
  transcriptId: string;
  evaluation: CaseEvaluation;
  tokenUsage?: Partial<LLMTokenUsage>;
  costUsd?: number;
  wallTimeMs?: number;
}

export interface RunAggregateOutput {
  totalCases: number;
  perField: {
    aggregateScore: number;
    chiefComplaintScore: number;
    vitalsScore: number;
    medicationsF1: number;
    diagnosesF1: number;
    diagnosesIcdBonus: number;
    planF1: number;
    followUpScore: number;
  };
  summary: {
    hallucinationCount: number;
    schemaFailureCount: number;
    totalCostUsd: number;
    totalWallTimeMs: number;
    tokenUsage: LLMTokenUsage;
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function aggregateEvaluations(cases: AggregateInputCase[]): RunAggregateOutput {
  return {
    totalCases: cases.length,
    perField: {
      aggregateScore: avg(cases.map((item) => item.evaluation.aggregateScore)),
      chiefComplaintScore: avg(cases.map((item) => item.evaluation.chiefComplaintScore)),
      vitalsScore: avg(cases.map((item) => item.evaluation.vitalsScore)),
      medicationsF1: avg(cases.map((item) => item.evaluation.medications.f1)),
      diagnosesF1: avg(cases.map((item) => item.evaluation.diagnoses.f1)),
      diagnosesIcdBonus: avg(cases.map((item) => item.evaluation.diagnoses.icdBonus)),
      planF1: avg(cases.map((item) => item.evaluation.plan.f1)),
      followUpScore: avg(cases.map((item) => item.evaluation.followUpScore)),
    },
    summary: {
      hallucinationCount: cases.reduce((sum, item) => sum + item.evaluation.hallucinationCount, 0),
      schemaFailureCount: cases.reduce(
        (sum, item) => sum + (item.evaluation.schemaInvalidEscaped ? 1 : 0),
        0,
      ),
      totalCostUsd: cases.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
      totalWallTimeMs: cases.reduce((sum, item) => sum + (item.wallTimeMs ?? 0), 0),
      tokenUsage: {
        inputTokens: cases.reduce((sum, item) => sum + (item.tokenUsage?.inputTokens ?? 0), 0),
        outputTokens: cases.reduce((sum, item) => sum + (item.tokenUsage?.outputTokens ?? 0), 0),
        cacheReadInputTokens: cases.reduce(
          (sum, item) => sum + (item.tokenUsage?.cacheReadInputTokens ?? 0),
          0,
        ),
        cacheWriteInputTokens: cases.reduce(
          (sum, item) => sum + (item.tokenUsage?.cacheWriteInputTokens ?? 0),
          0,
        ),
      },
    },
  };
}
