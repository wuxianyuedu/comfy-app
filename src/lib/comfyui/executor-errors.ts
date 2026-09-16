/**
 * `executor-errors.ts` — ComfyUI 错误信息人性化（纯函数）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的错误处理纯函数模块（batch 4）：
 *   - {@link friendlyError}     把 ComfyUI / node 抛出的任意结构（字符串、
 *                               结构化对象、traceback 数组…）剥成可读文本
 *   - {@link buildPromptError}  把 /prompt 的 `node_errors` 拆成逐节点清单
 *
 * @module comfyui/executor-errors
 */

import type { PromptResult } from "./client";

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

/** Build a human-readable failure message from ComfyUI's /prompt response.
 *  ComfyUI returns `node_errors` keyed by node id, each with `input_errors`
 *  (field → {message}) or a top-level `message`. Surface those instead of a
 *  generic "节点配置错误" so the user can fix the actual bad value. */
export function buildPromptError(
  res: PromptResult,
  graph: Record<string, unknown>,
): string {
  // previously `String(res.error)` — that collapses a structured
  // error object to the literal "[object Object]" and gets stored as
  // the task's error string, which then surfaces verbatim in the UI.
  // Reuse friendlyError so structured payloads (kaytool etc.) are
  // peeled to the real `.exception_message`/`.message`, and only the
  // true unknown-type cases fall through to a generic explanation.
  if (res?.error != null) {
    const peeled = friendlyError(res.error);
    const trimmed = peeled.trim();
    if (trimmed && trimmed !== "[object Object]") return peeled;
  }
  const ne = res?.node_errors;
  if (!ne || !Object.keys(ne).length) return "节点配置错误";
  const lines: string[] = [];
  for (const [nid, errRaw] of Object.entries(ne)) {
    if (typeof errRaw === "string") {
      lines.push(`节点 ${nid}: ${errRaw || "配置错误"}`);
      continue;
    }
    const err = errRaw as {
      class_type?: string;
      input_errors?: Record<string, unknown>;
      message?: string;
    };
    const cls =
      err.class_type ??
      (graph?.[nid] as { class_type?: string } | undefined)?.class_type ??
      "";
    let detail = "";
    if (err.input_errors) {
      detail = Object.entries(err.input_errors)
        .map(
          ([k, v]) =>
            `${k}: ${(v as { message?: string })?.message ?? (v as { details?: string })?.details ?? JSON.stringify(v)}`,
        )
        .join("; ");
    } else if (typeof err.message === "string") {
      detail = err.message;
    }
    lines.push(`节点 ${nid}${cls ? ` (${cls})` : ""}: ${detail || "配置错误"}`);
  }
  return `节点配置错误:\n${lines.join("\n")}`;
}
