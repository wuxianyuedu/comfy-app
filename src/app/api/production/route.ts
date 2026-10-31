// 统一生产模型的服务端写入端点（Phase 3b-2）。
//   端点：PUT /api/production  { project, production } → { ok: true }
// 工坊自动保存时，把一份生产数据（meta/剧本/场景/角色/镜头/进度）写穿到 production
// 表，供画布读取物化（Phase 3c）。读侧（GET）在画布接入时再补。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { productionRepository } from "~/lib/core/repository-production";
import {
  inheritDerivedFields,
  CHARACTER_DERIVED_FIELDS,
  SHOT_DERIVED_FIELDS,
} from "~/lib/production/payload";
import { apiErrorBody } from "~/lib/api-error";
import { isRecord } from "~/lib/is-record";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 从请求体里取生产数据载荷（宽松读取，字段缺省由表的默认值兜底）。 */
function productionFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(body.production) ? body.production : null;
}

function projectIdFrom(q: string | null): string | null {
  const trimmed = q?.trim();
  if (trimmed) {
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
  if (!project) {
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

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const project = typeof body.project === "string" && body.project ? body.project : null;
  if (!project) {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  const production = productionFromBody(body);
  if (!production) {
    return NextResponse.json({ error: "production 不能为空" }, { status: 400 });
  }
  try {
    // 机器衍生字段的保存继承（#2615）：草稿不携带评审 / 裁决 / rev——
    // 整列 upsert 前从库中同 id 记录继承缺键的位，否则工坊里编辑任何东西
    // 的下一次自动保存就会把它们抹掉。
    const existing = await productionRepository.getForUser(user.id, project);
    const existingShots = existing && Array.isArray(existing.shots) ? existing.shots : [];
    const existingCharacters =
      existing && Array.isArray(existing.characters) ? existing.characters : [];
    const shots = Array.isArray(production.shots)
      ? inheritDerivedFields(production.shots, existingShots, SHOT_DERIVED_FIELDS)
      : production.shots;
    const characters = Array.isArray(production.characters)
      ? inheritDerivedFields(production.characters, existingCharacters, CHARACTER_DERIVED_FIELDS)
      : production.characters;
    await productionRepository.upsertForUser(user.id, {
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
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "保存生产数据失败"), {
      status: 500,
    });
  }
}
