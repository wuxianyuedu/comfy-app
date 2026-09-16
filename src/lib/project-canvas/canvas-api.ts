/* ── 项目画布的网络客户端（第②层的网络部分）─────────────────────────────
 * 上传 / 启动生成 / 轮询任务 / LLM 剧本扩写四个请求集中在这里，视图层
 * （components/studio/project-canvas/**）不再直接 fetch 或调 vanillaApi
 * ——规范 17 §17.2：视图禁 IO，逻辑进 hooks 或 <domain>-client/api。
 *
 * 响应收窄与错误解析只此一份：服务端改错误信封时改这里即可，视图零感知。
 * 失败一律「抛出带中文文案的 Error」，由调用方（hook）决定提示形态。
 */

import { waitForComfyReady } from "@/lib/comfy-readiness-client";
import {
  parseValidationErrorsJson,
  type ValidationError,
} from "@/lib/comfyui/validation";
import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";

/** 单次 /api/upload 的结果：成功给出文件名，失败给出可读原因与可否重试。 */
type UploadAttempt =
  | { ok: true; name: string }
  | { ok: false; retryable: boolean; message: string };

/** 单次 POST /api/upload；不成功时返回可读原因与是否值得重试。 */
async function postUpload(file: File): Promise<UploadAttempt> {
  const fd = new FormData();
  fd.append("image", file);
  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body: fd });
  } catch {
    // 网络层失败（应用服务重启窗口）：按可重试处理，不把 fetch 原文抛给用户。
    return {
      ok: false,
      retryable: true,
      message: "上传请求未送达，请稍候重试",
    };
  }
  let d: unknown;
  try {
    d = await res.json();
  } catch {
    d = undefined;
  }
  const obj =
    typeof d === "object" && d !== null ? (d as Record<string, unknown>) : null;
  const name = typeof obj?.name === "string" ? obj.name : "";
  if (name) return { ok: true, name };
  const errRaw = obj?.error;
  /* ComfyUI 未运行时的 503（`hint: comfyui-unreachable`）是可重试的：服务端
   * 此时会顺手把实例拉起来，调用方等一会儿再传就能成功（ISSUE #345）。 */
  const retryable =
    res.status === 503 ||
    (typeof obj?.hint === "string" && obj.hint === "comfyui-unreachable");
  return {
    ok: false,
    retryable,
    message: typeof errRaw === "string" && errRaw ? errRaw : "上传失败",
  };
}

/**
 * 上传素材到 ComfyUI 的 input 目录，返回落库后的文件名。
 *
 * ComfyUI 未运行 / 正在启动时不再直接抛「无法连接」：先让服务端按配置把实例
 * 拉起来（`/api/comfy/ensure` + 短轮询），就绪后自动重试一次上传。整条路径上
 * `onProgress` 会把「正在启动 ComfyUI…」这类状态交给调用方展示——上传位因此
 * 有明确进行态，而不是静默失败后只在 console 留一行（ISSUE #345）。
 */
export async function uploadImageFile(
  file: File,
  opts: {
    onProgress?: (message: string) => void;
    readyTimeoutMs?: number;
  } = {},
): Promise<string> {
  const first = await postUpload(file);
  if (first.ok) return first.name;
  if (!first.retryable) throw new Error(first.message);

  opts.onProgress?.(first.message);
  const ready = await waitForComfyReady({
    timeoutMs: opts.readyTimeoutMs,
    onProgress: (message) => opts.onProgress?.(message),
  });
  if (!ready.ok) throw new Error(ready.message);

  const retry = await postUpload(file);
  if (retry.ok) return retry.name;
  throw new Error(retry.message);
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
  file: File,
): Promise<{ name: string; url: string }> {
  const name = await uploadImageFile(file);
  const url = `/api/images?filename=${encodeURIComponent(name)}&type=input`;
  return { name, url };
}

/** tRPC wire contract for the generate mutation (was `payload as any`). */
type GenerateInput = RouterInputs["generate"]["generate"];

export async function startGenerate(
  payload: Record<string, unknown>,
): Promise<string> {
  const d = await vanillaApi.generate.generate.mutate(payload as GenerateInput);
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
  /** structured ComfyUI /prompt validation errors
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
  /* callback fired on every poll tick with a
   *  clamped 0..100 progress. Optional — callers that don't care simply
   *  omit it. Wired into CanvasNode.runGenerate so the picture/movie
   *  preview can show a water-fill overlay while generation runs. */
  onProgress?: (progress: number) => void,
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
      /* surface 0..100 progress to the canvas.
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
        // Defensive normalize: `task.error` is typed `String?`
        // in Prisma but legacy rows / older code paths (e.g.
        // buildPromptError pre-used `String(res.error)`) can land
        // the literal "[object Object]" as the stored string.  We
        // peel structured objects to JSON AND detect the literal
        // garbage-string sentinel so the UI never shows
        // `[object Object]`.  Garbage strings get replaced with the
        // generic fallback. */
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
          /* 失败也回传请求 payload 快照，前端用于在失败面板里
           *  展示「执行了哪些参数」。task.params 由 /api/generate route.ts
           *  写入（Prisma JSON 列）。 */
          params: task?.params ?? undefined,
          /* carry structured validation errors from
           *  /api/tasks/[id].task.validationErrors into the failure result
           *  so CanvasNode can render a precise per-field list. */
          /* validationErrors 存在 Prisma Json 列里，类型上是 unknown——
           *  直接 `as ValidationError[]` 只是假保险（列里存了别的东西时
           *  会在渲染期炸）。按 §05「API 响应一律 Zod 校验」收口成真校验。 */
          validationErrors: parseValidationErrorsJson(task?.validationErrors),
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
export function isTaskSuccess(r: TaskResult | TaskFailure): r is TaskResult {
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
      const d: unknown = await res.json();
      const obj =
        typeof d === "object" && d !== null
          ? (d as Record<string, unknown>)
          : null;
      const choices = obj?.choices;
      const choiceContent =
        Array.isArray(choices) &&
        typeof choices[0] === "object" &&
        choices[0] !== null
          ? (choices[0] as { message?: { content?: unknown } }).message?.content
          : undefined;
      const c =
        typeof obj?.content === "string"
          ? obj.content
          : typeof choiceContent === "string"
            ? choiceContent
            : "";
      if (c.trim()) return c.trim();
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
