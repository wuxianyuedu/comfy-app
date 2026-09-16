import { promises as fs } from "fs";
import path from "node:path";

/**
 * /api/generated/[...path] — 任务产物文件流。
 *
 * executor-finalize 把产物落盘到 `<cwd>/public/generated/<taskId>/`，并把
 * `/api/generated/<taskId>/<file>` 形式的 localPath 写进 TaskImage /
 * resultImages —— 历史数据与所有消费方都以该前缀为 URL，但这个路由此前
 * 并不存在，产物图片在所有页面都以 404 呈现（broken image）。
 *
 * 实现按路径读 `public/generated` 下的文件流式返回：
 *  - 历史数据（/api 前缀）与新数据一并修复，无需迁移 DB；
 *  - 路径穿越防护：解析后必须仍落在 public/generated 内；
 *  - 产物不可变（taskId 目录一次性写入），长缓存安全。
 */

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const root = path.resolve(process.cwd(), "public", "generated");
  const abs = path.resolve(root, ...segments);
  /* 路径穿越防护：解析后必须仍在 public/generated 内（含根本身相等拒绝）。 */
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(abs).toLowerCase();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      /* 产物按 taskId 目录一次性写入、内容不变，长缓存安全。 */
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
