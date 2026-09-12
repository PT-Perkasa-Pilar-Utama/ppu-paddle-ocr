import { describe, expect, test } from "bun:test";
import type { InferenceSession } from "onnxruntime-common";
import { createSessionWithFallback } from "../src/core/session-factory.js";
import type { SessionOptions } from "../src/interface.js";

type FakeSession = { id: string };
type SessionOpts = SessionOptions;
type OrtLike = Parameters<typeof createSessionWithFallback>[0];

function makeFakeOrt(
  create: (data: Uint8Array, opts: SessionOpts) => Promise<FakeSession>
): OrtLike {
  return {
    InferenceSession: {
      create: (data: Uint8Array, opts?: SessionOpts) => create(data, opts ?? {}),
    },
  } as unknown as OrtLike;
}

describe("createSessionWithFallback", () => {
  test("succeeds on first try when providers work", async () => {
    const calls: SessionOpts[] = [];
    const ort = makeFakeOrt(async (_d, opts) => {
      calls.push(opts);
      return { id: "ok" };
    });
    const session = await createSessionWithFallback(
      ort,
      new Uint8Array([1, 2, 3]),
      { executionProviders: ["cuda", "cpu"] },
      () => {}
    );
    expect(session).toEqual({ id: "ok" } as unknown as InferenceSession);
    expect(calls).toHaveLength(1);
  });

  test("falls back to CPU when CUDA fails", async () => {
    let attempt = 0;
    const ort = makeFakeOrt(async () => {
      attempt++;
      if (attempt === 1) throw new Error("CUDA runtime not found");
      return { id: "fallback" };
    });
    const logs: string[] = [];
    let newOpts: SessionOpts | undefined;
    const session = await createSessionWithFallback(
      ort,
      new Uint8Array([1, 2, 3]),
      { executionProviders: ["cuda", "cpu"] },
      (m) => logs.push(m),
      (next: SessionOpts) => {
        newOpts = next;
      }
    );
    expect(session).toEqual({ id: "fallback" } as unknown as InferenceSession);
    expect(attempt).toBe(2);
    expect(logs[0]).toContain("cpu");
    expect(newOpts?.executionProviders).toEqual(["cpu"]);
  });

  test("falls back to WASM when WebGPU fails on web", async () => {
    let attempt = 0;
    const ort = makeFakeOrt(async () => {
      attempt++;
      if (attempt === 1) throw new Error("WebGPU device lost");
      return { id: "wasm" };
    });
    const logs: string[] = [];
    const session = await createSessionWithFallback(
      ort,
      new Uint8Array([1, 2, 3]),
      { executionProviders: ["webgpu", "wasm"] },
      (m) => logs.push(m)
    );
    expect(session).toEqual({ id: "wasm" } as unknown as InferenceSession);
    expect(attempt).toBe(2);
    expect(logs[0]).toContain("wasm");
  });

  test("rethrows when providers list is already safe-only", async () => {
    const ort = makeFakeOrt(async () => {
      throw new Error("model format invalid");
    });
    await expect(
      createSessionWithFallback(
        ort,
        new Uint8Array([1, 2, 3]),
        { executionProviders: ["cpu"] },
        () => {}
      )
    ).rejects.toThrow("model format invalid");
  });

  test("rethrows when no executionProviders specified", async () => {
    const ort = makeFakeOrt(async () => {
      throw new Error("generic failure");
    });
    await expect(createSessionWithFallback(ort, new Uint8Array([1]), {}, () => {})).rejects.toThrow(
      "generic failure"
    );
  });

  test("accepts provider objects with `name` field", async () => {
    let attempt = 0;
    const ort = makeFakeOrt(async (_d, opts) => {
      attempt++;
      if (attempt === 1) throw new Error("DirectML not available");
      expect(opts.executionProviders).toEqual(["cpu"]);
      return { id: "dml-fallback" };
    });
    const session = await createSessionWithFallback(
      ort,
      new Uint8Array([1]),
      { executionProviders: [{ name: "dml", deviceId: 0 }, "cpu"] },
      () => {}
    );
    expect(session).toEqual({ id: "dml-fallback" } as unknown as InferenceSession);
  });

  test("notifies onSessionFallback without leaking it into ORT options", async () => {
    let attempt = 0;
    const seen: SessionOpts[] = [];
    const ort = makeFakeOrt(async (_d, opts) => {
      attempt++;
      seen.push(opts);
      if (attempt === 1) throw new Error("CUDA runtime not found");
      return { id: "fallback" };
    });
    const errors: unknown[] = [];
    let storedOpts: SessionOpts | undefined;
    await createSessionWithFallback(
      ort,
      new Uint8Array([1]),
      {
        executionProviders: ["cuda", "cpu"],
        onSessionFallback: (error) => errors.push(error),
      },
      () => {},
      (next) => {
        storedOpts = next;
      }
    );
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("CUDA runtime not found");
    expect(seen).toHaveLength(2);
    for (const opts of seen) {
      expect("onSessionFallback" in opts).toBe(false);
    }
    // The user callback survives in the options the service stores back.
    expect(typeof storedOpts?.onSessionFallback).toBe("function");
  });

  test("skips onSessionFallback when the fallback session also fails", async () => {
    const ort = makeFakeOrt(async () => {
      throw new Error("everything is broken");
    });
    let called = 0;
    await expect(
      createSessionWithFallback(
        ort,
        new Uint8Array([1]),
        { executionProviders: ["cuda", "cpu"], onSessionFallback: () => called++ },
        () => {}
      )
    ).rejects.toThrow("everything is broken");
    expect(called).toBe(0);
  });

  test("picks a CPU/WASM fallback that was actually in the original list", async () => {
    let attempt = 0;
    let secondCallOpts: SessionOpts | undefined;
    const ort = makeFakeOrt(async (_d, opts) => {
      attempt++;
      if (attempt === 1) throw new Error("tensorrt failure");
      secondCallOpts = opts;
      return { id: "ok" };
    });
    await createSessionWithFallback(
      ort,
      new Uint8Array([1]),
      { executionProviders: ["tensorrt", "cpu"] },
      () => {}
    );
    expect(secondCallOpts?.executionProviders).toEqual(["cpu"]);
  });
});
