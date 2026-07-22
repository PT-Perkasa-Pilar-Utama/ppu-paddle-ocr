import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type Task = {
  id: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Async task store. In-memory and therefore **per-instance** - fine for a
 * single replica; swap this implementation for Redis/BullMQ behind the same
 * interface to share tasks across replicas.
 */
export type TaskStore = {
  create(): Task;
  get(id: string): Task | undefined;
  update(id: string, patch: Partial<Omit<Task, "id" | "createdAt">>): Task | undefined;
};

class InMemoryTaskStore implements TaskStore {
  private readonly map = new Map<string, Task>();

  constructor(private readonly ttlMs: number) {
    // Periodic GC of finished tasks; unref so it never holds the process open.
    const timer = setInterval(() => this.sweep(), Math.min(ttlMs, 60_000));
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  }

  create(): Task {
    const now = Date.now();
    const task: Task = { id: randomUUID(), status: "queued", createdAt: now, updatedAt: now };
    this.map.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.map.get(id);
  }

  update(id: string, patch: Partial<Omit<Task, "id" | "createdAt">>): Task | undefined {
    const task = this.map.get(id);
    if (!task) return undefined;
    Object.assign(task, patch, { updatedAt: Date.now() });
    return task;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, task] of this.map) {
      const finished =
        task.status === "done" || task.status === "failed" || task.status === "cancelled";
      if (finished && task.updatedAt < cutoff) this.map.delete(id);
    }
  }
}

export const tasks: TaskStore = new InMemoryTaskStore(config.taskTtlMs);
