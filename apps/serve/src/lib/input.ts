import type { Context } from "hono";
import { config } from "./config.js";
import { badRequest, payloadTooLarge } from "./errors.js";
import type { OcrOptions } from "./schemas.js";
import { jsonOcrSchema, ocrOptionsSchema } from "./schemas.js";

const tooBig = () =>
  payloadTooLarge(`Image exceeds MAX_UPLOAD_BYTES (${config.maxUploadBytes} bytes)`);

function decodeDataUri(uri: string): ArrayBuffer {
  const comma = uri.indexOf(",");
  if (comma === -1) throw badRequest("Malformed data: URI");
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const bytes = meta.includes("base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf-8");
  if (bytes.byteLength > config.maxUploadBytes) throw tooBig();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hostAllowed(url: URL): boolean {
  return config.sourceUrlAllowlist.some(
    (allowed) => url.host === allowed || url.host.endsWith(`.${allowed}`)
  );
}

async function fetchHttps(source: string): Promise<ArrayBuffer> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw badRequest("Invalid source URL");
  }
  if (url.protocol !== "https:") {
    throw badRequest("Only https URLs, data: URIs, or uploaded files are accepted");
  }
  if (config.sourceUrlAllowlist.length === 0) {
    throw badRequest("https sources are disabled; set SOURCE_URL_ALLOWLIST to enable them");
  }
  if (!hostAllowed(url)) {
    throw badRequest(`Host "${url.host}" is not in SOURCE_URL_ALLOWLIST`);
  }
  // `redirect: "error"` blocks redirect-based SSRF past the allowlist.
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok) throw badRequest(`Failed to fetch source (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > config.maxUploadBytes) throw tooBig();
  const buf = await res.arrayBuffer();
  if (buf.byteLength > config.maxUploadBytes) throw tooBig();
  return buf;
}

/** Resolve a `source` string to image bytes. Local paths are rejected. */
export async function resolveSource(source: string): Promise<ArrayBuffer> {
  if (source.startsWith("data:")) return decodeDataUri(source);
  if (source.startsWith("https://")) return fetchHttps(source);
  throw badRequest("source must be an https URL or a data: URI (local paths are not allowed)");
}

/** Read a single image: multipart `file` field, or JSON `{ source, ...opts }`. */
export async function readSingle(c: Context): Promise<{ image: ArrayBuffer; opts: OcrOptions }> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw badRequest("multipart body must include a 'file' field");
    }
    const image = await file.arrayBuffer();
    if (image.byteLength > config.maxUploadBytes) throw tooBig();
    const opts = ocrOptionsSchema.parse({
      strategy: body["strategy"],
      flatten: body["flatten"],
      engine: body["engine"],
    });
    return { image, opts };
  }

  const json = await c.req.json().catch(() => {
    throw badRequest("Invalid JSON body");
  });
  const { source, ...opts } = jsonOcrSchema.parse(json);
  const image = await resolveSource(source);
  return { image, opts };
}
