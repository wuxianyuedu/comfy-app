import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { detectParamMap } from "@/lib/comfyui/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List the current user's imported ComfyUI workflows.
export async function GET() {
  const user = await getServerUser();
  const list = await prisma.workflowTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, taskType: true, createdAt: true, paramMap: true },
  });
  return NextResponse.json({ workflows: list });
}

// Import a ComfyUI workflow exported in "API format".
// Body: { name?: string, graph: object, taskType?: string }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.graph !== "object" || Array.isArray(body.graph)) {
    return NextResponse.json(
      { error: "缺少有效的工作流图（graph），请粘贴 ComfyUI「导出(API格式)」的 JSON" },
      { status: 400 }
    );
  }

  const g = body.graph as Record<string, any>;
  // Sanity check: an API-format graph is an object of nodeId -> { class_type, inputs }.
  const looksLikeGraph = Object.values(g).some(
    (n) => n && typeof n === "object" && "class_type" in (n as any)
  );
  if (!looksLikeGraph) {
    return NextResponse.json(
      { error: "不是有效的 ComfyUI API 工作流（未找到节点 class_type）" },
      { status: 400 }
    );
  }

  const name = String(body.name ?? "未命名工作流").slice(0, 80);
  let taskType = String(body.taskType ?? "");
  if (!taskType) {
    const hasImg2img = Object.values(g).some(
      (n) => n?.class_type === "VAEEncode" || n?.class_type === "LoadImage"
    );
    taskType = hasImg2img ? "IMG2IMG" : "TXT2IMG";
  }

  // Auto-detect role nodes so the workflow is usable immediately.
  const paramMap = detectParamMap(g);

  const user = await getServerUser();
  const tpl = await prisma.workflowTemplate.create({
    data: { userId: user.id, name, taskType, graph: g, paramMap },
  });
  return NextResponse.json({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    paramMap: tpl.paramMap,
  });
}
