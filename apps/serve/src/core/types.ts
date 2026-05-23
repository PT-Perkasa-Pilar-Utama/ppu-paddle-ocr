import type { RequestIdVariables } from "hono/request-id";

/** Shared Hono environment: requestId from the request-id middleware. */
export type Env = { Variables: RequestIdVariables };
