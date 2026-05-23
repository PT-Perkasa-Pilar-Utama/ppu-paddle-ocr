import type { Context } from "hono";
import { config } from "./config.js";
import { badRequest, payloadTooLarge } from "./errors.js";
import type { OcrOptions } from "./schemas.js";
import { jsonOcrSchema, ocrOptionsSchema } from "./schemas.js";

const tooBig = () =>
  payloadTooLarge(`Image exceeds MAX_UPLOAD_BYTES (${config.maxUploadBytes} bytes)`);

/** Sniff a supported image format from magic bytes; null if unrecognized. */
function detectImageMime(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf.slice(0, 16));
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  const tag = (s: number) => String.fromCharCode(b[s] ?? 0, b[s + 1] ?? 0, b[s + 2] ?? 0, b[s + 3] ?? 0);
  if (tag(0) === "RIFF" && tag(8) === "WEBP") return "image/webp";
  if (tag(4) === "ftyp" && ["avif", "heic", "heif", "mif1"].includes(tag(8))) return "image/avif";
  return null;
}

/** Reject non-image payloads with a 400 instead of a downstream decode 500. */
function assertImage(buf: ArrayBuffer): void {
  if (!detectImageMime(buf)) {
    throw badRequest("Unsupported image type. Provide JPEG, PNG, WebP, GIF, BMP, TIFF, or AVIF.");
  }
}

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

/** Resolve a `source` string to image bytes. Local paths and non-images rejected. */
export async function resolveSource(source: string): Promise<ArrayBuffer> {
  let buf: ArrayBuffer;
  if (source.startsWith("data:")) buf = decodeDataUri(source);
  else if (source.startsWith("https://")) buf = await fetchHttps(source);
  else throw badRequest("source must be an https URL or a data: URI (local paths are not allowed)");
  assertImage(buf);
  return buf;
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
    assertImage(image);
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
