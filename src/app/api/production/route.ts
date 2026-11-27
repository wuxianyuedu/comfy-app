// 统一生产模型的服务端写入端点（Phase 3b-2）。
//   端点：PUT /api/production  { project, production } → { ok: true }
// 工坊自动保存时，把一份生产数据（meta/剧本/场景/角色/镜头/进度）写穿到 production
// 表，供画布读取物化（Phase 3c）。读侧（GET）在画布接入时再补。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
import { type NextRequest, NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { productionRepository } from "~/lib/core/repository-production";
import { db } from "~/lib/db";
import {
  inheritDerivedFields,
  CHARACTER_DERIVED_FIELDS,
  SHOT_DERIVED_FIELDS,
} from "~/lib/production/payload";
import { apiErrorBody } from "~/lib/api-error";
import { isRecord } from "~/lib/is-record";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";
import { audit } from "~/server/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 版本冲突：正常业务结果（另一个检出先写了），用它从 immediate 事务里退出，
 *  避免在事务外再写一份「这一轮是否作废」的布尔守卫（规范 16 P31）。 */
class StaleProductionWrite extends Error {}

/** 从请求体里取生产数据载荷（宽松读取，字段缺省由表的默认值兜底）。 */
function productionFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(body.production) ? body.production : null;
}

function projectIdFrom(q: string | null): string | null {
  const trimmed = q?.trim();
  if (trimmed !== undefined && trimmed !== "") {
    return trimmed;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const project = projectIdFrom(req.nextUrl.searchParams.get("project"));
  if (project === null || project === "") {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  try {
    const row = await productionRepository.getForUser(user.id, project);
    if (!row) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: true, production: row });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取生产数据失败"), {
      status: 500,
    });
  }
}

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
  const project = typeof body.project === "string" && body.project ? body.project : null;
  if (project === null || project === "") {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  const production = productionFromBody(body);
  if (!production) {
    return NextResponse.json({ error: "production 不能为空" }, { status: 400 });
  }
  /* 乐观并发（ISSUE #5208）：多检出共享同一份 production 时，旧基准的自动保存
   * 不能覆盖另一个检出的新写入。调用方带 ifUpdatedAt（上次读到的 updatedAt），
   * 事务内在写入前比对；不一致则跳过写入并回 stale:true，由 UI 给可行动提示。
   * 表上没有 rev 列（镜头 rev 只是 shots JSON 里的派生标记），故用 updatedAt 做 CAS。 */
  const ifUpdatedAt = typeof body.ifUpdatedAt === "string" ? body.ifUpdatedAt : null;
  try {
    // 机器衍生字段的保存继承（#2615）：草稿不携带评审 / 裁决 / rev——
    // 整列 upsert 前从库中同 id 记录继承缺键的位，否则工坊里编辑任何东西
    // 的下一次自动保存就会把它们抹掉。
    //
    // 读-继承-写收进 immediate 事务（ISSUE #3832）：自动保存与 run 引擎 /
    // 成片回写并发时，这个窗口内对方写入的列会被旧基准覆盖（丢失更新）。
    // SQLite 单写者 + immediate 拿锁即串行化这一段（与 saveLlmSettings
    // 同一形状，§18.10.1）；事务很短：两次读 + 一次 upsert。
    await db.transaction(
      async (tx) => {
        const existing = await productionRepository.getForUser(user.id, project, tx);
        if (ifUpdatedAt !== null && existing !== null) {
          const current =
            existing.updatedAt instanceof Date ? existing.updatedAt.toISOString() : "";
          if (current !== ifUpdatedAt) {
            throw new StaleProductionWrite();
          }
        }
        const existingShots = existing && Array.isArray(existing.shots) ? existing.shots : [];
        const existingCharacters =
          existing && Array.isArray(existing.characters) ? existing.characters : [];
        const shots = Array.isArray(production.shots)
          ? inheritDerivedFields(production.shots, existingShots, SHOT_DERIVED_FIELDS)
          : production.shots;
        const characters = Array.isArray(production.characters)
          ? inheritDerivedFields(
              production.characters,
              existingCharacters,
              CHARACTER_DERIVED_FIELDS,
            )
          : production.characters;
        await productionRepository.upsertForUser(
          user.id,
          {
            id: project,
            title: typeof production.title === "string" ? production.title : undefined,
            type: typeof production.type === "string" ? production.type : undefined,
            tone: typeof production.tone === "string" ? production.tone : undefined,
            logline: typeof production.logline === "string" ? production.logline : undefined,
            scriptMarkdown:
              typeof production.scriptMarkdown === "string" ? production.scriptMarkdown : undefined,
            scenes: production.scenes,
            characters,
            shots,
            progress: production.progress,
          },
          tx,
        );
      },
      { behavior: "immediate" },
    );
    /* 活动留痕（ISSUE #5208）：同一部剧在多个检出间流转，保存事件进 auditLog，
     * 后续活动流查询可从 meta 的 project 过滤。审计失败不影响保存。 */
    await audit(
      "project_content_saved",
      { headers: req.headers, session: { user: { id: user.id } } },
      { project },
    );
    return NextResponse.json({ ok: true, stale: false });
  } catch (error) {
    if (error instanceof StaleProductionWrite) {
      /* 冲突是正常业务结果，不是失败：回 stale 让 UI 提示刷新后重做，不静默覆盖。 */
      return NextResponse.json({ ok: true, stale: true });
    }
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(apiErrorBody(error, "保存生产数据失败"), {
      status: 500,
    });
  }
}
