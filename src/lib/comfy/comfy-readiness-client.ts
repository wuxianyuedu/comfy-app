import { readApiError } from "~/lib/api-error";

/* ── 「让 ComfyUI 立即可用」的客户端（第②层网络部分）─────────────────────
 * 素材上传这类动作要求 ComfyUI 已经跑着（文件要写进它的 input 目录）。此前
 * 未运行时服务端只回一句原始错误，视图既没有可重试的语义、也没有用户可见出口
 * （ISSUE #345）。
 *
 * 这里把「等一个正在启动的实例就绪」收敛成两件事：
 *   - `waitForComfyReady()`：轮询 `/api/comfy/ensure`，每次短等 + 退避，直到
 *     可用、明确失败或超过总时限；返回可读结果而不是抛原始错误；
 *   - `readComfyErrorMessage()`：把 ensure/upload 的错误信封收窄成中文文案
 *     （`{error}` 字符串 / `{error:{message}}` / `{detail}` 三种形态）。
 *
 * 视图只消费返回值，不自己判 202/503、不自己算退避（规范 17 §17.2）。
 */

/** 等待就绪的总时限：冷加载（重装 / CUDA 初始化）慢起来没有准数，但一次
 *  上传操作不该无限等——超时后把「去设置页手动启动」这条出口交给用户。 */
export const COMFY_READY_TIMEOUT_MS = 180_000;

/** 单次轮询间隔：服务端每次会短等一小会儿，这里再退避一档，避免连打。 */
export const COMFY_READY_POLL_MS = 2_000;

export type ComfyReadyResult =
  { ok: true } | { ok: false; pending: boolean; message: string };

interface EnsureBody {
  ok?: unknown;
  pending?: unknown;
  detail?: unknown;
  error?: unknown;
}

/** 从 ensure 响应体里取可读文案：`detail` → `{error}` 字符串 → `{error:{message}}`。 */
export function readComfyErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const rec = body as EnsureBody;
    /* `detail` 是这条路由的**业务字段**（「正在启动」的进度描述）而不是错误
     * 文案，所以它优先于错误信封 —— 那不是第二套错误形状。
     * `{error}` 字符串与 `{error:{message}}` 交 `~/lib/api-error` 的唯一读法
     * （规范 16 §16.2.4.35）。 */
    if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
  }
  return readApiError(body) ?? fallback;
}

/** 单次「让 ComfyUI 可用」请求；网络异常也按「还在启动」处理（服务端可能正忙）。 */
async function ensureOnce(): Promise<ComfyReadyResult> {
  let res: Response;
  try {
    res = await fetch("/api/comfy/ensure", { method: "POST" });
  } catch (e) {
    return {
      ok: false,
      pending: true,
      message: e instanceof Error ? e.message : "无法连接应用服务，稍后重试",
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const detail = readComfyErrorMessage(body, "ComfyUI 未就绪");
  if (
    res.ok &&
    typeof body === "object" &&
    body !== null &&
    (body as EnsureBody).ok === true
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    pending: res.status === 202,
    message: detail,
  };
}

/**
 * 等到 ComfyUI 可用为止。
 *
 * `onProgress` 在第一次需要等待时回调一次（「正在启动 ComfyUI…」），供调用方
 * 渲染可见状态；返回结果里的 `pending=true` 表示「还在启动 / 被手动关闭 / 未开
 * 自动启动」，`message` 直接可展示给用户。
 */
export async function waitForComfyReady(
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    onProgress?: (message: string) => void;
  } = {},
): Promise<ComfyReadyResult> {
  const timeoutMs = opts.timeoutMs ?? COMFY_READY_TIMEOUT_MS;
  const pollMs = Math.min(
    opts.pollMs ?? COMFY_READY_POLL_MS,
    Math.max(timeoutMs, 1),
  );
  const deadline = Date.now() + timeoutMs;
  let last: ComfyReadyResult = {
    ok: false,
    pending: true,
    message: "ComfyUI 未就绪",
  };
  let announced = false;

  for (;;) {
    const r = await ensureOnce();
    if (r.ok) return r;
    last = r;
    if (!r.pending) return r;
    if (!announced) {
      announced = true;
      opts.onProgress?.(r.message);
    }
    if (Date.now() + pollMs >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    ok: false,
    pending: true,
    message: `${last.message}（等待超时，可到 设置 → 创作后端 手动启动 ComfyUI 后重试）`,
  };
}
