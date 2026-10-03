/**
 * /api/custom-nodes/manifest —— 扫描清单原文的读取口。
 *
 * 它是**浏览器侧注册表唯一的灌入源**：`src/config/custom-nodes.ts` 的
 * `refreshCustomNodes()`（画布挂载时、以及每次解析收尾后各调一次）与
 * `getCustomNodesManifest()`（自定义节点设置面板的预览卡）都读这一个地址。
 *
 * ## 这条链曾经断在哪
 *
 * 这个 handler 在早前一次基线迁移里被删掉，而**客户端那两句 fetch 活着留了下来** ——
 * 于是 `if (!res.ok) return 0` 每天都命中 404，注册表恒空、预览卡恒空，而界面上没有任何
 * 一处说「清单没拿到」：0 恰好也是一个合法的解析结果。台账 E9 记的「注册表刷新没有通知
 * 通道」其实是它的下游 —— 没有灌入源，通道也只是把空广播一遍。
 *
 * ## 形状上的三条决定
 *
 *  - **要登录**：清单里带 `packages[*].path` 与 `sources`（本机绝对路径 + 已装了什么包），
 *    那是机器画像。口径同产物读取口（台账 A13 那一族）：响应取决于「你是谁」就不许公开。
 *  - **`private, no-store`**：`private` 同上（共享缓存会把它留给别人）；`no-store` 是因为
 *    这条链的正确性就是「刚解析完必须拿到新的一份」—— 摘要端点用 (size, mtime) 指纹做
 *    短路缓存是安全的（写一次指纹变一次），但把那份缓存思路搬到**这里**由浏览器缓存来做
 *    就不安全了：解析器写完文件后客户端立刻重取，任何一条中间缓存都能把旧清单当成新答案，
 *    而那正是这次事故的形状（恒空 / 恒旧）。
 *  - **三相比两相**：「还没有清单」（正常冷启动 → 404 + `custom_nodes.manifest_missing`）
 *    与「读不出来」（真故障 → 500 + `custom_nodes.manifest_unreadable`）分开回，
 *    好让调用方决定哪一档该说话、哪一档该安静（读取口径与理由在
 *    `~/lib/comfyui/custom-nodes-manifest.server`）。
 */
import { NextResponse } from "next/server";

import {
  customNodesManifestPath,
  readCustomNodesManifest,
} from "~/lib/comfyui/custom-nodes-manifest.server";
import { AppError, NotFoundError } from "~/lib/core/errors";
import { requireRequestUser } from "~/server/auth/request-user";
import {
  errorResponse,
  unauthorizedResponse,
} from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await requireRequestUser();
  if (!user) return unauthorizedResponse();

  const read = readCustomNodesManifest();
  if (read.kind === "missing") {
    // 冷启动的正常态：不写日志（会把用户的正常首屏刷成错误流水），但码要稳定，
    // 调用方据此区分「还没解析过」与「拿不到」。
    return errorResponse(
      new NotFoundError(
        `还没有解析过自定义节点清单（在设置面板点「解析」生成）：${customNodesManifestPath()}`,
        "custom_nodes.manifest_missing",
      ),
    );
  }
  if (read.kind === "unreadable") {
    return errorResponse(
      new AppError(
        `读取自定义节点清单失败（${read.detail}）`,
        "custom_nodes.manifest_unreadable",
        500,
      ),
    );
  }

  return new NextResponse(read.text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}
