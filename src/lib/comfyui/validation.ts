// Shared, client-safe validation-error types & helpers.
//
// ComfyUI's /prompt endpoint, when the workflow fails server-side
// validation, returns a payload shaped like:
//
//   {
//     "error": "Workflow has 6 validation error(s) against server",
//     "node_errors": {
//       "10": {
//         "class_type": "KSampler",
//         "input_errors": {
//           "cfg": { "message": "cfg must be a number" },
//           "steps": { "details": "..." }
//         }
//       },
//       "12": { "class_type": "CheckpointLoader", "message": "..." }
//     }
//   }
//
// We flatten `node_errors` into a `ValidationError[]` so the UI can render a
// precise, per-field, localized list ("节点 10 (KSampler) · 字段 cfg：…")
// instead of dumping the English summary string.  This module contains ONLY
// types + a pure parser — no prisma / fs / server-only imports — so it is
// safe to import from both the runner (server) and React components (client).

export interface ValidationError {
  /** ComfyUI node id, as a string (matches graph keys). */
  nodeId: string;
  /** Node class_type, e.g. "KSampler". Empty if unknown. */
  classType: string;
  /** Offending input field name. Empty for node-level (non-input) errors. */
  field: string;
  /** Human-readable reason. Never empty — falls back to "配置错误". */
  message: string;
}

/** Flatten ComfyUI's `node_errors` into a `ValidationError[]`.
 *  Returns `[]` when there is nothing structured to report.
 *
 *  R-ardot118 (2026-08-18): accept TWO carrier shapes, because the
 *  upstream `/prompt` response and the comfy-cli envelope disagree on
 *  how `node_errors` is serialised:
 *
 *    • DICT  — ComfyUI's native `/prompt` error body, and comfy-cli's
 *      `error.node_errors` when it forwards the raw body:
 *        { "10": { "class_type": "KSampler", "input_errors": {...} } }
 *    • LIST  — comfy-cli's `_node_errors_to_list()` flattens the dict
 *      into a list of self-contained records BEFORE it reaches the
 *      envelope's `error.details.node_errors`:
 *        [ { "node_id": "10", "class_type": "KSampler",
 *            "input_errors": {...} } ]
 *
 *  `res` may be either the carrier itself (a list) or an object that
 *  *contains* `node_errors` (dict or list).  The previous implementation
 *  only handled the DICT-in-object case, so the LIST-in-envelope shape
 *  returned `[]` and the per-field 6-item list never rendered. */
export function extractValidationErrors(
  res: unknown,
  graph?: Record<string, unknown>
): ValidationError[] {
  // 外部输入一律 unknown + 收窄：res 可能是 carrier 对象 / 列表 / 任意 JSON。
  const resObj =
    typeof res === "object" && res !== null ? (res as Record<string, unknown>) : undefined;
  let ne: unknown = resObj?.node_errors;
  // `res` is the LIST carrier directly (comfy-cli envelope path).
  const isListCarrier =
    Array.isArray(res) &&
    res.length > 0 &&
    res.some((r: unknown): boolean => {
      if (!r || typeof r !== "object") return false;
      const rec = r as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      return !!(rec.node_id || rec.class_type || rec.input_errors || rec.message);
    });
  if (
    (!ne || (Array.isArray(ne) ? ne.length === 0 : Object.keys(ne).length === 0)) &&
    isListCarrier
  ) {
    ne = res;
  }
  if (!ne) return [];
  const out: ValidationError[] = [];
  const entries: [string, unknown][] = Array.isArray(ne)
    ? ne.map((item: unknown) => {
        const rec = item as Record<string, unknown> | null | undefined;
        // String(x) 的收窄等价（见本文件底部 toStringValue）：值来自外部 JSON。
        return [toStringValue(rec?.node_id ?? "?"), item] as [string, unknown];
      })
    : Object.entries(ne as Record<string, unknown>);
  for (const [nid, err] of entries) {
    const errRec = err as Record<string, unknown> | null | undefined;
    const graphNode = graph?.[nid];
    const graphClass =
      typeof graphNode === "object" && graphNode !== null
        ? (graphNode as Record<string, unknown>).class_type
        : undefined;
    const errClass = errRec?.class_type;
    const classType: string =
      (typeof errClass === "string" ? errClass : undefined) ??
      (typeof graphClass === "string" ? graphClass : undefined) ??
      "";
    const inputErrors = errRec?.input_errors;
    if (inputErrors && typeof inputErrors === "object") {
      for (const [field, v] of Object.entries(inputErrors as Record<string, unknown>)) {

        const message =
          typeof v === "string"
            ? v
            : ((v as { message?: string })?.message ??
              (v as { details?: string })?.details ??
              JSON.stringify(v)) || "配置错误";
        out.push({ nodeId: nid, classType, field, message });
      }
    } else if (typeof errRec?.message === "string") {
      out.push({ nodeId: nid, classType, field: "", message: errRec.message });
    } else if (typeof err === "string") {
      out.push({ nodeId: nid, classType, field: "", message: err });
    } else if (err && typeof err === "object") {
      // Unknown structured shape — best-effort stringify so we never drop it.
      out.push({
        nodeId: nid,
        classType,
        field: "",
        message: JSON.stringify(err),
      });
    }
  }
  return out;
}

/** Parse the `validationErrors` DB column (a JSON string of `ValidationError[]`
 *  or `null`) back into a typed array.  Defensive: a corrupt / non-array
 *  payload yields `null` so callers can fall back to the `error` string. */
export function parseValidationErrors(
  raw: string | null | undefined
): ValidationError[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ValidationError[];
  } catch {
    /* fall through */
  }
  return null;
}

/** `String(v)` 的类型收窄等价（本模块保持 client-safe，不引入 comfyui/raw 依赖；
 *  与 raw.ts 导出的同名 helper 行为一致）：值全部来自 JSON 反序列化产物（无
 *  symbol / 自定义 toString），运行时行为与 String(v) 完全一致 —— 对象走其
 *  toString（普通对象即 "[object Object]"）。显式收窄只为满足
 *  no-base-to-string（该规则把 String(unknown/{}) 一律视为误报）。 */
function toStringValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return (v as { toString(): string }).toString();
}
