import type { RunProgressEvent } from "@test-evals/shared";

type ProgressListener = (event: RunProgressEvent) => void;

class RunnerProgressBus {
  private listeners = new Map<string, Set<ProgressListener>>();

  subscribe(runId: string, listener: ProgressListener): () => void {
    const set = this.listeners.get(runId) ?? new Set<ProgressListener>();
    set.add(listener);
    this.listeners.set(runId, set);

    return () => {
      const current = this.listeners.get(runId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  publish(runId: string, event: RunProgressEvent): void {
    const set = this.listeners.get(runId);
    if (!set || set.size === 0) return;

    for (const listener of set) {
      listener(event);
    }
  }
}

export const runnerProgressBus = new RunnerProgressBus();
