"use client";
/* ── 画布设置面板（右侧抽屉，宽 340px） ──
 * 由 <CanvasSettingsButton> 打开；按 Esc、点遮罩或点 × 都会关闭。
 * 状态经 props 传入（settings / update / reset），本组件不持有存储 ——
 * 唯一事实源在 `hooks/use-canvas-settings.ts`。
 */
import type { ReactNode } from "react";

import { fixed } from "~/lib/number-format";
import { Badge } from "~/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Button } from "~/components/ui/button";
import { RangeSlider } from "~/components/ui/range-slider";
import { Switch } from "~/components/ui/switch";
import { FieldLabel } from "~/components/ui/field";

import type { CanvasSettings } from "./canvas-settings-types";

/* 读数格式化：`fixed` 是全库 `toFixed` 的唯一落点（~/lib/number-format），
 * 非有限数返回 null —— 这里以空串兜底，不渲染出「NaN」。 */
function formatAlpha(value: number): string {
  return fixed(value, 2) ?? "";
}

function formatPx(value: number): string {
  return `${fixed(value, 2) ?? ""}px`;
}

interface PanelProps {
  onClose: () => void;
  reset: () => void;
  settings: CanvasSettings;
  update: (patch: Partial<CanvasSettings>) => void;
}

export function CanvasSettingsPanel({ settings, update, reset, onClose }: PanelProps) {
  /* 抽屉走 ui/sheet（规范 16 §16.2.3 P2）：Esc 关闭、点遮罩关闭、遮罩让出
 标题行与 ProjectSettingsDrawer 是同一件事，此前两边各写一份。 */
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open>
      <SheetContent
        aria-label="工作流画布设置"
        className="bg-panel/97 border-border-strong text-ink-bright w-85 gap-0 border-l shadow-2xl shadow-black/10 sm:max-w-85 dark:shadow-black/50"
        showCloseButton={false}
        side="right"
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
            <Badge className="font-mono" size="pill-sm" tone="neutral">
              v1
            </Badge>
          </div>
          <Button
            aria-label="关闭"
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright text-2xs rounded-md"
            onClick={onClose}
            size="icon-xs"
            variant="outline"
          >
            ✕
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section subtitle="背景格子线条的视觉强度" title="网格">
            <SliderRow
              format={formatAlpha}
              label="细线透明度"
              max={1}
              min={0}
              onChange={(value) => update({ gridMinorAlpha: value })}
              step={0.02}
              tooltip="细格子 (默认 10px 一格) 线条的可见度。设为 0 接近全透明"
              value={settings.gridMinorAlpha}
            />
            <SliderRow
              format={formatAlpha}
              label="主线透明度"
              max={1}
              min={0}
              onChange={(value) => update({ gridMajorAlpha: value })}
              step={0.02}
              tooltip="主参考线 (每 10 格 = 100px) 的可见度"
              value={settings.gridMajorAlpha}
            />
            <SliderRow
              format={formatPx}
              label="细线宽度"
              max={3}
              min={0.5}
              onChange={(value) => update({ gridMinorLineWidth: value })}
              step={0.25}
              value={settings.gridMinorLineWidth}
            />
            <SliderRow
              format={formatPx}
              label="主线宽度"
              max={3}
              min={0.5}
              onChange={(value) => update({ gridMajorLineWidth: value })}
              step={0.25}
              value={settings.gridMajorLineWidth}
            />
            <SliderRow
              format={(value) => `${value}px`}
              label="格子间距"
              max={40}
              min={4}
              onChange={(value) => update({ gridGap: value })}
              step={2}
              tooltip="细格子之间的世界坐标距离；调小 → 更密集的网格"
              value={settings.gridGap}
            />
            <ToggleRow
              label="显示网格"
              onChange={(value) => update({ showGrid: value })}
              value={settings.showGrid}
            />
          </Section>

          <Section subtitle="坐标尺 / 缩略图 等装饰" title="画布">
            <ToggleRow
              label="显示坐标尺"
              onChange={(value) => update({ showRulers: value })}
              tooltip="四边的世界坐标刻度，鼠标移动时会同步高亮最近刻度"
              value={settings.showRulers}
            />
            <ToggleRow
              label="显示缩略图"
              onChange={(value) => update({ showMiniMap: value })}
              tooltip="右下角缩略图，方便定位大规模工作流"
              value={settings.showMiniMap}
            />
          </Section>

          <Section subtitle="下次打开编辑器时生效" title="缩放">
            <SliderRow
              format={(value) => `${fixed(value, 1) ?? ""}×`}
              label="最大缩放"
              max={4}
              min={1}
              onChange={(value) => update({ maxZoom: value })}
              step={0.1}
              value={settings.maxZoom}
            />
            <SliderRow
              format={(value) => `${fixed(value, 2) ?? ""}×`}
              label="最小缩放"
              max={0.5}
              min={0.05}
              onChange={(value) => update({ minZoom: value })}
              step={0.05}
              value={settings.minZoom}
            />
          </Section>

          <Section subtitle="日志入口开关；节点渲染链路标签由顶栏「调试」按钮控制" title="调试">
            <ToggleRow
              label="日志面板"
              onChange={(value) => update({ debugMode: value })}
              tooltip="开启后在画布右上角显示『执行日志』入口按钮，点击以弹窗形式查看实时执行日志；节点卡片上的渲染链路标签请用顶栏「调试」按钮"
              value={settings.debugMode}
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="border-border-strong text-ink-muted text-2xs flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
          <span>设置保存在本浏览器</span>
          <Button
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright h-auto rounded-md px-2 py-1"
            onClick={reset}
            size="xs"
            variant="outline"
          >
            恢复默认
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── 小型的展示性行助手（模块私有：只有本面板在用） ── */

function Section({
  title,
  subtitle,
  children,
}: {
  children: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <header className="mb-2">
        <h3 className="text-ink-soft text-2xs font-semibold tracking-wider uppercase">{title}</h3>
        {subtitle && <p className="text-ink-muted text-2xs mt-0.5">{subtitle}</p>}
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
  format: (value: number) => string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  tooltip?: string;
  value: number;
}) {
  return (
    <FieldLabel className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink-soft" title={tooltip}>
          {label}
        </span>
        <span className="text-ink-soft font-mono tabular-nums">{format(value)}</span>
      </div>
      <RangeSlider max={max} min={min} onChange={onChange} step={step} value={value} />
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
  onChange: (value: boolean) => void;
  tooltip?: string;
  value: boolean;
}) {
  return (
    <FieldLabel className="flex cursor-pointer items-center justify-between gap-2 text-[11.5px]">
      <span className="text-ink-soft" title={tooltip}>
        {label}
      </span>
      {/* 与 ProjectCanvasSettings 的 ToggleRow 是同一件事（开关），此前各画
 一份 —— 现在都走 ui/switch（规范 16 §16.2.3）。 */}
      <Switch checked={value} className="shrink-0" onCheckedChange={onChange} />
    </FieldLabel>
  );
}
