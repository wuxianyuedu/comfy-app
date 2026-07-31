import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth";
import { detectParamMap } from "@/lib/comfyui/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Get a single imported workflow with its full graph (for the node preview /
// parameter-mapping editor) plus its role-node mapping.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const tpl = await prisma.workflowTemplate.findFirst({
    where: { id, userId: user.id },
  });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });

  const graph = tpl.graph as Record<string, any>;
  const nodes = Object.entries(graph).map(([nodeId, n]) => ({
    id: nodeId,
    class_type: n?.class_type ?? "?",
    title: n?._meta?.title ?? n?.class_type ?? nodeId,
  }));
  const paramMap = (tpl.paramMap as Record<string, string>) ?? detectParamMap(graph);

  return NextResponse.json({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    graph,
    nodes,
    paramMap,
  });
}

// Persist the user's role-node mapping (which node is the positive prompt, etc.).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.paramMap !== "object" || body.paramMap === null) {
    return NextResponse.json({ error: "缺少 paramMap" }, { status: 400 });
  }
  const tpl = await prisma.workflowTemplate.findFirst({ where: { id, userId: user.id } });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });

  await prisma.workflowTemplate.update({
    where: { id },
    data: { paramMap: body.paramMap },
  });
  return NextResponse.json({ ok: true });
}
