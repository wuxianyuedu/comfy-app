// 剧集协作活动流（ISSUE #5208）：读当前用户某个项目的保存事件。
// `auditLog` 是唯一留痕表；写侧在 PUT /api/production，本端点只读不另造事件通道。
import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, like } from "drizzle-orm";

import { db } from "~/lib/db";
import { auditLog } from "~/server/db/schema";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { apiErrorBody } from "~/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const project = new URL(req.url).searchParams.get("project")?.trim() ?? "";
  if (project === "") {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  try {
    const rows = await db
      .select({
        id: auditLog.id,
        event: auditLog.event,
        meta: auditLog.meta,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, user.id),
          eq(auditLog.event, "project_content_saved"),
          /* meta 是 JSON 文本；项目 id 形如 proj_*，用子串匹配即可，避免引入 JSON1 依赖。 */
          like(auditLog.meta, `%"project":"${project.replaceAll("%", String.raw`\%`)}"%`),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(30);
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        event: row.event,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      })),
    });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取活动流失败"), { status: 500 });
  }
}
