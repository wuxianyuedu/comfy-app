"use client";

// 单个 widget 控件（text / textarea / number / switch / image / select）。
// 纯展示：值由外部传入，变更通过 onValueChange 上抛。compact 走画布节点的
// 压缩尺寸，宽版走 CreatePanel / IO-edit 预览的尺寸。

import {
  isInputFilled,
  numericBounds,
  type EnrichedWidget,
} from "~/components/studio/shared/workflow-io";
import {
  AutoResizeTextarea,
  isSeedLike,
  SeedModeButton,
} from "~/components/studio/shared/WorkflowFormControls";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import { NumberField } from "~/components/studio/ui/NumberField";
import { inputCls } from "../constants";

interface WidgetControlProps {
  entry: EnrichedWidget;
  /** 行标签 —— 参与 placeholder（输入 / 选择 / 上传 + 必填后缀）。 */
  label: string;
  value: unknown;
  compact: boolean;
  disabled: boolean;
  /** 该行正在上传（image 行显示「上传中…」）。 */
  uploading: boolean;
  seedMode?: string;
  onSeedModeChange?: (mode: string) => void;
  onValueChange: (value: unknown) => void;
  onPickFile: () => void;
}

export function WidgetControl({
  entry,
  label,
  value,
  compact,
  disabled,
  uploading,
  seedMode,
  onSeedModeChange,
  onValueChange,
  onPickFile,
}: WidgetControlProps) {
  /* 标记必填但仍为空 → 红框，提醒作者补齐后再发布。 */
  const missingRequired = !!entry.required && !isInputFilled(value);
  const requiredHint = entry.required ? "（必填）" : "";

  switch (entry.control) {
    case "textarea": {
      const placeholder = `输入 ${label}${requiredHint}`;
      if (compact) {
        return (
          <AutoResizeTextarea
            value={typeof value === "string" ? value : ""}
            placeholder={placeholder}
            onChange={onValueChange}
            minHeight={28}
            maxHeight={80}
          />
        );
      }
      return (
        <textarea
          className={`${inputCls} mt-1.5 min-h-[52px] ${missingRequired ? "ring-1 ring-red-400/50" : ""}`}
          rows={4}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(ev) => onValueChange(ev.target.value)}
        />
      );
    }

    case "text":
      return (
        <input
          className={`${inputCls} ${compact ? "" : "mt-1"} ${missingRequired ? "border-red-400/50" : ""}`}
          value={
            typeof value === "string" || typeof value === "number"
              ? String(value)
              : ""
          }
          disabled={disabled}
          placeholder={`输入 ${label}${requiredHint}`}
          onChange={(ev) => onValueChange(ev.target.value)}
        />
      );

    case "int":
    case "float": {
      const bounds = numericBounds(entry);
      const isSeed = compact && isSeedLike(entry);
      /* 「随机值」模式：数值由 ComfyUI 每次生成时随机化，锁定编辑并展示
       * -1（ComfyUI 约定 seed=-1 即随机）。切回其它模式恢复原值。 */
      const randomSeed = isSeed && seedMode === "random";
      const stepper = (
        <NumberField
          value={
            randomSeed
              ? -1
              : typeof value === "number"
                ? value
                : Number(value) || bounds.min
          }
          onChange={onValueChange}
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          decimalPlaces={entry.control === "float" ? bounds.decimalPlaces : 0}
          disabled={disabled || randomSeed}
        />
      );
      const seedButton = isSeed ? (
        <SeedModeButton
          mode={seedMode}
          onPick={(mode) => onSeedModeChange?.(mode)}
        />
      ) : null;

      if (compact) {
        /* 步进器封顶 180px：4 位整数仍放得下（8.0 + 两个按钮 ≈ 150px），
         * 余下的卡片宽度留给标签列，避免「宽度 / 高度 / 步数」被截断。 */
        return (
          <div className="flex items-center gap-1.5">
            <div className="max-w-[180px] min-w-[120px]">{stepper}</div>
            {seedButton}
          </div>
        );
      }
      return (
        <div className={isSeed ? "mt-1 flex items-center gap-1.5" : "mt-1"}>
          <div className={isSeed ? "flex-1" : undefined}>{stepper}</div>
          {seedButton}
        </div>
      );
    }

    case "switch":
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onValueChange(!value)}
          className={`nodrag nopan ${compact ? "h-[28px] px-2.5" : "mt-1 h-[30px] px-3"} bg-canvas-deep flex w-full items-center justify-between rounded-md text-[12px] transition-colors ${
            value ? "text-emerald-700 dark:text-emerald-200" : "text-ink-muted"
          } ${missingRequired ? "ring-1 ring-red-400/50" : ""}`}
        >
          <span>{value ? "开启" : "关闭"}</span>
          <span
            className={`relative h-3.5 w-7 rounded-full transition-colors ${
              value ? "bg-emerald-400/70" : "bg-surface-2"
            }`}
          >
            <span
              className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all"
              style={{ left: value ? 14 : 3 }}
            />
          </span>
        </button>
      );

    case "image":
      return (
        <button
          type="button"
          className={`nodrag nopan ${compact ? "h-[28px] w-full" : "mt-1 py-1.5"} bg-canvas-deep text-ink-soft hover:text-ink-bright inline-flex items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors ${
            missingRequired ? "ring-1 ring-red-400/50" : ""
          }`}
          disabled={disabled || uploading}
          onClick={onPickFile}
        >
          {uploading
            ? "上传中…"
            : typeof value === "string" && value
              ? `已选：${value}`
              : `上传 ${label}${requiredHint}`}
        </button>
      );

    case "select":
      return (
        <DarkSelect
          value={typeof value === "string" ? value : ""}
          onChange={onValueChange}
          options={Array.isArray(entry.options) ? entry.options : []}
          disabled={disabled}
          placeholder={`选择 ${label}${requiredHint}`}
          className={`w-full ${compact ? "" : "mt-1"} ${
            missingRequired ? "rounded-md ring-1 ring-red-400/50" : ""
          }`}
          popoverMinWidth={compact ? 220 : 260}
        />
      );

    default:
      return null;
  }
}
