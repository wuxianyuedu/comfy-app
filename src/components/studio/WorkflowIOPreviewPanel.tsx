/* Extracted IO preview side panel from WorkflowEditorInner (wf-editor-inner.tsx).
 *
 *  Renders the same DynamicWorkflowForm that CreatePanel / the canvas
 *  workflow node consume, fed by the **live** `workflowIO` state (not the
 *  cached server-side enrichment).  This lets the author toggle a checkbox
 *  on the canvas and immediately see the new row appear in the preview,
 *  plus rename any row's display label and watch it flow back into the
 *  persisted selection.  Compact mode to match the on-canvas rendering the
 *  user will see at run time.
 *
 *  Position: top-right, ~360px wide, max-h that respects the bottom
 *  toolbar.  z-30 so it sits above the MiniMap + Controls but below the
 *  save toast.  Pointer events on the panel itself are enabled.
 *
 *  DATA MERGE (2026-08-09).  The local `workflowIO` state only carries the
 *  four identity fields written by toggleIO — it does NOT have
 *  type/defaultValue/nodeTitle/multiline, those come from the server-side
 *  enrichment in `api/workflows/[id].route.ts`.  Without merging, every
 *  freshly toggled pin would render as a read-only `link` placeholder.
 *  Solution: for each key in the local state, prefer
 *  `detailIOMap[key]` (already enriched), and overlay the local `label`
 *  on top so an un-saved rename wins immediately. */
"use client";

import { useCallback, useMemo } from "react";
import { DynamicWorkflowForm } from "@/components/studio/shared/DynamicWorkflowForm";
import { defaultInputValues, type WorkflowIOMap } from "@/components/studio/shared/workflow-io";
import type { WorkflowIOParam } from "./workflow-types";
import { RequiredSummary } from "./RequiredSummary";
import { getIOEditApi } from "./workflow-stores";

export interface WorkflowIoPreviewPanelProps {
  workflowIO: Record<string, WorkflowIOParam>;
  detailIOMap: WorkflowIOMap | null;
  onClose: () => void;
}

export function WorkflowIoPreviewPanel({ workflowIO, detailIOMap, onClose }: WorkflowIoPreviewPanelProps) {
  const ioApi = useMemo(() => getIOEditApi(), []);

  /* Merge server-side enrichment with the live local state (see the DATA
   *  MERGE comment at the top of this file for the full rationale). */
  const previewIO = useMemo<WorkflowIOMap>(() => {
    const out: WorkflowIOMap = {};
    if (!detailIOMap) return out;
    for (const [key, local] of Object.entries(workflowIO)) {
      if (!local) continue;
      const e = detailIOMap[key];
      if (e) {
        /* Local override beats server label so an un-saved rename wins.
         *  Identity fields always come from local (the toggle is the
         *  source of truth for what was actually checked). */
        out[key] = { ...e, ...local, label: local.label ?? e.label };
      } else {
        /* No server enrichment yet (e.g. user toggled + immediately opened
         *  preview without waiting for a refetch) — render with what we
         *  know; controlForEntry will degrade gracefully. */
        out[key] = {
          direction: local.direction,
          kind: local.kind,
          nodeId: local.nodeId,
          name: local.name,
          label: local.label,
          type: local.type ?? "*",
        };
      }
    }
    return out;
  }, [workflowIO, detailIOMap]);

  /* R94 (2026-08-17): does any widget pin carry an author override?  Drives
   *  the 「恢复默认」 button's enabled state. */
  const hasIOOverrides = useMemo(
    () => Object.values(workflowIO).some((entry) => entry?.kind === "widget" && entry.value !== undefined),
    [workflowIO]
  );

  const setIOValues = useCallback(
    (next: Record<string, unknown>) => ioApi.getState().setIOValues(next),
    [ioApi]
  );
  const setIOLabel = useCallback(
    (key: string, label: string) => ioApi.getState().setIOLabel(key, label),
    [ioApi]
  );
  const toggleIORequired = useCallback(
    (key: string) => ioApi.getState().toggleIORequired(key),
    [ioApi]
  );
  const resetIOPreviewValues = useCallback(
    () => ioApi.getState().resetIOPreviewValues(),
    [ioApi]
  );
  const reorderIO = useCallback(
    (fromKey: string, beforeKey: string | null) =>
      ioApi.getState().reorderIO(fromKey, beforeKey),
    [ioApi]
  );

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-[360px] flex-col">
      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-sky-400/30 bg-[#0a0a14]/92 shadow-2xl backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
            <span className="truncate text-[12px] font-semibold text-gray-200">IO 预览</span>
            <span className="rounded-full bg-white/6 px-1.5 py-px text-[10px] font-mono text-gray-400">
              {Object.keys(workflowIO).length}
            </span>
          </div>
          {hasIOOverrides && (
            <button
              type="button"
              onClick={resetIOPreviewValues}
              className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
              title="把所有参数恢复到工作流原本的默认值"
            >
              恢复默认
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
            title="关闭预览"
          >
            ✕
          </button>
        </div>
        <div className="nodrag nopan flex-1 overflow-y-auto px-3 py-3 text-gray-200">
          {Object.keys(workflowIO).length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/2 px-3 py-4 text-center text-[11px] leading-relaxed text-gray-500">
              尚未勾选任何 IO。
              <br />
              在画布上勾选参数后，这里会同步出现对应的表单行；每个名称旁的 ✎ 可点击重命名。
            </div>
          ) : (
            <DynamicWorkflowForm
              io={previewIO}
              values={defaultInputValues(previewIO)}
              onChange={setIOValues}
              compact
              showOutputs
              onLabelChange={setIOLabel}
              /* R57: 必填 / 可选 toggle.  Preview only — purely
               *  visual; the toggle writes into the same
               *  workflowIO map that setIOLabel uses, which gets
               *  shipped to the server on next PATCH. */
              onRequiredChange={toggleIORequired}
              /* R-ardot35: drag-to-reorder.  Only the canvas-side
               *  IO preview exposes this — the author is editing
               *  the workflow's IO layout here.  CreatePanel
               *  intentionally doesn't (consumers just see the
               *  result); WorkflowLibrary / canvas workflow
               *  nodes also omit it (read-only surfaces). */
              onReorder={reorderIO}
              emptyHint={null}
            />
          )}
        </div>
        <div className="shrink-0 border-t border-white/6 px-3 py-1.5 text-[10px] text-gray-500">
          <span className="opacity-80">点击任意名称旁的</span>
          <span className="mx-1 inline-block rounded bg-white/8 px-1 font-mono text-[10px] text-gray-300">✎</span>
          <span className="opacity-80">可重命名；「必填 / 可选」切换是否在运行时强校验。</span>
          <RequiredSummary io={previewIO} />
        </div>
      </div>
    </div>
  );
}
