// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

// pre-commit hook: package.json and jsr.json must carry the same version.

const read = async (file: string): Promise<string> =>
  ((await Bun.file(file).json()) as { version: string }).version;

const [pkg, jsr] = await Promise.all([read("package.json"), read("jsr.json")]);
if (pkg !== jsr) {
  console.error(`Error: version mismatch - package.json=${pkg} jsr.json=${jsr}`);
  console.error("Bump both manifests to the same version before committing.");
  process.exit(1);
}
