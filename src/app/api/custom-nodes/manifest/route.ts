/**
 * /api/custom-nodes/manifest —— 扫描清单原文读取口，浏览器侧注册表唯一灌入源。曾在基线迁移中误删 handler
 * 而客户端 fetch 残留致注册表恒空（台账 E9）。三条决定：要登录（清单含本机绝对路径等机器画像，口径同台账 A13 族）；
 * `private, no-store`（解析完客户端立刻重取，任何中间缓存都会把旧清单当新答案）；三相分开：无清单 404 `manifest_missing`，读故障 500 `manifest_unreadable`。
 */
import { NextResponse } from "next/server";

import {
  customNodesManifestPath,
  readCustomNodesManifest,
} from "~/lib/comfyui/custom-nodes-manifest.server";
import { AppError, NotFoundError } from "~/lib/core/errors";
import { requireRequestUser } from "~/server/auth/request-user";
import { errorResponse, unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

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
