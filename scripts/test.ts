/// <reference types='bun-types' />
/**
 * Test runner. The web entry point needs browser canvas globals that would make
 * ppu-ocv's node path take the browser branch, so the web tests run in their
 * own process, after the node suite. The node suite runs in parallel for speed;
 * the web suite runs alone.
 */
const all = [
  ...new Bun.Glob("**/*.test.ts").scanSync("tests"),
  ...[...new Bun.Glob("**/*.test.ts").scanSync("private-tests")].map((f) => `private-tests/${f}`),
].map((f) => (f.includes("/") ? f : `tests/${f}`));

const webFiles = ["tests/web-ocr.test.ts"];
const nodeFiles = all.filter((f) => !webFiles.includes(f));

async function run(files: string[], parallel: number): Promise<void> {
  const args = ["test", ...files];
  if (parallel > 1) args.push(`--parallel=${parallel}`);
  const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

await run(nodeFiles, nodeFiles.length);
await run(webFiles, 1);
