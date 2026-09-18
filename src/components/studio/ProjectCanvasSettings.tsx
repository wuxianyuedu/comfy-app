"use client";
/**
 * Project-canvas settings —
 *
 * Lightweight right-edge drawer surfaced from a top-right gear button on
 * the **project** canvas (ProjectCanvas).  The workflow editor
 * (`wf-editor-inner.tsx`) already has its own full settings drawer
 * (CanvasSettingsPanel) covering grid / rulers / minimap / zoom — those
 * are workflow-canvas concerns, not project-canvas ones, so we don't
 * duplicate them here.
 *
 * What the project canvas DOES need: the "调试模式" toggle, so the user
 * can flip it without first drill-in'ing into a workflow.  State is
 * shared with the workflow canvas via the same `useCanvasSettings()`
 * store (useSyncExternalStore + localStorage `v1`), so toggling here
 * instantly takes effect there and vice versa.
 */
import { useDebugMode } from "./canvas/WorkflowCanvasSettings";
import { useDebugStore } from "./debug/debug-store";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";

/* ── Toggle (inline, mirrors CanvasSettingsPanel's ToggleRow look) ── */
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
    <label
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
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          value
            ? "border-violet-400/60 bg-violet-500/80"
            : "border-border-strong bg-subtle"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
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
        className="bg-panel border-border-strong text-ink-bright w-[340px] gap-0 border-l sm:max-w-[340px]"
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
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright rounded-md border px-1.5 py-0.5 text-[11px] transition-colors"
          >
            ✕
          </button>
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

/* ── Top-right gear button (sits to the right of the center toolbar) ── */
export function ProjectSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="项目画布设置"
      aria-label="项目画布设置"
      data-testid="project-canvas-settings-button"
      className="border-border-strong bg-panel/90 text-ink-soft hover:text-ink-bright pointer-events-auto absolute top-3 right-3 z-20 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium tracking-tight shadow-lg backdrop-blur-sm transition-colors select-none hover:border-white/25"
    >
      <span aria-hidden className="mr-1 align-baseline text-[12.5px]">
        ⚙
      </span>
      设置
    </button>
  );
}
