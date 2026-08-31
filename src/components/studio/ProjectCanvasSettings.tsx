"use client";
/**
 * Project-canvas settings — R-ardot119 (2026-08-18).
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
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useDebugMode } from "./canvas/WorkflowCanvasSettings";
import { useDebugStore } from "./debug/debug-store";

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
      className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-white/6 bg-white/2 px-3 py-2.5 transition-colors hover:border-white/14.000000000000002"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-[12.5px] font-medium text-gray-100">{label}</span>
        {hint && <span className="mt-0.5 text-[10.5px] text-gray-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          value
            ? "border-violet-400/60 bg-violet-500/80"
            : "border-white/10 bg-white/6"
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
  const { debugMode: logPanelMode, setDebugMode: setLogPanelMode } = useDebugMode();

  /* Esc closes the drawer — standard drawer affordance, mirrors
   * CanvasSettingsPanel's behaviour. */
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
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      {/* Click-to-dismiss scrim */}
      <button
        type="button"
        aria-label="关闭项目画布设置"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/40 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label="项目画布设置"
        className="flex h-full w-[340px] flex-col border-l border-white/6 bg-[#0c0c14]/97 text-gray-200 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-[15px]">⚙</span>
            <span className="truncate text-[12.5px] font-semibold tracking-wide text-gray-100">
              项目画布设置
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
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            调试
          </h3>
          <p className="mb-3 px-1 text-[11px] leading-relaxed text-gray-500">
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
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/6 px-4 py-3 text-[11px] text-gray-500">
          <span>设置保存在本浏览器</span>
        </div>
      </aside>
    </div>,
    document.body
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
      className="pointer-events-auto absolute right-3 top-3 z-20 select-none rounded-md border border-white/10 bg-(--color-panel)/90 px-2.5 py-1.5 text-[11.5px] font-medium tracking-tight text-gray-300 shadow-lg backdrop-blur-sm transition-colors hover:border-white/25 hover:text-gray-100"
    >
      <span aria-hidden className="mr-1 align-baseline text-[12.5px]">⚙</span>
      设置
    </button>
  );
}
