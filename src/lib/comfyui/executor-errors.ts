/**
 * `executor-errors.ts` — ComfyUI 错误信息人性化（纯函数）
 * ===========================================================================
 *
 * 错误信息人性化的纯函数模块：
 *   - {@link friendlyError}     把 ComfyUI / node 抛出的任意结构（字符串、
 *                               结构化对象、traceback 数组…）剥成可读文本
 *
 * 提交路径统一走 comfy-cli 之后，`/prompt` 的响应体不再由本模块解析：结构化
 * 校验错误（`node_errors`）由 `executor-cli-stream` 从 cli envelope 里深搜后
 * 交给 `validation.extractValidationErrors`。
 *
 * @module comfyui/executor-errors — 面向用户的错误提示映射
 */

import { TASK_ERROR_MAX, clampText } from "~/lib/text-clamp";

// 把 ComfyUI / 节点抛回的原始错误翻译成用户能照着做的提示。
//
// 为什么不直接 `String(raw)`：部分 ComfyUI 构建（含 kaytool v0.28）把
// `exception_message` 发成结构化对象而不是字符串，traceback 还可能是帧数组。
// 朴素的 `Object.prototype.toString` 会把它们统统压成 "[object Object]"，
// 用户看到的就不是真实原因了。本函数递归剥出已知字段，兜底再打印 JSON ——
// 保证 `task.error` 里**总有**可读的信息。
export function friendlyError(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "bigint") return raw.toString();
  if (Array.isArray(raw)) {
    const parts = raw.map(friendlyError).filter((msg) => msg.trim() !== "");
    return parts.length ? parts.join("\n") : "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // 按优先级取：先 ComfyUI 自己的规范字段，再取通用异常形状
    //（Error.message / details / reason 这类通用形状）。
    const candidates: (keyof typeof o)[] = [
      "exception_message",
      "message",
      "error",
      "details",
      "reason",
      "msg",
      "detail",
      "description",
    ];
    for (const k of candidates) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    // 部分 ComfyUI 的 exception_payload 把 `exception_message` 埋得更深
    //（例如 `{ data: { exception_message: "..." } }`）。
    for (const k of ["data", "exception", "exception_payload"]) {
      const inner = o[k];
      if (inner && typeof inner === "object") {
        const innerText = friendlyError(inner);
        if (innerText.trim()) return innerText;
      }
    }
    // 最后手段：把对象打印出来，让用户至少看到点东西而不是 "[object Object]"。
    // 截断长度，避免超长的 traceback 撑爆数据库列 —— 上限走
    // `~/lib/text-clamp` 的 TASK_ERROR_MAX（受 DB 列体积约束，见 §16.2.4.48）。
    try {
      const json = JSON.stringify(raw, null, 2);
      return clampText(json, {
        maxLength: TASK_ERROR_MAX,
        marker: "\n…(truncated)",
      });
    } catch {
      return "[unserializable error]";
    }
  }
  // symbol / function 的兜底分支 —— 正常不会走到，留着以防万一。
  if (typeof raw === "function") return raw.name || "[function]";
  if (typeof raw === "symbol") return Symbol.prototype.toString.call(raw);
  return "[unknown error]";
}
