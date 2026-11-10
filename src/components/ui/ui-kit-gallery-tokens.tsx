"use client";

import { cn } from "~/lib/utils";
import { GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * token 墙（ISSUE #3525）：把界面里最常出错的语义 token 两态取值直接摆出来。
 *
 * 每一枚色票都走 Tailwind 语义类（不写死色值，`theme:check` 的硬闸面），
 * 标签写 token 名 —— 发现「某个控件颜色不对」时，先在这里确认 token 本身的
 * 两态取值是否正常，再回头查调用点有没有写错档。
 * 只收结构面（表面 / 文字 / 边框 / 品牌 / 状态）—— 画布内部件（node / port /
 * edge 一族）的颜色是内容色不是表面色，不在这页的量程里。
 */

type SwatchItem = {
  /** 演示类名（一组语义类，允许带透明度档）。 */
  className: string;
  label: string;
};

const SURFACES: Array<SwatchItem> = [
  { className: "bg-bg", label: "bg-bg" },
  { className: "bg-surface", label: "bg-surface" },
  { className: "bg-surface-1", label: "bg-surface-1" },
  { className: "bg-surface-2", label: "bg-surface-2" },
  { className: "bg-surface-row", label: "bg-surface-row" },
  { className: "bg-card", label: "bg-card" },
  { className: "bg-subtle", label: "bg-subtle" },
  { className: "bg-canvas", label: "bg-canvas" },
  { className: "bg-canvas-deep", label: "bg-canvas-deep" },
  { className: "bg-panel", label: "bg-panel" },
];

const INKS: Array<SwatchItem> = [
  { className: "text-ink-strong", label: "text-ink-strong" },
  { className: "text-ink", label: "text-ink" },
  { className: "text-ink-soft", label: "text-ink-soft" },
  { className: "text-ink-muted", label: "text-ink-muted" },
  { className: "text-ink-faint", label: "text-ink-faint" },
  { className: "text-ink-fainter", label: "text-ink-fainter" },
];

const BORDERS: Array<SwatchItem> = [
  { className: "border-border", label: "border-border" },
  { className: "border-border-subtle", label: "border-border-subtle" },
  { className: "border-border-strong", label: "border-border-strong" },
  { className: "border-input", label: "border-input" },
];

const BRAND: Array<SwatchItem> = [
  { className: "bg-primary text-on-brand", label: "bg-primary / on-brand" },
  { className: "bg-primary-hover text-on-brand", label: "bg-primary-hover" },
  { className: "bg-primary-soft text-primary-strong", label: "bg-primary-soft" },
  { className: "bg-accent text-on-brand", label: "bg-accent" },
  { className: "bg-accent-soft text-primary-strong", label: "bg-accent-soft" },
];

const STATUS: Array<SwatchItem> = [
  { className: "bg-success text-on-brand", label: "bg-success" },
  { className: "bg-success/10 text-success-strong", label: "success / 10 档" },
  { className: "bg-warning text-on-brand", label: "bg-warning" },
  { className: "bg-warning-soft text-warning-strong", label: "bg-warning-soft" },
  { className: "bg-destructive text-white", label: "bg-destructive" },
  { className: "bg-destructive/10 text-danger-strong", label: "destructive / 10 档" },
  { className: "bg-info text-on-brand", label: "bg-info" },
  { className: "bg-info/10 text-info-strong", label: "info / 10 档" },
];

function Swatch({ item }: { item: SwatchItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className={cn(
          "flex h-11 items-center justify-center rounded-lg border border-border px-2 text-xs",
          item.className,
        )}
      >
        <span className="truncate">控件文字</span>
      </div>
      <span className="text-ink-faint text-2xs truncate font-mono">{item.label}</span>
    </div>
  );
}

/** 文字 token 的色票：字色直接渲染在卡片底上，看对比度一排读完。 */
function InkSwatch({ item }: { item: SwatchItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className={cn("truncate text-sm", item.className)}>界面文字 Aa 12</p>
      <span className="text-ink-faint text-2xs truncate font-mono">{item.label}</span>
    </div>
  );
}

/** 边框 token 的色票：2px 描边画在卡片底上，混没混掉一眼可见。 */
function BorderSwatch({ item }: { item: SwatchItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={cn("h-11 rounded-lg border-2 bg-card", item.className)} />
      <span className="text-ink-faint text-2xs truncate font-mono">{item.label}</span>
    </div>
  );
}

export function TokenWall() {
  return (
    <GallerySection
      note="两态各看一遍：某枚 token 在其中一态下和承载面混掉，就是错档。"
      title="语义 token 墙"
    >
      <GalleryGrid>
        {SURFACES.map((item) => (
          <Swatch item={item} key={item.label} />
        ))}
      </GalleryGrid>
      <div className="border-border-subtle mt-6 border-t pt-5">
        <GalleryGrid>
          {INKS.map((item) => (
            <InkSwatch item={item} key={item.label} />
          ))}
        </GalleryGrid>
      </div>
      <div className="border-border-subtle mt-6 border-t pt-5">
        <GalleryGrid>
          {BORDERS.map((item) => (
            <BorderSwatch item={item} key={item.label} />
          ))}
        </GalleryGrid>
      </div>
      <div className="border-border-subtle mt-6 border-t pt-5">
        <GalleryGrid>
          {BRAND.map((item) => (
            <Swatch item={item} key={item.label} />
          ))}
        </GalleryGrid>
      </div>
      <div className="border-border-subtle mt-6 border-t pt-5">
        <GalleryGrid>
          {STATUS.map((item) => (
            <Swatch item={item} key={item.label} />
          ))}
        </GalleryGrid>
      </div>
    </GallerySection>
  );
}
