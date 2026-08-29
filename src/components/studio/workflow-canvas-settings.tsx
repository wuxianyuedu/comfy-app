"use client";
/**
 * Canvas settings — user-tunable preferences for the workflow editor
 * canvas.  Persisted per-browser to localStorage so the user's choices
 * (grid transparency, ruler visibility, etc.) survive page reloads and
 * apply the moment a new workflow is opened.
 *
 *  R-ardot95 (2026-08-17): three small affordances owe their home here —
 *    • grid line opacity / line width / gap (the orange/dark gridlines
 *      from the screenshot were too prominent),
 *    • show/hide rulers + mini-map,
 *    • max zoom clamp.
 *
 *  All settings live under one flat object so a single `useCanvasSettings()`
 *  hook can mutate any subset in one round-trip.  Rendered through:
 *    • <CanvasSettingsButton> — gear icon at the canvas top-right that
 *      shows a violet dot when settings differ from defaults,
 *    • <CanvasSettingsPanel> — right-edge drawer (340px wide) opened
 *      via the button.  Closes on Esc / scrim click / × button.
 *
 *  Settings are read by CanvasGrid / CanvasRulers / ZoomIndicator via
 *  props (the workflow editor root calls `useCanvasSettings()` once and
 *  distributes).  This avoids any React Context crossing the
 *  `<ReactFlow>` boundary, which can confuse the editor's internal
 *  selector subscriptions.
 *
 *  Storage key is versioned (`v1`) so future shape changes can migrate
 *  without colliding with old payloads.
 */
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export interface CanvasSettings {
  /** 网格 (Grid) */
  /** 0..1, applied to the fine (default 10px) grid lines. Multiplied by
   *  the CanvasGrid zoom-fade curve so lines stay legible at all zooms. */
  gridMinorAlpha: number;
  /** 0..1, applied to the major reference lines (default every 100px). */
  gridMajorAlpha: number;
  /** World-px between two adjacent fine lines.  Major lines always land
   *  at `gridGap * 10` to keep the 1:10 ratio users expect. */
  gridGap: number;
  gridMinorLineWidth: number;
  gridMajorLineWidth: number;
  /** When false the entire <Background> stack returns null.  Useful
   *  for screenshot workflows where a clean canvas is wanted. */
  showGrid: boolean;

  /** 画布 (Canvas chrome) */
  showRulers: boolean;
  showMiniMap: boolean;

  /** 缩放 (Zoom) — these only take effect on the next editor mount
   *  because the underlying `<ReactFlow minZoom/maxZoom>` props are
   *  consumed once at instantiation; the panel labels communicate that. */
  maxZoom: number;
  minZoom: number;

  /** 调试 (Debug) — R-ardot118 (2026-08-18): unified "调试模式" toggle.
   *  When ON, the canvas shows a separate bottom-docked execution-log
   *  panel (GlobalStepLogPanel) and each log line carries its caller
   *  source ("file:line").  This is the single switch the user asked
   *  for — no per-node log toggles. */
  debugMode: boolean;
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  gridMinorAlpha: 0.22,
  gridMajorAlpha: 0.14,
  gridGap: 10,
  gridMinorLineWidth: 1,
  gridMajorLineWidth: 1.25,
  showGrid: true,
  showRulers: true,
  showMiniMap: true,
  maxZoom: 2,
  minZoom: 0.15,
  debugMode: false,
};

const STORAGE_KEY = "comfyapp:canvas-settings:v1";

function readSettings(): CanvasSettings {
  if (typeof window === "undefined") return DEFAULT_CANVAS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CANVAS_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CanvasSettings>;
    /* Forward-compat: unknown keys in storage are ignored, default
     * values fill any holes left by older payloads. */
    return { ...DEFAULT_CANVAS_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_CANVAS_SETTINGS;
  }
}

function writeSettings(s: CanvasSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* Quota / private-mode / disabled-storage — silently ignore.
     * The settings still apply for this session; only persistence
     * is lost. */
  }
}

/** Single source of truth for canvas preferences.  Hydrates from
 *  localStorage on mount; mutations are auto-persisted and fanned out to
 *  EVERY `useCanvasSettings()` instance via a module-level listener set
 *  (useSyncExternalStore).  This matters because the settings drawer and
 *  the GlobalStepLogPanel are separate components — flipping "调试模式"
 *  in the drawer must instantly re-render the panel without prop-drilling
 *  across the React Flow boundary. */
const SETTINGS_LISTENERS = new Set<() => void>();
let CURRENT_SETTINGS: CanvasSettings = DEFAULT_CANVAS_SETTINGS;

function notifySettings() {
  for (const l of SETTINGS_LISTENERS) l();
}

function applySettings(next: CanvasSettings) {
  CURRENT_SETTINGS = next;
  writeSettings(next);
  notifySettings();
}

export function useCanvasSettings() {
  /* Start with defaults so SSR / first paint don't flash a saved state.
   * `hydrated` flips client-side only, via useSyncExternalStore (no
   * set-state-in-effect). */
  const hydrated = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    () => true,
    () => false,
  );

  useEffect(() => {
    CURRENT_SETTINGS = readSettings();
    notifySettings();
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    SETTINGS_LISTENERS.add(cb);
    return () => {
      SETTINGS_LISTENERS.delete(cb);
    };
  }, []);

  const getSnapshot = useCallback(() => CURRENT_SETTINGS, []);

  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback((patch: Partial<CanvasSettings>) => {
    applySettings({ ...CURRENT_SETTINGS, ...patch });
  }, []);

  const reset = useCallback(() => {
    applySettings(DEFAULT_CANVAS_SETTINGS);
  }, []);

  return { settings, update, reset, hydrated };
}

/** Convenience accessor for just the debug toggle. */
export function useDebugMode() {
  const { settings, update } = useCanvasSettings();
  return {
    debugMode: settings.debugMode,
    setDebugMode: (v: boolean) => update({ debugMode: v }),
  };
}

/** True iff the user has changed anything from defaults — used to
 *  light up the violet dot beside the ⚙ button so they know their
 *  customisations are in effect without having to open the panel.
 *  `debugMode` is excluded: it's a runtime debug affordance, not a
 *  visual customisation, so it shouldn't light the "you have overrides"
 *  dot. */
export function isCustomCanvasSettings(s: CanvasSettings): boolean {
  const keys = (Object.keys(DEFAULT_CANVAS_SETTINGS) as (keyof CanvasSettings)[]).filter(
    (key) => key !== "debugMode"
  );
  for (const k of keys) {
    if (s[k] !== DEFAULT_CANVAS_SETTINGS[k]) return true;
  }
  return false;
}

/* ── Settings panel (right-edge drawer) ── */

interface PanelProps {
  settings: CanvasSettings;
  update: (patch: Partial<CanvasSettings>) => void;
  reset: () => void;
  onClose: () => void;
}

export function CanvasSettingsPanel({
  settings,
  update,
  reset,
  onClose,
}: PanelProps) {
  /* Esc closes the panel — standard drawer affordance. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="presentation"
    >
      {/* Click-to-dismiss scrim.  Stays interactive so a click outside
       *  feels like clicking "the background of the drawer", not a
       *  floating dim layer. */}
      <button
        type="button"
        aria-label="关闭画布设置"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/40 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label="工作流画布设置"
        className="flex h-full w-[340px] flex-col border-l border-white/6 bg-[#0c0c14]/97 text-gray-200 shadow-2xl"
      >
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-[15px]">⚙</span>
            <span className="truncate text-[12.5px] font-semibold tracking-wide text-gray-100">
              画布设置
            </span>
            <span className="rounded-full bg-white/6 px-1.5 py-px text-[10px] font-mono text-gray-500">
              v1
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section
            title="网格"
            subtitle="背景格子线条的视觉强度"
          >
            <SliderRow
              label="细线透明度"
              value={settings.gridMinorAlpha}
              min={0} max={1} step={0.02}
              onChange={(value) => update({ gridMinorAlpha: value })}
              format={(value) => value.toFixed(2)}
              tooltip="细格子 (默认 10px 一格) 线条的可见度。设为 0 接近全透明"
            />
            <SliderRow
              label="主线透明度"
              value={settings.gridMajorAlpha}
              min={0} max={1} step={0.02}
              onChange={(value) => update({ gridMajorAlpha: value })}
              format={(value) => value.toFixed(2)}
              tooltip="主参考线 (每 10 格 = 100px) 的可见度"
            />
            <SliderRow
              label="细线宽度"
              value={settings.gridMinorLineWidth}
              min={0.5} max={3} step={0.25}
              onChange={(value) => update({ gridMinorLineWidth: value })}
              format={(value) => `${value.toFixed(2)}px`}
            />
            <SliderRow
              label="主线宽度"
              value={settings.gridMajorLineWidth}
              min={0.5} max={3} step={0.25}
              onChange={(value) => update({ gridMajorLineWidth: value })}
              format={(value) => `${value.toFixed(2)}px`}
            />
            <SliderRow
              label="格子间距"
              value={settings.gridGap}
              min={4} max={40} step={2}
              onChange={(value) => update({ gridGap: value })}
              format={(value) => `${value}px`}
              tooltip="细格子之间的世界坐标距离；调小 → 更密集的网格"
            />
            <ToggleRow
              label="显示网格"
              value={settings.showGrid}
              onChange={(value) => update({ showGrid: value })}
            />
          </Section>

          <Section title="画布" subtitle="坐标尺 / 缩略图 等装饰">
            <ToggleRow
              label="显示坐标尺"
              value={settings.showRulers}
              onChange={(value) => update({ showRulers: value })}
              tooltip="四边的世界坐标刻度，鼠标移动时会同步高亮最近刻度"
            />
            <ToggleRow
              label="显示缩略图"
              value={settings.showMiniMap}
              onChange={(value) => update({ showMiniMap: value })}
              tooltip="右下角缩略图，方便定位大规模工作流"
            />
          </Section>

          <Section title="缩放" subtitle="下次打开编辑器时生效">
            <SliderRow
              label="最大缩放"
              value={settings.maxZoom}
              min={1} max={4} step={0.1}
              onChange={(value) => update({ maxZoom: value })}
              format={(value) => `${value.toFixed(1)}×`}
            />
            <SliderRow
              label="最小缩放"
              value={settings.minZoom}
              min={0.05} max={0.5} step={0.05}
              onChange={(value) => update({ minZoom: value })}
              format={(value) => `${value.toFixed(2)}×`}
            />
          </Section>

          <Section title="调试" subtitle="日志面板开关；节点渲染链路标签由顶栏「调试」按钮控制">
            <ToggleRow
              label="日志面板"
              value={settings.debugMode}
              onChange={(value) => update({ debugMode: value })}
              tooltip="开启后画布底部显示独立的执行日志面板，并在每条日志后标注调用代码位置（file:line）；节点卡片上的渲染链路标签请用顶栏「调试」按钮"
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/6 px-4 py-3 text-[11px] text-gray-500">
          <span>设置保存在本浏览器</span>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-white/8 bg-white/4 px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
          >
            恢复默认
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/* ── Top-right gear button (sits next to <ZoomIndicator>) ── */

interface ButtonProps {
  hasOverrides: boolean;
  onClick: () => void;
}

export function CanvasSettingsButton({ hasOverrides, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="画布设置 · 调整格子 / 坐标尺 / 缩略图 等"
      aria-label="画布设置"
      className="pointer-events-auto absolute right-3 top-12 z-[6] select-none rounded-md border border-white/10 bg-(--color-panel)/90 px-2.5 py-1 text-[11px] font-medium tracking-tight text-gray-300 shadow-lg backdrop-blur-sm transition-colors hover:border-white/25 hover:text-gray-100"
    >
      <span aria-hidden className="mr-1 align-baseline text-[12px]">⚙</span>
      设置
      {/* Violet dot tells the user "you have unsaved-from-default
       *  preferences" without forcing them to open the panel.  Reads as
       *  both a status indicator and a tiny bit of branding. */}
      {hasOverrides && (
        <span
          aria-hidden
          className="ml-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-violet-400 align-middle shadow-[0_0_6px_rgba(167,139,250,0.7)]"
        />
      )}
    </button>
  );
}

/* ── Small presentational row helpers ── */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <header className="mb-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-[10.5px] text-gray-500">{subtitle}</p>
        )}
      </header>
      <div className="space-y-2.5 rounded-lg border border-white/5 bg-white/2 p-3">
        {children}
      </div>
    </section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  tooltip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  tooltip?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-gray-300" title={tooltip}>
          {label}
        </span>
        <span className="font-mono tabular-nums text-gray-400">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/6 accent-violet-500 outline-none"
        style={{
          /* Range input theming that's hard to do with Tailwind alone;
           * we paint the filled portion via a gradient that mirrors the
           * slider position so the user sees their value in the bar
           * itself. */
          background: `linear-gradient(to right, rgb(167,139,250) 0%, rgb(167,139,250) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.07) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.07) 100%)`,
        }}
      />
    </label>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-[11.5px]">
      <span className="text-gray-300" title={tooltip}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${
          value ? "bg-violet-500" : "bg-white/12"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[16px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </label>
  );
}
