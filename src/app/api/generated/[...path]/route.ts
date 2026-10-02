import { promises as fs } from "fs";
import path from "node:path";
import type { NextRequest } from "next/server";

import { getSettingsSync } from "~/lib/app-settings/app-settings.server";
import { contentTypeForPath } from "~/lib/media/mime-ext";
import { isForeignOwnedArtifact } from "~/lib/media/output-access";
import { generatedRoot, isWithinGeneratedRoot } from "~/lib/media/output-paths";
import {
  contentRangeHeader,
  resolveByteRange,
} from "~/server/lib/range-request";
import { requireRequestUser } from "~/server/auth/request-user";

/**
 * /api/generated/[...path] — 任务产物文件流。
 *
 * executor-finalize 把产物落盘到 `<cwd>/generated/<taskId>/`，并把
 * `/api/generated/<taskId>/<file>` 形式的 localPath 写进 TaskImage /
 * resultImages —— 历史数据与所有消费方都以该前缀为 URL，但这个路由此前
 * 并不存在，产物图片在所有页面都以 404 呈现（broken image）。
 *
 * 实现按路径读产物根（`generatedRoot()`）下的文件流式返回：
 *  - 历史数据（/api 前缀）与新数据一并修复，无需迁移 DB；
 *  - 路径穿越防护：解析后必须仍落在产物根之内；
 *  - **会话 + 归属**（台账 A13）：落点命名里就写着主人的身份
 *    （`projects/<项目 id>/<任务 id>`、`materials/<项目 id>/…`、`films/<成片 id>`），
 *    所以「在根内」从来不等于「该我给你读」；
 *  - 产物根**不在 `public/` 下**（台账 A13 的结构性关法）：`public/**` 由 Next 按
 *    静态文件直发、不经过任何 handler，所以根住在那儿的时候，上面这些判定靠
 *    「把 URL 里的 `api/` 去掉」就能整条绕过（本机实测过：同一份图 200 / 401 两个
 *    答案）。搬出来之后这条静态通道不存在，`src/proxy.ts` 那条 rewrite 只剩
 *    「让老数据里 `/generated/…` 那种形状仍然走闸」这一件兼容活。
 *  - 产物不可变（taskId 目录一次性写入），长缓存安全 —— 但正因如此缓存必须是
 *    `private`：见下面 `SHARED_HEADERS` 那条。
 *  - **支持 `Range`**（台账 A13 残留清单里的第二条）：产物根搬出 `public/` 之后，
 *    图片与**视频**都只剩这一条出口，而静态文件服务本来是白送 Range 的 —— 折进
 *    handler 那一刻就把「拖进度条」退化成「整份重读」。现在按 RFC 7233 的单档
 *    形状判：合法窗口 → 206 + `Content-Range`，语法对但满足不了 → 416，
 *    不认识的形状（多档 / 非 `bytes=` / `first > last`）→ 忽略并回 200，
 *    **不因为自己解析不了就把客户端要的东西判成错误**。判据本身在
 *    `~/server/lib/range-request`（这个端点只翻状态码，别再写第二份解析）。
 */

/** 三种响应（200 / 206 / 416）共用的一份头。
 *
 *  `Accept-Ranges: bytes` 是「告诉客户端可以分段要」的那一句；没有它，
 *  浏览器第一次拖进度条才会想起发 `Range`。
 *  ⚠️ `Cache-Control` 必须是 `private`：加了归属判定之后再标 `public`，
 *  等于允许共享缓存把 A 的产物回给 B —— 那会让上面那道闸只剩形式。 */
const SHARED_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "Accept-Ranges": "bytes",
} as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const user = await requireRequestUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

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

  /* 归属：判得清「这一格确定属于别人」就不读 —— 拒绝必须在 `fs.readFile` 之前，
   * 否则「有没有把别人的文件拖出去」取决于代码写在哪一行（这里的副作用是
   * `fs.stat` / `fs.open`，两个都必须在闸之后）。状态给 **404 而不是 403**：
   * 与「文件不存在」同形，这个端点不该顺带回答「某个 id 存不存在」（口径同 A2 / A3 / A12）。
   * 单用户模式（`loginRequired` 关）跳过：那时每个请求都解析成同一个演示用户，
   * 判定不可能有不同结果，只会因历史行的 userId 漂移把自己的图打裂。 */
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
    if (!st.isFile()) return new Response("Not found", { status: 404 });
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
      if (bytesRead === 0 && buf.length > 0)
        return new Response("Not found", { status: 404 });
      if (bytesRead !== buf.length) {
        buf = buf.subarray(0, bytesRead);
        if (window)
          effectiveWindow = { start, endInclusive: start + bytesRead - 1 };
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
