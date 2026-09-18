"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { overlayClass } from "~/lib/full-screen-layer";
import { placeFloating } from "~/lib/floating-position";
import { Z } from "~/lib/shell/overlay-z";

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
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M11 2.5L13.5 7L19 7.5L15 11.5L15.5 18L11 14.5L6.5 18L7 11.5L3 7.5L8.5 7L11 2.5Z"
          fill="#FF6B6B"
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
          stroke="#67E89D"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M6 9.5L11 4.5L16 9.5"
          stroke="#67E89D"
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
          stroke="#67E89D"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M6 12.5L11 17.5L16 12.5"
          stroke="#67E89D"
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
        fill="#16161C"
        stroke="#9A9AAD"
        strokeWidth="1.2"
      />
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
 *  Z-index fix (bug): the previous inline popover lived inside
 *  a React Flow node, which uses `position:absolute+transform:translate3d(...)`
 *  and therefore creates a stacking context. Even with `z-40` the popover was
 *  covered by any other node whose React Flow `zIndex` was raised (selected,
 *  dragging, etc.). We now portal the popover + backdrop into `document.body`
 *  so they live in the root stacking context and can never be hidden by other
 *  flow nodes. Position is recomputed from the trigger's getBoundingClientRect
 *  on open and on viewport/scroll resize.
 *
 *  视口翻转（ISSUE #349）：seed 行是参数表单的**最后一行**（画布节点里
 *  outputs 不渲染，末尾就是它），面板又从触发器向下弹 ~270px，于是贴着窗口
 *  下沿的节点一打开就把最后一个选项压到视口之外（截图里只露出前三项）。定位
 *  改为交给 `placeFloating`：下方放不下就翻到触发器上方，并给出高度上限
 *  （面板自身滚动），保证底边永远落在视口内。 */
const POPOVER_WIDTH = 280;
const POPOVER_GAP = 6;
/** 面板高度兜底值：首帧还没量到真实高度时用它决定「下面放不放得下」。
 *  实测值在 `useLayoutEffect` 里于绘制前回填，不会出现一帧错位。 */
const POPOVER_ESTIMATED_HEIGHT = 270;

export function SeedModeButton({
  mode,
  onPick,
}: {
  mode: string | undefined;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /* 滚动 / resize 时递增：触发 effect 重挂，从而重新绑定监听并立刻重算位置。 */
  const [repositionTick, setRepositionTick] = useState(0);
  const current =
    SEED_MODES.find((SEED_MODES) => SEED_MODES.value === mode)?.label ??
    "固定值";

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    /* `offsetHeight` 为 0 有两种情况：面板还没挂载，或环境不做布局（jsdom）。
     * 两者都必须退回兜底高度 —— 否则「面板高 0」会被判定成「哪儿都放得下」，
     * 于是永远向下弹，翻转逻辑形同不存在。 */
    const measured = popRef.current?.offsetHeight ?? 0;
    const height = measured > 0 ? measured : POPOVER_ESTIMATED_HEIGHT;
    setPos(
      placeFloating({
        trigger: rect,
        width: POPOVER_WIDTH,
        height,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align: "right",
        gap: POPOVER_GAP,
        margin: 8,
        /* 画布节点随时会被拖动，面板贴着视口中线时上下各有一半空间 —— 给
         * 24px 滞回，避免拖过中线的一瞬间面板上下翻来翻去。 */
        flipHysteresis: 24,
      }),
    );
  }, []);

  /* 绘制前算位（useLayoutEffect 而非 useEffect）：首帧就带着正确的 top 与
   *  maxHeight 出画，不会先向下闪一下再翻上去。 */
  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    /* 打开时量到的高度可能与兜底值不同（模式数量、字号缩放都会变），
     * rAF 里再校一次，把「实际高度」反馈进摆位。 */
    const raf = requestAnimationFrame(updatePos);
    const onScrollOrResize = () => {
      updatePos();
      setRepositionTick((tick) => tick + 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // capture: true catches scrolls inside any scroll ancestor (incl. R/F Pane)
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, updatePos, repositionTick]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="nodrag nopan border-border-strong bg-canvas-deep text-ink-soft hover:border-primary/40 hover:text-ink-bright flex h-[30px] shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors"
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
        <path
          d="M1.5 3L4 5.5L6.5 3"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
            className={overlayClass("modal")}
            style={{ zIndex: Z.overlay - 1 }}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          />
          <div
            ref={popRef}
            className="nodrag nopan border-border-strong bg-card fixed overflow-hidden rounded-xl border p-3 shadow-2xl shadow-black/12 dark:shadow-black/60"
            style={{
              zIndex: Z.overlay,
              width: POPOVER_WIDTH,
              top: pos?.top ?? -9999,
              left: pos?.left ?? 0,
              /* 高度封顶 + 自身滚动：窗口再矮也不会把最后一个选项推出视口。 */
              maxHeight: pos?.maxHeight,
              overflowY: "auto",
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
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
              {SEED_MODES.map((SEED_MODES) => {
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
                        ? "border-primary/40 bg-node-accent"
                        : "hover:bg-subtle border-transparent"
                    }`}
                  >
                    <span className="bg-node-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                      <SeedModeIcon value={SEED_MODES.value} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={`text-[12px] font-semibold ${selected ? "text-ink-bright" : "text-ink-bright"}`}
                      >
                        {SEED_MODES.label}
                      </span>
                      <span className="text-ink-muted truncate text-[10.5px] leading-snug">
                        {SEED_MODES.hint}
                      </span>
                    </span>
                    <span
                      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                        selected
                          ? "border-primary bg-primary"
                          : "border-[#4D4D59] bg-transparent"
                      }`}
                    >
                      {selected && (
                        <span className="ring-card block h-full w-full rounded-full ring-2" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
