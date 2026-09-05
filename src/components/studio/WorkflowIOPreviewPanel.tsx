/* IO 预览侧面板（工作流编辑器）。
 *
 * 模式体系（与工作流库「类型」同源）：
 *   - 模式页签直接来自工作流的 `modes`（模板列，MultiModeSelect 维护），
 *     不再有「通用」页签，也不再提供自由文本模式码；
 *   - 点击页签切换模式，主表单即时切换到该模式的覆盖层——所有默认值都
 *     用原本的通用组件填写（写入 modes[mode].defaultValue），不再有单独
 *     的「覆盖列表」配置区；
 *   - 每行的 👁 切换该参数在当前模式下是否可见（modes[mode].visible），
 *     按模式分别保留；
 *   - 尚未添加任何模式时表单禁用（禁止配置参数），先在 MultiModeSelect
 *     里勾选模式。
 *
 * DATA MERGE. 本地 `workflowIO` 只携带勾选时的身份字段；`detailIOMap` 是
 * 服务端富化（type/defaultValue/nodeTitle/multiline）。对每个 key 优先取
 * 富化条目、再叠加本地条目——本地是作者编辑态的唯一事实源（label/value/
 * required/seedMode/modes 的未保存修改都在上面，必须整体透传）。
 *
 * 位置：右上角，占满画布高度，z-30。 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { DynamicWorkflowForm } from "@/components/studio/shared/DynamicWorkflowForm";
import {
  collectModeCodes,
  defaultInputValues,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "@/components/studio/shared/workflow-io";
import { ALL_WORKFLOW_TYPES } from "@/lib/workflow-types";
import { MultiModeSelect } from "~/components/studio/ui/MultiModeSelect";
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
  /** 工作流支持的模式（模板 modes 列，与库详情「类型」同源）。 */
  modes: string[];
  defaultMode: string | null;
  /** 模式集合 / 默认模式变更（编辑器落库并同步本地 detail）。 */
  onModesChange: (modes: string[], defaultMode: string) => void;
  onClose: () => void;
}

export function WorkflowIoPreviewPanel({
  workflowIO,
  detailIOMap,
  modes,
  defaultMode,
  onModesChange,
  onClose,
}: WorkflowIoPreviewPanelProps) {
  /* getIOEditApi 内部调 useContext，只能在组件顶层调用（Hook 套 Hook 会被
   * React 19 拦下）。context 持有的 StoreApi 按编辑器实例稳定。 */
  const ioApi = getIOEditApi();

  /* 当前编辑的模式：始终是工作流模式之一；工作流删掉该模式时回落到
   * defaultMode → 第一个模式。没有模式 = 表单禁用（禁止配置参数）。 */
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const effectiveMode = useMemo(() => {
    if (activeMode && modes.includes(activeMode)) return activeMode;
    if (defaultMode && modes.includes(defaultMode)) return defaultMode;
    return modes[0] ?? null;
  }, [activeMode, modes, defaultMode]);

  /* Merge server-side enrichment with the live local state (DATA MERGE，
   * 详见文件头)。 */
  const previewIO = useMemo<WorkflowIOMap>(() => {
    const out: WorkflowIOMap = {};
    if (!detailIOMap) return out;
    for (const [key, local] of Object.entries(workflowIO)) {
      if (!local) continue;
      const e = detailIOMap[key];
      if (e) {
        /* Local override beats server label so an un-saved rename wins. */
        out[key] = { ...e, ...local, label: local.label ?? e.label };
      } else {
        /* 尚未有服务端富化（刚勾选就打开预览）：整体透传本地条目——它
         *  携带 value/required/seedMode/modes 等未保存编辑，逐字段列举
         *  会把它们静默丢掉（历史 bug：数值/必填改了又弹回）。 */
        out[key] = { ...local, type: local.type ?? "*" };
      }
    }
    return out;
  }, [workflowIO, detailIOMap]);

  const editableEntries = useMemo(() => splitWorkflowIO(previewIO).inputs, [previewIO]);
  /* 兜底：历史数据里可能存在不在工作流 modes 里的遗留模式码覆盖——
   * 列出来供删除，但不进入主编辑页签（页签只跟工作流 modes 走）。 */
  const legacyModeCodes = useMemo(
    () => collectModeCodes(previewIO).filter((code) => !modes.includes(code)),
    [previewIO, modes],
  );

  /* 当前模式是否落过覆盖（驱动「恢复默认」按钮）。 */
  const hasModeOverrides = useMemo(
    () =>
      effectiveMode != null &&
      Object.values(workflowIO).some((entry) => entry?.modes?.[effectiveMode] !== undefined),
    [workflowIO, effectiveMode],
  );

  const setIOLabel = useCallback(
    (key: string, label: string) => ioApi.getState().setIOLabel(key, label),
    [ioApi]
  );
  const toggleIORequired = useCallback(
    (key: string) => ioApi.getState().toggleIORequired(key),
    [ioApi]
  );
  const reorderIO = useCallback(
    (fromKey: string, beforeKey: string | null) =>
      ioApi.getState().reorderIO(fromKey, beforeKey),
    [ioApi]
  );

  /* 表单写入：一律落当前模式的覆盖层（defaultValue），「通用值」概念随
   *  通用页签一并移除。只写真正变化的键，避免一进页签就给所有参数落满覆盖。 */
  const handleFormChange = useCallback(
    (next: Record<string, unknown>) => {
      if (!effectiveMode) return;
      const current = defaultInputValues(previewIO, effectiveMode);
      for (const [key, value] of Object.entries(next)) {
        if (current[key] === value) continue;
        ioApi
          .getState()
          .setIOModeOverride(key, effectiveMode, { defaultValue: value });
      }
    },
    [effectiveMode, ioApi, previewIO]
  );

  const toggleModeVisibility = useCallback(
    (key: string, visible: boolean) => {
      if (!effectiveMode) return;
      ioApi.getState().setIOModeOverride(key, effectiveMode, { visible });
    },
    [effectiveMode, ioApi]
  );

  /* 恢复默认 = 清掉当前模式的全部覆盖（回到通用默认 + 默认可见）。 */
  const resetActiveModeOverrides = useCallback(() => {
    if (!effectiveMode) return;
    for (const key of Object.keys(workflowIO)) {
      ioApi.getState().setIOModeOverride(key, effectiveMode, null);
    }
  }, [effectiveMode, workflowIO, ioApi]);

  const removeLegacyMode = useCallback(
    (code: string) => {
      for (const key of Object.keys(workflowIO)) {
        ioApi.getState().setIOModeOverride(key, code, null);
      }
    },
    [workflowIO, ioApi]
  );

  const tabClass = (active: boolean) =>
    `shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
      active
        ? "border-sky-400/50 bg-sky-400/15 text-sky-200"
        : "border-white/8 bg-white/4 text-gray-400 hover:bg-white/8 hover:text-gray-200"
    }`;

  return (
    <div className="pointer-events-none absolute right-4 top-4 bottom-4 z-30 flex w-[440px] flex-col">
      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-sky-400/30 bg-[#0a0a14]/92 shadow-2xl backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
            <span className="truncate text-[12px] font-semibold text-gray-200">IO 预览</span>
            <span className="rounded-full bg-white/6 px-1.5 py-px text-[10px] font-mono text-gray-400">
              {Object.keys(workflowIO).length}
            </span>
          </div>
          {hasModeOverrides && (
            <button
              type="button"
              onClick={resetActiveModeOverrides}
              className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
              title={`把模式「${modeLabel(effectiveMode ?? "")}」的全部参数恢复到通用默认值`}
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

        {/* ── 模式页签：来自工作流 modes（与库「类型」同源）＋右侧模式管理 ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/6 px-3 py-1.5">
          {modes.map((code) => (
            <span key={code} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setActiveMode(code)}
                title={code}
                className={tabClass(effectiveMode === code)}
              >
                {modeLabel(code)}
              </button>
              {modes.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = modes.filter((m) => m !== code);
                    onModesChange(next, next[0] ?? "");
                  }}
                  className="rounded px-0.5 text-[10px] text-gray-500 transition-colors hover:text-red-300"
                  title={`从工作流模式中移除「${modeLabel(code)}」`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {legacyModeCodes.map((code) => (
            <span key={code} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => removeLegacyMode(code)}
                className="rounded-md border border-dashed border-amber-400/30 bg-amber-400/5 px-1.5 py-0.5 text-[11px] text-amber-300/80 transition-colors hover:text-red-300"
                title={`历史遗留模式「${code}」（不在工作流模式中）——点击清除其覆盖`}
              >
                {code} ×
              </button>
            </span>
          ))}
          <span className="ml-auto shrink-0">
            <MultiModeSelect
              modes={modes}
              defaultMode={defaultMode ?? modes[0] ?? ""}
              hideExtraBadge
              onChange={onModesChange}
            />
          </span>
        </div>

        <div className="nodrag nopan flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 text-gray-200">
          {Object.keys(workflowIO).length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/2 px-3 py-4 text-center text-[11px] leading-relaxed text-gray-500">
              尚未勾选任何 IO。
              <br />
              在画布上勾选参数后，这里会同步出现对应的表单行；每个名称旁的 ✎ 可点击重命名。
            </div>
          ) : modes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-400/30 bg-amber-400/5 px-3 py-4 text-center text-[11px] leading-relaxed text-amber-200/80">
              该工作流还没有配置模式 —— 请先在上方「模式」里勾选
              （文生图 / 图生图 / …），之后才能在这里配置参数。
            </div>
          ) : (
            <div className={effectiveMode ? "" : "pointer-events-none opacity-50"}>
              <DynamicWorkflowForm
                io={previewIO}
                values={defaultInputValues(previewIO, effectiveMode)}
                onChange={handleFormChange}
                mode={effectiveMode}
                compact
                showOutputs
                showHiddenInMode
                seedModes={(() => {
                  const map: Record<string, string> = {};
                  for (const entry of editableEntries) {
                    if (entry.seedMode) map[entry.ioKey] = entry.seedMode;
                  }
                  return map;
                })()}
                onSeedModeChange={(ioKey, mode) =>
                  ioApi.getState().setIOSeedMode(ioKey, mode)
                }
                onLabelChange={setIOLabel}
                /* 必填 / 可选 toggle：写进 workflowIO 条目，随整体 PATCH 落库。 */
                onRequiredChange={toggleIORequired}
                /* 每行 👁：该参数在当前模式下是否可见（按模式分别保留）。 */
                visibilityMode={effectiveMode}
                onVisibilityChange={toggleModeVisibility}
                /* drag-to-reorder：仅编辑态的 IO 预览暴露。 */
                onReorder={reorderIO}
                emptyHint={null}
              />
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/6 px-3 py-1.5 text-[10px] text-gray-500">
          <span className="opacity-80">点击任意名称旁的</span>
          <span className="mx-1 inline-block rounded bg-white/8 px-1 font-mono text-[10px] text-gray-300">✎</span>
          <span className="opacity-80">可重命名；👁 按当前模式保留可见性；「必填 / 可选」切换是否在运行时强校验。</span>
          <RequiredSummary io={previewIO} />
        </div>
      </div>
    </div>
  );
}
