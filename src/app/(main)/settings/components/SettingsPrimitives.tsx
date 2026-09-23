"use client";

/**
 * 设置页共用的展示原语（规范 17 §17.2 第③层）。
 *
 * 只做样式与结构，不含业务：卡片外壳、受控输入、主按钮、ANSI 日志文本、
 * 字段图片预览。原先内联在 `SettingsPageView.tsx` 底部（约 145 行），
 * 拆出后各分区视图共用同一份实现，避免复制样式类。
 */

import type { AnsiSegment, AnsiStyleKey } from "~/lib/log/log-ansi";
import { textHandler } from "~/lib/form-props";
import { isPreviewableUrl } from "~/lib/llm/usage-test-config";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { FormField } from "~/components/ui/form-field";

import { statusButtonClass } from "../settings-status-row-config";

/* ── 启动日志 ANSI 颜色渲染 ─────────────────────────────────
 * 纯映射：lib/log-ansi 解析出的样式键 → tailwind class，无业务逻辑。
 * 未知样式键回退默认色，保证新增键不会渲染成透明文本。 */
const ANSI_STYLE_CLASS: Record<AnsiStyleKey, string> = {
  bold: "font-bold",
  dim: "opacity-60",
  italic: "italic",
  underline: "underline",
  red: "text-red-600 dark:text-red-400",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-yellow-600 dark:text-yellow-300",
  blue: "text-blue-600 dark:text-blue-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  cyan: "text-cyan-700 dark:text-cyan-300",
  white: "text-ink-bright",
  gray: "text-ink-muted",
  "red-bright": "text-red-700 dark:text-red-300",
  "green-bright": "text-green-700 dark:text-green-300",
  "yellow-bright": "text-yellow-700 dark:text-yellow-200",
  "blue-bright": "text-blue-700 dark:text-blue-300",
  "magenta-bright": "text-fuchsia-700 dark:text-fuchsia-300",
  "cyan-bright": "text-cyan-800 dark:text-cyan-200",
  "white-bright": "text-ink-bright",
  "red-bg": "bg-red-500/15 dark:bg-red-900/60",
  "green-bg": "bg-green-500/15 dark:bg-green-900/60",
  "yellow-bg": "bg-yellow-500/15 dark:bg-yellow-800/60",
  "blue-bg": "bg-blue-500/15 dark:bg-blue-900/60",
  "magenta-bg": "bg-fuchsia-500/15 dark:bg-fuchsia-900/60",
  "cyan-bg": "bg-cyan-500/15 dark:bg-cyan-900/60",
  "white-bg": "bg-subtle",
};

export function AnsiLogText({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.styles && seg.styles.length > 0 ? (
          <span
            key={i}
            className={seg.styles
              .map((style) => ANSI_STYLE_CLASS[style])
              .filter(Boolean)
              .join(" ")}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border-subtle bg-surface-1 dark:bg-surface-1/60 rounded-2xl border p-5 shadow-sm shadow-black/5 backdrop-blur dark:shadow-none dark:shadow-black/2">
      <h2 className="text-ink mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
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

/**
 * 状态行主按钮 —— `ui/button` 的基元 + 本页的排布契约（ISSUE #672 P1）。
 *
 * 这里此前是第二个 `<button>` 实现（自拼尺寸类 + 自拼配色）。现在底子是
 * `ui/button`：配色由 `variant`（`primary-solid` 等语义变体）决定，本模块只
 * 负责把状态行的**排布契约**（`statusButtonClass`：不许换行 / 不许被 flex 压
 * 扁 / 行框归位，见 ISSUE #423）叠上去。
 *
 * 三条覆盖类与工作流编辑器顶栏同一口径（规范 §16.2.4.2 第 3、4 条）：
 *   · `h-auto px-4 py-2` —— 高度与横向内边距归还给本页（基元 `h-8 px-2.5`）；
 *   · `font-semibold`     —— 状态行动作的权重比基元默认高一档；
 *   · `rounded-lg`        —— 与状态行外框同一档圆角。
 * `cn()` 走 tailwind-merge，同一属性后面的类赢，因此覆盖串必须排在最后。
 */
export function StatusButton({
  onClick,
  disabled,
  children,
  className,
  variant = "primary-solid",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={statusButtonClass(
        `h-auto rounded-lg px-4 py-2 font-semibold ${className ?? ""}`,
      )}
    >
      {children}
    </Button>
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
        <p className="text-muted-foreground/70 max-h-24 overflow-hidden rounded-md border border-dashed px-2 py-1 text-[11px] leading-relaxed">
          该地址无法作为图片预览（可能被防盗链、需登录，或非图片地址）。点击行内「链接」替换，或用「上传」选本地图片。
        </p>
      }
    />
  );
}

/** 值是可尝试预览的 URL —— 供调用方决定是否渲染 `FieldImagePreview`。 */
export { isPreviewableUrl };
