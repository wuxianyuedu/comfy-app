/* ── Canvas helper functions ──
 * Thin wrappers around the existing Comfy-APP APIs so the canvas nodes can
 * upload references, enqueue generations, and poll for results without
 * duplicating server logic.
 */

export async function uploadImageFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const d = await res.json();
  if (!d.name) throw new Error(d.error || "上传失败");
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
  const fname = localPath.split("/").pop() || "input.png";
  const file = new File([blob], fname, { type: blob.type || "image/png" });
  const name = await uploadImageFile(file);
  importCache.set(localPath, name);
  return name;
}

export async function startGenerate(payload: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await res.json();
  if (!d.taskId) throw new Error(d.error || "生成失败");
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
}

/** Polls a task until it has a result, fails, or times out.  On success
 *  returns a `TaskResult` (truthy); on terminal failure returns the
 *  structured `TaskFailure` so callers can surface the real error. */
export async function pollTask(
  taskId: string,
  timeoutMs = 25 * 60 * 1000
): Promise<TaskResult | TaskFailure> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > timeoutMs) {
      return {
        taskId,
        status: "TIMEOUT",
        error: `轮询超时（${Math.round(timeoutMs / 60000)} 分钟无响应）`,
      };
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) {
        const { task } = await res.json();
        const imgs: TaskResult[] = task?.images ?? [];
        if (imgs.length) {
          const v = imgs.find((x) => x.mediaType === "video") ?? imgs[0];
          return { taskId, localPath: v.localPath, mediaType: v.mediaType };
        }
        const st = task?.status as string | undefined;
        if (st === "FAILED" || st === "CANCELLED" || st === "ERROR") {
          return {
            taskId,
            status: st,
            error: task?.error || `任务 ${st}`,
          };
        }
      }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, 2000));
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
      if (c && c.trim()) return c.trim();
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
