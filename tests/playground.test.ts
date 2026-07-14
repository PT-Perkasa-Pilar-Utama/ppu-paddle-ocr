import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const playground = resolve(root, "playground");

describe("playground deployment", () => {
  test("ships the complete browser module dependency tree", async () => {
    const build = Bun.spawn(["bun", "run", "playground/build-pages.ts"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await build.exited).toBe(0);

    const missingImports: string[] = [];
    const files = new Bun.Glob("lib/**/*.js").scan({
      cwd: resolve(playground, "dist"),
      absolute: true,
    });

    for await (const file of files) {
      const source = await Bun.file(file).text();
      const imports = source.matchAll(/(?:from|import)\s*\(?["'](\.{1,2}\/[^"']+)["']/g);

      for (const match of imports) {
        const target = resolve(dirname(file), match[1]);
        if (!existsSync(target)) missingImports.push(`${file} -> ${match[1]}`);
      }
    }

    expect(missingImports).toEqual([]);
  });

  test("includes mobile views and recoverable model loading", async () => {
    const html = await Bun.file(resolve(playground, "index.html")).text();

    expect(html.match(/class="mobile-view-tab(?:\s|")/g)).toHaveLength(3);
    expect(html).toContain('id="btn-retry-models"');
    expect(html).toContain('data-mobile-view="image"');
    expect(html).toContain("configRevision === appliedRevision");
  });
});
