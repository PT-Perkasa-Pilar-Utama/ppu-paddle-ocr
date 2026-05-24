/**
 * Argv parsing and command dispatch. Kept free of top-level side effects so it
 * can be imported and exercised in tests; `index.ts` is the executable shim
 * that calls {@link main} and translates the return value into an exit code.
 *
 * Exit codes: 0 success, 1 runtime error, 2 usage error.
 */

import { parseArgs } from "node:util";

import {
  runBatch,
  runClearCache,
  runDownloadModels,
  runModels,
  runRecognize,
  runStream,
} from "./commands.js";
import { USAGE } from "./help.js";
import { CliError, readVersion } from "./io.js";
import type { CliValues } from "./options.js";
import { PARSE_OPTIONS } from "./options.js";

async function dispatch(command: string, rest: string[], values: CliValues): Promise<void> {
  switch (command) {
    case "recognize":
      return runRecognize(rest, values);
    case "batch":
      return runBatch(rest, values);
    case "stream":
      return runStream(rest, values);
    case "download-models":
      return runDownloadModels(values);
    case "clear-cache":
      return runClearCache(values);
    case "models":
      return runModels(values);
    default:
      throw new CliError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: PARSE_OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }

  const values = parsed.values as CliValues;
  const [command, ...rest] = parsed.positionals;

  if (values.version) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (!command || command === "help" || values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  try {
    await dispatch(command, rest, values);
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return 1;
  }
}
