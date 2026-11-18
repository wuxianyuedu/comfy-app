"use client";

// ── 参考图多选行（工坊通用，#4355）─────────────────────────────────────
// 从 ModelTestView（#3949 需求 6/7）抽出：一个契约口收多张参考图，请求里以
// 数组整体下发；清除按钮悬停时出现在缩略图右上角。测试页与工坊镜头生图
// （多参考图，首张为主图）共用这一份。

import { Button } from "~/components/ui/button";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField } from "~/components/ui/form-field";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { TruncatedText } from "~/components/ui/truncated-text";
import { cn } from "~/lib/utils";

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
 *  hook 把关，这里只负责展示与增删回调）。 */
export function ReferenceImageField({
  disabled,
  hint,
  id,
  images,
  label,
  onAdd,
  onRemove,
  required,
}: {
  disabled?: boolean;
  hint?: string;
  id: string;
  images: Array<string>;
  label: string;
  onAdd: (files: Array<File>) => void;
  onRemove: (index: number) => void;
  required: boolean;
}) {
  const labelNode = (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText className="truncate">{label}</TruncatedText>
      <RequiredBadge required={required} />
    </span>
  );
  return (
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
      {() => (
        <div className="flex flex-wrap items-center gap-2">
          {images.map((src, i) => (
            <div className="group relative" key={`${String(i)}-${src.slice(0, 24)}`}>
              <MediaThumbnail
                alt={`参考图 ${i + 1}`}
                as="image"
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
            className="h-auto px-3 py-2 text-xs"
            disabled={disabled}
            multiple
            onPick={(_file, files) => {
              onAdd([...files]);
            }}
            size="sm"
            variant="outline"
          >
            {images.length > 0 ? "添加图片" : "上传参考图"}
          </FilePickerButton>
        </div>
      )}
    </FormField>
  );
}
