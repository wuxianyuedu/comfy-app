"use client";

// 统一的「先选模式 → 再选模型」级联选择器（#4834）：项目里所有用模型的入口
// （提取 / 定妆照 / 镜头生图 / 视频）共用这一份选择交互与候选口径。候选装配
// 复用测试模型页的 useTestCatalog（经 use-model-catalog 薄封装，§12.18）——
// 本地 ComfyUI 工作流以「本地模型」组出现（显示模型标签名，取值 `wf::<id>`），
// 远端 API 模型为「远端模型」组；chat（文本）没有模式维度，只显示模型下拉。
// 选中值 = candidateValue（模型名 / `wf::<id>`），调用侧据此分流本地 / 远端通道。

import { useMemo } from "react";

import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { cn } from "~/lib/utils";

import { useModelCatalog } from "./hooks/use-model-catalog";
import {
  candidateLabel,
  candidateValue,
  defaultModeForKind,
  type ModelTestKind,
} from "./model-test-config";

/** 一个生成入口的模型选择（随工坊草稿持久化）：mode 是工坊模式码
 *  （T2I / I2V / T2V …；文本恒 ""），model 是候选取值空间的字符串。 */
export type ModelSelection = { mode: string; model: string };

export function ModelCascadeSelect({
  className,
  kind,
  modes,
  onSelectionChange,
  placeholder = "选择模型…",
  selection,
}: {
  className?: string;
  kind: ModelTestKind;
  /** 只显示这些模式（如定妆照只出「文生图」）；缺省 = 该用途全部生成类模式。 */
  modes?: ReadonlyArray<string>;
  onSelectionChange: (next: ModelSelection) => void;
  placeholder?: string;
  selection: ModelSelection;
}) {
  const catalog = useModelCatalog(kind, selection.mode);
  /* 模式缺省（旧草稿迁移 / 初次进入）落到该用途的默认模式 —— 纯派生，
   * 不抢在取数前改父级状态。 */
  const mode = selection.mode === "" ? defaultModeForKind(kind) : selection.mode;
  const candidates = catalog.candidates;
  const modeTabs =
    modes === undefined ? catalog.modeTabs : catalog.modeTabs.filter((t) => modes.includes(t.mode));

  const groups = useMemo(
    () =>
      [
        {
          label: "本地模型",
          options: candidates.filter((c) => c.local).map(candidateValue),
        },
        {
          label: "远端模型",
          options: candidates.filter((c) => !c.local).map((c) => c.name),
        },
      ].filter((group) => group.options.length > 0),
    [candidates],
  );
  const labels = useMemo(
    () => Object.fromEntries(candidates.map((c) => [candidateValue(c), candidateLabel(c)])),
    [candidates],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {kind !== "chat" && modeTabs.length > 0 && (
        <div aria-label="选择模式" className="flex flex-wrap gap-2" role="radiogroup">
          {modeTabs.map((t) => (
            <SelectChip
              key={t.mode}
              onClick={() => {
                onSelectionChange({ ...selection, mode: t.mode });
              }}
              selected={t.mode === mode}
              shape="pill"
            >
              {t.label}
            </SelectChip>
          ))}
        </div>
      )}
      {candidates.length === 0 && !catalog.loading ? (
        <p className="text-muted-foreground bg-subtle rounded-lg px-3 py-2 text-xs leading-relaxed">
          {kind === "chat"
            ? "还没有可用的文本模型 —— 在「测试模型」页配置本地 / 远端文本模型，或在设置页勾选候选。"
            : `当前模式（${mode}）下没有可用模型 —— 换个模式，或先在「模型适配」给远端模型配置该模式的适配器；本地工作流需在工作流库声明支持该模式。`}
        </p>
      ) : (
        <SelectMenu
          aria-label="选择模型"
          autoFitFromOptions={false}
          className="text-sm"
          fullWidth={false}
          groups={groups}
          labels={labels}
          onChange={(next) => {
            onSelectionChange({ mode, model: next });
          }}
          options={candidates.map(candidateValue)}
          placeholder={catalog.loading ? "正在读取模型…" : placeholder}
          popoverMinWidth={240}
          value={selection.model}
        />
      )}
    </div>
  );
}
