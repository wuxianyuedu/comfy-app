"use client";

// 单个 widget 控件（text / textarea / number / switch / image / select）。
// 纯展示：值由外部传入，变更通过 onValueChange 上抛。compact 走画布节点的
// 压缩尺寸，宽版走 CreatePanel / IO-edit 预览的尺寸。

import { isInputFilled, numericBounds, type EnrichedWidget } from "~/components/studio/workflow-io";
import {
  AutoResizeTextarea,
  isSeedLike,
  SeedModeButton,
} from "~/components/studio/workflow-form/WorkflowFormControls";
import { Button } from "~/components/ui/button";
import { textHandler } from "~/lib/form-props";
import { SelectMenu } from "~/components/ui/select-menu";
import { NumberField } from "~/components/ui/number-field";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { mediaPreviewUrl, mediaReferenceFilename } from "~/lib/media/media-url";
import { inputCls } from "../constants";

type WidgetControlProps = {
  compact: boolean;
  disabled: boolean;
  entry: EnrichedWidget;
  /** 行标签 —— 参与 placeholder（输入 / 选择 / 上传 + 必填后缀）。 */
  label: string;
  onPickFile: () => void;
  onSeedModeChange?: (mode: string) => void;
  onValueChange: (value: unknown) => void;
  /** 用户刚选过这张图时的本地预览地址（data URL）；有则优先于按值算的 ComfyUI 代理地址。 */
  previewSrc?: string;
  seedMode?: string;
  /** 该行正在上传（image 行显示「上传中…」）。 */
  uploading: boolean;
  value: unknown;
};

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
  previewSrc,
}: WidgetControlProps) {
  /* 标记必填但仍为空 → 红框，提醒作者补齐后再发布。 */
  const missingRequired = entry.required === true && !isInputFilled(value);
  const requiredHint = entry.required === true ? "（必填）" : "";

  switch (entry.control) {
    case "textarea": {
      const placeholder = `输入 ${label}${requiredHint}`;
      if (compact) {
        return (
          <AutoResizeTextarea
            maxHeight={80}
            minHeight={28}
            onChange={onValueChange}
            placeholder={placeholder}
            value={typeof value === "string" ? value : ""}
          />
        );
      }
      return (
        <textarea
          aria-label={`${label}${requiredHint}`}
          className={`${inputCls} mt-1.5 min-h-13 ${missingRequired ? "ring-destructive/50 ring-1" : ""}`}
          disabled={disabled}
          onChange={textHandler(onValueChange)}
          placeholder={placeholder}
          rows={4}
          value={typeof value === "string" ? value : ""}
        />
      );
    }

    case "text": {
      return (
        <input
          aria-label={`${label}${requiredHint}`}
          className={`${inputCls} ${compact ? "" : "mt-1"} ${missingRequired ? "border-destructive/50" : ""}`}
          disabled={disabled}
          onChange={textHandler(onValueChange)}
          placeholder={`输入 ${label}${requiredHint}`}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        />
      );
    }

    case "int":
    case "float": {
      const bounds = numericBounds(entry);
      const isSeed = compact && isSeedLike(entry);
      /* 「随机值」模式：数值由 ComfyUI 每次生成时随机化，锁定编辑并展示
       * -1（ComfyUI 约定 seed=-1 即随机）。切回其它模式恢复原值。 */
      const randomSeed = isSeed && seedMode === "random";
      const stepper = (
        <NumberField
          decimalPlaces={entry.control === "float" ? bounds.decimalPlaces : 0}
          disabled={disabled || randomSeed}
          max={bounds.max}
          min={bounds.min}
          onChange={onValueChange}
          step={bounds.step}
          value={randomSeed ? -1 : typeof value === "number" ? value : Number(value) || bounds.min}
        />
      );
      const seedButton = isSeed ? (
        <SeedModeButton mode={seedMode} onPick={(mode) => onSeedModeChange?.(mode)} />
      ) : null;

      if (compact) {
        /* 步进器封顶 180px：4 位整数仍放得下（8.0 + 两个按钮 ≈ 150px），
         * 余下的卡片宽度留给标签列，避免「宽度 / 高度 / 步数」被截断。 */
        return (
          <div className="flex items-center gap-1.5">
            <div className="max-w-45 min-w-30">{stepper}</div>
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

    case "switch": {
      /* value 是 unknown：开关态只收一次真值，下面五处统一用它。 */
      const on = Boolean(value);
      return (
        <Button
          aria-checked={value === true}
          className={`nodrag nopan bg-canvas-deep hover:bg-canvas-deep ${compact ? "h-[28px] px-2.5" : "mt-1 h-7.5 px-3"} w-full justify-between rounded-md text-xs ${
            on ? "text-success-strong" : "text-ink-muted"
          } ${missingRequired ? "ring-destructive/50 ring-1" : ""}`}
          disabled={disabled}
          onClick={() => onValueChange(!on)}
          role="switch"
          variant="ghost"
        >
          <span>{on ? "开启" : "关闭"}</span>
          <span
            className={`relative h-3.5 w-7 rounded-full transition-colors ${
              on ? "bg-success/70" : "bg-surface-2"
            }`}
          >
            <span
              className="absolute top-0.5 size-2.5 rounded-full bg-white transition-all"
              style={{ left: on ? 14 : 3 }}
            />
          </span>
        </Button>
      );
    }

    case "image": {
      /* 文件名与预览地址都走 `~/lib/media/media-url` 的出口（§16.2.4.32）：
       *  `value` 可能是字符串文件名、ComfyUI 的 `{filename,subfolder,type}`
       *  对象或 `[filename,subfolder,type]` 数组（IMAGE 类型输入落值形态）——
       *  两个助手都吃任意形态，避免对象 / 数组被渲染成 `[object Object]` 或
       *  空掉（封装节点的 IMAGE 输入选完图「看不到图」，实测反馈）。 */
      const filename = mediaReferenceFilename(value);
      const previewUrl = previewSrc ?? mediaPreviewUrl(value);
      return (
        <div className={compact ? "" : "mt-1"}>
          <Button
            className={`nodrag nopan bg-canvas-deep hover:bg-canvas-deep text-ink-soft hover:text-ink-bright text-2xs gap-1.5 rounded-md px-2.5 ${
              compact ? "h-[28px] w-full" : "h-auto py-1.5"
            } ${missingRequired ? "ring-destructive/50 ring-1" : ""}`}
            disabled={disabled || uploading}
            onClick={onPickFile}
            variant="ghost"
          >
            {uploading
              ? "上传中…"
              : filename
                ? `已选：${filename}`
                : `上传 ${label}${requiredHint}`}
          </Button>
          {previewUrl !== null && previewUrl !== "" && (
            /* 缩略图不可点（点它等于点「换一张」是另一种语义）：换图仍走上面
               那个按钮，这里只负责把「选了哪张」显示出来。 */
            <MediaThumbnail
              alt={label}
              className="border-border bg-canvas-deep mt-1.5 max-h-32 w-full rounded-md border object-contain"
              fallback="none"
              src={previewUrl}
            />
          )}
        </div>
      );
    }

    case "select": {
      return (
        <SelectMenu
          className={`${compact ? "" : "mt-1"} ${
            missingRequired ? "ring-destructive/50 rounded-md ring-1" : ""
          }`}
          disabled={disabled}
          fullWidth
          onChange={onValueChange}
          options={Array.isArray(entry.options) ? entry.options : []}
          placeholder={`选择 ${label}${requiredHint}`}
          popoverMinWidth={compact ? 220 : 260}
          value={typeof value === "string" ? value : ""}
        />
      );
    }

    default: {
      return null;
    }
  }
}
