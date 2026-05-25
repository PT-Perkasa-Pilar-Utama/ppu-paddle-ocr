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
// Ship the license with the package — npm reads the SPDX field but the file
// itself must travel for OSI/FSF compliance and the OpenSSF baseline.
await Bun.write(`${OUTDIR}/LICENSE`, Bun.file(`${ROOTDIR}/LICENSE`));
// Ship the COOP/COEP service worker as an opt-in static asset. Consumers on
// hosts that can't set headers (e.g. GitHub Pages) copy it to their served root
// to unlock cross-origin isolation → SharedArrayBuffer → multithreaded WASM.
await Bun.write(`${OUTDIR}/coi-serviceworker.js`, Bun.file(`${ROOTDIR}/coi-serviceworker.js`));

console.log("Prepared publish manifest (scripts + devDependencies stripped).");
