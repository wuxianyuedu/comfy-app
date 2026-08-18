import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 下载「本次生成实际用到的 workflow.json」。
 *
 * 方案 B (2026-08-15)：任务完成时已在 Task.workflowSnapshot 写一份执行时捕获的
 * 独立快照（与 WorkflowTemplate 的覆盖式单行存储解耦），这里优先返回它；历史任务
 * 若尚无 DB 快照，则回退到磁盘 `generated/.../workflow.json`；都没有则 404。
 *
 * 返回的是「纯 workflow JSON」本体（便于浏览器直接保存为 workflow.json），来源标识
 * 通过 `X-Workflow-Source` 响应头带出（execution=执行时捕获 / backfill=历史回填 /
 * disk=磁盘回退）。前端详情页也可直接读 `task.workflowSnapshot.source` 展示提示文案。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    select: { workflowSnapshot: true, projectId: true },
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 1) DB 执行快照优先
  const snap = task.workflowSnapshot as
    | { workflow?: unknown; capturedAt?: string; source?: string }
    | null;
  if (snap && snap.workflow != null) {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("X-Workflow-Source", snap.source === "backfill" ? "backfill" : "execution");
    if (snap.capturedAt) headers.set("X-Workflow-Captured-At", snap.capturedAt);
    return new NextResponse(JSON.stringify(snap.workflow, null, 2), { status: 200, headers });
  }

  // 2) 回退到磁盘 workflow.json
  const dir = task.projectId
    ? path.join(process.cwd(), "public", "generated", "projects", task.projectId, id)
    : path.join(process.cwd(), "public", "generated", id);
  const diskPath = path.join(dir, "workflow.json");
  try {
    const raw = await fs.readFile(diskPath, "utf-8");
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("X-Workflow-Source", "disk");
    return new NextResponse(raw, { status: 200, headers });
  } catch {
    return NextResponse.json(
      { error: "no workflow snapshot available for this task" },
      { status: 404 }
    );
  }
}
