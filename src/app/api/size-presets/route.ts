// ── 尺寸配置表（ISSUE #3788）的应用数据端点：GET/PUT /api/size-presets ─────────
// 尺寸表（比例 × 分辨率，图片 / 视频两场景）的**唯一持有者在服务端**：项目默认
// 编译在 `src/lib/media/size-presets.ts`（跟代码走），本机覆盖落
// `data/size-presets.json`（应用数据），读取侧逐格合并 —— 都在
// `size-preset.server.ts`。画布 / 表单 / 设置页共用的 `size-preset-store`
// 经这里同读同写。鉴权沿用 requireRequestUser（未开启登录门槛时回落本地
// 演示用户，单机照常可用）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { loadSizePresetTable, saveSizePresetTable } from "~/lib/media/size-preset.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 生效的尺寸配置表（项目默认 + 本机覆盖，逐格合并）。 */
export async function GET() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  try {
    return NextResponse.json(await loadSizePresetTable());
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取尺寸配置表失败"), { status: 500 });
  }
}

/** 保存整份尺寸配置表：任意形状先逐格校验合并再落盘（坏值回退默认）。
 *  返回落盘（合并后）的那份表，调用方据此刷新。 */
export async function PUT(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }
  try {
    return NextResponse.json(await saveSizePresetTable(body));
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "保存尺寸配置表失败"), { status: 500 });
  }
}
