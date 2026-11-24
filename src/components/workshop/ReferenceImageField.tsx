"use client";

// ── 参考图多选行（工坊通用，#4355）─────────────────────────────────────
// 从 ModelTestView（#3949 需求 6/7）抽出：一个契约口收多张参考图，请求里以
// 数组整体下发；清除按钮悬停时出现在缩略图右上角。测试页与工坊镜头生图
// （多参考图，首张为主图）共用这一份。

import { ImagePlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField } from "~/components/ui/form-field";
import { ViewableImage } from "~/components/ui/image-viewer";
import { TruncatedText } from "~/components/ui/truncated-text";
import { useDropZone } from "~/components/ui/use-drop-zone";
import { cn } from "~/lib/utils";

/** 拖拽悬停高亮：沿剧本投放区（WorkshopStageBody）的既有形状。测试页的
 *  参考图行与单图输入行（ModelTestInputRow）共用这一个读数。 */
export const DROP_ACTIVE_CLASSES = "outline-primary/60 outline-2 -outline-offset-2";

/** 必备 / 可选标识（ISSUE #3778 问题 2）：来自模式契约的 required 生效集。 */
export function RequiredBadge({ required }: { required: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-2xs",
        required ? "bg-primary/12 text-primary-strong" : "bg-elevated text-muted-foreground",
      )}
    >
      {required ? "必填" : "可选"}
    </span>
  );
}

/** 参考图多选行：一个契约口（reference-image）收多张（上限由调用方的
 *  hook 把关，这里只负责展示与增删回调）。整行都是投放目标：一次可拖入
 *  多张（共享漏斗 `useDropZone` 的 multiple 档，ISSUE #4975），与点选的
 *  `multiple` 同一条 `onAdd` 链路。 */
export function ReferenceImageField({
  disabled,
  hint,
  id,
  images,
  label,
  onAdd,
  onError,
  onRemove,
  required,
}: {
  disabled?: boolean;
  hint?: string;
  id: string;
  images: Array<string>;
  label: string;
  onAdd: (files: Array<File>) => void;
  /** 拖拽 / 选文件的读数出口（漏斗的 multiple 档当前没有错误路径，
   *  留作与单图口同一形状的反馈通道）。 */
  onError?: (message: string) => void;
  onRemove: (index: number) => void;
  required: boolean;
}) {
  const dropZone = useDropZone(
    /* multiple 档整批走 onFiles；这个单文件回调只是漏斗的必填占位。 */
    (file) => {
      onAdd([file]);
    },
    (message) => {
      onError?.(message);
    },
    {
      multiple: true,
      onFiles: (files) => {
        onAdd(files);
      },
    },
  );
  /* 禁用行不接拖拽。 */
  const dragHandlers = disabled
    ? {}
    : {
        onDragEnter: dropZone.onDragEnter,
        onDragLeave: dropZone.onDragLeave,
        onDragOver: dropZone.onDragOver,
        onDrop: dropZone.onDrop,
      };
  const labelNode = (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText className="truncate">{label}</TruncatedText>
      <RequiredBadge required={required} />
    </span>
  );
  return (
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
      {() => (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg",
            dropZone.active && DROP_ACTIVE_CLASSES,
          )}
          data-active={dropZone.active ? "true" : "false"}
          {...dragHandlers}
        >
          {images.map((src, i) => (
            <div className="group relative" key={`${String(i)}-${src.slice(0, 24)}`}>
              {/* 点开进图片查看器（ISSUE #4840）：看细节（构图 / 文字 / 姿态）；
                  键盘可达（缩略图是按钮）。 */}
              <ViewableImage
                alt={`参考图 ${i + 1}`}
                className="border-border size-16 rounded-lg border object-cover"
                src={src}
              />
              {/* 清除按钮：悬停才出现在缩略图右上角（#3949 需求 7）。 */}
              <Button
                aria-label={`移除第 ${i + 1} 张参考图`}
                className="text-2xs absolute top-1 right-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 leading-none text-white group-hover:block"
                onClick={() => {
                  onRemove(i);
                }}
                size="sm"
                variant="ghost"
              >
                ✕
              </Button>
            </div>
          ))}
          <FilePickerButton
            accept="image/*"
            className={cn(
              "border-border bg-surface-1 text-muted-foreground hover:border-primary/60 hover:text-ink-soft h-auto flex-col gap-1 rounded-lg border border-dashed px-4 py-3 text-xs",
              dropZone.active && "border-primary/60 bg-primary/8 text-primary-strong",
              disabled && "pointer-events-none opacity-50",
            )}
            disabled={disabled}
            multiple
            onPick={(_file, files) => {
              onAdd([...files]);
            }}
            size="sm"
            variant="outline"
          >
            <ImagePlus className="size-4" />
            <span className="flex flex-col items-center">
              <span>{images.length > 0 ? "添加图片" : "上传参考图"}</span>
              {images.length === 0 && (
                <span className="text-2xs text-muted-foreground/80">点击或拖拽图片到此处</span>
              )}
            </span>
          </FilePickerButton>
        </div>
      )}
    </FormField>
  );
}
