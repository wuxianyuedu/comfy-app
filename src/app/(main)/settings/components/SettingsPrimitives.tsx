"use client";

/**
 * 设置页共用的展示原语（规范 17 §17.2 第③层）：卡片外壳、受控输入、主按钮、字段图片预览；只做样式与结构。
 * ANSI 日志着色在 `~/components/studio/logs/AnsiLogText`：其消费者被侧栏共用，
 * 留在这里会形成「共用部件 → 某屏展示原语」的反向依赖。
 */

import { textHandler } from "~/lib/form-props";
import { isPreviewableUrl } from "~/lib/llm/usage-test-config";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { FormField } from "~/components/ui/form-field";

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  /* 标签 / 控件 / ARIA 关联走 `ui/form-field` + shadcn `ui/input`
   * （规范 §16.2.4.26 / §16.2.3）：裸 `<label>` 无 htmlFor（不聚焦、读屏孤立），
   * 裸 `<input>` 的 UA focus ring 会与自定义 border 叠成双层紫。
   * className 覆盖 shadcn 默认回本页深色档：`h-auto` 让 py-2 定高、`bg-surface-2`
   * 深色底、文字与 placeholder 走项目色板。 */
  return (
    <FormField className="mb-3" label={label}>
      {(a11y) => (
        <Input
          {...a11y}
          className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
          onChange={textHandler(onChange)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      )}
    </FormField>
  );
}

/* 图片预览：值是可尝试 URL（http(s)/data:image）才渲染图；加载失败
 *（防盗链 / 需要登录态 / 不是图片 / 网络问题）时降级成一行说明，而不是
 * 破图占位或完全空白。失败态本身由 `MediaThumbnail` 收着，这里只提供
 * **本落点要的文案**（给用户可行动作），不再自持一份 `useState(failed)`。 */
export function FieldImagePreview({ src }: { src: string }) {
  return (
    <MediaThumbnail
      alt="字段图片预览"
      className="border-border/60 max-h-24 w-fit rounded-md border"
      fallback={
        <p className="text-muted-foreground/70 text-2xs max-h-24 overflow-hidden rounded-md border border-dashed px-2 py-1 leading-relaxed">
          该地址无法作为图片预览（可能被防盗链、需登录，或非图片地址）。点击行内「链接」替换，或用「上传」选本地图片。
        </p>
      }
      src={src}
    />
  );
}

/** 值是可尝试预览的 URL —— 供调用方决定是否渲染 `FieldImagePreview`。 */
export { isPreviewableUrl };
