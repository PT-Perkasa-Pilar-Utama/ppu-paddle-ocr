# Contributing to ppu-paddle-ocr

Thank you for taking the time to contribute. This document covers how to set up your environment, what checks are required before opening a PR, and the conventions we follow.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Code Quality](#code-quality)
- [How tests run](#how-tests-run)
- [Developer Certificate of Origin](#developer-certificate-of-origin)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Cutting a release](#cutting-a-release)
- [Reporting Issues](#reporting-issues)
- [Community](#community)

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/ppu-paddle-ocr.git
   cd ppu-paddle-ocr
   ```
3. **Install dependencies** (requires [Bun](https://bun.sh)):
   ```bash
   bun install
   ```
4. **Create a feature branch** off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Setup

The recommended development environment is Linux-based. macOS works fine too; Windows users may encounter path differences in some scripts.

Bun is the primary runtime and package manager. Every CI workflow pins Bun at **1.3.14**; earlier versions carried test-runner bugs that produced false failures on Linux. Use the same version locally:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
```

Pre-commit hooks are set up via Husky and run automatically after `bun install`. They enforce formatting and linting before every commit.

## Making Changes

- Keep changes focused. One feature or bug fix per PR makes review faster.
- **Any change to behavior must add or update tests.** New options, bug fixes,
  detection/recognition changes, and public-API changes all require test
  coverage in the same PR. A reviewer will ask for tests before merging if they
  are missing.
- Update `README.md` if you change public-facing options, defaults, or the setup steps.
- Add an entry under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes.

### What we accept

A pull request is ready to merge when it:

- solves one clearly described problem and links its issue (if any);
- passes every check in [Code Quality](#code-quality) and the required CI run;
- adds or updates tests for the behavior it changes;
- keeps the public API stable, or documents the break and bumps the version
  accordingly;
- carries a signed-off commit (see [Developer Certificate of Origin](#developer-certificate-of-origin)).

Maintainers may decline changes that broaden scope beyond OCR, add heavy
dependencies, or regress accuracy or performance without justification.

## How tests run

`bun test` runs the suite locally. CI runs the same suite on every push and
pull request to `main`, and the `Quality Checks and Tests` job is a **required
status check**: a pull request cannot merge until it passes. Coverage is
collected on each run (`bun run test --coverage`). Run the tests locally before
pushing so CI only confirms what you already know.

On a cold cache the suite downloads the default PP-OCRv6 models (~30 MB) on
first run and caches them under `~/.cache/ppu-paddle-ocr`; later runs read from
disk. The long per-test timeouts (up to 600 s on the model-download specs) exist
to cover that first download on a slow connection - they are expected, not a
hang.

## Developer Certificate of Origin

Every commit must be signed off under the [Developer Certificate of Origin
(DCO)](https://developercertificate.org/). The sign-off is your statement that
you wrote the change, or have the right to submit it under the project's MIT
license.

Add it with `-s`:

```bash
git commit -s -m "fix: correct box ordering in cross-line strategy"
```

This appends a `Signed-off-by:` trailer to your commit message. Commits without
a sign-off will be asked to amend before merge (`git commit --amend -s`).

## Code Quality

All of the following must pass before a PR can be merged. CI enforces them automatically, but run them locally first:

| Check           | Command              |
| :-------------- | :------------------- |
| Tests           | `bun test`           |
| Build + Tests   | `bun run build:test` |
| Linting         | `bun run lint`       |
| Auto-fix lint   | `bun run lint:fix`   |
| Formatting      | `bun run fmt`        |
| Auto-fix format | `bun run fmt:fix`    |
| Type check      | `bun run type-check` |

### File size

No TypeScript file may exceed **300 lines of code** (blank lines and comments
excluded). The `max-lines` oxlint rule enforces this as an error, so
`bun run lint` fails on any `.ts` file that crosses the cap. When a file grows
past it, split the logic into focused modules - extract pure helpers into a
sibling file (e.g. the recognition service's CTC decoding, image-tensor, and
line-grouping helpers live under `src/core/recognition/`). Keep the public class
API unchanged; move only internal helpers, and give each exported symbol a
concise JSDoc comment.

If your change touches the hot path (detection, recognition, preprocessing), run the benchmarks and include before/after numbers in your PR:

```bash
bun bench/index.bench.ts   # recognition strategies + accuracy
bun bench/batch.bench.ts   # batch vs concurrent recognize(), peak RSS
```

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a pull request against `main` on the upstream repo.
3. Fill out the PR template completely - the "What / Why / How" sections and checklist.
4. CI will run automatically. Fix any failures before requesting review.
5. A maintainer will review your PR. Address feedback, then request a re-review.

PRs are rebase-merged to keep each logically distinct commit on `main`. Keep your
commit history clean - squash fixup commits locally before review, and make every
commit message follow the project's Conventional Commits format.

## Cutting a release

Maintainers only. The version lives in more places than the two manifests, so
`bun bump` rewrites all of them in one pass and commits the result:

```bash
git checkout -b release/6.4.0
bun bump minor            # or major, patch, fix, or an explicit 6.4.0
```

| Touchpoint                 | What it does                                                                                    |
| :------------------------- | :---------------------------------------------------------------------------------------------- |
| `package.json`, `jsr.json` | the published version, kept in lockstep                                                         |
| `playground/index.html`    | the CDN fallback pin, which otherwise goes stale                                                |
| `CHANGELOG.md`             | promotes `## [Unreleased]` to a dated heading, sorting its sections into Keep a Changelog order |
| `apps/serve` (4 files)     | the REST envelope version, patch-bumped by default                                              |

The CLI reads `package.json` at runtime, so it needs no edit.

Options: `--serve <spec>` gives the serve app its own bump level, `--serve none`
leaves it alone, and `--no-commit` writes the files without staging them. The
command refuses to run on `main` and refuses to promote an empty `[Unreleased]`
section, so write the release notes first.

After the release PR merges:

```bash
git tag -s v6.4.0 -m "v6.4.0" && git push origin v6.4.0
gh release create v6.4.0 --title "6.4.0" --notes "<the CHANGELOG section>"
gh workflow run deploy-serve.yml
```

The release also triggers `cli-binaries.yml`, which builds the standalone CLI
executables, smoke-tests them on all four OS runners, signs them, and attaches
them to the release - it finishes some minutes after the release is published,
so don't be surprised if the binaries appear late.

Publishing to npm and JSR is triggered by the GitHub release, so the signed tag
has to be pushed first. Sync the wiki for any user-visible API change.

## Reporting Issues

Use the [GitHub issue tracker](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues). Issue templates are available for:

- Bug reports
- Feature requests
- Accuracy issues
- Performance issues
- Installation issues
- Documentation gaps

For security vulnerabilities, **do not open a public issue** - see [SECURITY.md](SECURITY.md) instead.

## Community

Join the [Slack community](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg) for questions, ideas, and discussion.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) in all interactions.
