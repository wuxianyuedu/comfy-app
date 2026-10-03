"use client";
/**
 * 画布设置 —— 用户可以调的「工作流编辑器画布」偏好。
 * 按浏览器持久化到 localStorage，因此用户的选择（网格透明度、标尺显隐等）
 * 在刷新后仍在，并在打开新工作流时立刻生效。
 *
 * 三件小功能归在这里：
 * • 网格线的透明度 / 线宽 / 间距
 * （截图里那种橙 / 深色格线太抢眼了），
 * • 标尺与小地图的显隐，
 * • 最大缩放的限幅。
 *
 * 所有设置放在同一个扁平对象里，好让单个`useCanvasSettings()` hook
 * 一次往返就能改任意子集。渲染出口有两个：
 * • <CanvasSettingsButton> —— 画布右上角的齿轮图标，
 * 设置偏离默认值时显示一个紫色小点；
 * • <CanvasSettingsPanel> —— 由该按钮打开的右侧抽屉（宽 340px）。
 * 按 Esc、点遮罩或点 × 都会关闭。
 *
 * 设置由 CanvasGrid / CanvasRulers / ZoomIndicator 经 props 读取
 *（工作流编辑器根组件调一次`useCanvasSettings()` 再分发）。
 * 这样就避免了任何 React Context 跨越`<ReactFlow>` 边界 ——
 * 那会干扰编辑器内部的选择器订阅。
 *
 * 存储键带版本（`v1`），将来改结构时可以迁移，
 * 不会与旧载荷相撞。
 */
import React, { useCallback, useEffect, useSyncExternalStore } from "react";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { fixed } from "~/lib/number-format";
import { Hint } from "~/components/ui/hint";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Button } from "~/components/ui/button";
import { RangeSlider } from "~/components/ui/range-slider";
import { Switch } from "~/components/ui/switch";
import { FieldLabel } from "~/components/ui/field";

export interface CanvasSettings {
  /** 网格 (Grid) */
  /** 0..1，作用于细网格线（默认 10px 那层）。
   * 会与 CanvasGrid 的缩放淡出曲线相乘，让线在所有缩放档下都可读。 */
  gridMinorAlpha: number;
  /** 0..1，作用于主参考线（默认每 100px 一条）。 */
  gridMajorAlpha: number;
  /** 相邻两条细线之间的世界坐标像素。主线恒落在`gridGap * 10` 处，
   * 保持用户预期的 1:10 比例。 */
  gridGap: number;
  gridMinorLineWidth: number;
  gridMajorLineWidth: number;
  /** 为 false 时整层 <Background> 直接返回 null。
   * 适合需要干净画布的截图流程。 */
  showGrid: boolean;

  /** 画布 (Canvas chrome) */
  showRulers: boolean;
  showMiniMap: boolean;

  /** 缩放 —— 这两项只在下次挂载编辑器时生效，
   * 因为底层的`<ReactFlow minZoom/maxZoom>` props 在实例化时只读一次；
   * 面板上的文案已写明这一点。 */
  maxZoom: number;
  minZoom: number;

  /** 调试 —— 统一的「调试模式」开关。
   * 打开时，画布底部会多出一个独立的执行日志面板（GlobalStepLogPanel），
   * 且每条日志都带上调用方来源（"文件:行"）。
   * 这是用户要的**一个**总开关 —— 不做按节点的日志开关。 */
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
  /* SSR / 隐私模式 / 坏数据一律回落默认值 —— 三条判据收在
   *`~/lib/browser-storage`（§16.2.4.28）。 */
  return readStorageJson(STORAGE_KEY, DEFAULT_CANVAS_SETTINGS, (raw) => {
    const parsed = JSON.parse(raw) as Partial<CanvasSettings>;
    /* 向前兼容：存储里的未知键忽略，默认值补齐旧载荷留下的空洞。 */
    return { ...DEFAULT_CANVAS_SETTINGS, ...parsed };
  });
}

function writeSettings(s: CanvasSettings): void {
  /* 写失败（配额满 / 隐私模式 / 被禁用）静默：设置对本次会话仍然生效，
   * 只是丢掉了持久化。 */
  writeStorageJson(STORAGE_KEY, s);
}

/* 画布偏好的唯一事实源。挂载时从 localStorage 读入；
 * 变更会自动落盘，并经模块级监听器集合（useSyncExternalStore）
 * 广播给**每一个**`useCanvasSettings()` 实例。
 * 这一点很要紧：设置抽屉与 GlobalStepLogPanel 是两个独立组件 ——
 * 在抽屉里切换「调试模式」必须立刻让面板重渲染，
 * 而不是靠 props 一路穿过 React Flow 边界传下去。 */
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
  /* 先用默认值起步，避免 SSR / 首屏闪一下已保存的状态。
   *`hydrated` 只在客户端翻转，且经 useSyncExternalStore 实现
   *（不在 effect 里 set-state）。 */
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

/* 只取「调试模式」开关的便捷访问器。 */
export function useDebugMode() {
  const { settings, update } = useCanvasSettings();
  return {
    debugMode: settings.debugMode,
    setDebugMode: (v: boolean) => update({ debugMode: v }),
  };
}

/* 当且仅当用户改过任何一项、偏离了默认值时为真 ——
 * 用于点亮 ⚙ 按钮旁边那个紫色小点，让用户不必打开面板也知道自己的定制在生效。
 *`debugMode` 被排除在外：它是运行期调试手段，不是视觉定制，
 * 不该点亮「你改过设置」这个点。 */
export function isCustomCanvasSettings(s: CanvasSettings): boolean {
  const keys = (
    Object.keys(DEFAULT_CANVAS_SETTINGS) as (keyof CanvasSettings)[]
  ).filter((key) => key !== "debugMode");
  for (const k of keys) {
    if (s[k] !== DEFAULT_CANVAS_SETTINGS[k]) return true;
  }
  return false;
}

/* ── 设置面板（右侧抽屉） ── */

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
  /* 抽屉走 ui/sheet（规范 16 §16.2.3 P2）：Esc 关闭、点遮罩关闭、遮罩让出
 标题行与 ProjectSettingsDrawer 是同一件事，此前两边各写一份。 */
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="bg-panel/97 border-border-strong text-ink-bright w-85 gap-0 border-l shadow-2xl shadow-black/10 sm:max-w-85 dark:shadow-black/50"
        aria-label="工作流画布设置"
      >
        <SheetTitle className="sr-only">工作流画布设置</SheetTitle>
        {/* Header bar */}
        <div className="border-border-strong flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-[15px]">
              ⚙
            </span>
            <span className="text-ink-bright truncate text-[12.5px] font-semibold tracking-wide">
              画布设置
            </span>
            <span className="bg-subtle text-ink-muted rounded-full px-1.5 py-px font-mono text-[10px]">
              v1
            </span>
          </div>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={onClose}
            aria-label="关闭"
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright rounded-md text-[11px]"
          >
            ✕
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section title="网格" subtitle="背景格子线条的视觉强度">
            <SliderRow
              label="细线透明度"
              value={settings.gridMinorAlpha}
              min={0}
              max={1}
              step={0.02}
              onChange={(value) => update({ gridMinorAlpha: value })}
              format={(value) => fixed(value, 2) ?? ""}
              tooltip="细格子 (默认 10px 一格) 线条的可见度。设为 0 接近全透明"
            />
            <SliderRow
              label="主线透明度"
              value={settings.gridMajorAlpha}
              min={0}
              max={1}
              step={0.02}
              onChange={(value) => update({ gridMajorAlpha: value })}
              format={(value) => fixed(value, 2) ?? ""}
              tooltip="主参考线 (每 10 格 = 100px) 的可见度"
            />
            <SliderRow
              label="细线宽度"
              value={settings.gridMinorLineWidth}
              min={0.5}
              max={3}
              step={0.25}
              onChange={(value) => update({ gridMinorLineWidth: value })}
              format={(value) => `${fixed(value, 2) ?? ""}px`}
            />
            <SliderRow
              label="主线宽度"
              value={settings.gridMajorLineWidth}
              min={0.5}
              max={3}
              step={0.25}
              onChange={(value) => update({ gridMajorLineWidth: value })}
              format={(value) => `${value.toFixed(2)}px`}
            />
            <SliderRow
              label="格子间距"
              value={settings.gridGap}
              min={4}
              max={40}
              step={2}
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
              min={1}
              max={4}
              step={0.1}
              onChange={(value) => update({ maxZoom: value })}
              format={(value) => `${fixed(value, 1) ?? ""}×`}
            />
            <SliderRow
              label="最小缩放"
              value={settings.minZoom}
              min={0.05}
              max={0.5}
              step={0.05}
              onChange={(value) => update({ minZoom: value })}
              format={(value) => `${fixed(value, 2) ?? ""}×`}
            />
          </Section>

          <Section
            title="调试"
            subtitle="日志入口开关；节点渲染链路标签由顶栏「调试」按钮控制"
          >
            <ToggleRow
              label="日志面板"
              value={settings.debugMode}
              onChange={(value) => update({ debugMode: value })}
              tooltip="开启后在画布右上角显示『执行日志』入口按钮，点击以弹窗形式查看实时执行日志；节点卡片上的渲染链路标签请用顶栏「调试」按钮"
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="border-border-strong text-ink-muted flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 text-[11px]">
          <span>设置保存在本浏览器</span>
          <Button
            variant="outline"
            size="xs"
            onClick={reset}
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright h-auto rounded-md px-2 py-1"
          >
            恢复默认
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── 右上角齿轮按钮（与 <ZoomIndicator> 并排） ── */

interface ButtonProps {
  hasOverrides: boolean;
  onClick: () => void;
}

export function CanvasSettingsButton({ hasOverrides, onClick }: ButtonProps) {
  return (
    <Hint label="画布设置 · 调整格子 / 坐标尺 / 缩略图 等">
      <Button
        variant="outline"
        onClick={onClick}
        aria-label="画布设置"
        className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-base pointer-events-auto absolute top-12 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight shadow-lg backdrop-blur-sm select-none"
      >
        <span aria-hidden className="mr-1 align-baseline text-[12px]">
          ⚙
        </span>
        设置
        {/* 紫色小点告诉用户「当前有偏离默认值的偏好」，
         * 不必先打开面板。它既是状态指示，也算一点点品牌色。 */}
        {hasOverrides && (
          <span
            aria-hidden
            className="bg-primary ml-1 inline-block size-1.5 -translate-y-px rounded-full align-middle shadow-[0_0_6px_rgba(167,139,250,0.7)]"
          />
        )}
      </Button>
    </Hint>
  );
}

/* ── Top-right 「重新居中」按钮（紧挨 ⚙ 设置上方） ──
 *
 * 为什么需要它：自动聚焦只在「打开工作流 / 进入子工作流」时做一次，之后
 * 作者把节点拖出视野、或用滚轮把画布缩成一团时，没有回到内容处的出口
 * （与项目画布的「重置布局」不同 —— 那个会改数据，这个只动视口）。
 * 纯视口动作，不写库、不移动任何节点。 */

export function CanvasRecenterButton({ onClick }: { onClick: () => void }) {
  return (
    <Hint label="回到有节点的位置（只移动视口，不改动节点布局）">
      <Button
        variant="outline"
        onClick={onClick}
        aria-label="重新居中"
        className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-base pointer-events-auto absolute top-3 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight shadow-lg backdrop-blur-sm select-none"
      >
        <span aria-hidden className="mr-1 align-baseline text-[12px]">
          🎯
        </span>
        居中
      </Button>
    </Hint>
  );
}

/* ── 小型的展示性行助手 ── */

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
        <h3 className="text-ink-soft text-[10.5px] font-semibold tracking-wider uppercase">
          {title}
        </h3>
        {subtitle && (
          <p className="text-ink-muted mt-0.5 text-[10.5px]">{subtitle}</p>
        )}
      </header>
      <div className="border-border-strong bg-subtle flex flex-col gap-2.5 rounded-lg border p-3">
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
    <FieldLabel className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink-soft" title={tooltip}>
          {label}
        </span>
        <span className="text-ink-soft font-mono tabular-nums">
          {format(value)}
        </span>
      </div>
      <RangeSlider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </FieldLabel>
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
    <FieldLabel className="flex cursor-pointer items-center justify-between gap-2 text-[11.5px]">
      <span className="text-ink-soft" title={tooltip}>
        {label}
      </span>
      {/* 与 ProjectCanvasSettings 的 ToggleRow 是同一件事（开关），此前各画
 一份 —— 现在都走 ui/switch（规范 16 §16.2.3）。 */}
      <Switch checked={value} onCheckedChange={onChange} className="shrink-0" />
    </FieldLabel>
  );
}
