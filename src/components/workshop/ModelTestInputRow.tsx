"use client";

// ── 测试模型 · 统一输入的一行渲染 ─────────────────────────────────────
// 从 ModelTestView 拆出（§12.13：视图文件越过 900 行硬闸，按自包含组件切；
// 纯 props 展示层，无网络 / 无导航动作）。

import { Dices, ImagePlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField, type FormFieldA11y } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Textarea } from "~/components/ui/textarea";
import { TruncatedText } from "~/components/ui/truncated-text";
import { useDropZone } from "~/components/ui/use-drop-zone";
import { cn } from "~/lib/utils";

import { DROP_ACTIVE_CLASSES, RequiredBadge } from "./ReferenceImageField";
import type { ModelTestControl } from "./model-test-config";

/** 图片输入行（ISSUE #4975）：整行都是投放目标 —— 空值时是带虚线框与
 *  「点击或拖拽」提示的上传瓦片（可拖拽的显性标识），已有值时是缩略图 +
 *  换一张 / 清除。拖入图片与点击上传走同一条 `onPickFile` 链路；一次拖入
 *  多张（单图口只收一张）由共享漏斗 `useDropZone` 给可读错误，经 `onError`
 *  报到页面反馈位。 */
function ImageInputRow({
  a11y,
  disabled,
  label,
  onClear,
  onError,
  onPickFile,
  value,
}: {
  a11y: FormFieldA11y;
  disabled?: boolean;
  label: string;
  onClear: () => void;
  onError?: (message: string) => void;
  onPickFile?: (file: File) => void;
  value: string;
}) {
  const dropZone = useDropZone(
    (file) => {
      onPickFile?.(file);
    },
    (message) => {
      onError?.(message);
    },
  );
  /* 禁用行不接拖拽（拖着图放到禁用口上不该有任何反应）。 */
  const dragHandlers = disabled
    ? {}
    : {
        onDragEnter: dropZone.onDragEnter,
        onDragLeave: dropZone.onDragLeave,
        onDragOver: dropZone.onDragOver,
        onDrop: dropZone.onDrop,
      };
  return (
    <div
      className={cn("flex items-center gap-2 rounded-lg", dropZone.active && DROP_ACTIVE_CLASSES)}
      data-active={dropZone.active ? "true" : "false"}
      {...dragHandlers}
    >
      {value === "" ? (
        <FilePickerButton
          {...a11y}
          accept="image/*"
          className={cn(
            "border-border bg-surface-1 text-muted-foreground hover:border-primary/60 hover:text-ink-soft h-auto w-full flex-col gap-1 rounded-lg border border-dashed px-4 py-4 text-xs",
            dropZone.active && "border-primary/60 bg-primary/8 text-primary-strong",
            disabled && "pointer-events-none opacity-50",
          )}
          onPick={(file) => {
            onPickFile?.(file);
          }}
          size="sm"
          variant="outline"
        >
          <ImagePlus className="size-4" />
          <span>上传图片</span>
          <span className="text-2xs text-muted-foreground/80">点击或拖拽图片到此处</span>
        </FilePickerButton>
      ) : (
        <>
          <MediaThumbnail
            alt={`${label}预览`}
            as="image"
            className="border-border h-10 w-10 rounded-lg border object-cover"
            src={value}
          />
          <FilePickerButton
            accept="image/*"
            className="h-auto px-3 py-2 text-xs"
            disabled={disabled}
            onPick={(file) => {
              onPickFile?.(file);
            }}
            size="sm"
            variant="outline"
          >
            换一张
          </FilePickerButton>
          <Button
            aria-label={`清除${label}`}
            className="text-muted-foreground/60 hover:text-danger-strong h-auto px-2 py-1 text-xs"
            onClick={onClear}
            size="sm"
            variant="ghost"
          >
            清除
          </Button>
        </>
      )}
    </div>
  );
}

/** 一行统一输入的渲染（按类型给控件；文案 = 契约口的展示名）。行标签右侧带
 *  必填 / 可选标识（来自契约 required）。尺寸复合口由 SizeField 统一承担。 */
export function InputRow({
  control,
  disabled,
  hint,
  id,
  label,
  onChange,
  onError,
  onPickFile,
  onRandom,
  required,
  value,
}: {
  control: ModelTestControl;
  disabled?: boolean;
  hint?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  /** 拖拽上传的读数出口（一次拖入多张到单图口等）：报到页面反馈位。 */
  onError?: (message: string) => void;
  /** 图片类控件：选完文件回调（data URL 由逻辑层读）。 */
  onPickFile?: (file: File) => void;
  /** 提示词的随机按钮；给了才渲染。 */
  onRandom?: () => void;
  required: boolean;
  value: string;
}) {
  const labelNode = (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText className="truncate">{label}</TruncatedText>
      <RequiredBadge required={required} />
    </span>
  );
  if (control === "prompt" || control === "negative") {
    return (
      <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
        {(a11y) => (
          <div className="flex items-start gap-2">
            <Textarea
              {...a11y}
              className={cn(
                "border-border bg-surface-1 focus:border-primary w-full flex-1 resize-y rounded-lg border px-3 py-2 text-sm outline-none",
                disabled && "opacity-50",
              )}
              disabled={disabled}
              onChange={(e) => {
                onChange(e.target.value);
              }}
              placeholder={
                control === "prompt" ? "描述你想要生成的画面" : "不想出现的内容（可留空）"
              }
              rows={control === "prompt" ? 3 : 2}
              value={value}
            />
            {control === "prompt" && onRandom !== undefined && (
              <Button
                className="h-auto shrink-0 px-3 py-2 text-xs"
                disabled={disabled}
                onClick={onRandom}
                variant="outline"
              >
                <Dices className="size-3.5" data-icon="inline-start" />
                随机
              </Button>
            )}
          </div>
        )}
      </FormField>
    );
  }
  if (control === "image") {
    return (
      <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
        {(a11y) => (
          <ImageInputRow
            a11y={a11y}
            disabled={disabled}
            label={label}
            onClear={() => {
              onChange("");
            }}
            onError={onError}
            onPickFile={onPickFile}
            value={value}
          />
        )}
      </FormField>
    );
  }
  /* 分辨率档已并入 SizeField 的「像素」段（分辨率 · 百万像素两行）—— 这里
   * 不再有独立的分辨率 chips。duration / number / text → 单行输入。 */
  return (
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
      {(a11y) => (
        <Input
          {...a11y}
          className="border-border bg-surface-1 focus:border-primary h-auto w-48 rounded-lg px-3 py-2 text-sm"
          disabled={disabled}
          inputMode={control === "duration" || control === "number" ? "numeric" : "text"}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={control === "duration" ? "例如 5（秒）" : undefined}
          value={value}
        />
      )}
    </FormField>
  );
}
