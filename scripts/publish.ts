import { cpToLib, exec } from "./utils";

// Write required files
await Promise.all(["./README.md", "./package.json"].map(cpToLib));

// await cpDirToLib("./src/models", "models");

await exec`cd lib && bun publish --access=public`;
