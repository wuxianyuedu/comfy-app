// ── 「保存为项目默认（本机）」端点：PUT /api/size-presets/project-default ──
// 尺寸配置表的项目默认覆盖（ISSUE #4150 起落 `data/size-preset-project-defaults.json`，
// 不入库）—— 与「侧栏页签行为」「模式契约」的「保存为项目默认」同一套口径：
// 只有开发检出可调（正式包服务端大声失败，不假装成功）。src 那份编译源运行期
// 不再被写（工作树噪声与 dev 模块图失效的根源）；要改出厂默认改它走 PR。
//
// 与本机覆盖（PUT /api/size-presets，改一格即存）是**两件事**：这一格写本机
// 基线覆盖（整份），那一格写逐格差集。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { saveSizePresetTableAsProjectDefaults } from "~/lib/media/size-preset.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 把当前这份表全量写进本机项目默认覆盖；返回写盘路径与落盘后的表。 */
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
