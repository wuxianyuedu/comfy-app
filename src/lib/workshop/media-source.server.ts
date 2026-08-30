// ── Workshop server-side media source resolution ──────────────────────────
// Resolve an image reference (data URL / local generated path / absolute URL)
// into raw bytes so it can be (a) forwarded to remote API channels as a data
// URL, or (b) uploaded into the local ComfyUI input dir as a first frame.
import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { isRecord } from "./api-channel-shared";

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
const MAX_BYTES = 24 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
};

function mimeForExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? "image/png";
}

/** Map a server-relative generated path (/api/generated/..., /generated/...)
 *  to a file under public/generated. Returns null when the URL does not point
 *  at locally generated output. Guards against path traversal. */
function localPathFor(src: string): string | null {
  const m = /^\/(?:api\/)?generated\/(.+)$/.exec(src);
  if (!m?.[1]) return null;
  const rel = path.normalize(decodeURIComponent(m[1]));
  const abs = path.join(GENERATED_DIR, rel);
  if (!abs.startsWith(GENERATED_DIR)) return null;
  return abs;
}

export interface ResolvedMedia {
  buffer: Buffer;
  mime: string;
}

/**
 * Load image bytes from a data URL, a locally generated path, or an absolute
 * http(s) URL. Throws with a readable message when the source is unusable.
 */
export async function resolveMediaBytes(src: string, origin: string): Promise<ResolvedMedia> {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    if (comma < 0) throw new Error("data URL 格式无效");
    const meta = src.slice(5, comma);
    const mime = /^([^;]+)/.exec(meta)?.[1] ?? "image/png";
    const b64 = src.slice(comma + 1);
    const buffer = Buffer.from(b64, "base64");
    if (buffer.byteLength === 0) throw new Error("data URL 解码为空");
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    return { buffer, mime };
  }

  if (src.startsWith("/")) {
    const abs = localPathFor(src);
    if (!abs) throw new Error(`无法定位本地生成文件: ${src}`);
    const buffer = await fs.readFile(abs);
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    return { buffer, mime: mimeForExt(path.extname(abs).replace(".", "")) };
  }

  if (/^https?:\/\//.test(src)) {
    let res: Response;
    try {
      res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(
        `拉取参考图失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) throw new Error(`拉取参考图失败 (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    const mime = res.headers.get("content-type")?.split(";")[0] ?? undefined;
    return {
      buffer,
      mime: mime?.startsWith("image/") ? mime : mimeForExt(path.extname(new URL(src).pathname).replace(".", "")),
    };
  }

  throw new Error(`不支持的图片来源: ${src.slice(0, 64)}`);
}

/** Same as resolveMediaBytes but returning an inline data URL (for remote APIs). */
export async function resolveMediaDataUrl(src: string, origin: string): Promise<string> {
  const { buffer, mime } = await resolveMediaBytes(src, origin);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** Parse and narrow the JSON body of an upstream response. */
export async function readUpstreamJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`上游返回非 JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Pick string fields off an unknown body with defaults (request guards). */
export function strField(rec: Record<string, unknown>, key: string): string | undefined {
  const v: unknown = rec[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/** Pick a bounded integer field off an unknown body. */
export function intField(rec: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v: unknown = rec[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.round(Math.min(max, Math.max(min, n)));
  return clamped;
}

/** Re-export for route handlers that need the record guard. */
export { isRecord };
