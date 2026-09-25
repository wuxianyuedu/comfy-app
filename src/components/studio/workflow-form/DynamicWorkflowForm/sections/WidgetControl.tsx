"use client";

// 单个 widget 控件（text / textarea / number / switch / image / select）。
// 纯展示：值由外部传入，变更通过 onValueChange 上抛。compact 走画布节点的
// 压缩尺寸，宽版走 CreatePanel / IO-edit 预览的尺寸。

import {
  isInputFilled,
  numericBounds,
  type EnrichedWidget,
} from "~/components/studio/workflow-io";
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
  /** 用户刚选过这张图时的本地预览地址（data URL）；有则优先于按值算的 ComfyUI 代理地址。 */
  previewSrc?: string;
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
  previewSrc,
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
          onChange={textHandler(onValueChange)}
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
          onChange={textHandler(onValueChange)}
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
        <Button
          variant="ghost"
          role="switch"
          aria-checked={value === true}
          disabled={disabled}
          onClick={() => onValueChange(!value)}
          className={`nodrag nopan bg-canvas-deep hover:bg-canvas-deep ${compact ? "h-[28px] px-2.5" : "mt-1 h-[30px] px-3"} w-full justify-between rounded-md text-[12px] ${
            value ? "text-success-strong" : "text-ink-muted"
          } ${missingRequired ? "ring-destructive/50 ring-1" : ""}`}
        >
          <span>{value ? "开启" : "关闭"}</span>
          <span
            className={`relative h-3.5 w-7 rounded-full transition-colors ${
              value ? "bg-success/70" : "bg-surface-2"
            }`}
          >
            <span
              className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all"
              style={{ left: value ? 14 : 3 }}
            />
          </span>
        </Button>
      );

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
            variant="ghost"
            className={`nodrag nopan bg-canvas-deep hover:bg-canvas-deep text-ink-soft hover:text-ink-bright gap-1.5 rounded-md px-2.5 text-[11px] ${
              compact ? "h-[28px] w-full" : "h-auto py-1.5"
            } ${missingRequired ? "ring-destructive/50 ring-1" : ""}`}
            disabled={disabled || uploading}
            onClick={onPickFile}
          >
            {uploading
              ? "上传中…"
              : filename
                ? `已选：${filename}`
                : `上传 ${label}${requiredHint}`}
          </Button>
          {previewUrl && (
            /* 缩略图不可点（点它等于点「换一张」是另一种语义）：换图仍走上面
               那个按钮，这里只负责把「选了哪张」显示出来。 */
            <MediaThumbnail
              src={previewUrl}
              alt={label}
              fallback="none"
              className="border-border bg-canvas-deep mt-1.5 max-h-32 w-full rounded-md border object-contain"
            />
          )}
        </div>
      );
    }

    case "select":
      return (
        <SelectMenu
          value={typeof value === "string" ? value : ""}
          onChange={onValueChange}
          options={Array.isArray(entry.options) ? entry.options : []}
          disabled={disabled}
          placeholder={`选择 ${label}${requiredHint}`}
          fullWidth
          className={`${compact ? "" : "mt-1"} ${
            missingRequired ? "rounded-md ring-1 ring-red-400/50" : ""
          }`}
          popoverMinWidth={compact ? 220 : 260}
        />
      );

    default:
      return null;
  }
}
