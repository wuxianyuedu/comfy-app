"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 *  the same dark fill as the WorkflowChipRow chips. */
function SeedModeIcon({ value }: { value: string }) {
  // 36x36 viewBox, ~22x22 glyph centered.
  if (value === "fixed") {
    // 📌 Pin (rounded square cap + diagonal stem with dot).
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 2.5L13.5 7L19 7.5L15 11.5L15.5 18L11 14.5L6.5 18L7 11.5L3 7.5L8.5 7L11 2.5Z" fill="#FF6B6B" />
      </svg>
    );
  }
  if (value === "increment") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 4.5V17.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6 9.5L11 4.5L16 9.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (value === "decrement") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 17.5V4.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6 12.5L11 17.5L16 12.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // random (dice)
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="2.5" width="17" height="17" rx="3.5" fill="#16161C" stroke="#9A9AAD" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="1.4" fill="#EDEDF2" />
      <circle cx="15" cy="7" r="1.4" fill="#EDEDF2" />
      <circle cx="11" cy="11" r="1.4" fill="#EDEDF2" />
      <circle cx="7" cy="15" r="1.4" fill="#EDEDF2" />
      <circle cx="15" cy="15" r="1.4" fill="#EDEDF2" />
    </svg>
  );
}

/** Clickable seed-mode chip (canvas node → inline on numeric/seed row).
 *  Click toggles a 4-option "控件后行为" popover aligned with the Ardot
 *  design (dark card, icon + title + hint, radio dot on the right).  Picking
 *  an option calls `onPick` which the canvas layer writes back to the
 *  node's `seedModes` map.
 *
 *  Z-index fix (R-ardot73-D bug): the previous inline popover lived inside
 *  a React Flow node, which uses `position:absolute+transform:translate3d(...)`
 *  and therefore creates a stacking context. Even with `z-40` the popover was
 *  covered by any other node whose React Flow `zIndex` was raised (selected,
 *  dragging, etc.). We now portal the popover + backdrop into `document.body`
 *  so they live in the root stacking context and can never be hidden by other
 *  flow nodes. Position is recomputed from the trigger's getBoundingClientRect
 *  on open and on viewport/scroll resize. */
export function SeedModeButton({
  mode,
  onPick,
}: {
  mode: string | undefined;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = SEED_MODES.find((SEED_MODES) => SEED_MODES.value === mode)?.label ?? "固定值";

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScrollOrResize = () => updatePos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // capture: true catches scrolls inside any scroll ancestor (incl. R/F Pane)
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, updatePos]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="nodrag nopan flex h-[30px] shrink-0 items-center gap-1 rounded-md border border-(--color-border-strong) bg-(--color-canvas-deep) px-2 text-[11px] font-medium text-(--color-ink-soft) transition-colors hover:border-(--color-primary)/40 hover:text-(--color-ink-bright)"
      title="控件后行为 · CONTROL AFTER GENERATE"
    >
      <span className="truncate">{current}</span>
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-70"
      >
        <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  if (!open || typeof document === "undefined") return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          />
          <div
            className="nodrag nopan fixed w-[280px] overflow-hidden rounded-xl border border-(--color-border-strong) bg-(--color-card) p-3 shadow-2xl shadow-black/60"
            style={{
              zIndex: 9999,
              top: pos?.top ?? -9999,
              right: pos?.right ?? 0,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="space-y-0.5">
              <h4 className="text-[12px] font-semibold text-(--color-ink-bright)">
                控件后行为 <span className="text-(--color-ink-muted)">· CONTROL AFTER GENERATE</span>
              </h4>
              <p className="text-[10.5px] leading-relaxed text-(--color-ink-muted)">
                seed / 类似数值 widget 点击数字弹出 4 选 1 切换面板
              </p>
            </div>
            <div className="mt-2.5 space-y-1">
              {SEED_MODES.map((SEED_MODES) =>
{
                const selected = SEED_MODES.value === mode;
                return (
                  <button
                    key={SEED_MODES.value}
                    type="button"
                    onClick={() => {
                      onPick(SEED_MODES.value);
                      setOpen(false);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className={`nodrag nopan flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? "border-(--color-primary)/40 bg-(--color-node-accent)"
                        : "border-transparent hover:bg-white/4"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        selected ? "bg-[#2A1F4A]" : "bg-(--color-node-accent)"
                      }`}
                    >
                      <SeedModeIcon value={SEED_MODES.value} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-[12px] font-semibold ${selected ? "text-(--color-ink-bright)" : "text-(--color-ink-bright)"}`}>
                        {SEED_MODES.label}
                      </span>
                      <span className="truncate text-[10.5px] leading-snug text-(--color-ink-muted)">
                        {SEED_MODES.hint}
                      </span>
                    </span>
                    <span
                      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                        selected ? "border-(--color-primary) bg-(--color-primary)" : "border-[#4D4D59] bg-transparent"
                      }`}
                    >
                      {selected && (
                        <span className="block h-full w-full rounded-full ring-2 ring-(--color-card)" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
