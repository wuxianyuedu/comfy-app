// 统一生产模型的服务端写入端点（Phase 3b-2）。
//   端点：PUT /api/production  { project, production, ifUpdatedAt? } → { ok, stale, updatedAt }
// 工坊自动保存时，把一份生产数据（meta/剧本/场景/角色/镜头/进度）写穿到 production
// 表，供画布读取物化（Phase 3c）。读侧（GET）在画布接入时再补。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
//
// ── 双操作者的写侧保护（ISSUE #5147）──────────────────────────
// 症状：AI 侧（run 引擎 / MCP 编排 / 评审器）把场景 / 角色 / 分镜写进 production 后，
// 工坊界面的一次自动保存把同一行整片盖成「界面那份旧草稿」—— 界面草稿是**挂载那一刻**
// 从 localStorage 读进来的旧副本，此后一直没变。实测现场：AI 写完 6 场景 / 6 角色 /
// 19 镜，界面的 `PUT /api/production 200` 之后同一行变成 `scenes=[] / characters=[] /
// shots=[]`，随后的自主 run 判「还没有镜头」→ 退回去规划分镜 → LLM 不可用 → run 失败。
//
// 两条判据（与草稿镜像 #4023、乐观并发 #5221 同口径）：
//   ① **窄字段写入**（主修）：`production` 里**没带的键 = 这一列不动**。界面自动保存
//      只发自己真改过的字段（`narrowProductionWrite`），于是「界面那份没有角色卡」
//      不再等于「把库里的角色卡清空」。整片覆盖在结构上不可能发生 —— 而不是事后
//      判一次要不要拒绝。
//   ② **乐观并发**（#5221 的 `ifUpdatedAt`）：调用方带上「上次读到的 updatedAt」，
//      事务内比对；不一致时**整片快照**写入跳过并回 `stale:true`，由界面给可行动提示。
//      窄写入不走这一闸：它只覆盖用户改过的字段，拦下来等于把用户的改动丢掉。
//
// `stale` 是**读数**，不是失败：它回答「你动手之前，别人（多半是 AI）刚写过」。
import { type NextRequest, NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { productionRepository, type ProductionInput } from "~/lib/core/repository-production";
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
import { env } from "~/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 版本冲突：正常业务结果（另一个检出先写了），用它从 immediate 事务里退出，
 *  避免在事务外再写一份「这一轮是否作废」的布尔守卫（规范 16 P31）。 */
class StaleProductionWrite extends Error {}

/** 整份快照的判据：这八条内容列全在。少一条就按窄写入处理（缺键不动）。 */
const FULL_SNAPSHOT_FIELDS = [
  "title",
  "type",
  "tone",
  "logline",
  "scriptMarkdown",
  "scenes",
  "characters",
  "shots",
] as const;

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

/** 这次载荷是不是「整份快照」（八条内容列一条不缺）。 */
function isFullSnapshot(production: Record<string, unknown>): boolean {
  return FULL_SNAPSHOT_FIELDS.every((key) => production[key] !== undefined);
}

/**
 * 请求载荷 → 只含「这次真要写的列」的行补丁（ISSUE #5147 ①）。
 *
 * 缺键的列**不进补丁** —— `upsertForUser` 的 `.set()` 会过滤 `undefined`
 * （drizzle 的 `mapUpdateSet`），于是没带的列一个字节都不动。
 * 三条元素列额外做机器衍生字段继承（#2615），且只对真要写的列做。
 */
function productionPatchFrom(
  production: Record<string, unknown>,
  existing: { characters: unknown; shots: unknown } | null,
): Omit<ProductionInput, "id"> {
  const patch: Omit<ProductionInput, "id"> = {};
  if (typeof production.title === "string") {
    patch.title = production.title;
  }
  if (typeof production.type === "string") {
    patch.type = production.type;
  }
  if (typeof production.tone === "string") {
    patch.tone = production.tone;
  }
  if (typeof production.logline === "string") {
    patch.logline = production.logline;
  }
  if (typeof production.scriptMarkdown === "string") {
    patch.scriptMarkdown = production.scriptMarkdown;
  }
  if (Array.isArray(production.shots)) {
    const existingShots = existing && Array.isArray(existing.shots) ? existing.shots : [];
    patch.shots = inheritDerivedFields(production.shots, existingShots, SHOT_DERIVED_FIELDS);
  }
  if (Array.isArray(production.characters)) {
    const existingCharacters =
      existing && Array.isArray(existing.characters) ? existing.characters : [];
    patch.characters = inheritDerivedFields(
      production.characters,
      existingCharacters,
      CHARACTER_DERIVED_FIELDS,
    );
  }
  if (production.scenes !== undefined) {
    patch.scenes = production.scenes;
  }
  if (production.progress !== undefined) {
    patch.progress = production.progress;
  }
  return patch;
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
  /* 乐观并发凭据（#5221）：上次读到的 `updatedAt`（ISO 串）。缺省 = 不参与 CAS。 */
  const ifUpdatedAt = typeof body.ifUpdatedAt === "string" ? body.ifUpdatedAt : null;
  const fullSnapshot = isFullSnapshot(production);
  try {
    // 读-继承-写收进 immediate 事务（ISSUE #3832）：自动保存与 run 引擎 /
    // 成片回写并发时，这个窗口内对方写入的列会被旧基准覆盖（丢失更新）。
    // SQLite 单写者 + immediate 拿锁即串行化这一段（与 saveLlmSettings
    // 同一形状，§18.10.1）；事务很短：两次读 + 一次 upsert。
    const outcome = await db.transaction(
      async (tx) => {
        const existing = await productionRepository.getForUser(user.id, project, tx);
        /* CAS（#5221）：库里被别的检出改过 ⇒ 「我这份基于旧副本」。
         * 对整份快照直接跳过（会盖掉别人的改动）；对窄写入只当读数（#5147）。 */
        const stale =
          ifUpdatedAt !== null &&
          existing !== null &&
          (existing.updatedAt instanceof Date ? existing.updatedAt.toISOString() : "") !==
            ifUpdatedAt;
        if (stale && fullSnapshot) {
          return { skipped: true as const, stale, row: existing };
        }
        const patch = productionPatchFrom(production, existing);
        /* 窄写入即使 `stale` 也照写（只覆盖用户改过的那几列），但把读数带出去 ——
         * 界面据此提示「服务端也更新过」，同时用户的改动没有丢。 */
        const row = await productionRepository.upsertForUser(
          user.id,
          { ...patch, id: project },
          tx,
        );
        return { skipped: false as const, stale, row };
      },
      { behavior: "immediate" },
    );
    /* 活动留痕（ISSUE #5208）：同一部剧在多个检出间流转，保存事件进 auditLog，
     * 后续活动流查询可从 meta 的 project 过滤。审计失败不影响保存。
     * 跳过的写入不记 —— 那一笔没有落地。 */
    if (!outcome.skipped) {
      await audit(
        "project_content_saved",
        { headers: req.headers, session: { user: { id: user.id } } },
        { project, source: env.COMFYAPP_ACTIVITY_SOURCE ?? "unknown" },
      );
    }
    if (outcome.skipped) {
      /* 与草稿镜像 `ifNewer` 同一形状（#4023）：200 + `stale: true`，
       * 库里一个字节都没动。用 200 而不是 409 是刻意的 —— 这不是失败，
       * 是「你基于的那版已经旧了，先看看服务端这份」。 */
      return NextResponse.json({
        ok: true,
        stale: true,
        updatedAt: outcome.row.updatedAt.toISOString(),
        production: outcome.row,
      });
    }
    return NextResponse.json({
      ok: true,
      stale: outcome.stale,
      updatedAt: outcome.row.updatedAt.toISOString(),
    });
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
