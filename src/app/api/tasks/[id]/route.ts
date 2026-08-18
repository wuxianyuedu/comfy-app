import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { type ValidationError, parseValidationErrors } from "@/lib/comfyui/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { images: { orderBy: { sortIndex: "asc" } } },
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  // R-ardot63 (2026-08-15): 工作流默认值兜底 —— 有些工作流（如 z_image）把 seed/steps/cfg 硬编码在
  // subgraph 内部 KSampler 的 widgets_values，从不通过 inputs 暴露给用户，也写不进 task.params。
  // 这里抽稳定的非随机字段（steps/cfg/sampler/scheduler/denoise/size）回传前端；
  // seed 故意不返回，因为 control_after_generate=randomize 时工作流的 seed 不是真实执行值。
  //
  // R-ardot62 (2026-08-15)：上一段是错的！经过 extractRuntimeParams 抽过，
  // 历史里能拿到的 seed 是真值，落在 `task.params.runtime.seed`。这里把它也带回前端。
  const runtimeParams =
    typeof (task.params as Record<string, unknown>)?.runtime === "object" &&
    (task.params as Record<string, unknown>)?.runtime != null
      ? ((task.params as Record<string, any>).runtime as Record<string, any>)
      : null;
  const runtimeSeed =
    runtimeParams && Number.isFinite(Number(runtimeParams.seed))
      ? Number(runtimeParams.seed)
      : undefined;
  const workflowId =
    typeof (task.params as Record<string, unknown>)?.workflow === "string"
      ? String((task.params as Record<string, unknown>).workflow)
      : null;
  let workflowHints:
    | {
        steps?: number;
        cfg?: number;
        sampler_name?: string;
        scheduler?: string;
        denoise?: number;
        width?: number;
        height?: number;
        /** 历史执行抽取的真 seed，workflowHints 唯一权威来源 */
        seed?: number;
        seedSource?: "history" | "subgraph" | "top" | "request" | null;
        source: "subgraph" | "top";
      }
    | null = null;
  if (workflowId) {
    const wf = await prisma.workflowTemplate.findUnique({
      where: { id: workflowId },
      select: { rawJson: true, graph: true },
    });
    if (wf) {
      // 优先级：在 subgraph（definitions.subgraphs）的所有节点里找 KSampler /
      // KSamplerAdvanced 第一匹配；若没子图则从顶层 graph.nodes 找。
      const subgraphs =
        (wf.rawJson as { definitions?: { subgraphs?: Array<{ nodes?: unknown[] }> } } | null)
          ?.definitions?.subgraphs ?? [];
      const graphNodes =
        ((wf.graph as { nodes?: unknown[] } | null)?.nodes ?? []) as unknown[];

      const tryExtract = (
        nodes: unknown[],
        source: "subgraph" | "top"
      ): {
        ks?: {
          steps?: number;
          cfg?: number;
          sampler_name?: string;
          scheduler?: string;
          denoise?: number;
        };
        lat?: { width?: number; height?: number };
        source: "subgraph" | "top";
      } | null => {
        let ks: ReturnType<typeof tryExtract> extends infer R
          ? R extends null
            ? never
            : R extends { ks?: infer K }
            ? K
            : never
          : never = undefined as never;
        let lat: ReturnType<typeof tryExtract> extends infer R
          ? R extends null
            ? never
            : R extends { lat?: infer L }
            ? L
            : never
          : never = undefined as never;
        for (const raw of nodes) {
          const n = raw as Record<string, unknown>;
          const t = typeof n?.type === "string" ? n.type : "";
          const wv = n?.widgets_values;
          if (!ks && Array.isArray(wv) && /^KSampler(Advanced)?$/.test(t)) {
            // 标准 KSampler widgets_values 顺序：
            //   [seed, control_after_generate, steps, cfg, sampler_name, scheduler, denoise]
            // KSamplerAdvanced 类似但多 noise_seed 在前。宽松取位置 2..6。
            const steps = toNum(wv[2]);
            const cfg = toNum(wv[3]);
            const sampler_name = typeof wv[4] === "string" ? (wv[4] as string) : undefined;
            const scheduler = typeof wv[5] === "string" ? (wv[5] as string) : undefined;
            const denoise = toNum(wv[6]);
            if (steps != null || cfg != null || sampler_name || scheduler || denoise != null) {
              ks = { steps: steps ?? undefined, cfg: cfg ?? undefined, sampler_name, scheduler, denoise: denoise ?? undefined };
            }
          }
          if (!lat && Array.isArray(wv) && /Empty.*Latent/.test(t)) {
            const width = toNum(wv[0]);
            const height = toNum(wv[1]);
            if (width != null || height != null) lat = { width: width ?? undefined, height: height ?? undefined };
          }
        }
        if (!ks && !lat) return null;
        return { ks, lat, source };
      };
      // 优先 subgraph 节点
      for (const sg of subgraphs) {
        const out = tryExtract((sg.nodes ?? []) as unknown[], "subgraph");
        if (out) {
          workflowHints = {
            steps: out.ks?.steps,
            cfg: out.ks?.cfg,
            sampler_name: out.ks?.sampler_name,
            scheduler: out.ks?.scheduler,
            denoise: out.ks?.denoise,
            width: out.lat?.width,
            height: out.lat?.height,
            source: out.source,
          };
          break;
        }
      }
      if (!workflowHints) {
        const out = tryExtract(graphNodes, "top");
        if (out) {
          workflowHints = {
            steps: out.ks?.steps,
            cfg: out.ks?.cfg,
            sampler_name: out.ks?.sampler_name,
            scheduler: out.ks?.scheduler,
            denoise: out.ks?.denoise,
            width: out.lat?.width,
            height: out.lat?.height,
            source: out.source,
          };
        }
      }
    }
  }

  // R-ardot62：把真 seed 附到 workflowHints（前提是已经构建出 hints；source 标记 history）。
  // 旧 SDXL TXT2IMG 任务的 seed 直接走 `task.params.seed`（用户填的值视为真值）。
  if (workflowHints) {
    if (runtimeSeed !== undefined) {
      workflowHints.seed = runtimeSeed;
      workflowHints.seedSource = "history";
    } else {
      const reqSeed =
        (task.params as Record<string, unknown>)?.seed ??
        (task.params as Record<string, unknown>)?.requestSeed;
      const n = typeof reqSeed === "number" ? reqSeed
        : typeof reqSeed === "string" && reqSeed.trim() !== "" && Number.isFinite(Number(reqSeed))
          ? Number(reqSeed)
          : undefined;
      if (n !== undefined) {
        workflowHints.seed = n;
        workflowHints.seedSource = "request";
      }
    }
  }

  // R-Next (2026-08-17): parse the raw `validationErrors` JSON-string column
  // into a structured `ValidationError[]` so clients render a precise
  // per-field list instead of parsing the JSON string themselves.
  const validationErrors: ValidationError[] | null = parseValidationErrors(
    task.validationErrors
  );

  // Override the raw string column with the parsed array on the response
  // payload (keeps the contract clean for all consumers).
  const taskPayload = { ...task, validationErrors };

  return NextResponse.json({ task: taskPayload, workflowHints });
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Delete image files on disk as well.
    const task = await prisma.task.findUnique({
      where: { id },
      include: { images: true },
    });
    if (task) {
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      for (const img of task.images) {
        const full = path.join(process.cwd(), "public", img.localPath.replace(/^\//, ""));
        fsPromises.unlink(full).catch(() => {});
      }
      const dir = path.join(process.cwd(), "public", "generated", id);
      fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "删除失败" }, { status: 500 });
  }
}
