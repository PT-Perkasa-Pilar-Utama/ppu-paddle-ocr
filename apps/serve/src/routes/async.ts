import { Hono } from "hono";
import { sendError } from "../errors.js";
import { resolveBatch, runBatch } from "../runner.js";
import { batchOcrSchema } from "../schemas.js";
import { tasks } from "../tasks.js";

export const asyncOcr = new Hono();

// In-flight controllers, so DELETE can abort a running batch.
const controllers = new Map<string, AbortController>();

// Enqueue an async batch job; returns 202 with a task id immediately.
asyncOcr.post("/v1/ocr/async", async (c) => {
  const body = batchOcrSchema.parse(await c.req.json());
  const images = await resolveBatch(body.sources);

  const task = tasks.create();
  const controller = new AbortController();
  controllers.set(task.id, controller);

  // Fire-and-forget; the task store carries the outcome.
  void (async () => {
    tasks.update(task.id, { status: "running" });
    try {
      const { results, meta } = await runBatch(images, body, controller.signal);
      tasks.update(task.id, { status: "done", result: { results, meta } });
    } catch (error) {
      const aborted = controller.signal.aborted;
      tasks.update(task.id, {
        status: aborted ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controllers.delete(task.id);
    }
  })();

  return c.json({ taskId: task.id, status: task.status }, 202);
});

asyncOcr.get("/v1/tasks/:id", (c) => {
  const task = tasks.get(c.req.param("id"));
  if (!task) return sendError(c, 404, "not_found", "Unknown task id");
  return c.json({ id: task.id, status: task.status, updatedAt: task.updatedAt });
});

asyncOcr.get("/v1/tasks/:id/result", (c) => {
  const task = tasks.get(c.req.param("id"));
  if (!task) return sendError(c, 404, "not_found", "Unknown task id");
  if (task.status === "failed" || task.status === "cancelled") {
    return sendError(c, 409, task.status, task.error ?? `Task ${task.status}`);
  }
  if (task.status !== "done") {
    return sendError(c, 409, "not_ready", `Task is ${task.status}`);
  }
  return c.json(task.result);
});

asyncOcr.delete("/v1/tasks/:id", (c) => {
  const task = tasks.get(c.req.param("id"));
  if (!task) return sendError(c, 404, "not_found", "Unknown task id");
  controllers.get(task.id)?.abort();
  tasks.update(task.id, { status: "cancelled" });
  return c.json({ id: task.id, status: "cancelled" });
});
