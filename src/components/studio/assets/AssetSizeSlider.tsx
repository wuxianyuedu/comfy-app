"use client";

/**
 * `AssetSizeSlider` — 内容区右下角**悬浮**的大小滑块（ISSUE #4868）：
 * 拖动或点 ± 在三档列宽间切换（大图 2 列 / 标准 4 列 / 小图 6 列）。
 * 与 Eagle 的角落缩放同形：浮在网格之上、不随滚动消失（挂在与网格同一
 * 滚动容器里），选择被本地记忆（见 `use-asset-library`）。
 */
import { Minus, Plus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { clamp } from "~/lib/clamp";
import { cn } from "~/lib/utils";

import { ASSET_SIZE_PRESETS, type AssetSizeKey } from "./asset-categories";

/** 档位顺序（显式列出，不走 Object.keys + 断言）。 */
const SIZE_ORDER: Array<AssetSizeKey> = ["large", "standard", "small"];

export function AssetSizeSlider({
  className,
  onChange,
  size,
}: {
  className?: string;
  onChange: (size: AssetSizeKey) => void;
  size: AssetSizeKey;
}) {
  const index = SIZE_ORDER.indexOf(size);
  const step = (direction: 1 | -1) => {
    const next = SIZE_ORDER[clamp(index + direction, 0, SIZE_ORDER.length - 1)];
    if (next !== undefined && next !== size) {
      onChange(next);
    }
  };
  return (
    <div
      aria-label="调整资产卡片大小"
      className={cn(
        "bg-surface border-border-subtle shadow-black/20 absolute right-6 bottom-6 z-canvas-ui flex h-9 items-center gap-2 rounded-full border px-2.5 shadow-lg",
        className,
      )}
      role="group"
    >
      <Button
        aria-label="缩小卡片"
        className="text-ink-faint hover:text-ink-strong size-6 rounded-full"
        disabled={index === 0}
        onClick={() => {
          step(-1);
        }}
        size="icon-xs"
        variant="ghost"
      >
        <Minus aria-hidden data-icon="inline-start" size={13} />
      </Button>
      <input
        aria-label="卡片大小"
        aria-valuemax={SIZE_ORDER.length - 1}
        aria-valuemin={0}
        aria-valuenow={index}
        aria-valuetext={ASSET_SIZE_PRESETS[size].label}
        className="w-24 cursor-pointer"
        max={SIZE_ORDER.length - 1}
        min={0}
        onChange={(event) => {
          const next = SIZE_ORDER[Number(event.target.value)];
          if (next !== undefined) {
            onChange(next);
          }
        }}
        step={1}
        style={{ accentColor: "var(--color-primary)" }}
        type="range"
        value={index}
      />
      <Button
        aria-label="放大卡片"
        className="text-ink-faint hover:text-ink-strong size-6 rounded-full"
        disabled={index === SIZE_ORDER.length - 1}
        onClick={() => {
          step(1);
        }}
        size="icon-xs"
        variant="ghost"
      >
        <Plus aria-hidden data-icon="inline-start" size={13} />
      </Button>
    </div>
  );
}
