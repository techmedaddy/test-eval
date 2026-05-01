import { Hono } from "hono";
import { z } from "zod";
import { listStrategies } from "@test-evals/llm";
import type { PromptStrategy } from "@test-evals/shared";
import { getRunnerService } from "../services/runner/runner.service";

const createRunSchema = z.object({
  strategy: z.custom<PromptStrategy>((value) => {
    return typeof value === "string" && listStrategies().includes(value as PromptStrategy);
  }, "Invalid strategy"),
  model: z.string().min(1),
  dataset_filter: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

export const runsRoutes = new Hono();

runsRoutes.post("/api/v1/runs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createRunSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request payload",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const runner = getRunnerService();

  const response = await runner.startRun({
    strategy: parsed.data.strategy,
    model: parsed.data.model,
    datasetFilter: parsed.data.dataset_filter,
    force: parsed.data.force,
  });

  return c.json(response, 202);
});

runsRoutes.post("/api/v1/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    return c.json({ error: "Missing run id" }, 400);
  }

  const runner = getRunnerService();

  try {
    const response = await runner.resumeRun(runId);
    return c.json(response, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resume run";
    return c.json({ error: message }, 404);
  }
});
