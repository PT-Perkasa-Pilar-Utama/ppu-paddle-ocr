import type { Env as HonoEnv, ValidationTargets } from "hono";
import { validator } from "hono-openapi";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { badRequest } from "./errors.js";

/** The subset of a Standard Schema issue this formatter reads; valibot's own issues fit too. */
type IssueLike = { message: string; path?: readonly unknown[] };

/** Turn validation issues into one line: `path: message; path: message`. */
export function describeIssues(issues: readonly IssueLike[]): string {
  return issues
    .map((i) => {
      const path = (i.path ?? [])
        .map((p) => (typeof p === "object" && p !== null && "key" in p ? String(p.key) : String(p)))
        .join(".");
      return `${path || "body"}: ${i.message}`;
    })
    .join("; ");
}

/**
 * hono-openapi's validator with the envelope-shaped 400. The thrown HttpError
 * reaches app.onError, so validation failures share the error path with every
 * other 400.
 */
export function validate<
  Schema extends StandardSchemaV1,
  Target extends keyof ValidationTargets,
  E extends HonoEnv,
  P extends string,
>(target: Target, schema: Schema): ReturnType<typeof validator<Schema, Target, E, P>> {
  return validator<Schema, Target, E, P>(target, schema, (result) => {
    if (!result.success) throw badRequest(`Validation failed - ${describeIssues(result.error)}`);
  });
}
