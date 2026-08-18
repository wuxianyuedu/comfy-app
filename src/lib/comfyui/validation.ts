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
  graph?: Record<string, any>
): ValidationError[] {
  let ne = (res as any)?.node_errors;
  // `res` is the LIST carrier directly (comfy-cli envelope path).
  const isListCarrier =
    Array.isArray(res) &&
    res.length > 0 &&
    res.some(
      (r: any) =>
        r && typeof r === "object" && (r.node_id || r.class_type || r.input_errors || r.message)
    );
  if (
    (!ne || (Array.isArray(ne) ? ne.length === 0 : Object.keys(ne).length === 0)) &&
    isListCarrier
  ) {
    ne = res;
  }
  if (!ne) return [];
  const out: ValidationError[] = [];
  const entries: [string, any][] = Array.isArray(ne)
    ? (ne as any[]).map((r) => [String(r?.node_id ?? "?"), r] as [string, any])
    : (Object.entries(ne) as [string, any][]);
  for (const [nid, err] of entries) {
    const classType = err?.class_type ?? graph?.[nid]?.class_type ?? "";
    const inputErrors = err?.input_errors;
    if (inputErrors && typeof inputErrors === "object") {
      for (const [field, v] of Object.entries(inputErrors) as [string, any][]) {
        const message =
          typeof v === "string"
            ? v
            : (v?.message ?? v?.details ?? JSON.stringify(v)) || "配置错误";
        out.push({ nodeId: nid, classType, field, message });
      }
    } else if (typeof err?.message === "string") {
      out.push({ nodeId: nid, classType, field: "", message: err.message });
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
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ValidationError[];
  } catch {
    /* fall through */
  }
  return null;
}
