import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { expandPatterns, isMissingLocalFile, loadImageInput } from "../src/cli/io.js";
import {
  buildBatchOptions,
  buildPaddleOptions,
  buildRecognizeOptions,
  PARSE_OPTIONS,
} from "../src/cli/options.js";
import { V6_SMALL_MODEL, V6_TINY_MODEL } from "../src/model-catalogue.js";
import { main } from "../src/cli/run.js";

const ASSETS = `${import.meta.dir}/../assets`;
const RECEIPT = `${ASSETS}/receipt.jpg`;
const TILTED = `${ASSETS}/tilted.png`;

let workdir: string;
let badImage: string;

/** Run `main` with stdout/stderr captured in-process. */
async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string) => ((out += chunk), true);
  process.stderr.write = (chunk: string) => ((err += chunk), true);
  try {
    const code = await main(args);
    return { code, out, err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

beforeAll(async () => {
  // Warm the cache once so OCR commands don't pay download latency per test.
  await PaddleOcrService.downloadModels();
  workdir = mkdtempSync(join(tmpdir(), "ppu-cli-"));
  badImage = join(workdir, "not-an-image.png");
  writeFileSync(badImage, "this is not a PNG");
});

afterAll(() => {
  if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
});

// ─── Option builders (pure, no models) ──────────────────────────────────────

describe("option builders", () => {
  test("buildRecognizeOptions maps the per-call flags", () => {
    expect(buildRecognizeOptions({ flatten: true, "no-cache": true })).toEqual({
      flatten: true,
      noCache: true,
    });
    expect(buildRecognizeOptions({ strategy: "per-box" })).toEqual({ strategy: "per-box" });
    expect(buildRecognizeOptions({})).toEqual({});
  });

  test("buildPaddleOptions maps detection, recognition, processing, session, model", () => {
    const opts = buildPaddleOptions({
      "model-detection": "/d.onnx",
      "model-dict": "/dict.txt",
      strategy: "cross-line",
      "cross-line-width-factor": "1.2",
      "image-height": "64",
      engine: "canvas-native",
      "max-side-length": "960",
      mean: "0.1,0.2,0.3",
      "execution-providers": "cuda,cpu",
      verbose: true,
    });
    expect(opts.model).toEqual({ detection: "/d.onnx", charactersDictionary: "/dict.txt" });
    expect(opts.detection).toEqual({ maxSideLength: 960, mean: [0.1, 0.2, 0.3] });
    expect(opts.recognition).toEqual({
      charactersDictionary: [],
      strategy: "cross-line",
      crossLineWidthFactor: 1.2,
      imageHeight: 64,
    });
    expect(opts.processing).toEqual({ engine: "canvas-native" });
    expect(opts.session).toEqual({ executionProviders: ["cuda", "cpu"] });
    expect(opts.debugging).toEqual({ verbose: true });
  });

  test("--max-crop-source-side-length is registered and maps onto recognition", () => {
    // The CLI documents a 1:1 flag mapping for every RecognitionOptions field,
    // so a new sibling of --image-height / --min-confidence has to be both
    // parseable and forwarded, not just present in the library options type.
    expect(PARSE_OPTIONS["max-crop-source-side-length"]).toEqual({ type: "string" });

    const opts = buildPaddleOptions({ "max-crop-source-side-length": "1200" });
    expect(opts.recognition?.maxCropSourceSideLength).toBe(1200);

    // Omitted leaves it unset so the library's own 2000 default applies.
    expect(buildPaddleOptions({}).recognition?.maxCropSourceSideLength).toBeUndefined();

    expect(() => buildPaddleOptions({ "max-crop-source-side-length": "abc" })).toThrow();
  });

  test("--main-thread-yield-ms is registered and maps onto recognition", () => {
    expect(PARSE_OPTIONS["main-thread-yield-ms"]).toEqual({ type: "string" });

    const opts = buildPaddleOptions({ "main-thread-yield-ms": "16" });
    expect(opts.recognition?.mainThreadYieldMs).toBe(16);

    // Omitted leaves it unset so the library default (0, disabled) applies.
    expect(buildPaddleOptions({}).recognition?.mainThreadYieldMs).toBeUndefined();

    expect(() => buildPaddleOptions({ "main-thread-yield-ms": "abc" })).toThrow();
  });

  test("recognition quality flags are registered and map onto recognition", () => {
    expect(PARSE_OPTIONS["rec-batch-size"]).toEqual({ type: "string" });
    expect(PARSE_OPTIONS["space-recovery"]).toEqual({ type: "boolean" });
    expect(PARSE_OPTIONS["no-rotate-vertical-crops"]).toEqual({ type: "boolean" });

    const opts = buildPaddleOptions({
      "rec-batch-size": "12",
      "space-recovery": true,
      "no-rotate-vertical-crops": true,
    });
    expect(opts.recognition?.recBatchSize).toBe(12);
    expect(opts.recognition?.spaceRecovery).toBe(true);
    expect(opts.recognition?.rotateVerticalCrops).toBe(false);

    // Omitted leaves them unset so library defaults apply.
    const bare = buildPaddleOptions({}).recognition;
    expect(bare?.recBatchSize).toBeUndefined();
    expect(bare?.spaceRecovery).toBeUndefined();
    expect(bare?.rotateVerticalCrops).toBeUndefined();

    expect(() => buildPaddleOptions({ "rec-batch-size": "abc" })).toThrow();
  });

  test("buildPaddleOptions resolves --model presets, with --model-* overriding parts", () => {
    expect(buildPaddleOptions({ model: "v6-tiny" }).model).toEqual(V6_TINY_MODEL);

    // A granular flag overrides only its part of the selected preset.
    const opts = buildPaddleOptions({ model: "v6-small", "model-detection": "/custom-det.onnx" });
    expect(opts.model).toEqual({ ...V6_SMALL_MODEL, detection: "/custom-det.onnx" });
  });

  test("buildBatchOptions parses concurrency and settle", () => {
    expect(buildBatchOptions({ concurrency: "auto" }).concurrency).toBe("auto");
    expect(buildBatchOptions({ concurrency: "4" }).concurrency).toBe(4);
    expect(buildBatchOptions({ settle: true }).settle).toBe(true);
    expect(buildBatchOptions({}).concurrency).toBeUndefined();
    expect(buildBatchOptions({}).settle).toBeUndefined();
  });

  test("invalid flag values throw a usage error (exit code 2)", () => {
    expect(() => buildPaddleOptions({ strategy: "nonsense" })).toThrow();
    expect(() => buildPaddleOptions({ engine: "nonsense" })).toThrow();
    expect(() => buildPaddleOptions({ "max-side-length": "abc" })).toThrow();
    expect(() => buildPaddleOptions({ mean: "1,2" })).toThrow();
    expect(() => buildPaddleOptions({ model: "v9-imaginary" })).toThrow();
    expect(() => buildBatchOptions({ concurrency: "0" })).toThrow();
  });
});

// ─── IO helpers ─────────────────────────────────────────────────────────────

describe("io helpers", () => {
  test("expandPatterns globs, passes literals through, and errors on no match", () => {
    expect(expandPatterns([RECEIPT])).toEqual([RECEIPT]);
    expect(expandPatterns(["https://example.com/a.png"])).toEqual(["https://example.com/a.png"]);
    expect(expandPatterns([`${ASSETS}/*.jpg`].map(String)).length).toBeGreaterThan(0);
    expect(() => expandPatterns([`${ASSETS}/does-not-exist-*.zzz`])).toThrow();
  });

  test("isMissingLocalFile flags missing paths but trusts URLs", () => {
    expect(isMissingLocalFile(RECEIPT)).toBe(false);
    expect(isMissingLocalFile(`${ASSETS}/nope.jpg`)).toBe(true);
    expect(isMissingLocalFile("https://example.com/x.png")).toBe(false);
  });

  test("loadImageInput reads a file into an ArrayBuffer and rejects missing files", async () => {
    const buf = await loadImageInput(RECEIPT);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
    await expect(loadImageInput(`${ASSETS}/nope.jpg`)).rejects.toBeDefined();
  });
});

// ─── Usage / argument handling (no models) ──────────────────────────────────

describe("argument handling", () => {
  test("--version prints the package version", async () => {
    const { code, out } = await run(["--version"]);
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("help and no-args both print usage", async () => {
    expect((await run(["help"])).out).toContain("Usage:");
    const noArgs = await run([]);
    expect(noArgs.code).toBe(0);
    expect(noArgs.out).toContain("Usage:");
  });

  test("unknown command exits 2 with usage", async () => {
    const { code, err } = await run(["frobnicate"]);
    expect(code).toBe(2);
    expect(err).toContain("Unknown command");
  });

  test("unknown flag exits 2", async () => {
    expect((await run(["recognize", "x.jpg", "--nope"])).code).toBe(2);
  });

  test("recognize requires exactly one image", async () => {
    expect((await run(["recognize"])).code).toBe(2);
    expect((await run(["recognize", "a.jpg", "b.jpg"])).code).toBe(2);
  });

  test("batch/stream require at least one image", async () => {
    expect((await run(["batch"])).code).toBe(2);
    expect((await run(["stream"])).code).toBe(2);
  });

  test("invalid --strategy is a usage error", async () => {
    expect((await run(["recognize", RECEIPT, "--strategy", "bogus"])).code).toBe(2);
  });

  test("a missing image is a runtime error (exit 1)", async () => {
    const { code, err } = await run(["recognize", `${ASSETS}/nope.jpg`]);
    expect(code).toBe(1);
    expect(err).toContain("No such file");
  });

  test("batch fails fast when a local file is missing", async () => {
    expect((await run(["batch", RECEIPT, `${ASSETS}/nope.jpg`])).code).toBe(1);
  });
});

// ─── OCR happy paths ────────────────────────────────────────────────────────

describe("recognize", () => {
  test("prints recognized text to stdout", async () => {
    const { code, out } = await run(["recognize", RECEIPT, "-q"]);
    expect(code).toBe(0);
    expect(out.trim().length).toBeGreaterThan(0);
  });

  test("--json emits a grouped result with lines", async () => {
    const { code, out } = await run(["recognize", TILTED, "--json", "-q"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { text: string; lines: unknown[]; confidence: number };
    expect(parsed).toHaveProperty("lines");
    expect(typeof parsed.text).toBe("string");
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  test("--json --flatten emits a flat results array", async () => {
    const { out } = await run(["recognize", TILTED, "--json", "--flatten", "-q"]);
    const parsed = JSON.parse(out) as { results: unknown[] };
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  test("-o writes to a file instead of stdout", async () => {
    const outFile = join(workdir, "out.txt");
    const { code, out } = await run(["recognize", RECEIPT, "-o", outFile, "-q"]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(readFileSync(outFile, "utf-8").trim().length).toBeGreaterThan(0);
  });
});

describe("detect", () => {
  test("prints boxes as JSON to stdout", async () => {
    const { code, out } = await run(["detect", RECEIPT, "-q"]);
    expect(code).toBe(0);
    const boxes = JSON.parse(out) as Array<{ x: number; y: number; width: number }>;
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes[0]).toHaveProperty("width");
  });

  test("--save-crops writes one PNG per box", async () => {
    const cropDir = join(workdir, "crops");
    const { code, out } = await run(["detect", RECEIPT, "--save-crops", cropDir, "-q"]);
    expect(code).toBe(0);
    const boxes = JSON.parse(out) as unknown[];
    expect(existsSync(join(cropDir, "crop_000.png"))).toBe(true);
    expect(boxes.length).toBeGreaterThan(0);
  });

  test("requires exactly one image", async () => {
    const { code } = await run(["detect", RECEIPT, TILTED, "-q"]);
    expect(code).toBe(2);
  });
});

describe("batch", () => {
  test("--json returns one index-aligned entry per image", async () => {
    const { code, out } = await run(["batch", TILTED, RECEIPT, "--json", "-q"]);
    expect(code).toBe(0);
    const entries = JSON.parse(out) as { file: string; status: string; result?: unknown }[];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.file).toBe(TILTED);
    expect(entries[1]?.file).toBe(RECEIPT);
    expect(entries.every((e) => e.status === "fulfilled")).toBe(true);
  });

  test("text output delimits each file", async () => {
    const { out } = await run(["batch", TILTED, "-q"]);
    expect(out).toContain(`==> ${TILTED} <==`);
  });

  test("an undecodable image is isolated and reported, with exit code 1", async () => {
    const { code, out } = await run(["batch", TILTED, badImage, "--json", "-q"]);
    expect(code).toBe(1);
    const entries = JSON.parse(out) as { file: string; status: string; error?: string }[];
    const bad = entries.find((e) => e.file === badImage);
    expect(bad?.status).toBe("rejected");
    expect(typeof bad?.error).toBe("string");
  });
});

describe("stream", () => {
  test("emits one block per image as work completes", async () => {
    const { code, out } = await run(["stream", TILTED, RECEIPT, "-q"]);
    expect(code).toBe(0);
    expect(out.match(/==>/g)?.length).toBe(2);
  });

  test("--json emits NDJSON, one object per line", async () => {
    const { out } = await run(["stream", TILTED, RECEIPT, "--json", "-q"]);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

// ─── Utility commands ───────────────────────────────────────────────────────

describe("utility commands", () => {
  test("models reports the active configuration as JSON", async () => {
    const { code, out } = await run(["models", "--json"]);
    expect(code).toBe(0);
    const info = JSON.parse(out) as { models: { detection: string }; engine: string };
    expect(info.models.detection).toContain("PP-OCRv6");
    expect(info.engine).toBe("opencv");
  });

  test("models reflects overrides", async () => {
    const { out } = await run(["models", "--json", "--engine", "canvas-native"]);
    expect((JSON.parse(out) as { engine: string }).engine).toBe("canvas-native");
  });

  test("download-models succeeds against the warm cache", async () => {
    expect((await run(["download-models", "-q"])).code).toBe(0);
  });
});
