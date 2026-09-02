/* ── Shared workflow-IO types (2026-08-09) ──
 *
 * Single source of truth for "what does this custom workflow accept / produce",
 * imported by BOTH client components (src/components/studio/...) and the server
 * router (src/server/api/routers/workflow.ts). Living in `src/lib/` keeps the
 * server from crossing the boundary into `components/`.
 */

/** One exposed pin, as returned by GET /api/workflows/[id]. */
export interface WorkflowIOEntry {
  direction: "input" | "output";
  /** Semantic bucket chosen in IO-edit mode — NOT the data type.
   *  Values: "param" | "widget" | "output" | (free-form for custom kinds). */
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  /** ComfyUI data type: STRING / INT / FLOAT / BOOLEAN / IMAGE / VIDEO / … */
  type?: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** 2026-08-11 (R57): mark a widget-backed input as REQUIRED. */
  required?: boolean;
  /** 2026-08-12: COMBO candidate list resolved from ComfyUI /object_info. */
  options?: string[];
  /** 2026-08-15 R-ardot35: user-defined display order. */
  displayOrder?: number;
  /** 2026-08-17 R94: author override of `defaultValue`. */
  value?: unknown;
}

export type WorkflowIOMap = Record<string, WorkflowIOEntry>;
