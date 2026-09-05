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
 *  DATA MERGE. The local `workflowIO` state only carries the
 *  four identity fields written by toggleIO — it does NOT have
 *  type/defaultValue/nodeTitle/multiline, those come from the server-side
 *  enrichment in `api/workflows/[id].route.ts`.  Without merging, every
 *  freshly toggled pin would render as a read-only `link` placeholder.
 *  Solution: for each key in the local state, prefer
 *  `detailIOMap[key]` (already enriched), and overlay the local `label`
 *  on top so an un-saved rename wins immediately.
 *
 *  多模式：顶部新增「模式页签」。「通用」页签下编辑的是全局默认值
 *  （写 `value`）；切到某个模式码页签后，编辑的是该模式下的覆盖层
 *  （写 `modes[code] = { defaultValue, visible }`）。覆盖层就在 workflowIO 的
 *  JSON 列里，随整体 workflowIO 一起 PATCH 落库，因此新增模式无需改表。 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { DynamicWorkflowForm } from "@/components/studio/shared/DynamicWorkflowForm";
import {
  collectModeCodes,
  defaultInputValues,
  ioLabel,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "@/components/studio/shared/workflow-io";
import { ALL_WORKFLOW_TYPES } from "@/lib/workflow-types";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import type { WorkflowIOParam } from "./workflow-types";
import { RequiredSummary } from "./RequiredSummary";
import { getIOEditApi } from "./workflow-editor/WorkflowStores";

/** 模式码 → 中文标签（标准任务类型）；非标准码原样显示，兼容历史自定义值。 */
function modeLabel(code: string): string {
  return ALL_WORKFLOW_TYPES.find((type) => type.code === code)?.label ?? code;
}

export interface WorkflowIoPreviewPanelProps {
  workflowIO: Record<string, WorkflowIOParam>;
  detailIOMap: WorkflowIOMap | null;
  onClose: () => void;
}

/** 覆盖值 → 输入框文本。对象/数组没有可编辑的文本形态，直接留空表示沿用通用值。 */
function stringifyModeDefault(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  /* 对象 / 数组 / symbol 等没有可编辑的文本形态，留空表示沿用通用默认值。 */
  return "";
}

/** 把模式默认值输入框里的文本还原成参数真实类型（避免 "512" 变成字符串 512）。 */
function coerceModeDefault(
  text: string,
  control: "textarea" | "text" | "int" | "float" | "switch" | "image" | "link" | "select"
): unknown {
  if (control === "int" || control === "float") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

export function WorkflowIoPreviewPanel({
  workflowIO,
  detailIOMap,
  onClose,
}: WorkflowIoPreviewPanelProps) {
  const ioApi = useMemo(() => getIOEditApi(), []);

  /* null = 「通用」页签（编辑全局默认值）；字符串 = 某个模式码页签。 */
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [addingMode, setAddingMode] = useState(false);

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
         * preview without waiting for a refetch) — render with what we
         * know; controlForEntry will degrade gracefully. */
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

  /* 覆盖层编辑的行：只取输入（输出没有"默认值"语义）。 */
  const editableEntries = useMemo(() => splitWorkflowIO(previewIO).inputs, [previewIO]);
  const modeCodes = useMemo(() => collectModeCodes(previewIO), [previewIO]);

  /* does any widget pin carry an author override? Drives
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

  /* 表单写入分流：通用页签写全局 `value`；模式页签写该模式的 defaultValue 覆盖。
   *  模式页签只把「真正变了」的键写成覆盖项，避免一进页签就给所有参数落满覆盖。 */
  const handleFormChange = useCallback(
    (next: Record<string, unknown>) => {
      if (!activeMode) {
        setIOValues(next);
        return;
      }
      const current = defaultInputValues(previewIO, activeMode);
      for (const [key, value] of Object.entries(next)) {
        if (current[key] === value) continue;
        ioApi.getState().setIOModeOverride(key, activeMode, { defaultValue: value });
      }
    },
    [activeMode, ioApi, previewIO, setIOValues]
  );

  const toggleModeVisibility = useCallback(
    (key: string, visible: boolean) => {
      if (!activeMode) return;
      ioApi.getState().setIOModeOverride(key, activeMode, { visible });
    },
    [activeMode, ioApi]
  );

  const setModeDefault = useCallback(
    (key: string, text: string, control: Parameters<typeof coerceModeDefault>[1]) => {
      if (!activeMode) return;
      ioApi.getState().setIOModeOverride(key, activeMode, {
        defaultValue: text === "" ? undefined : coerceModeDefault(text, control),
      });
    },
    [activeMode, ioApi]
  );

  /* 新增模式：给每个已勾选参数落一条 visible:true，新页签才会被 collectModeCodes
   * 发现并立刻可编辑（否则空模式没有任何持久化痕迹）。
   * 模式码固定用标准任务类型（文生图/图生图…），与工作流库的「类型」同源。 */
  const confirmAddMode = useCallback(
    (code: string) => {
      setAddingMode(false);
      const trimmed = code.trim();
      if (!trimmed || modeCodes.includes(trimmed)) return;
      for (const key of Object.keys(workflowIO)) {
        ioApi.getState().setIOModeOverride(key, trimmed, { visible: true });
      }
      setActiveMode(trimmed);
    },
    [modeCodes, workflowIO, ioApi],
  );

  const removeMode = useCallback(
    (code: string) => {
      for (const key of Object.keys(workflowIO)) {
        ioApi.getState().setIOModeOverride(key, code, null);
      }
      if (activeMode === code) setActiveMode(null);
    },
    [activeMode, workflowIO, ioApi]
  );

  const tabClass = (active: boolean) =>
    `shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
      active
        ? "border-sky-400/50 bg-sky-400/15 text-sky-200"
        : "border-white/8 bg-white/4 text-gray-400 hover:bg-white/8 hover:text-gray-200"
    }`;

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
          {hasIOOverrides && !activeMode && (
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

        {/* ── 模式页签 ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/6 px-3 py-1.5">
          <button type="button" onClick={() => setActiveMode(null)} className={tabClass(activeMode === null)}>
            通用
          </button>
          {modeCodes.map((code) => (
            <span key={code} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setActiveMode(code)}
                title={code}
                className={tabClass(activeMode === code)}
              >
                {modeLabel(code)}
              </button>
              <button
                type="button"
                onClick={() => removeMode(code)}
                className="rounded px-0.5 text-[10px] text-gray-500 transition-colors hover:text-red-300"
                title={`删除模式「${modeLabel(code)}」的全部覆盖`}
              >
                ×
              </button>
            </span>
          ))}
          {addingMode ? (
            <DarkSelect
              className="w-[150px] text-[11px]"
              value=""
              onChange={(code) => confirmAddMode(code)}
              options={ALL_WORKFLOW_TYPES.map((type) => type.code).filter(
                (code) => !modeCodes.includes(code),
              )}
              labels={Object.fromEntries(
                ALL_WORKFLOW_TYPES.map((type) => [type.code, `${type.label}（${type.code}）`]),
              )}
              placeholder="选择模式"
              popoverMinWidth={200}
              autoFitFromOptions={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingMode(true)}
              className="shrink-0 rounded-md border border-dashed border-white/12 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:border-sky-400/40 hover:text-sky-200"
              title="新增一个模式（文生图 / 图生图 / …）"
            >
              ＋ 模式
            </button>
          )}
        </div>

        {/* ── 模式覆盖层编辑（仅模式页签） ── */}
        {activeMode && (
          <div className="nodrag nopan max-h-[38%] shrink-0 overflow-y-auto border-b border-white/6 px-3 py-2">
            <div className="mb-1 text-[10px] text-gray-500">
              模式「{modeLabel(activeMode)}」覆盖：留空 = 沿用通用默认值
            </div>
            <div className="space-y-1">
              {editableEntries.map((entry) => {
                const override = entry.modes?.[activeMode];
                const visible = override?.visible ?? true;
                const dv = override?.defaultValue;
                return (
                  <div key={entry.ioKey} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => toggleModeVisibility(entry.ioKey, e.target.checked)}
                      title="该模式下是否显示此参数"
                      className="h-3 w-3 shrink-0 accent-sky-400"
                    />
                    <span
                      className={`w-[104px] shrink-0 truncate text-[11px] ${
                        visible ? "text-gray-300" : "text-gray-600 line-through"
                      }`}
                      title={ioLabel(entry, editableEntries)}
                    >
                      {ioLabel(entry, editableEntries)}
                    </span>
                    {entry.control === "switch" ? (
                      <input
                        type="checkbox"
                        checked={dv === true}
                        onChange={(e) =>
                          ioApi
                            .getState()
                            .setIOModeOverride(entry.ioKey, activeMode, {
                              defaultValue: e.target.checked,
                            })
                        }
                        className="h-3 w-3 shrink-0 accent-sky-400"
                      />
                    ) : (
                      <input
                        value={stringifyModeDefault(dv)}
                        onChange={(e) => setModeDefault(entry.ioKey, e.target.value, entry.control)}
                        placeholder="(通用)"
                        className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[11px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-400/60"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              values={defaultInputValues(previewIO, activeMode)}
              onChange={handleFormChange}
              mode={activeMode}
              compact
              showOutputs
              onLabelChange={setIOLabel}
              /* 必填 / 可选 toggle. Preview only — purely
               *  visual; the toggle writes into the same
               *  workflowIO map that setIOLabel uses, which gets
               *  shipped to the server on next PATCH. */
              onRequiredChange={toggleIORequired}
              /* drag-to-reorder. Only the canvas-side
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
