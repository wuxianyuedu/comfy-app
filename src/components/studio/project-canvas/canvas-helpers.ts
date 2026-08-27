/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
/* ── Canvas helper functions ──
 * Thin wrappers around the existing Comfy-APP APIs so the canvas nodes can
 * upload references, enqueue generations, and poll for results without
 * duplicating server logic.
 */

import type { ValidationError } from "@/lib/comfyui/validation";
import { vanillaApi } from "~/trpc/vanilla";
import type { Edge, FitViewOptions } from "@xyflow/react";
import {
  type CanvasNodeType,
  type CanvasNodeData,
  isCanvasNode,
} from "./canvas-types";

/** 生成画布节点唯一 id（项目画布各创建入口共用，避免散落重复逻辑）。 */
export function makeNodeId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 双 rAF 的 fitView 调度器：等 ReactFlow 完成本轮布局后再 fit，
 *  替代脆弱的 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
export function makeFitViewScheduler(
  fitView: (options?: FitViewOptions) => void
): (padding?: number) => void {
  return (padding = 0.25) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitView({ padding, duration: 300 });
      });
    });
  };
}

/** 连线传播的纯函数核心：根据 source 节点与出边，把上游数据写入下游节点。
 *  - workflow 节点：按 ioKey 写进 workflowInputs
 *  - picture / movie 内容载体：把上游 image 写入 mediaPath
 *  - 其余节点：按 targetHandle 分派 prompt/negative/steps/cfg/seed/inputImage
 *  workflowArdot 纯视觉节点无数据，直接跳过。 */
export function applyPropagationToNodes(
  nodes: CanvasNodeType[],
  sourceId: string,
  opts: {
    srcData: CanvasNodeData;
    outEdges: Edge[];
    importedFile: string | null;
  }
): CanvasNodeType[] {
  const { srcData: src, outEdges, importedFile } = opts;

  return nodes.map((node) => {
    if (node.id === sourceId) return node;
    if (!isCanvasNode(node)) return node;
    const edge = outEdges.find((outEdge) => outEdge.target === node.id);
    if (!edge) return node;
    const td = node.data;

    // 连线传入自定义工作流节点：按 ioKey 把上游输出写进 workflowInputs，
    // 这样 runGenerate 的 toWorkflowInputsPayload 会把它一起发给后端。
    if (td.kind === "workflow" && edge.targetHandle) {
      const key = edge.targetHandle;
      let stored: unknown = undefined;
      if (src.kind === "text" && src.content?.trim()) stored = src.content;
      else if ((src.kind === "picture" || src.kind === "movie") && src.mediaPath)
        stored = src.mediaPath;
      else if (src.resultPath && src.resultMediaType !== "video" && importedFile)
        stored = importedFile;
      if (stored !== undefined) {
        return {
          ...node,
          data: {
            ...td,
            workflowInputs: { ...(td.workflowInputs ?? {}), [key]: stored },
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    /* 上游产出写入 picture / movie 资产节点 — 当 target 是 picture 或 movie
     * 内容载体时，把 source 的 image (importedFile 优先于 src.mediaPath) 写到
     * target.mediaPath，让图片资产自动接收工作流生成的图作为内容；下游生图
     * 节点再从 picture 节点的 output Handle 接收这个 mediaPath，形成
     * 「工作流 → 图片资产 → 生图」完整链路。upstreamId 标记数据来源便于 UI
     * 后续显示「连线源：xxx 工作流」。 */
    if (td.kind === "picture" || td.kind === "movie") {
      const incoming: string | undefined =
        importedFile ??
        (src.kind === "picture" || src.kind === "movie" ? src.mediaPath ?? undefined : undefined);
      if (incoming) {
        return {
          ...node,
          data: {
            ...td,
            mediaPath: incoming,
            mediaName: src.resultPath
              ? String(src.resultPath).split(/[\\/]/).pop()
              : td.mediaName,
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    const next: CanvasNodeData = { ...td };
    switch (edge.targetHandle) {
      case "prompt":
        // A text-carrier node feeds its free text; everything else feeds prompt.
        if (src.kind === "text") {
          if (src.content?.trim()) next.prompt = src.content;
        } else if (src.prompt?.trim()) {
          next.prompt = src.prompt;
        }
        break;
      case "negative":
        if (src.negative?.trim()) next.negative = src.negative;
        break;
      case "steps":
        if (src.steps != null) next.steps = src.steps;
        break;
      case "cfg":
        if (src.cfg != null) next.cfg = src.cfg;
        break;
      case "seed":
        if (src.seed?.trim()) next.seed = src.seed;
        break;
      case "inputImage":
      default:
        if (importedFile) {
          next.inputImage = importedFile;
          next.upstreamId = sourceId;
          // auto-switch the consumer mode so the fed input is actually used
          if (next.kind === "image" && next.mode === "txt2img") next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        } else if (
          (src.kind === "picture" || src.kind === "movie") &&
          src.mediaPath
        ) {
          // Content carriers already live in ComfyUI's input dir, so no
          // re-import is needed — wire the existing filename straight in.
          next.inputImage = src.mediaPath;
          next.upstreamId = sourceId;
          if (next.kind === "image" && next.mode === "txt2img") next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        }
        break;
    }
    return { ...node, data: next };
  });
}

export async function uploadImageFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const d = await res.json();
  if (!d.name) throw new Error(d.error ?? "上传失败");
  return d.name;
}

/* Re-upload an already-generated output (served via /outputs/...) back into
 * ComfyUI's input directory so it can be consumed as a downstream node's
 * `inputImage`. Cached by source path to avoid re-uploading for many targets. */
const importCache = new Map<string, string>();

export async function importOutputAsInput(localPath: string): Promise<string> {
  if (importCache.has(localPath)) return importCache.get(localPath)!;
  const abs = localPath.startsWith("/") ? localPath : `/${localPath}`;
  const res = await fetch(abs);
  if (!res.ok) throw new Error("读取上游输出失败");
  const blob = await res.blob();
  const fname = localPath.split("/").pop() ?? "input.png";
  const file = new File([blob], fname, { type: blob.type || "image/png" });
  const name = await uploadImageFile(file);
  importCache.set(localPath, name);
  return name;
}

/* Upload a user asset (image OR video) for a content-carrier node.
 * Reuses the same `/api/upload` endpoint the image nodes use (it drops the
 * bytes into ComfyUI's input dir and returns the stored filename). Returns
 * both the filename and a ready-to-use preview URL (proxied via /api/images
 * so the browser never hits ComfyUI :8188 directly). */
export async function uploadMediaFile(
  file: File
): Promise<{ name: string; url: string }> {
  const name = await uploadImageFile(file);
  const url = `/api/images?filename=${encodeURIComponent(name)}&type=input`;
  return { name, url };
}

export async function startGenerate(payload: Record<string, unknown>): Promise<string> {
  const d = await vanillaApi.generate.generate.mutate(payload as any);
  if (!d.taskId) throw new Error("生成失败");
  return d.taskId;
}

export interface TaskResult {
  localPath: string;
  mediaType: string;
  taskId?: string;
}

/** Returned by `pollTask` when the server task ended without producing an
 *  output (FAILED / CANCELLED / ERROR / TIMEOUT).  Carries the underlying
 *  backend error message from `prisma.task.error` so the UI can show a
 *  meaningful explanation instead of a generic "生成失败或无结果" stub. */
export interface TaskFailure {
  taskId: string;
  status: "FAILED" | "CANCELLED" | "ERROR" | "TIMEOUT";
  /** Raw backend / ComfyUI error message, already decoded to plain text. */
  error: string;
  /** Snapshot of the original request payload (from `prisma.task.params`)
   *  so the error UI can show "what was sent" next to "what failed". */
  params?: unknown;
  /** R-Next (2026-08-17): structured ComfyUI /prompt validation errors
   *  (flattened `node_errors`), so the UI can render a precise per-field
   *  list instead of parsing the English summary in `error`. */
  validationErrors?: ValidationError[];
}

/** Polls a task until it has a result, fails, or times out.  On success
 *  returns a `TaskResult` (truthy); on terminal failure returns the
 *  structured `TaskFailure` so callers can surface the real error. */
export async function pollTask(
  taskId: string,
  timeoutMs = 25 * 60 * 1000,
  /* R-ardot103 (2026-08-17): callback fired on every poll tick with a
   *  clamped 0..100 progress. Optional — callers that don't care simply
   *  omit it. Wired into CanvasNode.runGenerate so the picture/movie
   *  preview can show a water-fill overlay while generation runs. */
  onProgress?: (progress: number) => void
): Promise<TaskResult | TaskFailure> {
  const start = Date.now();
   
  while (true) {
    if (Date.now() - start > timeoutMs) {
      return {
        taskId,
        status: "TIMEOUT",
        error: `轮询超时（${Math.round(timeoutMs / 60000)} 分钟无响应）`,
      };
    }
    try {
      const task = await vanillaApi.task.detail.query({ id: taskId });
        /* R-ardot103 (2026-08-17): surface 0..100 progress to the canvas.
         *  Previously dropped — pollTask only read status + images, so the
         *  canvas picture/image preview had no progress to show even
         *  though /api/tasks/[id] returns task.progress. */
        if (onProgress && typeof task?.progress === "number") {
          onProgress(Math.max(0, Math.min(100, task.progress)));
        }
        const imgs: TaskResult[] = task?.images ?? [];
        if (imgs.length) {
          const v = imgs.find((img) => img.mediaType === "video") ?? imgs[0];
          return { taskId, localPath: v!.localPath, mediaType: v!.mediaType };
        }
        const st = task?.status as string | undefined;
        if (st === "FAILED" || st === "CANCELLED" || st === "ERROR") {
          // Defensive normalize (R67 + R69): `task.error` is typed `String?`
          // in Prisma but legacy rows / older code paths (e.g.
          // buildPromptError pre-R69 used `String(res.error)`) can land
          // the literal "[object Object]" as the stored string.  We
          // peel structured objects to JSON AND detect the literal
          // garbage-string sentinel so the UI never shows
          // `[object Object]`.  Garbage strings get replaced with the
          // generic fallback (R69). */
          const rawErr = task?.error;
          const peeled =
            typeof rawErr === "string"
              ? rawErr
              : rawErr && typeof rawErr === "object"
                ? (() => {
                    try {
                      return JSON.stringify(rawErr);
                    } catch {
                      return "";
                    }
                  })()
                : "";
          const trimmed = peeled.trim();
          const isGarbage =
            !trimmed ||
            trimmed === "[object Object]" ||
            trimmed === "[unserializable error]";
          return {
            taskId,
            status: st,
            error: isGarbage
              ? `任务 ${st}（无详细错误，请查看后端日志）`
              : trimmed,
            /* 2026-08-13 R83: 失败也回传请求 payload 快照，前端用于在失败面板里
             *  展示「执行了哪些参数」。task.params 由 /api/generate route.ts
             *  写入（Prisma JSON 列）。 */
            params: task?.params ?? undefined,
            /* R-Next (2026-08-17): carry structured validation errors from
             *  /api/tasks/[id].task.validationErrors into the failure result
             *  so CanvasNode can render a precise per-field list. */
            validationErrors: task?.validationErrors as unknown as ValidationError[] | undefined,
          };
        }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** Type guard for the success branch — keeps existing `if (result)` call
 *  sites semantic-compatible (a populated TaskResult is still truthy) while
 *  making the failure branch type-safe. */
export function isTaskSuccess(
  r: TaskResult | TaskFailure
): r is TaskResult {
  return typeof (r as TaskResult).localPath === "string";
}

/** Expand a theme/梗概 into a structured script via the LLM, with offline fallback. */
export async function runScript(theme: string): Promise<string> {
  try {
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "你是一个专业编剧助手。用户给出一个主题或梗概，请扩写成一份带有场景划分的中文短片剧本，每个场景包含：场景标题、画面描述、台词要点。语言生动、有画面感。",
          },
          { role: "user", content: theme },
        ],
        temperature: 0.85,
        maxTokens: 1400,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      const c = d.content ?? d.choices?.[0]?.message?.content ?? "";
      if (c?.trim()) return c.trim();
    }
  } catch {
    /* fall through to offline */
  }
  return `【场景一】
画面：清晨的城市还在沉睡，主角背着行囊走出老旧的公寓。
台词：今天，一切重新开始。

【场景二】
画面：地铁站台，主角遇见一位神秘的同行者。
台词：你也去那边吗？一起走吧。

【场景三】
画面：黄昏的山顶，两人回望来路，灯火渐起。
台词：原来坚持本身就是风景。`;
}
