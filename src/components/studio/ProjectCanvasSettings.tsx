"use client";
/**
 * 项目画布设置 ——
 *
 * **项目**画布（ProjectCanvas）右上角齿轮按钮弹出的轻量
 * 右边缘抽屉。工作流编辑器
 *（`wf-editor-inner.tsx`）已有自己的完整设置抽屉
 *（CanvasSettingsPanel），覆盖网格 / 标尺 / minimap / 缩放 —— 那些
 * 是工作流画布的关切，不是项目画布的，所以这里不
 * 重复它们。
 *
 * 项目画布**确实**需要的：调试模式开关，好让用户
 * 不用先下钻进一条工作流就能翻转它。状态经同一个 `useCanvasSettings()`
 * store 与工作流画布共享（useSyncExternalStore + localStorage `v1`），所以在这里
 * 切换会立刻在那里生效，反之亦然。
 */
import { useDebugMode } from "./canvas/hooks/use-canvas-settings";
import { useDebugStore } from "./debug/debug-store";
import { Hint } from "~/components/ui/hint";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { FieldLabel } from "~/components/ui/field";

/* ── 开关（内联，镜像 CanvasSettingsPanel 的 ToggleRow 观感） ── */
function ToggleRow({
  label,
  hint,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}) {
  return (
    <FieldLabel
      title={tooltip}
      className="border-border-strong bg-subtle hover:border-border-strong flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-ink-bright text-[12.5px] font-medium">
          {label}
        </span>
        {hint && (
          <span className="text-ink-muted mt-0.5 text-[10.5px]">{hint}</span>
        )}
      </span>
      {/* 开关走 ui/switch（规范 16 §16.2.3）：此前这里自绘了一个
          「圆角底 + 绝对定位圆点」的开关，与 CanvasSettingsPanel 的另一份
          同形实现各自维护 —— 开关是**状态控件**，样式改动应当只发生在一处。 */}
      <Switch checked={value} onCheckedChange={onChange} className="shrink-0" />
    </FieldLabel>
  );
}

/* ── Drawer ── */
export function ProjectSettingsDrawer({ onClose }: { onClose: () => void }) {
  /* 「渲染链路标签」开关走全局 debug-store（与工作流画布顶栏"调试"按钮、
   *  workflow-canvas ComfyNode 共用同一开关）；「日志面板」开关走
   *  useCanvasSettings.debugMode（与工作流画布设置抽屉共享）。 */
  const debugMode = useDebugStore((state) => state.debugMode);
  const toggleDebugMode = useDebugStore((state) => state.toggleDebugMode);
  const { debugMode: logPanelMode, setDebugMode: setLogPanelMode } =
    useDebugMode();

  /* 抽屉走 ui/sheet（规范 16 §16.2.3 P2）：Esc 关闭、点遮罩关闭、遮罩让出
     标题行此前是本文件手写的一份，`ui/sheet` 里还有一份同源实现。 */
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="bg-panel border-border-strong text-ink-bright w-85 gap-0 border-l sm:max-w-85"
        aria-label="项目画布设置"
      >
        <SheetTitle className="sr-only">项目画布设置</SheetTitle>
        {/* Header */}
        <div className="border-border-strong flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-[15px]">
              ⚙
            </span>
            <span className="text-ink-bright truncate text-[12.5px] font-semibold tracking-wide">
              项目画布设置
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
          <h3 className="text-ink-soft px-1 text-[11px] font-semibold tracking-wider uppercase">
            调试
          </h3>
          <p className="text-ink-muted mb-3 px-1 text-[11px] leading-relaxed">
            「渲染链路标签」在节点卡片上叠加显示对应本项目代码模块的路径，点击可查看源码；
            「日志面板」在画布右上角显示执行日志入口按钮，点击以弹窗形式查看实时执行日志。两者相互独立。
          </p>
          <ToggleRow
            label="渲染链路标签"
            hint="节点卡片底部显示代码模块，点击查看源码"
            value={debugMode}
            onChange={toggleDebugMode}
            tooltip="开启后每个节点卡片底部叠加显示渲染链路模块标签（如 workflow-node.tsx / CanvasNode.tsx），点击标签弹出对应源码"
          />
          <div className="h-2" />
          <ToggleRow
            label="日志面板"
            hint="弹窗形式查看执行日志 + file:line 调用位置"
            value={logPanelMode}
            onChange={setLogPanelMode}
            tooltip="开启后在画布右上角显示『执行日志』入口按钮，点击以弹窗形式查看实时执行日志，并在每条日志后标注调用代码位置（file:line）"
          />
        </div>

        {/* Footer */}
        <div className="border-border-strong text-ink-muted flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 text-[11px]">
          <span>设置保存在本浏览器</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── 右上角齿轮按钮（位于居中工具栏右侧） ── */
export function ProjectSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Hint label="项目画布设置">
      <Button
        variant="outline"
        onClick={onClick}
        aria-label="项目画布设置"
        data-testid="project-canvas-settings-button"
        className="border-border-strong bg-panel/90 text-ink-soft hover:text-ink-bright z-canvas-ui pointer-events-auto absolute top-3 right-3 h-auto rounded-md px-2.5 py-1.5 text-[11.5px] font-medium tracking-tight shadow-lg backdrop-blur-sm select-none hover:border-white/25"
      >
        <span aria-hidden className="mr-1 align-baseline text-[12.5px]">
          ⚙
        </span>
        设置
      </Button>
    </Hint>
  );
}
