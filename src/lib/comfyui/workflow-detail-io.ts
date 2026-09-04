/**
 * workflowIO enrichment — extracted from workflow-detail.ts (batch 4).
 *
 * The stored selection only records WHICH pin was exposed
 * (`direction` / `kind` / `nodeId` / `name`).  `kind` is a *semantic*
 * bucket ("param" | "widget" | "output") — it is NOT the ComfyUI data
 * type, so a consumer that wants to render a control (textarea vs
 * number vs switch vs image-upload) had no way to decide.
 *
 * Rather than force every client to re-join `nodes[].raw_inputs[]` and
 * `rawNodes[].outputs[]` by (nodeId, name), we do the join once here and
 * ship a self-describing record:
 *   type          ComfyUI data type — "STRING" | "INT" | "FLOAT" |
 *                 "BOOLEAN" | "IMAGE" | "LATENT" | …  ("*" when unknown)
 *   defaultValue  current widget value (or the literal in the API graph),
 *                 so a dynamic form can pre-fill instead of showing blanks
 *   label         best display label (label > localized > name)
 *   nodeTitle     owning node's title, used to disambiguate same-named
 *                 pins across nodes ("seed" on 3 samplers)
 *   multiline     STRING inputs that ComfyUI marks as multiline-ish
 *                 (prompt-sized) → render a textarea, not a one-liner
 * Consumers: DynamicWorkflowForm (CreatePanel + canvas workflow node)
 * and the canvas auto-spawn logic (first output's `type` decides whether
 * the downstream node is an image or a video node).
 */
import { asRecord } from "@/lib/comfyui/raw";
import {
  type RawInputEntry,
  type RawNodeMeta,
} from "@/lib/comfyui/workflow-detail-raw";

const MULTILINE_HINT = /(prompt|text|caption|描述|提示)/i;

/** 存库 workflowIO 列的单条记录（PATCH 原样落库的「哪根 pin 被暴露」）。 */
export interface WorkflowIORawEntry {
  direction: "input" | "output";
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  displayOrder?: number;
  value?: unknown;
}

export interface WorkflowIOEnrichParams {
  workflowIORaw: Record<string, WorkflowIORawEntry>;
  rawInputsById: Record<string, RawInputEntry[]>;
  rawNodeMeta: RawNodeMeta[];
  graph: Record<string, unknown>;
  nodeTitleById: Record<string, string>;
  nodeTypeById: Record<string, string>;
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
}

export interface WorkflowIOEntry {
  direction: "input" | "output";
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  type: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** COMBO candidate list (unet_name / clip_name / …) resolved from
   *  /api/object_info.  Absent for non-COMBO pins or when ComfyUI is
   *  unreachable — consumers fall back to a plain text control. */
  options?: string[];
  /** author override of the default value, round-tripped
   *  from the stored `workflowIORaw` so a custom default survives reload. */
  value?: unknown;
  displayOrder?: number;
}

/** Enrich the stored IO selection into a self-describing record (see the
 *  module doc for field semantics).  Pure — only depends on its params. */
export async function enrichWorkflowIO(
  params: WorkflowIOEnrichParams
): Promise<Record<string, WorkflowIOEntry>> {
  const {
    workflowIORaw,
    rawInputsById,
    rawNodeMeta,
    graph,
    nodeTitleById,
    nodeTypeById,
    comboOptionsForClassField,
    comboOptionsForFieldName,
  } = params;

  const workflowIO: Record<string, WorkflowIOEntry> = {};
  for (const [ioKey, v] of Object.entries(workflowIORaw)) {
    if (!v || typeof v !== "object") continue;
    let type = "*";
    let defaultValue: unknown = undefined;
    let label = v.label;
    /* COMBO candidate list — resolved below once we know the final `type`. */
    let options: string[] | undefined;

    // Helper: resolve a stored `v.nodeId` against keys that may
    // be stored in EITHER of two ID families —
    //   • React Flow short ids (e.g. "9b9009e4") — what toggleIO writes
    //   • ComfyUI UUIDs (e.g. "9b9009e4-2d3d-445f-9be5-6063f465757e") — the
    //     rawJson / graph key shape
    // Without this leniency the lookup falls through to type="*" + undefined
    // defaultValue, which silently degrades every dynamic form to single-line
    // text inputs (no textarea for prompts, no switch / number / file widget),
    // because the enrichment never reaches MULTILINE_HINT or the long-string
    // fallback.  See controlForEntry() in src/components/studio/shared/workflow-io.ts.
    // Returns the CANONICAL key in whatever shape the data lives in.
    const full = String(v.nodeId);
    const canonicalNodeId = (() => {
      const metaById: Record<string, boolean> = Object.fromEntries(
        rawNodeMeta.map((meta) => [meta.id, true])
      );
      const dicts: Record<string, unknown>[] = [rawInputsById, metaById, graph];
      for (const dict of dicts) {
        if (!dict) continue;
        if (Object.prototype.hasOwnProperty.call(dict, full)) return full;
      }
      /* Fallback: match `9b9009e4` against `9b9009e4-2d3d-…`.  Requires a
       * word-boundary char (`-`) right after the prefix so `9b9009e4` never
       * collides with `9b9009e44`. */
      for (const dict of dicts) {
        if (!dict) continue;
        const hit = Object.keys(dict).find((key) => key.length > full.length && key.startsWith(full) && key.charAt(full.length) === "-");
        if (hit) return hit;
      }
      return full;
    })();

    if (v.direction === "output") {
      const meta = rawNodeMeta.find((rawNodeMeta) => rawNodeMeta.id === canonicalNodeId);
      const out = meta?.outputs.find((output) => output.name === v.name);
      if (out) {
        type = out.type || "*";
        label = label ?? out.label ?? out.localized ?? out.name;
      }
    } else {
      const ri = (rawInputsById[canonicalNodeId] ?? []).find((raw) => raw.name === v.name);
      if (ri) {
        type = ri.type || "*";
        label = label ?? ri.label ?? ri.localized ?? ri.name;
        if (ri.widgetValue !== undefined) defaultValue = ri.widgetValue;
      }
      /* API-only imports carry no rawJson → rawInputsById is empty.  Fall
       * back to the literal sitting in the API graph and infer the type
       * from its JS runtime type (good enough to pick a control). */
      if (defaultValue === undefined) {
        const gv = asRecord(asRecord(graph[canonicalNodeId])?.inputs)?.[v.name];
        if (gv !== undefined && !Array.isArray(gv)) defaultValue = gv;
      }
      if (type === "*" && defaultValue !== undefined) {
        if (typeof defaultValue === "boolean") type = "BOOLEAN";
        else if (typeof defaultValue === "number")
          type = Number.isInteger(defaultValue) ? "INT" : "FLOAT";
        else if (typeof defaultValue === "string") type = "STRING";
      }
      /* COMBO candidate list: a wrapper COMBO already carries `comboOptions`
       *  from the pass; a direct (non-wrapper) COMBO node resolves via
       *  its class type.  ComfyUI unreachable → options stays undefined → the
       *  form falls back to a plain text control. */
      if (type === "COMBO") {
        if (ri?.comboOptions) {
          options = ri.comboOptions;
        } else {
          const byClass = await comboOptionsForClassField(nodeTypeById[canonicalNodeId], v.name);
          /* wrapper nodes (esp. `comfy-core` subgraphs whose
           *  `properties.proxyWidgets` is absent/quarantined) can't resolve the
           *  internal class, so the class lookup above returns nothing.  Fall
           *  back to a field-name scan across object_info to recover the option
           *  list for uniquely-named COMBOs (e.g. `resolution_preset`). */
          options = byClass ?? (await comboOptionsForFieldName(v.name));
        }
      }
    }

    workflowIO[ioKey] = {
      direction: v.direction,
      kind: v.kind,
      nodeId: String(v.nodeId),
      name: v.name,
      label: label ?? v.name,
      type,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(options ? { options } : {}),
      nodeTitle: nodeTitleById[canonicalNodeId] ?? nodeTitleById[String(v.nodeId)],
      ...(type === "STRING" &&
      (MULTILINE_HINT.test(v.name) ||
        MULTILINE_HINT.test(String(label ?? "")) ||
        (typeof defaultValue === "string" && defaultValue.length > 40))
        ? { multiline: true }
        : {}),
      /* pass the user-defined displayOrder
       *  through.  It was authored on a previous session via the IO-edit
       *  preview's drag-to-reorder gesture, persisted via PATCH, and now
       *  read back here so consumers can sort by it.  Coerce to number
       *  (PATCH might serialize a string for whatever reason) and only
       *  forward finite integers so a corrupted value can't poison the
       *  sort comparator downstream. */
      ...(typeof v.displayOrder === "number" && Number.isFinite(v.displayOrder)
        ? { displayOrder: v.displayOrder }
        : {}),
      /* preserve any author override of the default value.
       *  `value` is stored verbatim via PATCH (the whole workflowIO object is
       *  persisted as-is) and must survive this GET rebuild so a custom
       *  default isn't silently dropped on reload. */
      ...(v.value !== undefined ? { value: v.value } : {}),
    };
  }

  return workflowIO;
}
