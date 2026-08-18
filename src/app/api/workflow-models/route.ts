import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Workflow model-tag library (user-level global) ─────────────────────────
// A single user owns a flat, de-duplicated set of model-name tags
// (e.g. "z-image", "wan2.2").  Tags are referenced by many workflows via an
// implicit many-to-many relation (WorkflowTemplate.modelTags).  These routes
// let the UI list / create / delete tags — the library is shared across all
// of a user's workflows so the same model name need only be typed once.

/** GET /api/workflow-models → list the current user's tags, each with the
 *  number of workflows it is attached to.  Sorted alphabetically for a stable
 *  UI.  Always returns JSON (never a 0-byte body) so the client never crashes
 *  on a failed parse. */
export async function GET() {
  try {
    const user = await getServerUser();
    const tags = await prisma.workflowModelTag.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        count: t._count.workflows,
      })),
    });
  } catch (e: any) {
    console.error("[api/workflow-models] GET failed:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "服务器内部错误", tags: [] }, { status: 500 });
  }
}

/** POST /api/workflow-models → add a new tag (idempotent: if the user already
 *  has a tag with the same name, the existing one is returned instead of
 *  erroring).  Body: { name: string }. */
export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "标签名称不能为空" }, { status: 400 });
    }
    if (name.length > 64) {
      return NextResponse.json({ error: "标签名称过长（最多 64 字符）" }, { status: 400 });
    }
    const tag = await prisma.workflowModelTag.upsert({
      where: { userId_name: { userId: user.id, name } },
      update: {},
      create: { userId: user.id, name },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return NextResponse.json({
      tag: { id: tag.id, name: tag.name, count: tag._count.workflows },
    });
  } catch (e: any) {
    console.error("[api/workflow-models] POST failed:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "服务器内部错误" }, { status: 500 });
  }
}

/** PATCH /api/workflow-models — rename an existing tag.
 *  Body: { oldName, newName }. The join rows are keyed by tag id, so renaming
 *  keeps every workflow binding intact — only the label text changes.
 *  Errors: 400 on empty / too-long / same-name (same-name returns idempotent
 *  ok:true), 404 when oldName does not exist for this user, 409 when newName
 *  collides with another of the user's tags (we never silently merge two
 *  distinct tags). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getServerUser();
    const body = await req.json().catch(() => null);
    const oldName = typeof body?.oldName === "string" ? body.oldName.trim() : "";
    const newName = typeof body?.newName === "string" ? body.newName.trim() : "";
    if (!oldName || !newName) {
      return NextResponse.json({ error: "原名称和新名称都不能为空" }, { status: 400 });
    }
    if (newName.length > 64) {
      return NextResponse.json({ error: "标签名称过长（最多 64 字符）" }, { status: 400 });
    }
    if (oldName === newName) {
      return NextResponse.json({ ok: true, renamed: false, reason: "same-name" });
    }
    const existing = await prisma.workflowModelTag.findUnique({
      where: { userId_name: { userId: user.id, name: oldName } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: `标签「${oldName}」不存在` }, { status: 404 });
    }
    const collision = await prisma.workflowModelTag.findUnique({
      where: { userId_name: { userId: user.id, name: newName } },
      select: { id: true },
    });
    if (collision) {
      return NextResponse.json(
        { error: `标签「${newName}」已存在，请换一个名字` },
        { status: 409 },
      );
    }
    const tag = await prisma.workflowModelTag.update({
      where: { id: existing.id },
      data: { name: newName },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return NextResponse.json({
      ok: true,
      renamed: true,
      tag: { id: tag.id, name: tag.name, count: tag._count.workflows },
    });
  } catch (e: any) {
    console.error("[api/workflow-models] PATCH failed:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "服务器内部错误" }, { status: 500 });
  }
}

/** DELETE /api/workflow-models → remove a tag (and its workflow links).
 *  Body: { name: string } — identification by name is simplest for the UI.
 *  Removing a tag detaches it from every workflow that referenced it (the
 *  implicit-join rows are auto-cleaned by the cascade/relation deletion). */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getServerUser();
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "标签名称不能为空" }, { status: 400 });
    }
    const existing = await prisma.workflowModelTag.findUnique({
      where: { userId_name: { userId: user.id, name } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ ok: true, deleted: false });
    }
    await prisma.workflowModelTag.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e: any) {
    console.error("[api/workflow-models] DELETE failed:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "服务器内部错误" }, { status: 500 });
  }
}
