# Reproducible build

ppu-paddle-ocr produces a **byte-identical** build from the same source:
rebuilding the package yields the same `lib/` output, with no embedded
timestamps, absolute paths, or other nondeterministic data.

## Why it is deterministic

`bun run build` (see `scripts/build.ts`) transpiles `src/**/*.ts` to `lib/` with
Bun's transpiler and writes type declarations. The transform is a pure function
of the source files and the pinned toolchain:

- **Toolchain is pinned.** Bun is pinned to 1.2.23 in CI; dependencies are
  pinned in `bun.lock` and installed with `--frozen-lockfile`.
- **No nondeterministic inputs.** The build embeds no build time, hostname, or
  absolute path. File order is sorted; output is minified deterministically.
- **Model files are not generated.** The ONNX models shipped with the package
  are committed binaries, not build artifacts, so they never vary between runs.

## Verify it yourself

```bash
bun install --frozen-lockfile
bun run build
h1=$(find lib -type f -exec shasum {} \; | sort | shasum)

rm -rf lib
bun run build
h2=$(find lib -type f -exec shasum {} \; | sort | shasum)

[ "$h1" = "$h2" ] && echo "reproducible" || echo "NOT reproducible"
```

Both hashes match. CI enforces this on every push and pull request via the
**"Verify reproducible build"** step in `.github/workflows/ci.yml`, which builds
twice and fails if the output differs.
