import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { buildAndValidate, buildCustomWorkflow } from "@/lib/comfyui/workflow";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { enqueue } from "@/lib/comfyui/runner";

export const runtime = "nodejs";

const LoraSchema = z.object({ name: z.string(), weight: z.number() });
const GenerateSchema = z.object({
  workflow: z.string(),
  prompt: z.string().max(2000).optional(),
  negative: z.string().max(2000).optional(),
  checkpoint: z.string().min(1).optional(), // optional for custom workflows
  loras: z.array(LoraSchema).optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  steps: z.number().int().min(1).max(100).optional(),
  cfg: z.number().min(0).max(30).optional(),
  size: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  seed: z.number().int().optional(),
  denoise: z.number().min(0).max(1).optional(),
  inputImage: z.string().optional(),
  mask: z.string().optional(),
  upscaleModel: z.string().optional(),
  frames: z.number().int().min(1).max(1000).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  wanModel: z.string().optional(),
  wanVae: z.string().optional(),
  t5Model: z.string().optional(),
  firstFrame: z.string().optional(),
  lastFrame: z.string().optional(),
  paramMap: z.record(z.string()).optional(),
  canvasGraph: z.record(z.any()).optional(), // Direct graph from canvas (overrides template)
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  const data = parsed.data;
  const user = await getServerUser();
  const count = data.count ?? 1;

  let built: { ok: boolean; prompt?: Record<string, unknown>; error?: string };
  let workflowName: string;
  let taskType: string;

  const builtin = getWorkflow(data.workflow);
  if (builtin) {
    // Built-in workflow template (token-based).
    built = await buildAndValidate(data.workflow, { ...data, count });
    workflowName = data.workflow;
    taskType = builtin.taskType;
  } else {
    // Custom workflow imported from ComfyUI "Export (API Format)".
    const tpl = await prisma.workflowTemplate.findFirst({
      where: { id: data.workflow, userId: user.id },
    });
    if (!tpl && !data.canvasGraph) {
      return NextResponse.json({ error: "未找到该自定义工作流" }, { status: 404 });
    }
    // Use canvas-edited graph if provided; otherwise fall back to template
    const graph = (data.canvasGraph as Record<string, any>) ?? (tpl?.graph as Record<string, any>);
    if (!graph) {
      return NextResponse.json({ error: "工作流图数据为空" }, { status: 400 });
    }
    try {
      built = {
        ok: true,
        prompt: buildCustomWorkflow(
          graph,
          { ...data, count },
          (data.paramMap as any) ?? (tpl?.paramMap as any)
        ),
      };
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "工作流构建失败" }, { status: 400 });
    }
    workflowName = tpl?.name ?? data.workflow;
    taskType = tpl?.taskType ?? "TXT2IMG";
  }

  if (!built.ok || !built.prompt) {
    return NextResponse.json({ error: built.error ?? "工作流构建失败" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      userId: user.id,
      type: taskType,
      prompt: data.prompt ?? "",
      negativePrompt: data.negative,
      params: data as object,
      workflowName,
      status: "QUEUED",
    },
  });

  enqueue({ taskId: task.id, prompt: built.prompt });
  return NextResponse.json({ taskId: task.id });
}
