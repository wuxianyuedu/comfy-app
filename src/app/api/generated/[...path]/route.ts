import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

import { getSettingsSync } from "~/lib/app-settings/app-settings.server";
import { contentTypeForPath } from "~/lib/media/mime-ext";
import { isForeignOwnedArtifact } from "~/lib/media/output-access";
import { generatedRoot, isWithinGeneratedRoot } from "~/lib/media/output-paths";
import { contentRangeHeader, resolveByteRange } from "~/server/lib/range-request";
import { requireRequestUser } from "~/server/auth/request-user";

/**
 * /api/generated/[...path] — 任务产物文件流（历史 localPath 以此为前缀而路由此前不存在，全站 404）。
 * 边界：路径穿越解析后必须仍在产物根内；会话+归属（台账 A13：「在根内」≠「该给你读」）；产物根不在 `public/` 下
 *（否则静态直发绕过全部判定，同一份图 200/401 两个答案）。产物不可变 → 长缓存安全但必须 `private`；`Range` 按 RFC 7233 单档 206/416/忽略回 200。
 */

/** 三种响应（200 / 206 / 416）共用的一份头。
 *  `Accept-Ranges: bytes` 告诉客户端可以分段要；⚠️ `Cache-Control` 必须是 `private`：
 *  加了归属判定后再标 `public` 等于允许共享缓存把 A 的产物回给 B，归属闸就只剩形式。 */
/* SAFETY: type assertion reviewed */
const SHARED_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "Accept-Ranges": "bytes",
} as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: Array<string> }> },
): Promise<Response> {
  const user = await requireRequestUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  /* 产物根与「仍在根内」的判据来自 `~/lib/media/output-paths` —— 落盘侧
   * （executor-finalize）、打开侧与删除侧都吃同一份定义；这一条曾经只在
   * 本地内联拼一次，属于 §12.12 说的那类「一处改了另一处不知道」。 */
  const root = generatedRoot();
  const abs = path.resolve(root, ...segments);
  /* 路径穿越防护：解析后必须仍在产物根之内。解析回根目录本身**不算越界**
   * （判据放它过去），但它是个目录 → 由下面的 `stat` + `isFile()` 判成 404，
   * 而不是 500。 */
  if (!isWithinGeneratedRoot(abs, root)) {
    return new Response("Forbidden", { status: 403 });
  }

  /* 归属：判得清「属于别人」就不读 —— 拒绝必须在 `fs.stat`/`fs.open` 之前。状态给 404 而非 403
   *（与「文件不存在」同形，不顺带回答「某个 id 存不存在」，口径同 A2/A3/A12）。
   * 单用户模式跳过：每个请求都解析成同一演示用户，只会因历史行 userId 漂移把自己的图打裂。 */
  if (getSettingsSync().loginRequired) {
    if (await isForeignOwnedArtifact(segments, user.id)) {
      return new Response("Not found", { status: 404 });
    }
  }

  /* 尺寸必须在**打开之前**拿到：Range 的裁剪与 `Content-Range` 都要它，而
   * 「解析到一个目录」这一格也得在这里就当「没有这一格」——目录能 stat 成功，
   * 所以 `isFile()` 这一条不能省（省了就会走到 `open` 去读一个目录）。 */
  let size: number;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      return new Response("Not found", { status: 404 });
    }
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  /* Range：拖进度条的 `<video>` 每一下都是这条。判据在 `~/server/lib/range-request`
   * （RFC 7233 的单档形状 + 三条口径），这里只负责把它翻成状态码与窗口。 */
  const range = resolveByteRange(req.headers.get("range"), size);
  if (range.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": contentRangeHeader(null, size),
        ...SHARED_HEADERS,
      },
    });
  }
  const window = range.kind === "partial" ? range.window : null;
  const start = window?.start ?? 0;
  const length = (window?.endInclusive ?? size - 1) - start + 1;

  /* 只读要的那一段：`read(buffer, 0, length, position)` 的第四个参数是文件里的
   * 偏移。这里刻意不用 `readFile` 再 `slice` —— 那等于每按一下进度条都把整份
   * 成片读进内存（产物根现在只有这一条出口，视频也走它）。 */
  let buf: Buffer;
  let effectiveWindow = window;
  try {
    const handle = await fs.open(abs, "r");
    try {
      buf = Buffer.allocUnsafe(Math.max(length, 0));
      const { bytesRead } = await handle.read(buf, 0, buf.length, start);
      /* 文件在一次请求之内被换掉（同名产物重新生成、或被裁短）时，按**实际读到**
       * 的字节回，并把窗口一起收窄 —— `Content-Range` 承诺 6 个字节而 body 只有 2 个，
       * 比回 404 更坏：客户端会按承诺的长度去拼文件，拼出一个坏产物。
       * 一个字节都没读到则是「这一格现在没有那段东西」，按不存在处理。 */
      if (bytesRead === 0 && buf.length > 0) {
        return new Response("Not found", { status: 404 });
      }
      if (bytesRead !== buf.length) {
        buf = buf.subarray(0, bytesRead);
        if (window) {
          effectiveWindow = { start, endInclusive: start + bytesRead - 1 };
        }
      }
    } finally {
      // 句柄必须关：Windows 上不关的那一份会把产物锁住，同名重生成当场失败
      //（而且它是 finally 里的一条，异常路径也要走到）。
      await handle.close();
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": contentTypeForPath(abs),
    ...SHARED_HEADERS,
  });
  if (effectiveWindow) {
    headers.set("Content-Range", contentRangeHeader(effectiveWindow, size));
    return new Response(new Uint8Array(buf), { status: 206, headers });
  }
  return new Response(new Uint8Array(buf), { headers });
}
