/// <reference types='bun-types' />
/**
 * One-shot release version bump.
 *
 *   bun bump minor
 *   bun bump 6.4.0 --serve minor
 *   bun bump patch --no-commit
 *
 * Rewrites every version touchpoint, promotes the CHANGELOG's Unreleased
 * section into a dated release heading, and commits the result. The CLI reads
 * package.json at runtime, so it carries no version string of its own.
 */
import { $, file, write } from "bun";
import { join } from "node:path";

/** The semver shape this project uses: three numbers, no prerelease tags. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** A version-bearing spot in a file. Capture group 1 is the version to rewrite. */
type Touchpoint = { path: string; pattern: RegExp };

const LIBRARY_TOUCHPOINTS: Touchpoint[] = [
  { path: "package.json", pattern: /"version":\s*"(\d+\.\d+\.\d+)"/ },
  { path: "jsr.json", pattern: /"version":\s*"(\d+\.\d+\.\d+)"/ },
  { path: "playground/index.html", pattern: /ppu-paddle-ocr@(\d+\.\d+\.\d+)/g },
];

/** The serve app versions its REST envelope separately from the library. */
const SERVE_TOUCHPOINTS: Touchpoint[] = [
  { path: "apps/serve/package.json", pattern: /"version":\s*"(\d+\.\d+\.\d+)"/ },
  { path: "apps/serve/src/app.ts", pattern: /version:\s*"(\d+\.\d+\.\d+)"/ },
  { path: "apps/serve/src/core/api-response.ts", pattern: /API_VERSION = "(\d+\.\d+\.\d+)"/ },
  { path: "apps/serve/README.md", pattern: /"version":\s*"(\d+\.\d+\.\d+)"/g },
];

const CHANGELOG = "CHANGELOG.md";
const UNRELEASED = "## [Unreleased]";

/** Keep a Changelog's section order. Anything else keeps its relative place at the end. */
const SECTION_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** One rewritten file. */
export type VersionChange = {
  /** Path relative to the repo root. */
  path: string;
  /** Version the file carried before the bump. */
  from: string;
  /** Version the file carries now. */
  to: string;
};

/** What a bump did, for reporting and for building the commit message. */
export type BumpResult = {
  /** New library version. */
  version: string;
  /** Library version before the bump. */
  previous: string;
  /** New serve version, or null when the serve bump was skipped. */
  serveVersion: string | null;
  /** Release date stamped into the CHANGELOG heading. */
  date: string;
  /** Every file rewritten, in the order they were written. */
  changes: VersionChange[];
  /** Non-fatal oddities, such as a touchpoint that had drifted out of sync. */
  warnings: string[];
};

/** Inputs for {@link bumpVersions}. */
export type BumpOptions = {
  /** Repo root to rewrite. */
  root: string;
  /** `major`, `minor`, `patch` (or `fix`), or an explicit `x.y.z`. */
  spec: string;
  /** Same grammar as `spec`, plus `none` to leave the serve app alone. Defaults to `patch`. */
  serve?: string;
  /** Release date for the CHANGELOG heading. Defaults to today, in local time. */
  today?: Date;
};

/** `true` when `candidate` sorts strictly after `current`. */
function isNewer(candidate: string, current: string): boolean {
  const next = candidate.split(".").map(Number);
  const now = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i] > now[i];
  }
  return false;
}

/** Resolve a bump spec against the current version. */
export function nextVersion(current: string, spec: string): string {
  const parsed = current.match(VERSION);
  if (!parsed) throw new Error(`Cannot parse the current version "${current}"`);

  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  const patch = Number(parsed[3]);

  if (spec === "major") return `${major + 1}.0.0`;
  if (spec === "minor") return `${major}.${minor + 1}.0`;
  if (spec === "patch" || spec === "fix") return `${major}.${minor}.${patch + 1}`;

  if (!VERSION.test(spec)) {
    throw new Error(`Expected major, minor, patch, or an x.y.z version, got "${spec}"`);
  }
  if (!isNewer(spec, current)) {
    throw new Error(`Version ${spec} is not newer than the current ${current}`);
  }
  return spec;
}

/** Local calendar date as `YYYY-MM-DD`. `toISOString` would report UTC and can slip a day. */
export function releaseDate(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/** Where a `### Heading` block sorts. A preamble stays on top, unknown headings sink. */
function sectionRank(block: string): number {
  if (!block.startsWith("### ")) return -1;
  const name = (block.split("\n", 1)[0] ?? "").slice(4).trim();
  const rank = SECTION_ORDER.indexOf(name);
  return rank === -1 ? SECTION_ORDER.length : rank;
}

/**
 * Sort the `###` blocks of one release into {@link SECTION_ORDER}, verbatim.
 *
 * The sort is stable, so repeated or unrecognised headings keep the order the
 * author wrote them in.
 */
export function orderSections(notes: string): string {
  return notes
    .split(/^(?=### )/m)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .sort((a, b) => sectionRank(a) - sectionRank(b))
    .join("\n\n");
}

/**
 * Insert a dated release heading under `## [Unreleased]`, leaving that heading in
 * place, and sort the promoted notes into Keep a Changelog's section order.
 * Earlier releases are never touched.
 */
export function promoteChangelog(text: string, version: string, date: string): string {
  const heading = `## [${version}]`;
  if (text.includes(heading)) {
    throw new Error(`${CHANGELOG} already has a ${heading} section`);
  }

  const start = text.indexOf(UNRELEASED);
  if (start === -1) {
    throw new Error(`${CHANGELOG} has no ${UNRELEASED} section to promote`);
  }

  const rest = text.slice(start + UNRELEASED.length);
  const nextHeading = rest.search(/^## \[/m);
  const notes = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  if (notes.length === 0) {
    throw new Error(`${CHANGELOG} ${UNRELEASED} section is empty - write the release notes first`);
  }

  const earlier = nextHeading === -1 ? "" : rest.slice(nextHeading);
  const body = earlier ? `${orderSections(notes)}\n\n${earlier}` : `${orderSections(notes)}\n`;
  return `${text.slice(0, start + UNRELEASED.length)}\n\n${heading} - ${date}\n\n${body}`;
}

/** Rewrite every version this pattern matches, reporting the first one it found. */
function swapVersion(text: string, pattern: RegExp, to: string): { text: string; from: string } {
  let from = "";
  const rewritten = text.replace(pattern, (match: string, current: string) => {
    from ||= current;
    return match.replace(current, to);
  });
  if (from === "") throw new Error(`No version matching ${pattern} found`);
  return { text: rewritten, from };
}

/** Read a touchpoint, failing loudly rather than silently skipping a missing file. */
async function readFile(root: string, path: string): Promise<string> {
  const handle = file(join(root, path));
  if (!(await handle.exists())) throw new Error(`Missing version touchpoint: ${path}`);
  return handle.text();
}

/** Current version of a manifest, used as the base for a relative bump. */
async function readManifestVersion(root: string, path: string): Promise<string> {
  const match = (await readFile(root, path)).match(/"version":\s*"(\d+\.\d+\.\d+)"/);
  if (!match?.[1]) throw new Error(`No version field in ${path}`);
  return match[1];
}

/** Plan the rewrite of one touchpoint group, warning when a file had drifted. */
function planEdits(
  sources: Map<string, string>,
  touchpoints: Touchpoint[],
  to: string,
  expected: string,
  warnings: string[]
): { path: string; text: string; change: VersionChange }[] {
  return touchpoints.map((touchpoint) => {
    const source = sources.get(touchpoint.path) ?? "";
    const { text, from } = swapVersion(source, touchpoint.pattern, to);
    if (from !== expected) {
      warnings.push(`${touchpoint.path} was on ${from}, not ${expected} - rewritten to ${to}`);
    }
    return { path: touchpoint.path, text, change: { path: touchpoint.path, from, to } };
  });
}

/**
 * Rewrite every version touchpoint under `root`.
 *
 * Everything is read and validated before anything is written, so a bad spec or
 * an empty changelog leaves the tree untouched.
 */
export async function bumpVersions(options: BumpOptions): Promise<BumpResult> {
  const { root, spec, serve = "patch", today = new Date() } = options;

  const previous = await readManifestVersion(root, "package.json");
  const version = nextVersion(previous, spec);
  const date = releaseDate(today);
  const warnings: string[] = [];

  const bumpServe = serve !== "none";
  const touchpoints = bumpServe
    ? [...LIBRARY_TOUCHPOINTS, ...SERVE_TOUCHPOINTS]
    : LIBRARY_TOUCHPOINTS;

  const sources = new Map<string, string>();
  for (const touchpoint of [...touchpoints, { path: CHANGELOG, pattern: VERSION }]) {
    sources.set(touchpoint.path, await readFile(root, touchpoint.path));
  }

  const edits = planEdits(sources, LIBRARY_TOUCHPOINTS, version, previous, warnings);

  edits.push({
    path: CHANGELOG,
    text: promoteChangelog(sources.get(CHANGELOG) ?? "", version, date),
    change: { path: CHANGELOG, from: UNRELEASED, to: `[${version}] - ${date}` },
  });

  let serveVersion: string | null = null;
  if (bumpServe) {
    const servePrevious = await readManifestVersion(root, "apps/serve/package.json");
    serveVersion = nextVersion(servePrevious, serve);
    edits.push(...planEdits(sources, SERVE_TOUCHPOINTS, serveVersion, servePrevious, warnings));
  }

  for (const edit of edits) {
    await write(join(root, edit.path), edit.text);
  }

  return {
    version,
    previous,
    serveVersion,
    date,
    changes: edits.map((edit) => edit.change),
    warnings,
  };
}

/** Commit message for a completed bump, wrapped for `git log`. */
export function commitMessage(result: BumpResult): string {
  const lines = [
    `chore: bump version to ${result.version}`,
    "",
    `Moves the Unreleased changelog into ${result.version} and points the`,
    "playground CDN fallback at the new version.",
  ];
  if (result.serveVersion) {
    lines.push("", `Serve goes to ${result.serveVersion} so the image publishes against it.`);
  }
  return lines.join("\n");
}

/** Stage exactly what the bump rewrote and commit it. */
export async function commitBump(root: string, result: BumpResult): Promise<void> {
  const paths = result.changes.map((change) => change.path);
  await $`git add ${paths}`.cwd(root).quiet();
  await $`git commit -F - < ${Buffer.from(commitMessage(result))}`.cwd(root).quiet();
}

/** Keep release commits off main, which is protected and merges only via PR. */
export async function assertNotOnMain(root: string): Promise<void> {
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(root).text()).trim();
  if (branch === "main") {
    throw new Error("Refusing to commit a release on main. Branch first, e.g. release/x.y.z");
  }
}

const HELP = `Usage: bun bump <major|minor|patch|fix|x.y.z> [options]

Options:
  --serve <spec>  Serve app bump: same grammar, or "none" to skip. Default: patch
  --no-commit     Rewrite the files but leave them unstaged`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const spec = args[0];
  if (!spec || spec === "--help" || spec === "-h") {
    console.log(HELP);
    process.exit(spec ? 0 : 1);
  }

  const serveIndex = args.indexOf("--serve");
  const serve = serveIndex === -1 ? undefined : args[serveIndex + 1];
  const commit = !args.includes("--no-commit");
  const root = join(import.meta.dir, "..");

  if (commit) await assertNotOnMain(root);

  const result = await bumpVersions({ root, spec, serve });

  console.log(`\n${result.previous} -> ${result.version}`);
  if (result.serveVersion) console.log(`serve -> ${result.serveVersion}`);
  console.log("");
  for (const change of result.changes) {
    console.log(`  ${change.path.padEnd(36)} ${change.from} -> ${change.to}`);
  }
  for (const warning of result.warnings) console.log(`\n  warning: ${warning}`);

  if (commit) {
    await commitBump(root, result);
    console.log(`\ncommitted: chore: bump version to ${result.version}`);
  }

  console.log(
    `\nNext: open the release PR, then after merge\n` +
      `  git tag -s v${result.version} -m "v${result.version}" && git push origin v${result.version}\n` +
      `  gh release create v${result.version} --title "${result.version}" --notes "<CHANGELOG section>"\n` +
      `  gh workflow run deploy-serve.yml`
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(`\nbump failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
