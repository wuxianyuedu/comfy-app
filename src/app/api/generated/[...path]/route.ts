import { promises as fs } from "fs";
import path from "node:path";
import type { NextRequest } from "next/server";

import { getSettingsSync } from "~/lib/app-settings/app-settings.server";
import { contentTypeForPath } from "~/lib/media/mime-ext";
import { isForeignOwnedArtifact } from "~/lib/media/output-access";
import { generatedRoot, isWithinGeneratedRoot } from "~/lib/media/output-paths";
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
 *    `private`：见下面响应头那条。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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
   * （判据放它过去），但它是个目录 → `readFile` 抛错 → 由下面的 catch 统一回 404，
   * 而不是 500。 */
  if (!isWithinGeneratedRoot(abs, root)) {
    return new Response("Forbidden", { status: 403 });
  }

  /* 归属：判得清「这一格确定属于别人」就不读 —— 拒绝必须在 `fs.readFile` 之前，
   * 否则「有没有把别人的文件拖出去」取决于代码写在哪一行。状态给 **404 而不是 403**：
   * 与「文件不存在」同形，这个端点不该顺带回答「某个 id 存不存在」（口径同 A2 / A3 / A12）。
   * 单用户模式（`loginRequired` 关）跳过：那时每个请求都解析成同一个演示用户，
   * 判定不可能有不同结果，只会因历史行的 userId 漂移把自己的图打裂。 */
  if (getSettingsSync().loginRequired) {
    if (await isForeignOwnedArtifact(segments, user.id)) {
      return new Response("Not found", { status: 404 });
    }
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
      /* 产物按 taskId 目录一次性写入、内容不变，长缓存安全。
       * ⚠️ 但必须是 `private`：加了归属判定之后再标 `public`，等于允许共享缓存
       * 把 A 的产物回给 B —— 那会让上面那道闸只剩形式。 */
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
