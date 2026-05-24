/// <reference types='bun-types' />
/**
 * Coverage gate. The web entry point needs browser canvas globals
 * (see tests/web-canvas-polyfill.ts) that would make ppu-ocv's node path take
 * the browser branch, so the web tests cannot share a process with the node
 * OCR tests. We run two isolated, serial passes (serial keeps the coverage
 * merge accurate) and combine their lcov, then enforce a single line-coverage
 * floor across the union.
 */
import { rmSync } from "node:fs";

const THRESHOLD = 0.9;

const allFiles = [
  ...new Bun.Glob("**/*.test.ts").scanSync("tests"),
  ...new Bun.Glob("**/*.test.ts").scanSync("private-tests"),
];
const webFiles = ["tests/web-ocr.test.ts", "tests/web-support.test.ts"];
const nodeFiles = allFiles
  .map((f) => (f.startsWith("tests/") || f.startsWith("private-tests/") ? f : `tests/${f}`))
  .filter((f) => !webFiles.includes(f));

rmSync("coverage", { recursive: true, force: true });

async function run(files: string[], dir: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      ...files,
      "--coverage",
      "--coverage-reporter=lcov",
      `--coverage-dir=coverage/${dir}`,
    ],
    { stdout: "inherit", stderr: "inherit" }
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`\nTest run failed (${dir}).`);
    process.exit(code);
  }
}

await run(nodeFiles, "node");
await run(webFiles, "web");

// Merge lcov: union of source files; a line counts as covered if any pass hit it.
const hits = new Map<string, Map<number, number>>();
for (const dir of ["node", "web"]) {
  const path = `coverage/${dir}/lcov.info`;
  if (!(await Bun.file(path).exists())) continue;
  let file = "";
  for (const line of (await Bun.file(path).text()).split("\n")) {
    if (line.startsWith("SF:")) {
      file = line.slice(3);
    } else if (line.startsWith("DA:") && file) {
      const [ln, count] = line.slice(3).split(",").map(Number);
      const m = hits.get(file) ?? new Map<number, number>();
      hits.set(file, m);
      m.set(ln, Math.max(m.get(ln) ?? 0, count));
    }
  }
}

let total = 0;
let covered = 0;
for (const m of hits.values()) {
  for (const count of m.values()) {
    total++;
    if (count > 0) covered++;
  }
}

const pct = total === 0 ? 0 : covered / total;
console.log(`\nCombined line coverage: ${(pct * 100).toFixed(2)}% (${covered}/${total})`);
if (pct < THRESHOLD) {
  console.error(`Below threshold of ${(THRESHOLD * 100).toFixed(0)}%.`);
  process.exit(1);
}
console.log(`Meets the ${(THRESHOLD * 100).toFixed(0)}% threshold.`);
