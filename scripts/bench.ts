import { Glob } from "bun";
import { exec } from "./utils";

const DIR = import.meta.dir + "/../bench";
const exe = { raw: "bun run" };

let exactBench = process.argv[2];
if (exactBench == "--node") {
  exe.raw = "bun tsx --expose-gc --allow-natives-syntax";
  exactBench = process.argv[3];
}

Bun.$.cwd(DIR);

if (exactBench != null) {
  const path = `${exactBench}.bench.ts`;
  console.log("Running benchmark:", path);
  await exec`${exe} ${path}`;
} else
  for (const path of new Glob("**/*.bench.ts").scanSync(DIR)) {
    console.log("Running benchmark:", path);
    await exec`${exe} ${path}`;
  }
