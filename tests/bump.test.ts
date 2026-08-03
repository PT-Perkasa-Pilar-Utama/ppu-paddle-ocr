// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Unit tests for the release bump tool. Every case runs against a throwaway
 * fixture tree in the OS temp dir, never against the real repo.
 */
import { $ } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertNotOnMain,
  bumpVersions,
  commitBump,
  commitMessage,
  nextVersion,
  promoteChangelog,
  releaseDate,
} from "../scripts/bump.js";

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- something worth releasing

## [6.1.0] - 2026-07-13

### Added

- older news
`;

const EMPTY_CHANGELOG = `# Changelog

## [Unreleased]

## [6.1.0] - 2026-07-13

### Added

- older news
`;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type FixtureOptions = {
  version?: string;
  serve?: string;
  playgroundPin?: string;
  changelog?: string;
};

/** Build a minimal tree with the same version touchpoints as the repo. */
async function fixture(options: FixtureOptions = {}): Promise<string> {
  const {
    version = "6.2.0",
    serve = "0.3.0",
    playgroundPin = version,
    changelog = CHANGELOG,
  } = options;

  const root = await mkdtemp(join(tmpdir(), "ppu-bump-"));
  roots.push(root);

  const write = (path: string, text: string) => Bun.write(join(root, path), text);
  await Promise.all([
    write("package.json", `{\n  "name": "ppu-paddle-ocr",\n  "version": "${version}"\n}\n`),
    write("jsr.json", `{\n  "name": "@snowfluke/ppu-paddle-ocr",\n  "version": "${version}"\n}\n`),
    write(
      "playground/index.html",
      `import "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.mjs";\n` +
        `await import("https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@${playgroundPin}/web/index.js");\n`
    ),
    write("CHANGELOG.md", changelog),
    write(
      "apps/serve/package.json",
      `{\n  "name": "ppu-paddle-ocr-serve",\n  "version": "${serve}"\n}\n`
    ),
    write(
      "apps/serve/README.md",
      `{ "status": "success", "version": "${serve}" }\n` +
        `{ "status": "error", "version": "${serve}" }\n`
    ),
    write("apps/serve/src/app.ts", `const doc = { info: { version: "${serve}" } };\n`),
    write("apps/serve/src/core/api-response.ts", `export const API_VERSION = "${serve}";\n`),
  ]);

  return root;
}

const read = (root: string, path: string) => Bun.file(join(root, path)).text();

describe("nextVersion", () => {
  test.each([
    ["major", "7.0.0"],
    ["minor", "6.3.0"],
    ["patch", "6.2.1"],
    ["fix", "6.2.1"],
    ["6.4.0", "6.4.0"],
  ])("%s resolves to %s", (spec, expected) => {
    expect(nextVersion("6.2.0", spec)).toBe(expected);
  });

  test("compares components, so 6.10.0 is newer than 6.9.0", () => {
    expect(nextVersion("6.9.0", "6.10.0")).toBe("6.10.0");
  });

  test.each([["6.2.0"], ["6.1.9"], ["5.9.9"]])("rejects %s as not newer than 6.2.0", (spec) => {
    expect(() => nextVersion("6.2.0", spec)).toThrow("not newer");
  });

  test("rejects a spec that is neither a level nor a version", () => {
    expect(() => nextVersion("6.2.0", "6.3")).toThrow("Expected major, minor, patch");
  });

  test("rejects an unparsable current version", () => {
    expect(() => nextVersion("6.2.0-rc.1", "minor")).toThrow("Cannot parse");
  });
});

describe("releaseDate", () => {
  test("stamps the local calendar date", () => {
    expect(releaseDate(new Date(2026, 7, 3, 14, 30))).toBe("2026-08-03");
  });

  test("does not slip a day in positive UTC offsets", () => {
    // 00:30 local on new year's day is still the previous year in UTC.
    expect(releaseDate(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });
});

describe("promoteChangelog", () => {
  test("inserts a dated heading and keeps Unreleased on top", () => {
    const promoted = promoteChangelog(CHANGELOG, "6.3.0", "2026-08-03");

    expect(promoted).toContain("## [Unreleased]\n\n## [6.3.0] - 2026-08-03\n\n### Fixed");
    expect(promoted).toContain("## [6.1.0] - 2026-07-13");
  });

  test("sorts the promoted notes into Keep a Changelog order", () => {
    const source = `# Changelog

## [Unreleased]

### Fixed

- a fix

### Added

- an addition

## [6.1.0] - 2026-07-13

### Fixed

- older news
`;

    const promoted = promoteChangelog(source, "6.3.0", "2026-08-03");

    expect(promoted).toContain(
      "## [6.3.0] - 2026-08-03\n\n### Added\n\n- an addition\n\n### Fixed\n\n- a fix\n\n## [6.1.0]"
    );
  });

  test("leaves earlier releases in the order they were written", () => {
    const source = `# Changelog

## [Unreleased]

### Added

- new

## [6.1.0] - 2026-07-13

### Fixed

- old fix

### Added

- old addition
`;

    const promoted = promoteChangelog(source, "6.3.0", "2026-08-03");

    expect(promoted).toContain("## [6.1.0] - 2026-07-13\n\n### Fixed\n\n- old fix\n\n### Added");
  });

  test("keeps a section it does not recognise, after the ones it does", () => {
    const source = "# Changelog\n\n## [Unreleased]\n\n### Notes\n\n- note\n\n### Added\n\n- new\n";

    const promoted = promoteChangelog(source, "6.3.0", "2026-08-03");

    expect(promoted).toContain("### Added\n\n- new\n\n### Notes\n\n- note");
  });

  test("keeps a preamble above the sections", () => {
    const source = "# Changelog\n\n## [Unreleased]\n\nHeads up.\n\n### Added\n\n- new\n";

    const promoted = promoteChangelog(source, "6.3.0", "2026-08-03");

    expect(promoted).toContain("## [6.3.0] - 2026-08-03\n\nHeads up.\n\n### Added");
  });

  test("refuses an empty Unreleased section", () => {
    expect(() => promoteChangelog(EMPTY_CHANGELOG, "6.3.0", "2026-08-03")).toThrow("is empty");
  });

  test("refuses a version that already has a section", () => {
    expect(() => promoteChangelog(CHANGELOG, "6.1.0", "2026-08-03")).toThrow("already has");
  });

  test("refuses a changelog with no Unreleased section", () => {
    expect(() => promoteChangelog("# Changelog\n", "6.3.0", "2026-08-03")).toThrow("no ## [Unrele");
  });
});

describe("bumpVersions", () => {
  test("rewrites every library touchpoint", async () => {
    const root = await fixture();

    const result = await bumpVersions({ root, spec: "minor", today: new Date(2026, 7, 3) });

    expect(result.previous).toBe("6.2.0");
    expect(result.version).toBe("6.3.0");
    expect(await read(root, "package.json")).toContain(`"version": "6.3.0"`);
    expect(await read(root, "jsr.json")).toContain(`"version": "6.3.0"`);
    expect(await read(root, "playground/index.html")).toContain("ppu-paddle-ocr@6.3.0");
    expect(await read(root, "CHANGELOG.md")).toContain("## [6.3.0] - 2026-08-03");
    expect(result.warnings).toEqual([]);
  });

  test("leaves other pinned packages in the playground alone", async () => {
    const root = await fixture();

    await bumpVersions({ root, spec: "minor" });

    expect(await read(root, "playground/index.html")).toContain("onnxruntime-web@1.26.0");
  });

  test("patch-bumps the serve app in all four places by default", async () => {
    const root = await fixture();

    const result = await bumpVersions({ root, spec: "minor" });

    expect(result.serveVersion).toBe("0.3.1");
    expect(await read(root, "apps/serve/package.json")).toContain(`"version": "0.3.1"`);
    expect(await read(root, "apps/serve/src/app.ts")).toContain(`version: "0.3.1"`);
    expect(await read(root, "apps/serve/src/core/api-response.ts")).toContain(
      `API_VERSION = "0.3.1"`
    );
    expect((await read(root, "apps/serve/README.md")).match(/0\.3\.1/g)).toHaveLength(2);
  });

  test("accepts its own spec for the serve app", async () => {
    const root = await fixture();

    const result = await bumpVersions({ root, spec: "patch", serve: "minor" });

    expect(result.serveVersion).toBe("0.4.0");
  });

  test("skips the serve app entirely on none", async () => {
    const root = await fixture();

    const result = await bumpVersions({ root, spec: "minor", serve: "none" });

    expect(result.serveVersion).toBeNull();
    expect(await read(root, "apps/serve/package.json")).toContain(`"version": "0.3.0"`);
    expect(result.changes.map((change) => change.path)).not.toContain("apps/serve/package.json");
  });

  test("warns about a drifted touchpoint and pulls it back in line", async () => {
    const root = await fixture({ playgroundPin: "6.0.0" });

    const result = await bumpVersions({ root, spec: "minor" });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("playground/index.html was on 6.0.0");
    expect(await read(root, "playground/index.html")).toContain("ppu-paddle-ocr@6.3.0");
  });

  test("writes nothing when the changelog has no release notes", async () => {
    const root = await fixture({ changelog: EMPTY_CHANGELOG });

    expect(bumpVersions({ root, spec: "minor" })).rejects.toThrow("is empty");
    expect(await read(root, "package.json")).toContain(`"version": "6.2.0"`);
  });

  test("names the file that is missing", async () => {
    const root = await fixture();
    await rm(join(root, "jsr.json"));

    expect(bumpVersions({ root, spec: "minor" })).rejects.toThrow("Missing version touchpoint");
  });
});

describe("commitMessage", () => {
  test("mentions the serve bump only when there was one", async () => {
    const root = await fixture();

    const withServe = commitMessage(await bumpVersions({ root, spec: "minor" }));
    const withoutServe = commitMessage(
      await bumpVersions({ root: await fixture(), spec: "minor", serve: "none" })
    );

    expect(withServe.split("\n")[0]).toBe("chore: bump version to 6.3.0");
    expect(withServe).toContain("Serve goes to 0.3.1");
    expect(withoutServe).not.toContain("Serve goes to");
  });

  test("keeps every line inside the 80 column cap", async () => {
    const message = commitMessage(await bumpVersions({ root: await fixture(), spec: "minor" }));

    for (const line of message.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });
});

/** Fixture tree that is also a git repo, with a base commit in place. */
async function gitFixture(options: FixtureOptions = {}): Promise<string> {
  const root = await fixture(options);
  await $`git init -q -b main`.cwd(root).quiet();
  await $`git config user.email test@example.com`.cwd(root).quiet();
  await $`git config user.name Test`.cwd(root).quiet();
  await $`git config commit.gpgsign false`.cwd(root).quiet();
  await $`git add -A`.cwd(root).quiet();
  await $`git commit -q -m base`.cwd(root).quiet();
  return root;
}

describe("assertNotOnMain", () => {
  test("refuses to run on main", async () => {
    const root = await gitFixture();

    expect(assertNotOnMain(root)).rejects.toThrow("Refusing to commit a release on main");
  });

  test("allows a release branch", async () => {
    const root = await gitFixture();
    await $`git checkout -q -b release/6.3.0`.cwd(root).quiet();

    expect(assertNotOnMain(root)).resolves.toBeUndefined();
  });
});

describe("commitBump", () => {
  test("stages exactly the rewritten files and leaves the tree clean", async () => {
    const root = await gitFixture();

    const result = await bumpVersions({ root, spec: "minor" });
    await commitBump(root, result);

    const subject = (await $`git log -1 --format=%s`.cwd(root).text()).trim();
    const committed = (await $`git show --name-only --format= HEAD`.cwd(root).text())
      .trim()
      .split("\n")
      .sort();

    expect(subject).toBe("chore: bump version to 6.3.0");
    expect(committed).toEqual(result.changes.map((change) => change.path).sort());
    expect((await $`git status --porcelain`.cwd(root).text()).trim()).toBe("");
  });
});
