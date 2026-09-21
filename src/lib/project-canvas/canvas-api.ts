/* ── 项目画布的网络客户端（第②层的网络部分）─────────────────────────────
 * 上传 / 启动生成 / 轮询任务三个请求集中在这里，视图层
 * （components/studio/project-canvas/**）不再直接 fetch 或调 vanillaApi
 * ——规范 17 §17.2：视图禁 IO，逻辑进 hooks 或 <domain>-client/api。
 *
 * 响应收窄与错误解析只此一份：服务端改错误信封时改这里即可，视图零感知。
 * 失败一律「抛出带中文文案的 Error」，由调用方（hook）决定提示形态。
 */

import { waitForComfyReady } from "~/lib/comfy/comfy-readiness-client";
import { lastSegments } from "~/lib/path-display";
import { asRecord } from "~/lib/is-record";
import { clampPct } from "~/lib/progress";
import { sleep } from "~/lib/with-timeout";
import { comfyImageUrl } from "~/lib/media/media-url";
import {
  parseValidationErrorsJson,
  type ValidationError,
} from "~/lib/comfyui/validation";
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
  const obj = asRecord(d);
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

/* 把已生成的产物（经 /outputs/... 提供）重新上传回 ComfyUI 的 input 目录，
 * 供下游节点当作 `inputImage` 消费。按源路径缓存，避免同一个文件为多个目标
 * 重复上传。 */
const importCache = new Map<string, string>();

export async function importOutputAsInput(localPath: string): Promise<string> {
  if (importCache.has(localPath)) return importCache.get(localPath)!;
  const abs = localPath.startsWith("/") ? localPath : `/${localPath}`;
  const res = await fetch(abs);
  if (!res.ok) throw new Error("读取上游输出失败");
  const blob = await res.blob();
  const fname = lastSegments(localPath, 1) || "input.png";
  const file = new File([blob], fname, { type: blob.type || "image/png" });
  const name = await uploadImageFile(file);
  importCache.set(localPath, name);
  return name;
}

/* 上传用户素材（图片或视频），供内容载体节点使用。
 * 复用图片节点用的同一个 `/api/upload` 接口（它把字节丢进 ComfyUI 的 input
 * 目录并返回存储后的文件名）。返回文件名，外加一个可直接用的预览 URL
 *（经 /api/images 代理，浏览器因此不必直接访问 ComfyUI 的端口）。 */
export async function uploadMediaFile(
  file: File,
): Promise<{ name: string; url: string }> {
  const name = await uploadImageFile(file);
  /* 预览地址的拼装收在 `~/lib/media/media-url`（规范 16 §16.2.4.32）——
   * 出口恒有文件名（`uploadImageFile` 刚返回的），所以这里不会是 null。 */
  const url = comfyImageUrl({ filename: name })!;
  return { name, url };
}

/* 生成 mutation 的 tRPC 传输契约（此前是 `payload as any`）。 */
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

/* `pollTask` 在服务端任务没产出结果就结束时返回它
 *（FAILED / CANCELLED / ERROR / TIMEOUT）。它带上 `prisma.task.error` 里
 * 底层后端的错误信息，好让界面给出有意义的解释，
 * 而不是一句通用的「生成失败或无结果」。 */
export interface TaskFailure {
  taskId: string;
  status: "FAILED" | "CANCELLED" | "ERROR" | "TIMEOUT";
  /** 后端 / ComfyUI 的原始错误信息，已解码成纯文本。 */
  error: string;
  /** 原始请求载荷的快照（来自 `prisma.task.params`），
   *  好让错误界面把「发了什么」和「哪里失败了」并排展示。 */
  params?: unknown;
  /** 结构化的 ComfyUI /prompt 校验错误（摊平后的 `node_errors`），
   *  好让界面渲染出精确到字段的列表，而不是去解析 `error` 里那句英文摘要。 */
  validationErrors?: ValidationError[];
}

/* 轮询一个任务，直到它有结果、失败或超时。
 * 成功时返回 `TaskResult`（真值）；终态失败时返回结构化的 `TaskFailure`，
 * 调用方据此把真实错误暴露出去。 */
export async function pollTask(
  taskId: string,
  timeoutMs = 25 * 60 * 1000,
  /* 每次轮询都会回调，进度被夹在 0..100。可选 —— 不关心的调用方不传即可。
   * 接到 CanvasNode.runGenerate 上，让图片 / 影片预览在生成期间显示水位填充。 */
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
      /* 把 0..100 的进度透到画布上。
       * 此前被丢掉了 —— pollTask 只读 status 与 images，于是画布的图片/影片预览
       * 即使 /api/tasks/[id] 返回了 task.progress，也没进度可显示。 */
      if (onProgress && typeof task?.progress === "number") {
        onProgress(clampPct(task.progress));
      }
      const imgs: TaskResult[] = task?.images ?? [];
      if (imgs.length) {
        const v = imgs.find((img) => img.mediaType === "video") ?? imgs[0];
        return { taskId, localPath: v!.localPath, mediaType: v!.mediaType };
      }
      const st = task?.status as string | undefined;
      if (st === "FAILED" || st === "CANCELLED" || st === "ERROR") {
        /* 防御性归一：`task.error` 在 Prisma 里类型是 `String?`，
         * 但历史数据行 / 更早的代码路径（例如 buildPromptError 曾用
         * `String(res.error)`）可能把字面量 "[object Object]" 存了进来。
         * 这里既把结构化对象剥成 JSON，也识别那个垃圾字符串哨兵，
         * 让界面永远不显示 `[object Object]`；垃圾字符串换成通用兜底文案。 */
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
          /* 把 /api/tasks/[id] 的 task.validationErrors 里的结构化校验错误
           * 带进失败结果，让 CanvasNode 能渲染出精确到字段的列表。 */
          /* validationErrors 存在 Prisma Json 列里，类型上是 unknown——
           *  直接 `as ValidationError[]` 只是假保险（列里存了别的东西时
           *  会在渲染期炸）。按 §05「API 响应一律 Zod 校验」收口成真校验。 */
          validationErrors: parseValidationErrorsJson(task?.validationErrors),
        };
      }
    } catch {
      /* 暂时性失败 —— 继续轮询 */
    }
    await sleep(2000);
  }
}

/* 成功分支的类型守卫 —— 让既有的 `if (result)` 调用点语义不变
 *（填充过的 TaskResult 依旧是真值），同时让失败分支有类型安全。 */
export function isTaskSuccess(r: TaskResult | TaskFailure): r is TaskResult {
  return typeof (r as TaskResult).localPath === "string";
}
