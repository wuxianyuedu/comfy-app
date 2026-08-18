import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2026-08-10 R16: POST /api/workflows/[id]/resync
 *
 * Manual re-import of an on-disk local-workflow source file. Re-reads the
 * file (read-only against the disk — see `localWorkflows.ts` iron rule) and
 * overwrites the DB row's `graph / rawJson / positions / paramMap /
 * taskType / sourceChecksum / sourceMtime`. The user-facing UI on
 * WorkflowLibrary surfaces this via a "↻ 同步" button when the list GET
 * detected `diskDirty = (diskMtimeSec > sourceMtime)`.
 *
 * Behaviour matrix:
 *   - sourcePath is null / not a local row  → 405
 *   - file deleted / missing               → 200 { missing: true }
 *   - mtime matches the last reimport      → 200 { unchanged: true }
 *   - file changed                         → 200 { updated: true, summary }
 *
 * NEVER write the original .json on disk; only the DB row is mutated.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();

  const tpl = await prisma.workflowTemplate.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      sourcePath: true,
      sourceMtime: true,
      sourceChecksum: true,
      /* R-ardot87 (2026-08-16): 同步时透传 taskType 给 reimportFromSource，
       * 避免覆盖用户已手动设置的类型（不再被自动推断回写）。 */
      taskType: true,
    },
  });
  if (!tpl) {
    return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });
  }
  if (!tpl.sourcePath) {
    return NextResponse.json(
      {
        error:
          "该工作流不是本地工作流（没有关联磁盘文件），无需同步",
      },
      { status: 405 }
    );
  }

  const { reimportFromSource } = await import("@/lib/comfyui/importSource");
  let re;
  try {
    re = await reimportFromSource({
      sourcePath: tpl.sourcePath,
      sourceMtime: tpl.sourceMtime,
      sourceChecksum: tpl.sourceChecksum,
      existingTaskType: tpl.taskType ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `同步失败：${e?.message ?? String(e)}` },
      { status: 500 }
    );
  }

  if (re.missing) {
    return NextResponse.json({
      id,
      missing: true,
      message: "磁盘文件已不存在",
    });
  }
  if (re.unchanged) {
    return NextResponse.json({
      id,
      unchanged: true,
      message: "磁盘文件未变化",
    });
  }
  if (!re.update) {
    // Defensive: reimportFromSource always sets exactly one of
    // missing / unchanged / update, but we fall back conservatively.
    return NextResponse.json(
      { error: "reimportFromSource 返回意外结果" },
      { status: 500 }
    );
  }

  await prisma.workflowTemplate.update({
    where: { id },
    data: {
      graph: re.update.graph as any,
      rawJson: re.update.rawJson as any,
      positions: re.update.positions as any,
      paramMap: re.update.paramMap as any,
      taskType: re.update.taskType,
      sourceChecksum: re.update.sourceChecksum,
      sourceMtime: re.update.sourceMtime,
    },
  });

  return NextResponse.json({
    id,
    updated: true,
    taskType: re.update.taskType,
    sourceChecksum: re.update.sourceChecksum,
    sourceMtime: re.update.sourceMtime,
    message: "已同步磁盘内容",
  });
}
