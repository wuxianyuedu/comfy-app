/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
/* Extracted input/output row computation for FlowNode (workflow-node.tsx).
 * Split out of the 1276-line FlowNode component (T12) so the renderer only
 * orchestrates layout while this hook owns the entry bucketing logic. */
import { useMemo } from "react";
import { inferOutputTypeAll } from "../workflow-utils";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";

export interface FlowNodeEntries {
  /** raw_inputs (per-node metadata with localized labels) keyed by API `name`. */
  rawMeta: Record<string, RawInputMeta>;
  /** Composed input rows: rawInputs (server-paired widget values) first, then data.inputs. */
  allEntries: [string, any][];
  /** Pure-typed port rows (rawInputs[i].widget absent) — get a Handle on the left edge. */
  connEntries: [string, any][];
  /** Rows that back a widgets_values slot (rawInputs[i].widget present). */
  widgetEntries: [string, any][];
  /** connEntries minus names that also appear as widgets (R50 dedupe). */
  uniqueConnEntries: [string, any][];
  uniqueWidgetEntries: [string, any][];
  /** Legacy combined list — kept for the overflow-handle fallback. */
  orderedEntries: [string, any][];
  /** No cap — every widget renders (DaSiWa etc. show full parameter list). */
  visibleWidgetEntries: [string, any][];
  /** LoadImage synthetic `preview: true` entries (inline thumbnail / placeholder). */
  imagePreviewEntries: RawInputMeta[];
  /** Output ports: static inferOutputTypeAll table → rawOutputs → empty. */
  outputs: [string, string][];
}

/**
 * Buckets a node's inputs into connection rows (TOP PINS) and widget rows
 * (knobs), plus outputs and image preview targets.  Behaviour is identical
 * to the pre-split inline useMemos in workflow-node.tsx.
 */
export function useFlowNodeEntries(data: WorkflowNodeData): FlowNodeEntries {
  const rawMeta: Record<string, RawInputMeta> = useMemo(() => {
    const out: Record<string, RawInputMeta> = {};
    for (const r of data.rawInputs ?? []) out[r.name] = r;
    return out;
  }, [data.rawInputs]);

  const allEntries: [string, any][] = useMemo(() => {
    if (data.rawInputs && data.rawInputs.length > 0) {
      return data.rawInputs.map((rawInput) => {
        // Server-paired widget value — present for EVERY widget-type input,
        // connected or not.  Show it regardless of link state.
        if (rawInput.widgetValue !== undefined) {
          return [rawInput.name, rawInput.widgetValue] as [string, any];
        }
        // Pure-connection inputs carry no widget value — emit an array so
        // the conn/widget splitter keeps them as wire rows with a Handle.
        return [rawInput.name, rawInput.isConnection ? [] : ""] as [string, any];
      });
    }
    const fromGraph = Object.entries(data.inputs ?? {});
    if (fromGraph.length > 0) return fromGraph;
    return [];
  }, [data.inputs, data.rawInputs]);

  // Split into two buckets using ComfyUI's own input definition (widget
  // marker presence).  Skip the synthetic `preview` entries (R28) — they
  // are body-only thumbnail slots, never input ports.
  const connEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    return m && m.widget === undefined && !m.preview;
  });
  const widgetEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    return m?.widget !== undefined && !m.preview;
  });
  // R50: dedupe by `name` across the two buckets BEFORE layout — custom
  // nodes that combine a typed port with an inline widget (Z-Image-Base)
  // surface the same name twice; keep the widget row (live widgets_values).
  const widgetNameSet = new Set(widgetEntries.map(([k]) => k));
  const uniqueConnEntries = connEntries.filter(([k]) => !widgetNameSet.has(k));
  const uniqueWidgetEntries = widgetEntries;
  const orderedEntries = [...uniqueConnEntries, ...uniqueWidgetEntries];
  const visibleWidgetEntries = uniqueWidgetEntries;

  // IMAGE-input inline thumbnail previews (R27, narrowed R28): only
  // LoadImage's synthetic `preview: true` entry qualifies.
  const imagePreviewEntries = useMemo(
    () => (data.rawInputs ?? []).filter((raw) => raw.preview === true),
    [data.rawInputs]
  );

  // Output ports: static table → raw outputs[] (only place custom-node
  // outputs like ResolutionSelector.width/height survive) → empty list.
  const outputs: [string, string][] = useMemo(() => {
    const staticOuts = Object.entries(inferOutputTypeAll(data.classType));
    if (staticOuts.length > 0) return staticOuts;
    if (data.rawOutputs && data.rawOutputs.length > 0) {
      return data.rawOutputs.map((rawOutput) => [rawOutput.name, rawOutput.type] as [string, string]);
    }
    return [];
  }, [data.classType, data.rawOutputs]);

  return {
    rawMeta,
    allEntries,
    connEntries,
    widgetEntries,
    uniqueConnEntries,
    uniqueWidgetEntries,
    orderedEntries,
    visibleWidgetEntries,
    imagePreviewEntries,
    outputs,
  };
}
