// ── 尺寸配置表（ISSUE #3788）的应用数据端点：GET/PUT /api/size-presets ─────────
// 尺寸表（比例 × 分辨率，图片 / 视频两场景）的**唯一持有者在服务端**：项目默认
// 入库在 `src/lib/media/size-preset-defaults.json`（跟代码走，ISSUE #3948 起），
// 本机覆盖落 `data/size-presets.json`（应用数据），读取侧逐格合并 —— 都在
// `size-preset.server.ts`。画布 / 表单 / 设置页共用的 `size-preset-store`
// 经这里同读同写。鉴权沿用 requireRequestUser（未开启登录门槛时回落本地
// 演示用户，单机照常可用）。
//
// GET 回**两层**（`defaults` = 项目默认那份、`table` = 生效表）：客户端的
// 「恢复默认」要以项目默认为基准。项目默认是编译期基线，运行期只读不写
// （ISSUE #5001）—— 改它走改代码 / 提 PR 那条路。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { loadSizePresetLayers, saveSizePresetTable } from "~/lib/media/size-preset.server";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 项目默认那份 + 生效表。 */
export async function GET() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  try {
    const { defaults, table } = await loadSizePresetLayers();
    return NextResponse.json({ defaults, table });
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
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(req);
  if (crossOrigin !== null) {
    return crossOrigin;
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
