/// <reference types='bun-types' />
import { chmodSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path/posix";

import tsconfig from "../tsconfig.json";

// Constants
const ROOTDIR = resolve(import.meta.dir, "..");
const SOURCEDIR = `${ROOTDIR}/src`;
const OUTDIR = join(ROOTDIR, tsconfig.compilerOptions.declarationDir);

// Remove old content
if (existsSync(OUTDIR)) rmSync(OUTDIR, { recursive: true });

// Emit all .d.ts in one native tsc pass (tsconfig.build.json scopes it to
// src/ rooted at lib/). typescript 7 dropped the transpileDeclaration JS API
// this script previously used, but its Go tsc emits identical output.
const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(ROOTDIR, "tsconfig.build.json")], {
  cwd: ROOTDIR,
  stdout: "inherit",
  stderr: "inherit",
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

// Transpile files concurrently
const transpiler = new Bun.Transpiler({
  loader: "ts",
  target: "node",

  // Lighter output
  minifyWhitespace: true,
  treeShaking: true,
});

for (const path of new Bun.Glob("**/*.ts").scanSync(SOURCEDIR)) {
  const srcPath = `${SOURCEDIR}/${path}`;

  const pathExtStart = path.lastIndexOf(".");
  const outPathNoExt = `${OUTDIR}/${path.substring(0, pathExtStart >>> 0)}`;

  const buf = await Bun.file(srcPath).text();
  const res = transpiler.transformSync(buf);
  if (res.length !== 0) {
    let js = res.replace(/const /g, "let ");

    // Preserve a leading shebang the transpiler strips, then mark the bin
    // executable so `npx`/`bunx ppu-paddle-ocr` can run it directly.
    const shebang = buf.startsWith("#!") ? buf.slice(0, buf.indexOf("\n")) : null;
    if (shebang && !js.startsWith("#!")) js = `${shebang}\n${js}`;

    const outFile = `${outPathNoExt}.js`;
    await Bun.write(outFile, js);
    if (shebang) chmodSync(outFile, 0o755);
  }
}
