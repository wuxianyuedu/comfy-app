// ── 「保存为项目默认（跟代码走）」端点：PUT /api/size-presets/project-default ──
// 尺寸配置表的项目默认（入库、跟代码走的那份）落在
// `src/lib/media/size-preset-defaults.json`：提交后每个检出与每个桌包都是这一份。
// 与「侧栏页签行为」「模式契约」的「保存为项目默认（跟代码走）」同一套口径 ——
// 只有开发检出有可写的目标文件（正式包没有源码可写，服务端大声失败，不假装成功）。
//
// 与本机覆盖（PUT /api/size-presets，改一格即存）是**两件事**：这一格写进代码库，
// 那一格写进应用数据目录。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { saveSizePresetTableAsProjectDefaults } from "~/lib/media/size-preset.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 把当前这份表全量写进入库的项目默认 JSON；返回写盘路径与落盘后的表。 */
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
    const { file, table } = await saveSizePresetTableAsProjectDefaults(body);
    return NextResponse.json({ file, table });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "写入尺寸配置表项目默认失败"), { status: 500 });
  }
}
