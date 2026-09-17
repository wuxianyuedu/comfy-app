/**
 * `executor-errors.ts` — ComfyUI 错误信息人性化（纯函数）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的错误处理纯函数模块（batch 4）：
 *   - {@link friendlyError}     把 ComfyUI / node 抛出的任意结构（字符串、
 *                               结构化对象、traceback 数组…）剥成可读文本
 *
 * 提交路径统一走 comfy-cli 之后，`/prompt` 的响应体不再由本模块解析：结构化
 * 校验错误（`node_errors`）由 `executor-cli-stream` 从 cli envelope 里深搜后
 * 交给 `validation.extractValidationErrors`。
 *
 * @module comfyui/executor-errors
 */

// Map raw ComfyUI/node errors to user-actionable hints.
//
// Why we don't just `String(raw)`: some ComfyUI builds (kaytool's v0.28
// included) emit `exception_message` as a structured object instead of a
// plain string, and tracebacks can be arrays of frames. A naive
// `Object.prototype.toString` would collapse all of those to
// "[object Object]", hiding the actual reason from the user.  This
// helper recursively peels known fields, falling back to a pretty-printed
// JSON dump so *something* informative always lands in `task.error`.
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
    // Ordered preference: ComfyUI's own canonical fields first, then
    // generic exception shape (Error.message / details / reason).
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
    // Some ComfyUI exception_payloads nest `exception_message` deeper
    // (e.g. `{ data: { exception_message: "..." } }`).
    for (const k of ["data", "exception", "exception_payload"]) {
      const inner = o[k];
      if (inner && typeof inner === "object") {
        const innerText = friendlyError(inner);
        if (innerText.trim()) return innerText;
      }
    }
    // Last resort: pretty-print the object so the user at least sees
    // *something* other than "[object Object]".  Cap length so a
    // gigantic traceback payload can't blow up the DB column.
    try {
      const json = JSON.stringify(raw, null, 2);
      return json.length > 4000 ? json.slice(0, 4000) + "\n…(truncated)" : json;
    } catch {
      return "[unserializable error]";
    }
  }
  // Fallback for symbols / functions — should not happen, but be safe.
  if (typeof raw === "function") return raw.name || "[function]";
  if (typeof raw === "symbol") return Symbol.prototype.toString.call(raw);
  return "[unknown error]";
}
