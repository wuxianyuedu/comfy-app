"use client";
/* 拆出来的画布装饰组件 —— 原本在 WorkflowCanvasEditor.tsx 里。 */
import React, { useState, useRef, useMemo, useEffect } from "react";
import { digitsOnly, textHandler } from "~/lib/form-props";
import { clamp } from "~/lib/clamp";
import {
  useReactFlow,
  useStore,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import type { CanvasSettings } from "./canvas/WorkflowCanvasSettings";
import { DEFAULT_CANVAS_SETTINGS } from "./canvas/WorkflowCanvasSettings";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { alphaText } from "~/lib/number-format";
import {
  GRID_BASE_LAYER_ID,
  GRID_MAJOR_LAYER_ID,
  GRID_MINOR_LAYER_ID,
} from "./canvas/workflow-canvas-grid";
export const GRID_CELL = 10;
export const GRID_MAJOR_EVERY = 10;
/* 画布底色。React Flow 的 `<Background bgColor>` 直接把它写成 CSS 变量
 *  （`--xy-background-color-props`），所以这里可以给一个随主题解析的
 *  `var()` —— 浅色下取 `--color-canvas`（浅灰）、深色下取原 `#0a0a0f`。
 *  写死 `#0a0a0f` 时，Light 下整块画布（以及缩到极限时唯一可见的底色）
 *  仍是黑的，与浅色工作区割裂。 */
export const CANVAS_BG = "var(--color-canvas)";

/* 细网格线的**淡出上限**（不是整张网格的关闭阈值）：低于这个缩放，
 *  10px 一格已经糊成噪点，细线不再画，只留 100px 的主参考线。
 *
 *  这里曾经是「整张网格一起关掉」的阈值：缩到 0.3 以下 `<CanvasGrid>` 直接
 *  返回 null，连带承载底色的 `bgColor` 也一起消失 —— 画布上只剩节点卡片那点
 *  像素，整屏读起来就是黑屏（用户侧「缩小到能显示节点」的那一段正是此处）。
 *  细线可以淡出，**底色不能**：底色的有无是画布有没有渲染出来的唯一直观凭据。 */
export const GRID_FINE_FADE_ZOOM = 0.3;

export function CanvasGrid({
  settings = DEFAULT_CANVAS_SETTINGS,
}: {
  /* 设置由编辑器根组件（它持有唯一的 useCanvasSettings() 实例）通过 props 传进来，
   *  而不是从 context 里取。这样 CanvasGrid 就是它 props 的纯函数，
   *  也不必穿越 <ReactFlow> 的内部 context 边界。 */
  settings?: CanvasSettings;
}) {
  /* 只订阅 zoom（标量）而不是在选择器里现拼对象：选择器本体在 store 每次
   * 更新时都要跑一遍并做 `Object.is` 比较，返回**新对象**时永不相等 —— 平移
   * 每帧都换 transform，网格层（两层 `<Background>`）就跟着每帧重渲染。
   * 取到 zoom 之后的计算放在渲染里做即可，它只依赖 props 与 zoom。 */
  const zoom = useStore((state) => state.transform[2]);
  const cellPx = settings.gridGap * zoom;
  /* 淡入曲线这样取：
   *  - 缩放 0.30（约 3px 一格）：t = 0 → 不画细线（那时只是噪点）
   *  - 缩放 0.45（约 4.5px）：t ≈ 0.4 → 可见
   *  - 缩放 0.60（约 6px）：t ≈ 0.7 → 实了
   *  - 缩放 0.80 以上：t = 1 → 满透明度
   * 早先用的是 `(cellPx - 5) / 3`，要到 5px 一格（缩放 0.5）才开始淡入，
   * 于是对任何正常规模的工作流，fitView 之后的画布在视觉上都是空的。 */
  const minorAlpha = Math.round(clamp((cellPx - 3) / 3, 0, 1) * 10) / 10;
  /* 淡出的是**细线**，不是整个网格层（见 GRID_FINE_FADE_ZOOM 的说明）。 */
  const showFineLines = zoom > GRID_FINE_FADE_ZOOM;
  /* 用户主动关网格（画布设置里的「显示网格」）时也要保留底色 —— 关的是格子，
   *  不是画布背景。此前 `!settings.showGrid` 也走 return null，关掉网格后整块
   *  画布与「缩小到极限」是同一种黑屏。 */
  return (
    <>
      {settings.showGrid && showFineLines && (
        <Background
          id={GRID_MINOR_LAYER_ID}
          variant={BackgroundVariant.Lines}
          /* 间距 / 线宽 / 透明度现在绑定到用户的画布设置，
           *  不再是硬编码的 10 / 1 / 0.22。
           *  会乘上一个「随缩放淡出」的系数，让线在任何缩放档下都可读
           *（此前缩放 0.5 时透明度直接是 0）。 */
          gap={settings.gridGap}
          lineWidth={settings.gridMinorLineWidth}
          color={`rgba(148,163,184,${alphaText(settings.gridMinorAlpha * minorAlpha)})`}
        />
      )}
      {/* 底色层：**唯一一个恒常渲染**的网格层（它自己就是画布的底色）。
          细线在主参考线之前渲染（都会被后画的层盖在上方），顺序不影响观感。 */}
      <Background
        id={GRID_BASE_LAYER_ID}
        variant={BackgroundVariant.Dots}
        gap={1e6}
        color="transparent"
        bgColor={CANVAS_BG}
      />
      {settings.showGrid && (
        /* 主参考线恒落在 `gridGap * 10` 处，保持用户预期的 1:10 比例；
         *  可调的只有它们的透明度与线宽。 */
        <Background
          id={GRID_MAJOR_LAYER_ID}
          variant={BackgroundVariant.Lines}
          gap={settings.gridGap * GRID_MAJOR_EVERY}
          lineWidth={settings.gridMajorLineWidth}
          color={`rgba(148,163,184,${alphaText(settings.gridMajorAlpha)})`}
          bgColor="transparent"
        />
      )}
    </>
  );
}

/* ── 画布标尺 ──
 *  在画布窗口四条边上的细小坐标读数，让用户一眼读出节点的世界坐标。
 *  每条标尺渲染「当前穿过该边的所有主网格线」的**世界** X / Y 值，
 *  定位用屏幕像素（于是标签在任何缩放下都清晰可读）。
 *
 *  当主网格线在屏幕上间距不到 48px 时，步长会自动翻倍 ——
 *  否则在缩放 0.1 下标签会叠在一起。
 *  负的世界坐标用 Unicode 负号渲染成 `−N`，排版上更一致。
 *
 *  整个浮层是 `pointer-events: none`，因此它绝不挡住节点 / 连线的交互；
 *  它的层级是 `z-index: 3` —— 在变换过的视口（z 0）之上、
 *  但在 Controls / MiniMap（z 5+）之下，
 *  于是落在缩放按钮上的标尺标签会被按钮盖住，而不是把控件遮住。 */

/**
 * 缩放读数小片 —— 在右上角显示画布的实时缩放百分比。两种调整方式：
 *    • 点它，直接键入精确百分比，回车（或失焦）生效 ——
 *      `rf.zoomTo` 会遵守 `<ReactFlow>` 的 minZoom / maxZoom 边界（0.15–2）。
 *    • 按住后上下拖拽（向上放大、向下缩小）做连续微调。
 *      位移小于 4px 的按压按「一次点击」处理。
 *  ESC 取消编辑；空值或非数字输入不改动缩放。
 *
 *  限幅现在从 `useCanvasSettings()` 读，因此这个小片遵守用户在面板里设的
 *  同一套 minZoom / maxZoom。 */
export function ZoomIndicator({
  minZoom = DEFAULT_CANVAS_SETTINGS.minZoom,
  maxZoom = DEFAULT_CANVAS_SETTINGS.maxZoom,
}: {
  minZoom?: number;
  maxZoom?: number;
} = {}) {
  const zoom = useStore((state) => state.transform[2]);
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startY: number;
    startZoom: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  // 拖拽缩放期间挂到 window 的监听器；卸载时若拖拽尚未结束（鼠标按住未松手）
  // 必须移除，否则泄漏到页面生命周期（规范 §8.5 / P7）。
  const scrubListenersRef = useRef<{
    onMove: (ev: MouseEvent) => void;
    onUp: () => void;
  } | null>(null);
  useEffect(() => {
    return () => {
      const ls = scrubListenersRef.current;
      if (ls) {
        window.removeEventListener("mousemove", ls.onMove);
        window.removeEventListener("mouseup", ls.onUp);
      }
    };
  }, []);

  const pct = Math.round(zoom * 100);

  const applyZoom = (z: number) => {
    const clamped = clamp(z, minZoom, maxZoom);
    void rf.zoomTo(clamped, { duration: 0 });
  };

  const beginEdit = () => {
    setDraft(String(pct));
    setEditing(true);
  };

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n > 0) applyZoom(n / 100);
    setEditing(false);
  };

  // 微调：按住后上下拖拽，连续改变缩放。向上放大、向下缩小；
  // 用乘法（对数）映射，让每像素位移在任何缩放档下手感一致。
  const onScrubStart = (e: React.MouseEvent) => {
    if (editing) return;
    e.preventDefault();
    justDraggedRef.current = false;
    dragRef.current = { startY: e.clientY, startZoom: zoom, moved: false };
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dy = st.startY - ev.clientY; // up = positive
      if (Math.abs(dy) > 4) st.moved = true;
      applyZoom(st.startZoom * Math.exp(dy / 220));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      scrubListenersRef.current = null;
      const st = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (st?.moved) justDraggedRef.current = true;
      else if (st) beginEdit();
    };
    scrubListenersRef.current = { onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        onChange={textHandler(setDraft, digitsOnly)}
        onBlur={commit}
        {...enterCommit({
          onCommit: commit,
          /* Esc 关掉编辑态即可 —— 草稿在下次进入编辑时由 `beginEdit()` 重置，
           * 所以这里不需要显式回退原值。 */
          onCancel: () => setEditing(false),
        })}
        title="输入缩放百分比后回车"
        className="bg-panel text-ink-bright z-base border-primary/60 absolute top-3 right-3 h-7 w-16 rounded-md border px-2 text-right text-[11px] font-medium tabular-nums shadow-lg outline-none"
      />
    );
  }

  return (
    <Hint label="点击输入缩放倍数，或按住上下拖动调整">
      <Button
        variant="outline"
        onMouseDown={onScrubStart}
        onClick={() => {
          if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
          }
          beginEdit();
        }}
        className={`border-border-strong bg-panel/90 text-ink-soft hover:text-ink-bright z-base pointer-events-auto absolute top-3 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight tabular-nums shadow-lg backdrop-blur-sm select-none hover:border-white/25 ${
          dragging
            ? "border-primary-400/50 cursor-grabbing"
            : "cursor-ns-resize"
        }`}
      >
        {pct}%
      </Button>
    </Hint>
  );
}

export function CanvasRulers({
  settings = DEFAULT_CANVAS_SETTINGS,
}: {
  /* 标尺可以在画布设置面板里隐藏，
   *  好让需要干净画布（或正在做截图）的作者不必忍受这层坐标浮层。 */
  settings?: CanvasSettings;
} = {}) {
  const tx = useStore((state) => state.transform[0]);
  const ty = useStore((state) => state.transform[1]);
  const zoom = useStore((state) => state.transform[2]);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);

  // 取满足「屏幕间距 ≥ 48px」的最小世界单位步长，让标签永不重叠。
  // 它总是主网格步长的整数倍。
  const labelStep = useMemo(() => {
    const base = settings.gridGap * GRID_MAJOR_EVERY; // 100
    let s = base;
    while (s * zoom < 48) s *= 2;
    return s;
  }, [zoom, settings.gridGap]);

  // 每条可见的主竖线的世界 X → 屏幕 X。
  const xLabels = useMemo(() => {
    if (zoom <= 0.01 || !width)
      return [] as { world: number; screen: number }[];
    const start = Math.floor(-tx / zoom / labelStep) * labelStep;
    const end = Math.ceil((width - tx) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let x = start; x <= end + 0.5; x += labelStep) {
      const sx = x * zoom + tx;
      if (sx < -4 || sx > width + 4) continue;
      out.push({ world: x, screen: sx });
    }
    return out;
  }, [tx, zoom, width, labelStep]);

  // 每条可见的主横线的世界 Y → 屏幕 Y。
  const yLabels = useMemo(() => {
    if (zoom <= 0.01 || !height)
      return [] as { world: number; screen: number }[];
    const start = Math.floor(-ty / zoom / labelStep) * labelStep;
    const end = Math.ceil((height - ty) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let y = start; y <= end + 0.5; y += labelStep) {
      const sy = y * zoom + ty;
      if (sy < -4 || sy > height + 4) continue;
      out.push({ world: y, screen: sy });
    }
    return out;
  }, [ty, zoom, height, labelStep]);

  if (!settings.showRulers) return null;

  // 用 Unicode 负号统一排版（既有控件值用的是普通 `-`；
  // 标尺用 `−`，因为它的字号更大，负坐标下这点差异看得出来）。
  const fmt = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

  const labelBase =
    "pointer-events-none absolute select-none whitespace-nowrap text-[10px] font-medium tabular-nums tracking-tight";

  return (
    <div className="z-base pointer-events-none absolute inset-0" aria-hidden>
      {/* 上边 —— X 坐标 */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rt-${world}`}
          className={labelBase}
          style={{
            left: screen,
            top: 2,
            transform: "translateX(-50%)",
            color: "var(--color-canvas-ruler-ink)",
            textShadow: "var(--color-canvas-ruler-shadow)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* 下边 —— X 坐标（上移到缩放控件之上，好让
       *  左下角按钮簇不盖住最左侧的标签） */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rb-${world}`}
          className={labelBase}
          style={{
            left: screen,
            bottom: 2,
            transform: "translateX(-50%)",
            color: "var(--color-canvas-ruler-ink)",
            textShadow: "var(--color-canvas-ruler-shadow)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* 左边 —— Y 坐标 */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rl-${world}`}
          className={labelBase}
          style={{
            top: screen,
            left: 3,
            transform: "translateY(-50%)",
            color: "var(--color-canvas-ruler-ink)",
            textShadow: "var(--color-canvas-ruler-shadow)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* 右边 —— Y 坐标 */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rr-${world}`}
          className={labelBase}
          style={{
            top: screen,
            right: 3,
            transform: "translateY(-50%)",
            color: "var(--color-canvas-ruler-ink)",
            textShadow: "var(--color-canvas-ruler-shadow)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
    </div>
  );
}

/* ── Color helper ── */
