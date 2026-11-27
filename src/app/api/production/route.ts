// 统一生产模型的服务端写入端点（Phase 3b-2）。
//   端点：PUT /api/production  { project, production, baseUpdatedAt? } → { ok, stale?, updatedAt }
// 工坊自动保存时，把一份生产数据（meta/剧本/场景/角色/镜头/进度）写穿到 production
// 表，供画布读取物化（Phase 3c）。读侧（GET）在画布接入时再补。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
//
// ── 双操作者的写侧保护（ISSUE #5147）──────────────────────────
// 症状：AI 侧（run 引擎 / MCP 编排 / 评审器）把场景 / 角色 / 分镜写进 production 后，
// 工坊界面的一次自动保存把同一行整片盖成「界面那份旧草稿」—— 界面草稿是**挂载那一刻**
// 从 localStorage 读进来的旧副本，此后一直没变，而载荷里没有任何「我这份基于哪个版本」
// 的凭据，服务端也就无从判断该不该收。实测现场：AI 写完 6 场景 / 6 角色 / 19 镜，
// 界面的 `PUT /api/production 200` 之后同一行变成 `scenes=[] / characters=[] / shots=[]`。
//
// 两条判据（与草稿镜像 #4023 同口径）：
//   ① **窄字段写入**：`production` 里**没带的键 = 这一列不动**。界面自动保存只发
//      自己真改过的字段（`narrowProductionWrite`），于是「界面那份没有角色卡」不再
//      等于「把库里的角色卡清空」。这是本单的主修 —— 它让「用户没碰的字段被覆盖」
//      从根上不可能发生，而不是事后判一次要不要拒绝。
//   ② **整份写入的版本闸**：载荷带 `baseUpdatedAt`（它读到那一行的时刻）、且这次是
//      **整份快照**（八条内容列全在 —— 旧调用方与画布的形态）、而库里比它更新时，
//      跳过写入并回 `{ ok: true, stale: true }` + 服务端现值（草稿镜像 `ifNewer`
//      的同一形状）。窄写入不走这一闸：它只带用户改过的字段，按字段自带新旧判据，
//      拦下来反而会把用户这一笔改动丢掉。
//
// `stale` 是**读数**，不是失败：它回答「你动手之前，别人（多半是 AI）刚写过」，
// 界面据此提示「服务端内容已更新，是否采用」，而不是静默互相覆盖。
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** 载荷里的版本凭据（epoch ms）；缺省 / 非法值 → undefined（不参与版本闸）。 */
function baseUpdatedAtFrom(body: Record<string, unknown>): number | undefined {
  const raw = body.baseUpdatedAt;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function projectIdFrom(q: string | null): string | null {
  const trimmed = q?.trim();
  if (trimmed !== undefined && trimmed !== "") {
    return trimmed;
  }
  return null;
}

/** 服务端这一行的版本时刻（epoch ms）。`updatedAt` 是 drizzle 的 Date 列。 */
function rowUpdatedAt(row: { updatedAt: Date }): number {
  return row.updatedAt.getTime();
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
  const baseUpdatedAt = baseUpdatedAtFrom(body);
  const fullSnapshot = isFullSnapshot(production);
  try {
    // 读-继承-写收进 immediate 事务（ISSUE #3832）：自动保存与 run 引擎 /
    // 成片回写并发时，这个窗口内对方写入的列会被旧基准覆盖（丢失更新）。
    // SQLite 单写者 + immediate 拿锁即串行化这一段（与 saveLlmSettings
    // 同一形状，§18.10.1）；事务很短：两次读 + 一次 upsert。
    const outcome = await db.transaction(
      async (tx) => {
        const existing = await productionRepository.getForUser(user.id, project, tx);
        /* 别人在我读到那一版之后写过（`stale`）—— 只作读数回给界面。 */
        const stale =
          baseUpdatedAt !== undefined &&
          existing !== null &&
          rowUpdatedAt(existing) > baseUpdatedAt;
        /* 整份快照 + 版本更旧 ⇒ 拒写（②）。窄写入不拦：它只带用户改过的字段，
         * 拦下来等于把这笔改动丢掉，而它本来就不可能清空别的列。 */
        if (stale && fullSnapshot) {
          return { skipped: true as const, stale: true, row: existing };
        }
        const patch = productionPatchFrom(production, existing);
        const row = await productionRepository.upsertForUser(
          user.id,
          { ...patch, id: project },
          tx,
        );
        return { skipped: false as const, stale, row };
      },
      { behavior: "immediate" },
    );
    if (outcome.skipped) {
      /* 与草稿镜像 `ifNewer` 同一形状（#4023）：200 + `stale: true` + 现值，
       * 库里一个字节都没动。用 200 而不是 409 是刻意的 —— 这不是失败，
       * 是「你基于的那版已经旧了，先看看服务端这份」。 */
      return NextResponse.json({
        ok: true,
        stale: true,
        updatedAt: rowUpdatedAt(outcome.row),
        production: outcome.row,
      });
    }
    return NextResponse.json({
      ok: true,
      stale: outcome.stale,
      updatedAt: rowUpdatedAt(outcome.row),
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(apiErrorBody(error, "保存生产数据失败"), {
      status: 500,
    });
  }
}
