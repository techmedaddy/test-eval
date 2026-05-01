"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@test-evals/ui/components/input";
import { Button } from "@test-evals/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@test-evals/ui/components/card";
import { authClient } from "@/lib/auth-client";

type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type CaseStatus = "queued" | "running" | "completed" | "failed" | "skipped";

type RunsListResponse = {
  items: RunSummary[];
  pagination: { limit: number; offset: number; total: number };
};

type RunSummary = {
  id: string;
  strategy: string;
  model: string;
  status: RunStatus;
  aggregateScore: number | null;
  totalCostUsd: number;
  durationMs: number | null;
  completedCases: number;
  totalCases: number;
  createdAt: string;
};

type RunDetail = RunSummary & {
  promptHash: string;
  hallucinationCount: number;
  schemaFailureCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  extractionSourceSummary?: {
    cacheHits: number;
    freshExtractions: number;
  };
  caseStatusCounts: Record<CaseStatus, number>;
  perFieldAggregate: Record<string, number | null>;
};

type CaseRow = {
  id: string;
  transcriptId: string;
  status: CaseStatus;
  cacheHit: boolean;
  extractionSource: "cache" | "fresh";
  aggregateScore: number | null;
  chiefComplaintScore: number | null;
  vitalsScore: number | null;
  followUpScore: number | null;
  hallucinationCount: number;
  schemaInvalidEscaped: boolean;
  transcript?: string | null;
  prediction: Record<string, unknown> | null;
  gold: Record<string, unknown> | null;
  evaluation: Record<string, unknown> | null;
  attempts?: AttemptRow[];
};

type AttemptRow = {
  id: string;
  attemptNumber: number;
  schemaValid: boolean;
  schemaErrors: string[];
  latencyMs: number;
  responseText: string;
  requestSystemPrompt: string;
  requestUserPrompt: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
};

type CasesResponse = {
  items: CaseRow[];
};

type CompareResponse = {
  left: RunSummary;
  right: RunSummary;
  fields: Array<{
    key: string;
    label: string;
    left: number | null;
    right: number | null;
    delta: number | null;
    winner: "left" | "right" | "tie";
  }>;
  winnerSummary: {
    left: number;
    right: number;
    tie: number;
  };
};

function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function fmtNumber(value: number | null | undefined, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function fmtMoney(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `$${value.toFixed(4)}`;
}

function fmtDurationMs(value: number | null | undefined) {
  if (!value) return "—";
  if (value < 1000) return `${value}ms`;
  const sec = value / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function statusBadge(status: string) {
  const base = "px-2 py-0.5 text-[11px] border";
  if (status === "completed") return `${base} border-emerald-500 text-emerald-600`;
  if (status === "failed") return `${base} border-red-500 text-red-600`;
  if (status === "running") return `${base} border-blue-500 text-blue-600`;
  return `${base} border-muted-foreground/40 text-muted-foreground`;
}

function flattenObject(value: unknown, prefix = ""): Array<{ key: string; value: string }> {
  if (value === null || value === undefined) {
    return [{ key: prefix || "root", value: "null" }];
  }

  if (typeof value !== "object") {
    return [{ key: prefix || "root", value: String(value) }];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [{ key: prefix || "root", value: "[]" }];
    return value.flatMap((entry, index) => flattenObject(entry, `${prefix}[${index}]`));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [{ key: prefix || "root", value: "{}" }];

  return entries.flatMap(([k, v]) => {
    const next = prefix ? `${prefix}.${k}` : k;
    return flattenObject(v, next);
  });
}

function buildFieldDiff(gold: unknown, prediction: unknown) {
  const goldMap = new Map(flattenObject(gold).map((item) => [item.key, item.value]));
  const predMap = new Map(flattenObject(prediction).map((item) => [item.key, item.value]));
  const keys = Array.from(new Set([...goldMap.keys(), ...predMap.keys()])).sort();

  return keys.map((key) => {
    const g = goldMap.get(key) ?? "—";
    const p = predMap.get(key) ?? "—";
    return {
      key,
      gold: g,
      prediction: p,
      same: g === p,
    };
  });
}

export default function Dashboard({ session }: { session: typeof authClient.$Infer.Session }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"createdAt" | "aggregateScore" | "totalCostUsd" | "durationMs">(
    "createdAt",
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const [leftRunId, setLeftRunId] = useState<string>("");
  const [rightRunId, setRightRunId] = useState<string>("");
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
    let active = true;

    const loadRuns = async () => {
      try {
        setLoadingRuns(true);
        setError(null);

        const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
        const data = await getJson<RunsListResponse>(`/api/v1/runs${query}`);

        if (!active) return;
        setRuns(data.items ?? []);

        if (!selectedRunId && data.items.length > 0) {
          setSelectedRunId(data.items[0]?.id ?? null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load runs");
      } finally {
        if (active) setLoadingRuns(false);
      }
    };

    void loadRuns();

    return () => {
      active = false;
    };
  }, [statusFilter, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;

    let active = true;

    const loadDetail = async () => {
      try {
        setLoadingDetail(true);

        const [detailData, caseData] = await Promise.all([
          getJson<RunDetail>(`/api/v1/runs/${selectedRunId}`),
          getJson<CasesResponse>(
            `/api/v1/runs/${selectedRunId}/cases?limit=200&include_attempts=true&include_transcript=true`,
          ),
        ]);

        if (!active) return;
        setRunDetail(detailData);
        setCases(caseData.items ?? []);
        if ((caseData.items?.length ?? 0) > 0) {
          setSelectedCaseId((prev) => prev ?? caseData.items[0]?.id ?? null);
        } else {
          setSelectedCaseId(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load run detail");
      } finally {
        if (active) setLoadingDetail(false);
      }
    };

    void loadDetail();

    return () => {
      active = false;
    };
  }, [selectedRunId]);

  const sortedRuns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = runs.filter((run) => {
      if (!normalizedSearch) return true;
      return [run.id, run.strategy, run.model, run.status].join(" ").toLowerCase().includes(normalizedSearch);
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === "createdAt") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      const aValue = a[sortKey] ?? -Infinity;
      const bValue = b[sortKey] ?? -Infinity;
      return Number(bValue) - Number(aValue);
    });
  }, [runs, search, sortKey]);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  const fieldDiff = useMemo(() => {
    if (!selectedCase) return [];
    return buildFieldDiff(selectedCase.gold, selectedCase.prediction);
  }, [selectedCase]);

  const loadCompare = async () => {
    if (!leftRunId || !rightRunId) return;

    try {
      setLoadingCompare(true);
      const data = await getJson<CompareResponse>(
        `/api/v1/runs/compare?left=${encodeURIComponent(leftRunId)}&right=${encodeURIComponent(rightRunId)}`,
      );
      setCompare(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compare request failed");
    } finally {
      setLoadingCompare(false);
    }
  };

  return (
    <div className="grid h-[calc(100svh-3.5rem)] grid-cols-1 gap-3 p-3 lg:grid-cols-[1.05fr_1.4fr]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search run/model" />
            <select
              className="h-8 border bg-background px-2 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.currentTarget.value as "all" | RunStatus)}
            >
              <option value="all">All status</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="h-8 border bg-background px-2 text-xs"
              value={sortKey}
              onChange={(e) => setSortKey(e.currentTarget.value as typeof sortKey)}
            >
              <option value="createdAt">Sort: newest</option>
              <option value="aggregateScore">Sort: aggregate F1</option>
              <option value="totalCostUsd">Sort: cost</option>
              <option value="durationMs">Sort: duration</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          {loadingRuns ? (
            <div className="p-4 text-xs text-muted-foreground">Loading runs...</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left">
                  <th className="p-2">Run</th>
                  <th className="p-2">Strategy</th>
                  <th className="p-2">F1</th>
                  <th className="p-2">Cost</th>
                  <th className="p-2">Duration</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((run) => (
                  <tr
                    key={run.id}
                    className={`cursor-pointer border-b hover:bg-muted/40 ${selectedRunId === run.id ? "bg-muted/60" : ""}`}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <td className="p-2 font-mono">{run.id.slice(0, 8)}</td>
                    <td className="p-2">{run.strategy}</td>
                    <td className="p-2">{fmtNumber(run.aggregateScore)}</td>
                    <td className="p-2">{fmtMoney(run.totalCostUsd)}</td>
                    <td className="p-2">{fmtDurationMs(run.durationMs)}</td>
                    <td className="p-2">
                      <span className={statusBadge(run.status)}>{run.status}</span>
                    </td>
                  </tr>
                ))}
                {sortedRuns.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      No runs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Compare runs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select className="h-8 border bg-background px-2 text-xs" value={leftRunId} onChange={(e) => setLeftRunId(e.currentTarget.value)}>
                <option value="">Left run</option>
                {runs.map((run) => (
                  <option key={`left-${run.id}`} value={run.id}>
                    {run.id.slice(0, 8)} · {run.strategy} · {run.model}
                  </option>
                ))}
              </select>
              <select className="h-8 border bg-background px-2 text-xs" value={rightRunId} onChange={(e) => setRightRunId(e.currentTarget.value)}>
                <option value="">Right run</option>
                {runs.map((run) => (
                  <option key={`right-${run.id}`} value={run.id}>
                    {run.id.slice(0, 8)} · {run.strategy} · {run.model}
                  </option>
                ))}
              </select>
              <Button onClick={loadCompare} disabled={!leftRunId || !rightRunId || loadingCompare}>
                {loadingCompare ? "Comparing..." : "Compare"}
              </Button>
            </div>

            {compare && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {compare.fields.map((field) => (
                  <div key={field.key} className="border p-2 text-xs">
                    <div className="mb-1 font-medium">{field.label}</div>
                    <div className="text-muted-foreground">
                      {compare.left.id.slice(0, 8)}: <span className="font-mono">{fmtNumber(field.left)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {compare.right.id.slice(0, 8)}: <span className="font-mono">{fmtNumber(field.right)}</span>
                    </div>
                    <div className="mt-1">
                      Δ: <span className="font-mono">{fmtNumber(field.delta)}</span>
                    </div>
                    <div className="mt-1">
                      Winner:{" "}
                      <span
                        className={
                          field.winner === "left"
                            ? "text-blue-600"
                            : field.winner === "right"
                              ? "text-emerald-600"
                              : "text-muted-foreground"
                        }
                      >
                        {field.winner}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {runDetail && (
          <Card>
            <CardHeader>
              <CardTitle>Run detail · {runDetail.id.slice(0, 8)}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="border p-2">
                <div className="text-muted-foreground">Strategy</div>
                <div>{runDetail.strategy}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Aggregate F1</div>
                <div>{fmtNumber(runDetail.aggregateScore)}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Cost</div>
                <div>{fmtMoney(runDetail.totalCostUsd)}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Duration</div>
                <div>{fmtDurationMs(runDetail.durationMs)}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Cases</div>
                <div>
                  {runDetail.completedCases}/{runDetail.totalCases}
                </div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Hallucinations</div>
                <div>{runDetail.hallucinationCount}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Schema failures</div>
                <div>{runDetail.schemaFailureCount}</div>
              </div>
              <div className="border p-2">
                <div className="text-muted-foreground">Source split</div>
                <div>
                  cache {runDetail.extractionSourceSummary?.cacheHits ?? 0} · fresh{" "}
                  {runDetail.extractionSourceSummary?.freshExtractions ?? 0}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="min-h-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Cases</CardTitle>
          </CardHeader>
          <CardContent className="grid min-h-0 grid-cols-1 gap-3 p-0 lg:grid-cols-[1fr_1fr]">
            <div className="min-h-0 overflow-auto border-r">
              {loadingDetail ? (
                <div className="p-4 text-xs text-muted-foreground">Loading cases...</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left">
                      <th className="p-2">Case</th>
                      <th className="p-2">F1</th>
                      <th className="p-2">Halluc.</th>
                      <th className="p-2">Source</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((item) => (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-b hover:bg-muted/40 ${selectedCaseId === item.id ? "bg-muted/60" : ""}`}
                        onClick={() => setSelectedCaseId(item.id)}
                      >
                        <td className="p-2 font-mono">{item.transcriptId}</td>
                        <td className="p-2">{fmtNumber(item.aggregateScore)}</td>
                        <td className="p-2">{item.hallucinationCount}</td>
                        <td className="p-2">{item.extractionSource}</td>
                        <td className="p-2">
                          <span className={statusBadge(item.status)}>{item.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="min-h-0 overflow-auto p-3 text-xs">
              {selectedCase ? (
                <div className="grid gap-3">
                  <div className="border p-2">
                    <div className="mb-1 font-medium">Transcript · {selectedCase.transcriptId}</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">
                      {selectedCase.transcript ?? "Transcript unavailable"}
                    </pre>
                  </div>

                  <div className="border p-2">
                    <div className="mb-1 font-medium">Field-level diff (gold vs prediction)</div>
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="p-1">Field</th>
                            <th className="p-1">Gold</th>
                            <th className="p-1">Prediction</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fieldDiff.map((row) => (
                            <tr key={row.key} className={`border-b ${row.same ? "bg-emerald-500/5" : "bg-red-500/5"}`}>
                              <td className="p-1 font-mono">{row.key}</td>
                              <td className="p-1">{row.gold}</td>
                              <td className="p-1">{row.prediction}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="border p-2">
                      <div className="mb-1 font-medium">Gold JSON</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(selectedCase.gold, null, 2)}</pre>
                    </div>
                    <div className="border p-2">
                      <div className="mb-1 font-medium">Prediction JSON</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(selectedCase.prediction, null, 2)}</pre>
                    </div>
                  </div>

                  <div className="border p-2">
                    <div className="mb-1 font-medium">Attempt trace</div>
                    <div className="grid gap-2">
                      {(selectedCase.attempts ?? []).map((attempt) => (
                        <div key={attempt.id} className="border p-2">
                          <div className="mb-1 flex flex-wrap gap-2">
                            <span>Attempt #{attempt.attemptNumber}</span>
                            <span className={attempt.schemaValid ? "text-emerald-600" : "text-red-600"}>
                              schema: {attempt.schemaValid ? "valid" : "invalid"}
                            </span>
                            <span>latency: {attempt.latencyMs}ms</span>
                            <span>
                              cache-read: {attempt.tokenUsage.cacheReadInputTokens} · cache-write: {attempt.tokenUsage.cacheWriteInputTokens}
                            </span>
                          </div>
                          {attempt.schemaErrors.length > 0 && (
                            <pre className="mb-1 overflow-auto whitespace-pre-wrap text-[11px] text-red-600">
                              {attempt.schemaErrors.join("\n")}
                            </pre>
                          )}
                          <details>
                            <summary className="cursor-pointer">request/response</summary>
                            <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-[11px]">
{`SYSTEM:\n${attempt.requestSystemPrompt}\n\nUSER:\n${attempt.requestUserPrompt}\n\nRESPONSE:\n${attempt.responseText}`}
                            </pre>
                          </details>
                        </div>
                      ))}
                      {(selectedCase.attempts ?? []).length === 0 && (
                        <div className="text-muted-foreground">No attempt trace for this case (likely cache hit).</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">Select a case for deep debug.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <div className="fixed right-3 bottom-3 border bg-background p-2 text-xs text-red-600">{error}</div>}
      <div className="fixed right-3 top-12 border bg-background px-2 py-1 text-[11px] text-muted-foreground">
        signed in as {session.user?.email}
      </div>
    </div>
  );
}
