// Workshop 前端项目草稿的服务端镜像：GET /api/workshop/draft?project=<wsp_*> → { exists, draft? }；
// PUT { project, draft } → { ok: true }；DELETE (同上 query) → { ok: true }。
// 目的：工坊编辑的剧本/角色/分镜不再只落 localStorage —— 每次自动保存也写穿到本地 db.sqlite 的 workshopDraft 表，清缓存也不丢。
// 鉴权沿用 requireRequestUser（未开启登录门槛时回落本地演示用户，单机照常可用）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { parseDraftDto, draftHasContent } from "~/lib/workshop/draft-sync-shared";
import { NotFoundError } from "~/lib/core/errors";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import {
  deleteDraft,
  findDraftOwner,
  getDraft,
  listDraftsByUser,
  upsertDraft,
} from "~/server/workshop/draft-repository";
import { apiErrorBody } from "~/lib/api-error";
import { errorResponse, unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORIZED = () => unauthorizedResponse();

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
    return UNAUTHORIZED();
  }
  const project = projectIdFrom(req.nextUrl.searchParams.get("project"));
  try {
    // 不带 project → 返回该用户全部服务端项目摘要（本地索引被清空时用来重建）。
    if (project === null || project === "") {
      const drafts = await listDraftsByUser(user.id);
      return NextResponse.json({ drafts });
    }
    /* 归属过滤（ISSUE #4556）：本人或无主可见；他人的草稿与不存在同形
     * （exists:false），不借响应探得他人项目 id 的存在性。 */
    const draft = await getDraft(project, user.id);
    if (!draft || !draftHasContent(draft)) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: true, draft });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取服务端草稿失败"), {
      status: 500,
    });
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return UNAUTHORIZED();
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const project = typeof body.project === "string" && body.project ? body.project : null;
  if (project === null || project === "") {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  const draft = parseDraftDto(body.draft);
  try {
    /* 归属校验（ISSUE #4556，与 tRPC task.detail 同口径）：他人的草稿按 NOT_FOUND
     * 拒绝——不区分「不存在」与「不是你的」，避免借状态码探得他人项目 id 的存在性。
     * findDraftOwner 不做归属过滤，才能把这两种情形分开。 */
    const existing = await findDraftOwner(project);
    if (existing && existing.userId !== null && existing.userId !== user.id) {
      return errorResponse(new NotFoundError("工坊草稿不存在"));
    }
    /* ifNewer（#4023）：两侧都带版本时刻时，更旧的 PUT 不覆盖较新的镜像——
     * 旧标签页 / 旧窗口迟到的自动保存不再回滚别处的新编辑。缺时刻（旧数据）
     * 保持原样落库，行为与此前一致。 */
    const incomingAt = draft.updatedAt;
    const existingAt = existing?.updatedAt.getTime();
    if (
      typeof incomingAt === "number" &&
      typeof existingAt === "number" &&
      incomingAt < existingAt
    ) {
      return NextResponse.json({ ok: true, stale: true });
    }
    await upsertDraft(project, draft, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "保存服务端草稿失败"), {
      status: 500,
    });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return UNAUTHORIZED();
  }
  const project = projectIdFrom(req.nextUrl.searchParams.get("project"));
  if (project === null || project === "") {
    return NextResponse.json({ error: "project 不能为空" }, { status: 400 });
  }
  try {
    /* 归属过滤（ISSUE #4556）：只删本人或无主的行；他人的草稿删不动，
     * 与「本来就不存在」同形（alreadyGone:true），不泄露存在性。 */
    const deleted = await deleteDraft(project, user.id);
    /* 幂等应答带 alreadyGone（#4048）：与 materials 的 DELETE 同一判据——
     * 「删了不存在的东西」对调用方可见，而不是无差别 ok。 */
    return NextResponse.json({ ok: true, alreadyGone: !deleted });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "删除服务端草稿失败"), {
      status: 500,
    });
  }
}
