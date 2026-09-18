"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

/** Seed modes — ComfyUI `control_after_generate` mapping.  Each entry has the
 *  ComfyUI value, the Chinese label, and a two-line description used in the
 *  popover (mirrors the Ardot "控件后行为" 4-option panel). */
const SEED_MODES: { value: string; label: string; hint: string }[] = [
  { value: "fixed", label: "固定值", hint: "数值不变" },
  { value: "increment", label: "递增值", hint: "数值+1 或切换到下一个选项" },
  { value: "decrement", label: "递减值", hint: "数值-1 或切换到上一个选项" },
  { value: "random", label: "随机值", hint: "每次运行后随机化该值" },
];

/** Seed-like widget input? (KSampler / custom node seed pins). */

export function isSeedLike(e: { name: string; label?: string }): boolean {
  return /seed|noise_seed/i.test(`${e.name} ${e.label ?? ""}`);
}

/** Inline glyph for the seed-mode popover (Ardot 4-option panel).
 *  Geometric, no font dependency — drawn with SVG inside a 36×36 box with
 *  the same dark fill as the WorkflowChipRow chips.
 *
 *  配色（`#FF6B6B` / `#67E89D` / 深底 `#16161C` 等）属**类型色例外**
 *  （规范 03 §3.6.1）：色值即「哪一种 seed 行为」的语义，不是表面色，
 *  已逐条登记在 `scripts/check-theme-colors.cjs` 的 `EXEMPT_TABLES`。 */
function SeedModeIcon({ value }: { value: string }) {
  // 36x36 viewBox, ~22x22 glyph centered.
  if (value === "fixed") {
    // 📌 Pin (rounded square cap + diagonal stem with dot).
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M11 2.5L13.5 7L19 7.5L15 11.5L15.5 18L11 14.5L6.5 18L7 11.5L3 7.5L8.5 7L11 2.5Z"
          fill="var(--color-seed-fixed)"
        />
      </svg>
    );
  }
  if (value === "increment") {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M11 4.5V17.5"
          stroke="var(--color-seed-step)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M6 9.5L11 4.5L16 9.5"
          stroke="var(--color-seed-step)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (value === "decrement") {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M11 17.5V4.5"
          stroke="var(--color-seed-step)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M6 12.5L11 17.5L16 12.5"
          stroke="var(--color-seed-step)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // random (dice)
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="2.5"
        y="2.5"
        width="17"
        height="17"
        rx="3.5"
        fill="var(--color-seed-dice-bg)"
        stroke="var(--color-seed-dice-stroke)"
        strokeWidth="1.2"
      />
      <circle cx="7" cy="7" r="1.4" fill="var(--color-seed-dice-pip)" />
      <circle cx="15" cy="7" r="1.4" fill="var(--color-seed-dice-pip)" />
      <circle cx="11" cy="11" r="1.4" fill="var(--color-seed-dice-pip)" />
      <circle cx="7" cy="15" r="1.4" fill="var(--color-seed-dice-pip)" />
      <circle cx="15" cy="15" r="1.4" fill="var(--color-seed-dice-pip)" />
    </svg>
  );
}

/** Clickable seed-mode chip (canvas node → inline on numeric/seed row).
 *  Click toggles a 4-option "控件后行为" popover aligned with the Ardot
 *  design (dark card, icon + title + hint, radio dot on the right).  Picking
 *  an option calls `onPick` which the canvas layer writes back to the
 *  node's `seedModes` map.
 *
 *  浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里自搓了
 *  `createPortal` + 手写 fixed 定位（`placeFloating`）+ 遮罩 + 滚动重定位 +
 *  手写 Esc。为什么当时非 portal 不可 —— 面板长在 React Flow 节点里，而节点用
 *  `position:absolute + transform:translate3d(...)` 建了层叠上下文，`z-40`
 *  也会被别的节点盖住（ISSUE #349 记录的现象）。`ui/popover` 本身就是
 *  portal 到 body 的，这条约束由基元天然满足；视口翻转（#349：seed 行是表单
 *  最后一行，向下弹会把最后一项推出视口）改由 base-ui 的 Positioner 的
 *  `collisionAvoidance.side = 'flip'` 承担。
 */
export function SeedModeButton({
  mode,
  onPick,
}: {
  mode: string | undefined;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current =
    SEED_MODES.find((item) => item.value === mode)?.label ?? "固定值";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="控件后行为 · CONTROL AFTER GENERATE"
        render={
          <Button
            variant="outline"
            className="nodrag nopan border-border-strong bg-canvas-deep text-ink-soft hover:bg-canvas-deep hover:border-primary/40 hover:text-ink-bright focus-visible:border-primary/40 h-auto shrink-0 gap-1 rounded-md px-2 py-0 text-[11px] font-medium"
          />
        }
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={8} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        /* 面板自身滚动：窗口再矮也不会把最后一个选项推出视口（基元负责
           `max-height` 与翻转，这里只给形态）。 */
        className="nodrag nopan border-border-strong bg-card w-[280px] gap-0 overflow-hidden rounded-xl border p-3 shadow-2xl shadow-black/12 dark:shadow-black/60"
      >
        <div className="space-y-0.5">
          <h4 className="text-ink-bright text-[12px] font-semibold">
            控件后行为{" "}
            <span className="text-ink-muted">· CONTROL AFTER GENERATE</span>
          </h4>
          <p className="text-ink-muted text-[10.5px] leading-relaxed">
            seed / 类似数值 widget 点击数字弹出 4 选 1 切换面板
          </p>
        </div>
        <div className="mt-2.5 space-y-1">
          {SEED_MODES.map((item) => {
            const selected = item.value === mode;
            return (
              <Button
                key={item.value}
                variant="ghost"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onPick(item.value);
                  setOpen(false);
                }}
                className={`nodrag nopan hover:bg-subtle flex h-auto w-full justify-start gap-2.5 rounded-lg border px-2 py-1.5 text-left ${
                  selected
                    ? "border-primary/40 bg-node-accent hover:bg-node-accent"
                    : "border-transparent"
                }`}
              >
                <span className="bg-node-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <SeedModeIcon value={item.value} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ink-bright text-[12px] font-semibold">
                    {item.label}
                  </span>
                  <span className="text-ink-muted truncate text-[10.5px] leading-snug">
                    {item.hint}
                  </span>
                </span>
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                    selected
                      ? "border-primary bg-primary"
                      : "border-border-strong bg-transparent"
                  }`}
                >
                  {selected && (
                    <span className="ring-card block h-full w-full rounded-full ring-2" />
                  )}
                </span>
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
