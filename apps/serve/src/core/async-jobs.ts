import { runBatch } from "./runner.js";
import type { BatchOcrBody } from "./schemas.js";
import { tasks } from "./tasks.js";

// In-flight controllers so a job can be aborted on cancel.
const controllers = new Map<string, AbortController>();

/** Enqueue a batch job; returns the task id immediately and runs in the background. */
export function submitJob(images: ArrayBuffer[], body: BatchOcrBody): string {
  const task = tasks.create();
  const controller = new AbortController();
  controllers.set(task.id, controller);

  void (async () => {
    tasks.update(task.id, { status: "running" });
    try {
      const { results, meta } = await runBatch(images, body, controller.signal);
      tasks.update(task.id, { status: "done", result: { results, meta } });
    } catch (error) {
      tasks.update(task.id, {
        status: controller.signal.aborted ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controllers.delete(task.id);
    }
  })();

  return task.id;
}

/** Abort a running job (best-effort) and mark it cancelled. */
export function cancelJob(id: string): boolean {
  if (!tasks.get(id)) return false;
  controllers.get(id)?.abort();
  tasks.update(id, { status: "cancelled" });
  return true;
}
