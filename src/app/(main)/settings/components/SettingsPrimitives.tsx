"use client";

/**
 * 设置页共用的展示原语（规范 17 §17.2 第③层）。
 *
 * 只做样式与结构，不含业务：卡片外壳、受控输入、主按钮、ANSI 日志文本、
 * 字段图片预览。原先内联在 `SettingsPageView.tsx` 底部（约 145 行），
 * 拆出后各分区视图共用同一份实现，避免复制样式类。
 */

import { useState } from "react";

import type { AnsiSegment, AnsiStyleKey } from "~/lib/log/log-ansi";
import { isPreviewableUrl } from "~/lib/llm/usage-test-config";

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
  return (
    <div className="mb-3">
      <label className="text-ink/80 mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
      />
    </div>
  );
}

export function Btn({
  onClick,
  disabled,
  children,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={statusButtonClass(
        `bg-primary hover:bg-primary-hover text-white disabled:opacity-50 ${className ?? ""}`,
      )}
    >
      {children}
    </button>
  );
}

/* 图片预览：值是可尝试 URL（http(s)/data:image）才渲染 <img>；加载失败
 *（防盗链 / 需要登录态 / 不是图片 / 网络问题）时降级成一行说明，而不是
 * 破图占位或完全空白——用 isPreviewableUrl 放开入口，交由 onError 兜底。 */
export function FieldImagePreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="text-muted-foreground/70 max-h-24 overflow-hidden rounded-md border border-dashed px-2 py-1 text-[11px] leading-relaxed">
        该地址无法作为图片预览（可能被防盗链、需登录，或非图片地址）。点击行内「链接」替换，或用「上传」选本地图片。
      </p>
    );
  }
  return (
    <img
      src={src}
      alt="字段图片预览"
      onError={() => setFailed(true)}
      className="border-border/60 max-h-24 w-fit rounded-md border"
    />
  );
}

/** 值是可尝试预览的 URL —— 供调用方决定是否渲染 `FieldImagePreview`。 */
export { isPreviewableUrl };
