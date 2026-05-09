import { $, file, write } from "bun";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const cpToLib = async (path: string): Promise<number> => {
  const targetDir = join("./lib", path.split("/").slice(0, -1).join("/"));

  await mkdir(targetDir, { recursive: true });
  return write(join("./lib", path), file(path));
};

export const cpDirToLib = async (sourcePath: string, targetSubPath?: string): Promise<void> => {
  const sourcePathClean = sourcePath.startsWith("./") ? sourcePath.slice(2) : sourcePath;

  const targetBasePath = targetSubPath
    ? join("./lib", targetSubPath)
    : join("./lib", sourcePathClean);

  await mkdir(targetBasePath, { recursive: true });

  const entries = await readdir(sourcePath);

  for (const entry of entries) {
    const fullSourcePath = join(sourcePath, entry);
    const stats = await stat(fullSourcePath);

    if (stats.isDirectory()) {
      const nestedTargetPath = join(targetSubPath || sourcePathClean, entry);
      await cpDirToLib(fullSourcePath, nestedTargetPath);
    } else {
      const targetFilePath = join("./lib", targetSubPath || sourcePathClean, entry);

      await mkdir(join("./lib", targetSubPath || sourcePathClean), {
        recursive: true,
      });

      await write(targetFilePath, file(fullSourcePath));
    }
  }
};

export const exec: (...args: Parameters<typeof $>) => Promise<unknown> = async (...args) => {
  try {
    return await $(...args);
  } catch (err: unknown) {
    process.stderr.write((err as { stderr: Uint8Array }).stderr);
  }
};
