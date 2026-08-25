import { isReady, queue } from "./service.js";

const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

const requestsTotal = new Map<string, number>();
const bucketCounts = new Map<string, number[]>();
const durationSum = new Map<string, number>();
const durationCount = new Map<string, number>();

/** Record one finished request for the Prometheus exposition. */
export function recordRequest(route: string, status: number, seconds: number): void {
  const key = `${route}|${status}`;
  requestsTotal.set(key, (requestsTotal.get(key) ?? 0) + 1);

  const buckets = bucketCounts.get(route) ?? DURATION_BUCKETS.map(() => 0);
  DURATION_BUCKETS.forEach((bound, i) => {
    if (seconds <= bound) buckets[i] = (buckets[i] ?? 0) + 1;
  });
  bucketCounts.set(route, buckets);
  durationSum.set(route, (durationSum.get(route) ?? 0) + seconds);
  durationCount.set(route, (durationCount.get(route) ?? 0) + 1);
}

/** Render the current metrics in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP ppu_ocr_requests_total Total HTTP requests by route and status.");
  lines.push("# TYPE ppu_ocr_requests_total counter");
  for (const [key, value] of requestsTotal) {
    const [route, status] = key.split("|");
    lines.push(`ppu_ocr_requests_total{route="${route}",status="${status}"} ${value}`);
  }

  lines.push("# HELP ppu_ocr_request_duration_seconds Request duration by route.");
  lines.push("# TYPE ppu_ocr_request_duration_seconds histogram");
  for (const [route, buckets] of bucketCounts) {
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      lines.push(
        `ppu_ocr_request_duration_seconds_bucket{route="${route}",le="${DURATION_BUCKETS[i]}"} ${buckets[i]}`
      );
    }
    lines.push(
      `ppu_ocr_request_duration_seconds_bucket{route="${route}",le="+Inf"} ${durationCount.get(route) ?? 0}`
    );
    lines.push(
      `ppu_ocr_request_duration_seconds_sum{route="${route}"} ${durationSum.get(route) ?? 0}`
    );
    lines.push(
      `ppu_ocr_request_duration_seconds_count{route="${route}"} ${durationCount.get(route) ?? 0}`
    );
  }

  lines.push("# HELP ppu_ocr_queue_inflight Inferences currently running.");
  lines.push("# TYPE ppu_ocr_queue_inflight gauge");
  lines.push(`ppu_ocr_queue_inflight ${queue.inFlight}`);

  lines.push("# HELP ppu_ocr_queue_waiting Requests waiting for an inference slot.");
  lines.push("# TYPE ppu_ocr_queue_waiting gauge");
  lines.push(`ppu_ocr_queue_waiting ${queue.waiting}`);

  lines.push("# HELP ppu_ocr_model_ready 1 when the default model is warmed.");
  lines.push("# TYPE ppu_ocr_model_ready gauge");
  lines.push(`ppu_ocr_model_ready ${isReady() ? 1 : 0}`);

  return `${lines.join("\n")}\n`;
}
