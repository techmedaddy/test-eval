import type { ClinicalExtraction } from "./extraction";

export type PromptStrategy = "zero_shot" | "few_shot" | "cot";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type CaseStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface DatasetCase {
  transcriptId: string;
  transcript: string;
  gold: ClinicalExtraction;
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export interface PromptMetadata {
  promptHash: string;
  strategy: PromptStrategy;
  model: string;
}

export interface ExtractionAttempt {
  attempt: number;
  request: {
    systemPrompt: string;
    userPrompt: string;
  };
  responseText: string;
  parsedOutput: unknown | null;
  schemaValid: boolean;
  schemaErrors: string[];
  tokenUsage: LLMTokenUsage;
  latencyMs: number;
  createdAt: string;
}

export interface CaseEvaluation {
  aggregateScore: number;
  chiefComplaintScore: number;
  vitalsScore: number;
  medications: {
    precision: number;
    recall: number;
    f1: number;
  };
  diagnoses: {
    precision: number;
    recall: number;
    f1: number;
    icdBonus: number;
  };
  plan: {
    precision: number;
    recall: number;
    f1: number;
  };
  followUpScore: number;
  hallucinationCount: number;
  schemaInvalidEscaped: boolean;
}

export interface CaseResultDto {
  runId: string;
  transcriptId: string;
  status: CaseStatus;
  prediction: ClinicalExtraction | null;
  gold: ClinicalExtraction;
  attempts: ExtractionAttempt[];
  evaluation: CaseEvaluation | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface RunSummaryDto {
  id: string;
  strategy: PromptStrategy;
  model: string;
  status: RunStatus;
  promptHash: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  schemaFailureCount: number;
  hallucinationCount: number;
  totalCostUsd: number;
  tokenUsage: LLMTokenUsage;
}

export interface RunDetailDto extends RunSummaryDto {
  cases: CaseResultDto[];
  perFieldAggregate: {
    chiefComplaint: number;
    vitals: number;
    medicationsF1: number;
    diagnosesF1: number;
    planF1: number;
    followUp: number;
    overallF1: number;
  };
}

export interface RunCreateRequest {
  strategy: PromptStrategy;
  model: string;
  datasetFilter?: string[];
  force?: boolean;
}

export interface RunCreateResponse {
  runId: string;
  status: RunStatus;
}

export type RunProgressEvent =
  | {
      type: "run_started";
      runId: string;
      at: string;
    }
  | {
      type: "case_completed";
      runId: string;
      transcriptId: string;
      completed: number;
      total: number;
      cacheHit: boolean;
      source: "cache" | "fresh";
      at: string;
    }
  | {
      type: "run_completed";
      runId: string;
      status: Extract<RunStatus, "completed" | "cancelled">;
      at: string;
    }
  | {
      type: "run_failed";
      runId: string;
      status: "failed";
      error?: string;
      at: string;
    };
