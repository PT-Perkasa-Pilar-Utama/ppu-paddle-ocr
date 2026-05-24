/// <reference types='bun-types' />
import { resolve } from "node:path/posix";

import tsconfig from "../tsconfig.json";

// Copies README + a SANITIZED package.json into the publish dir (lib/).
//
// Consumer safety: the published manifest must not carry `scripts` (a stray
// `prepare`/`postinstall` is the classic supply-chain foothold) or
// `devDependencies` (dead weight consumers never resolve). We strip both so the
// installed package can run no lifecycle code.
const ROOTDIR = resolve(import.meta.dir, "..");
const OUTDIR = `${ROOTDIR}/${tsconfig.compilerOptions.declarationDir}`;

const pkg = (await Bun.file(`${ROOTDIR}/package.json`).json()) as Record<string, unknown>;

delete pkg.scripts;
delete pkg.devDependencies;
delete pkg["lint-staged"];

await Bun.write(`${OUTDIR}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
await Bun.write(`${OUTDIR}/README.md`, Bun.file(`${ROOTDIR}/README.md`));

console.log("Prepared publish manifest (scripts + devDependencies stripped).");
