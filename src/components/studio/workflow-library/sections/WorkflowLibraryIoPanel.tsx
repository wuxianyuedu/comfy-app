"use client";

/* 工作流库「IO 预览」页签：不进编辑器就能调整对外参数的显隐 / 默认值 /
 * 必填 / 显示名 / seed 行为（ISSUE #3632）。与编辑器侧共享同一份编辑规则
 * （src/lib/workflow/workflow-io-edit.ts 的纯变换）与同一套表单
 * （DynamicWorkflowForm 编辑态），两处不各写一份 modeOverrides 读写口径。
 *
 * 数据分两层：**显示**用服务端富化后的 workflowIO（带 label / type /
 * defaultValue / options），**落库**以模板的原始 DB 列为底稿 —— 富化字段是
 * 派生结果，原样写回会把图内读出的当前值固化进库。每次编辑即时经
 * onPatchWorkflowIO 落库，不设「保存」按钮（用户只是改个显隐 / 默认值）。 */
import { useCallback, useMemo, useState } from "react";

import { DynamicWorkflowForm } from "~/components/studio/workflow-form/DynamicWorkflowForm";
import {
  defaultInputValues,
  resolveEntrySeedMode,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "~/components/studio/workflow-io";
import { RequiredSummary } from "~/components/studio/RequiredSummary";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { clearModeOverrides, withIOLabel, withModeOverride } from "~/lib/workflow/workflow-io-edit";
import { modeLabel } from "../workflow-library-config";
import { isPlainRecord } from "~/lib/is-record";

export type WorkflowLibraryIoPanelProps = {
  /** 当前查看 / 编辑的模式；由详情层统一下发，切页签不丢。 */
  activeMode: string | null;
  /** 工作流支持的模式（与「类型」同源）。 */
  modes: Array<string>;
  /** 切换当前模式（只改查看语境，不落库）。 */
  onActiveModeChange: (mode: string) => void;
  /** 整体落库 workflowIO（PATCH 整列 + 失效两个 detail 缓存）。 */
  onPatchWorkflowIO: (next: Record<string, unknown>) => Promise<void>;
  /** 模板的原始 DB 列（落库底稿）。 */
  storedIO: Record<string, unknown>;
  /** 服务端富化后的 IO 表（显示源）。 */
  workflowIO: WorkflowIOMap | null;
};

/** 原始列条目的形状守卫：身份字段齐了才认作一条 workflowIO 条目，
 *  其余字段（label / type / modeOverrides…）原样透传，不在本函数里补猜。 */
function isIOEntry(value: unknown): value is WorkflowIOMap[string] {
  if (!isPlainRecord(value)) {
    return false;
  }
  const rec = value;
  return (
    typeof rec.nodeId === "string" &&
    typeof rec.name === "string" &&
    (rec.direction === "input" || rec.direction === "output") &&
    typeof rec.kind === "string"
  );
}

/** 把原始列归一成 WorkflowIOMap 形状（形状不合的条目丢弃，不盲转型）。 */
function asIOMap(raw: Record<string, unknown>): WorkflowIOMap {
  const out: WorkflowIOMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isIOEntry(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function WorkflowLibraryIoPanel({
  modes,
  activeMode,
  onActiveModeChange,
  onPatchWorkflowIO,
  storedIO,
  workflowIO,
}: WorkflowLibraryIoPanelProps) {
  /* 草稿 = 原始 DB 列的深拷贝（只嵌套到条目这一层），编辑动作先改它、再即时
   * 落库。detailFull 的富化链会把草稿里作者写过的 modeOverrides / label /
   * required 原样透传回来，重拉后草稿与服务端一致。 */
  const [draft, setDraft] = useState<WorkflowIOMap>(() => asIOMap(storedIO));

  /* 生效模式：当前模式必须是工作流模式之一，否则回退到第一个（与编辑器
   * IO 预览、画布节点同一口径）。没有模式时表单禁用。 */
  const effectiveMode = useMemo(() => {
    if (activeMode !== null && activeMode !== "" && modes.includes(activeMode)) {
      return activeMode;
    }
    return modes[0] ?? null;
  }, [activeMode, modes]);

  /* 显示源：草稿的作者编辑覆盖在富化条目上（显隐 / 默认值 / 必填 / 改名以
   * 草稿为准，类型 / 候选 / 图内默认值取富化结果）。与编辑器面板的 DATA MERGE
   * 同向：本地是作者编辑态的唯一事实源。 */
  const previewIO = useMemo<WorkflowIOMap>(() => {
    if (!workflowIO) {
      return draft;
    }
    const out: WorkflowIOMap = {};
    for (const [key, enriched] of Object.entries(workflowIO)) {
      const local = draft[key];
      out[key] = local ? { ...enriched, ...local } : enriched;
    }
    return out;
  }, [draft, workflowIO]);

  /* 「恢复默认」是否可用：当前模式落过覆盖就亮。 */
  const hasModeOverrides = useMemo(
    () =>
      effectiveMode !== null &&
      effectiveMode !== "" &&
      Object.values(draft).some((entry) => entry?.modeOverrides?.[effectiveMode] !== undefined),
    [draft, effectiveMode],
  );

  /* 一次编辑 = 纯变换出下一张表 → 本地草稿即时反映 → 整列落库。
   * 三个动作共用这一条路径，不各写一份 setState + PATCH。 */
  const commit = useCallback(
    (next: WorkflowIOMap) => {
      setDraft(next);
      void onPatchWorkflowIO(next);
    },
    [onPatchWorkflowIO],
  );

  const handleFormChange = useCallback(
    (values: Record<string, unknown>) => {
      if (effectiveMode === null || effectiveMode === "") {
        return;
      }
      /* 与编辑器面板同款：只把真正变化的键写进当前模式的覆盖层，避免一进
       * 页签就给所有参数落满 defaultValue 覆盖。 */
      const current = defaultInputValues(previewIO, effectiveMode);
      let next = draft;
      for (const [key, value] of Object.entries(values)) {
        if (current[key] === value) {
          continue;
        }
        next = withModeOverride(next, key, effectiveMode, { defaultValue: value });
      }
      if (next !== draft) {
        commit(next);
      }
    },
    [commit, draft, effectiveMode, previewIO],
  );

  const handleVisibilityChange = useCallback(
    (key: string, visible: boolean) => {
      if (effectiveMode === null || effectiveMode === "") {
        return;
      }
      commit(withModeOverride(draft, key, effectiveMode, { visible }));
    },
    [commit, draft, effectiveMode],
  );

  const handleRequiredChange = useCallback(
    (key: string, required: boolean) => {
      if (effectiveMode === null || effectiveMode === "" || draft[key]?.kind !== "widget") {
        return;
      }
      commit(withModeOverride(draft, key, effectiveMode, { required }));
    },
    [commit, draft, effectiveMode],
  );

  const handleSeedModeChange = useCallback(
    (key: string, seedMode: string) => {
      if (effectiveMode === null || effectiveMode === "") {
        return;
      }
      commit(withModeOverride(draft, key, effectiveMode, { seedMode }));
    },
    [commit, draft, effectiveMode],
  );

  const handleLabelChange = useCallback(
    (key: string, label: string) => {
      commit(withIOLabel(draft, key, label));
    },
    [commit, draft],
  );

  const handleReset = useCallback(() => {
    if (effectiveMode === null || effectiveMode === "") {
      return;
    }
    commit(clearModeOverrides(draft, effectiveMode));
  }, [commit, draft, effectiveMode]);

  /* seed 模式映射：按当前模式解析（模式覆盖优先，回退条目全局）。 */
  const seedModes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of splitWorkflowIO(previewIO).inputs) {
      const resolved = resolveEntrySeedMode(entry, effectiveMode);
      if (resolved !== undefined && resolved !== "") {
        map[entry.ioKey] = resolved;
      }
    }
    return map;
  }, [previewIO, effectiveMode]);

  const tabClass = (active: boolean) =>
    `shrink-0 rounded-md border px-2 py-1 text-2xs transition-colors ${
      active
        ? "border-info/50 bg-info/15 text-info-strong"
        : "border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright"
    }`;

  return (
    <div className="border-border bg-panel-deep flex h-full min-h-0 flex-col rounded-2xl border">
      <div className="border-border-strong flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-sky-400" />
          <span className="text-ink-bright truncate text-xs font-semibold">IO 预览</span>
          <span className="bg-subtle text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">
            {Object.keys(previewIO).length}
          </span>
          <span className="text-ink-faint text-2xs truncate">
            在这里调整显隐 / 默认值 / 必填 / 显示名，改动即时保存
          </span>
        </div>
        {hasModeOverrides && (
          <Hint label={`把模式「${modeLabel(effectiveMode ?? "")}」的全部参数恢复到通用默认值`}>
            <Button
              className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright text-2xs h-auto shrink-0 rounded-md px-1.5 py-0.5"
              onClick={handleReset}
              size="xs"
              variant="outline"
            >
              恢复默认
            </Button>
          </Hint>
        )}
      </div>

      {/* 模式页签：与「类型」同一份模式码，切到哪个模式就编哪个模式的覆盖层。 */}
      <div className="border-border-strong flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5">
        <span className="text-ink-faint text-2xs mr-1">模式</span>
        {modes.map((code) => (
          <Hint key={code} label={code}>
            <Button
              className={`${tabClass(effectiveMode === code)} h-auto`}
              onClick={() => {
                onActiveModeChange(code);
              }}
              size="xs"
              variant="ghost"
            >
              {modeLabel(code)}
            </Button>
          </Hint>
        ))}
        {modes.length === 0 && (
          <span className="text-warning-strong/80 text-2xs">
            该工作流还没有配置模式 —— 请先在「类型」里勾选
          </span>
        )}
      </div>

      <div className="nodrag nopan text-ink-bright min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {Object.keys(previewIO).length === 0 ? (
          <div className="border-border-strong bg-subtle text-ink-muted text-2xs rounded-lg border border-dashed px-3 py-4 text-center leading-relaxed">
            这条工作流还没有暴露任何 IO —— 请在编辑器里勾选参数后再来这里调整。
          </div>
        ) : modes.length === 0 ? (
          <div className="border-warning/30 bg-warning/5 text-warning-strong/80 text-2xs rounded-lg border border-dashed px-3 py-4 text-center leading-relaxed">
            没有配置模式，参数配置暂不可用。
          </div>
        ) : (
          <DynamicWorkflowForm
            compact
            emptyHint={null}
            io={previewIO}
            mode={effectiveMode}
            onChange={handleFormChange}
            onLabelChange={handleLabelChange}
            onRequiredChange={handleRequiredChange}
            onSeedModeChange={handleSeedModeChange}
            onVisibilityChange={handleVisibilityChange}
            seedModes={seedModes}
            showHiddenInMode
            showOutputs
            values={defaultInputValues(previewIO, effectiveMode)}
            visibilityMode={effectiveMode}
          />
        )}
      </div>

      <div className="border-border-strong text-ink-muted text-3xs shrink-0 border-t px-3 py-1.5">
        <span className="opacity-80">
          点击变量名称即可重命名；👁 按当前模式保留可见性；「必填 / 可选」切换是否在运行时强校验。
        </span>
        <RequiredSummary io={previewIO} mode={effectiveMode} />
      </div>
    </div>
  );
}
