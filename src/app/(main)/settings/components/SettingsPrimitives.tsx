"use client";

/**
 * 设置页共用的展示原语（规范 17 §17.2 第③层）。
 *
 * 只做样式与结构，不含业务：卡片外壳、受控输入、主按钮、字段图片预览。
 * 原先内联在 `SettingsPageView.tsx` 底部（约 145 行），拆出后各分区视图共用
 * 同一份实现，避免复制样式类。
 *
 * ANSI 日志着色（`AnsiLogText`）刚从本模块搬走 —— 它的消费者是「运行日志框」
 * 而那个部件现在被侧栏的 ComfyUI 页共用，留在设置页这一侧就成了一条
 * 「共用部件 → 某个屏的展示原语」的反向依赖。新家：
 * `~/components/studio/logs/AnsiLogText`。
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
  /* 标签 / 控件 / ARIA 关联走 `ui/form-field`（规范 16 §16.2.4.26）；
   * 控件本体走 `ui/input`（shadcn Input、§16.2.3 / §12.18 · P67 f 治理）。
   * 收口前这里的 `<label>` 是裸的 —— 点标签不聚焦输入框、读屏器把标签读成
   * 孤立文本（全库 15 处表单行**没有一处**关联过 `htmlFor`）；控件也是裸
   * `<input>` + `focus:border-primary` —— Chrome 的 UA focus ring 与自定义
   * border 叠加成「双层紫」（设置页「全局默认温度」那格最明显）。换成
   * shadcn `<Input>` 之后焦点档走 `focus-visible:border-ring +
   * focus-visible:ring-3 focus-visible:ring-ring/50`（同一 --ring token、
   * 只在键盘聚焦时出现），视觉是一层协调的 ring、不再叠 UA ring。
   *
   * className 覆盖 shadcn Input 默认（`h-8 bg-transparent border-input
   * px-2.5 py-1 text-base md:text-sm`）回到本页深色档：`h-auto` 让 py-2
   * 决定高度、`bg-surface-2` 深色底、`border-border` 与本页其它控件同色系、
   * `text-ink` / `placeholder:text-muted-foreground/60` 走项目色板。 */
  return (
    <FormField label={label} className="mb-3">
      {(a11y) => (
        <Input
          {...a11y}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={textHandler(onChange)}
          className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-primary/30 h-auto rounded-lg px-3 py-2 text-sm"
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
      src={src}
      alt="字段图片预览"
      className="border-border/60 max-h-24 w-fit rounded-md border"
      fallback={
        <p className="text-muted-foreground/70 text-2xs max-h-24 overflow-hidden rounded-md border border-dashed px-2 py-1 leading-relaxed">
          该地址无法作为图片预览（可能被防盗链、需登录，或非图片地址）。点击行内「链接」替换，或用「上传」选本地图片。
        </p>
      }
    />
  );
}

/** 值是可尝试预览的 URL —— 供调用方决定是否渲染 `FieldImagePreview`。 */
export { isPreviewableUrl };
