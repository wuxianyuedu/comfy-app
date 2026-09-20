// ── 工坊服务端媒体源解析 ───────────────────────────────────────────────
// 把图片引用（data URL / 本地生成路径 / 绝对 URL）解析成原始字节，
// 从而可以 (a) 作为 data URL 转发给远程 API 通道，
// 或 (b) 当作首帧上传进本机 ComfyUI 的 input 目录。
import { errorText } from "~/lib/error-message";
import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { isRecord } from "~/lib/is-record";
import { isInlineMedia, parseDataUrl, toDataUrl } from "~/lib/media/data-url";
import { DEFAULT_IMAGE_MIME, mimeForExt } from "~/lib/media/mime-ext";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
const MAX_BYTES = 24 * 1024 * 1024;

/* 把服务端相对的生成路径（/api/generated/... 或 /generated/...）映射到
 * public/generated 下的文件。URL 不是指向本地生成产物时返回 null。
 * 同时防目录穿越。 */
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
 * 从 data URL、本地生成路径或绝对 http(s) URL 加载图片字节。
 * 源不可用时抛出带可读说明的错误。
 */
export async function resolveMediaBytes(
  src: string,
  _origin: string,
): Promise<ResolvedMedia> {
  if (isInlineMedia(src)) {
    /* 「怎么读回一个 data URL 的 MIME 与载荷」只有一处定义
     *（`~/lib/media/data-url`，规范 16 §16.2.4.56）。 */
    const parsed = parseDataUrl(src);
    if (!parsed) throw new Error("data URL 格式无效");
    const buffer = Buffer.from(parsed.base64, "base64");
    if (buffer.byteLength === 0) throw new Error("data URL 解码为空");
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    return { buffer, mime: parsed.mime };
  }

  if (src.startsWith("/")) {
    const abs = localPathFor(src);
    if (!abs) throw new Error(`无法定位本地生成文件: ${src}`);
    const buffer = await fs.readFile(abs);
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    return { buffer, mime: mimeForExt(abs) ?? DEFAULT_IMAGE_MIME };
  }

  if (/^https?:\/\//.test(src)) {
    let res: Response;
    try {
      res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(errorText(e, "拉取参考图失败"));
    }
    if (!res.ok) throw new Error(`拉取参考图失败 (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error("图片超过 24MB 上限");
    const mime = res.headers.get("content-type")?.split(";")[0] ?? undefined;
    return {
      buffer,
      mime: mime?.startsWith("image/")
        ? mime
        : (mimeForExt(new URL(src).pathname) ?? DEFAULT_IMAGE_MIME),
    };
  }

  throw new Error(`不支持的图片来源: ${src.slice(0, 64)}`);
}

/* 与 resolveMediaBytes 相同，只是返回内联 data URL（给远程 API 用）。 */
export async function resolveMediaDataUrl(
  src: string,
  _origin: string,
): Promise<string> {
  const { buffer, mime } = await resolveMediaBytes(src, _origin);
  return toDataUrl(buffer, mime);
}

/* 解析并收窄上游响应的 JSON 体。 */
export async function readUpstreamJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `上游返回非 JSON (${res.status}): ${clampText(text, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
    );
  }
}

/* 从 unknown 响应体里按默认值取字符串字段（请求侧守卫）。 */
export function strField(
  rec: Record<string, unknown>,
  key: string,
): string | undefined {
  const v: unknown = rec[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/* 从 unknown 响应体里取一个带上下界的整数字段。 */
export function intField(
  rec: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const v: unknown = rec[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.round(Math.min(max, Math.max(min, n)));
  return clamped;
}

/* 为需要「记录守卫」的路由处理器再导出一次。 */
export { isRecord };
