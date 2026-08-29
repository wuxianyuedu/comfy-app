"use client";

/** 2026-08-29 T12-3: popover primitives shared by the four workflow-node
 *  filter chips — portal viewport-position calculation (up/down flip +
 *  right-edge clamp) and outside-click / Escape dismissal.
 *
 *  Extracted verbatim from WorkflowNode.tsx so each chip stays focused and
 *  the node file shrinks to its data/assembly concerns.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const POPOVER_MIN_W = 240;
export const POPOVER_MAX_H = 320;
export const VIEWPORT_MARGIN = 8;

export function usePopoverPosition(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  width: number,
) {
  const [pos, setPos] = useState({ left: 0, top: 0, width });
  useLayoutEffect(() => {
    if (!open) return;
    const r = () => {
      const t = triggerRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      const w = Math.max(rect.width, width, POPOVER_MIN_W);
      const maxW = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
      const popW = Math.min(w, maxW);
      let left = rect.left;
      if (left + popW > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - popW,
        );
      }
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const place: "down" | "up" =
        spaceBelow >= POPOVER_MAX_H || spaceBelow >= rect.top ? "down" : "up";
      setPos({
        left,
        top:
          place === "down"
            ? rect.bottom + 4
            : Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_MAX_H - 4),
        width: popW,
      });
    };
    r();
    /* R-ardot38: 持续 rAF 重算 —— 画布 transform 变化时 trigger 在视口里的位置
     *  会动，但 React 不重渲染 useLayoutEffect 的 deps（open/width/triggerRef
     *  都没变）。关闭 popover 时立刻 cancel，零开销。 */
    let raf = 0;
    const tick = () => {
      r();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("scroll", r, true);
    window.addEventListener("resize", r);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", r, true);
      window.removeEventListener("resize", r);
    };
  }, [open, width, triggerRef]);
  return pos;
}

/** Outside-click + Escape dismissal for a chip popover (same listener set
 *  every chip used to duplicate). `onClose` is read through a ref so the
 *  listeners only re-bind when `open` flips, matching the original
 *  `useEffect(..., [open])` behaviour. */
export function usePopoverDismiss(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  popRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e instanceof MouseEvent) {
        const target = e.target as Node | null;
        if (
          target &&
          !triggerRef.current?.contains(target) &&
          !popRef.current?.contains(target)
        ) {
          onCloseRef.current();
        }
      }
    };
    // Capture phase (R-ardot48): React Flow v12's pane handler calls
    // stopPropagation in the bubble phase, which can swallow our
    // document-level `mousedown` and leave the popover stuck open when
    // the user clicks the empty canvas. Listening in capture phase runs
    // us BEFORE any stopPropagation, and we also bind `click` because some
    // libraries only intercept the click phase.
    document.addEventListener("mousedown", h, true);
    document.addEventListener("click", h, true);
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("mousedown", h, true);
      document.removeEventListener("click", h, true);
      document.removeEventListener("keydown", h);
    };
  }, [open, triggerRef, popRef]);
}
