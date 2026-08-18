import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/tasks/[id]/open-folder
 * 返回本机自定义协议 URL：comfyapp://open?path=<encoded absolute path>
 *
 * 前端拿到后直接导航到该 URL（user-initiated 点击），浏览器弹出
 * 「是否打开外部应用」确认 → OS 调起 comfyapp:// 协议 handler
 * （scripts/comfyapp-open-folder.ps1）→ 在白名单内用 explorer 打开目录。
 *
 * 设计取舍：
 * - 不「下载 .url」：用户明确要求不下载任何文件。
 * - 不 GET 302→file://：Chromium 硬拦截 HTTP→file:// 跳转
 *   （ERR_UNSAFE_REDIRECT / Not allowed to load local resource）。
 *   comfyapp:// 是 external protocol，走「外部应用确认」机制，浏览器不拦。
 *
 * 路径白名单：仅放行 process.cwd()/public/generated/... 下的目录
 * （server-side 校验一次，handler 端再校验一次，双向防御）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  // taskId 形状防御：DB 是 cuid；先卡掉所有 shell metacharacter
  // 和路径 traversal 的可能性，从源头避免拼路径注入。
  if (!/^[a-z0-9]{20,40}$/i.test(taskId)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, status: true },
  });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 与 runner.ts 完全一致：public/generated/<taskId>/  or  projects/<projectId>/<taskId>/
  const baseDir = path.join(process.cwd(), "public", "generated");
  const dir = task.projectId
    ? path.join(baseDir, "projects", task.projectId, taskId)
    : path.join(baseDir, taskId);

  // 二次白名单：拼好后归一化，必须仍在 baseDir 下
  const normalized = path.resolve(dir);
  const normalizedBase = path.resolve(baseDir);
  if (
    normalized !== normalizedBase &&
    !normalized.startsWith(normalizedBase + path.sep)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 目录必须真实存在（已失败或未生成的任务目录可能还没建出来）
  let exists = false;
  try {
    const st = await fs.stat(normalized);
    exists = st.isDirectory();
  } catch {
    exists = false;
  }

  if (!exists) {
    return NextResponse.json(
      {
        error: "directory missing",
        absolutePath: normalized,
      },
      { status: 404 }
    );
  }

  const comfyappUrl =
    "comfyapp://open?path=" + encodeURIComponent(normalized);

  return NextResponse.json({
    absolutePath: normalized,
    comfyappUrl,
  });
}
