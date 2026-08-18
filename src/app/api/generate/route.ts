import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { buildAndValidate, buildCustomWorkflow } from "@/lib/comfyui/workflow";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { enqueue } from "@/lib/comfyui/runner";
import { synthesizeFirstFrame } from "@/lib/comfyui/firstframe";

export const runtime = "nodejs";

const LoraSchema = z.object({ name: z.string(), weight: z.number() });
const WorkflowInputSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  value: z.unknown(),
});
const GenerateSchema = z.object({
  workflow: z.string(),
  // ── 2026-08-13 项目级产出：归属到某个画布项目 ──
  // projectId 是 localStorage 里的 CanvasProject.id（client 侧 proj_... 字符串）。
  projectId: z.string().optional(),
  // 本次生成使用到的参考图路径/url 数组（img2img/inpaint/i2v/flf 上游、首末帧…）。
  referenceImages: z.array(z.string()).optional(),
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
  workflowInputs: z.array(WorkflowInputSchema).optional(),
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
    // Local video: text-to-video / first-last-frame with no supplied image
    // auto-synthesizes a first frame via a local txt2img pass (no cloud/auth).
    if (
      builtin.taskType === "VIDEO" &&
      !data.inputImage &&
      !data.firstFrame
    ) {
      try {
        data.inputImage = await synthesizeFirstFrame({
          userId: user.id,
          prompt: data.prompt ?? "",
          negative: data.negative,
          size: data.size,
        });
      } catch (e: any) {
        return NextResponse.json(
          { error: `首帧合成失败：${e?.message ?? e}` },
          { status: 500 }
        );
      }
    }
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
    workflowName = tpl?.name ?? data.workflow;
    taskType = tpl?.taskType ?? "TXT2IMG";

    // Raw UI-format json (subgraph wrappers) → execute via comfy-cli, which
    // natively expands subgraphs + converts UI→API client-side. Canvas-edited
    // graphs (canvasGraph) and API-only imports keep the existing POST path.
    if (tpl?.rawJson && !data.canvasGraph) {
      const task = await prisma.task.create({
        data: {
          userId: user.id,
          type: taskType,
          prompt: data.prompt ?? "",
          negativePrompt: data.negative,
          params: data as object,
          workflowName,
          projectId: data.projectId ?? null,
          referenceImages: (data.referenceImages?.length
            ? data.referenceImages
            : undefined) as object | undefined,
          status: "QUEUED",
        },
      });
      enqueue({ taskId: task.id, rawJson: tpl.rawJson as any, overrides: data.workflowInputs });
      return NextResponse.json({ taskId: task.id });
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
      projectId: data.projectId ?? null,
      referenceImages: (data.referenceImages?.length
        ? data.referenceImages
        : undefined) as object | undefined,
      status: "QUEUED",
    },
  });

  enqueue({ taskId: task.id, prompt: built.prompt });
  return NextResponse.json({ taskId: task.id });
}
