import { promises as fs } from "fs";
import path from "node:path";

import { contentTypeForPath } from "~/lib/media/mime-ext";
import { generatedRoot, isWithinGeneratedRoot } from "~/lib/media/output-paths";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  /* 产物根与「仍在根内」的判据来自 `~/lib/media/output-paths` —— 落盘侧
   * （executor-finalize）、打开侧与删除侧都吃同一份定义；这一条曾经只在
   * 本地内联拼一次，属于 §12.12 说的那类「一处改了另一处不知道」。 */
  const root = generatedRoot();
  const abs = path.resolve(root, ...segments);
  /* 路径穿越防护：解析后必须仍在 public/generated 内。解析回根目录本身**不算越界**
   * （判据放它过去），但它是个目录 → `readFile` 抛错 → 由下面的 catch 统一回 404，
   * 而不是 500。 */
  if (!isWithinGeneratedRoot(abs, root)) {
    return new Response("Forbidden", { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeForPath(abs),
      /* 产物按 taskId 目录一次性写入、内容不变，长缓存安全。 */
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
