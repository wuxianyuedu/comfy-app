// Workshop 前端项目草稿的服务端镜像：读 / 写 / 删。
//   端点：GET /api/workshop/draft?project=<wsp_*>  → { exists, draft? }
//   端点：PUT /api/workshop/draft  { project, draft } → { ok: true }
//   端点：DELETE /api/workshop/draft?project=<wsp_*> → { ok: true }
// 目的：工坊界面编辑的剧本/角色/分镜不再只落浏览器 localStorage —— 每次
// 自动保存也写穿到本地 db.sqlite 的 workshopDraft 表，清缓存也不丢。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import {
  parseDraftDto,
  draftHasContent,
} from "~/lib/workshop/draft-sync-shared";
import { isRecord } from "~/lib/workshop/api-channel-shared";
import {
  deleteDraft,
  getDraft,
  listDraftsByUser,
  upsertDraft,
} from "~/server/workshop/draft-repository";
import { errorMessage } from "~/lib/error-message";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORIZED = () => unauthorizedResponse();

function projectIdFrom(q: string | null): string | null {
  const trimmed = q?.trim();
  if (trimmed) return trimmed;
  return null;
}

export async function GET(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) return UNAUTHORIZED();
  const project = projectIdFrom(req.nextUrl.searchParams.get("project"));
  try {
    // 不带 project → 返回该用户全部服务端项目摘要（本地索引被清空时用来重建）。
    if (!project) {
      const drafts = await listDraftsByUser(user.id);
      return NextResponse.json({ drafts });
    }
    const draft = await getDraft(project);
    if (!draft || !draftHasContent(draft)) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: true, draft });
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "读取服务端草稿失败") },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) return UNAUTHORIZED();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }
  const project =
    typeof body.project === "string" && body.project ? body.project : null;
  if (!project) {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  const draft = parseDraftDto(body.draft);
  try {
    await upsertDraft(project, draft, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "保存服务端草稿失败") },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) return UNAUTHORIZED();
  const project = projectIdFrom(req.nextUrl.searchParams.get("project"));
  if (!project) {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  try {
    await deleteDraft(project);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "删除服务端草稿失败") },
      { status: 500 },
    );
  }
}
