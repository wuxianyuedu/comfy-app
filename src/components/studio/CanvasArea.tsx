"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";

/* ── Canvas Area with Context Menu + Bottom Toolbar ────
  Wraps content (e.g. WorkflowCanvas) with:
  - Right-click context menu
  - Bottom zoom/toolbar strip
  - Minimap toggle (bottom-left)
*/

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  divider?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

const DEFAULT_CONTEXT_MENU: ContextMenuItem[] = [
  { id: "upload", label: "上传", icon: <MenuIconUpload /> },
  { id: "text-node", label: "添加文本节点", icon: <MenuIconText /> },
  { id: "image-node", label: "添加图片节点", icon: <MenuIconImage /> },
  { id: "video-node", label: "添加视频节点", icon: <MenuIconVideo /> },
  { id: "audio-node", label: "添加音频节点", icon: <MenuIconAudio /> },
  { id: "agent-node", label: "添加 Agent 节点", icon: <MenuIconAgent /> },
  { id: "divider-1", label: "", divider: true },
  { id: "plugins", label: "插件库", icon: <MenuIconPlugin /> },
  { id: "fit-view", label: "适应屏幕", icon: <MenuIconFit /> },
  { id: "paste", label: "粘贴", icon: <MenuIconPaste /> },
];

export interface CanvasAreaProps {
  children: React.ReactNode;
  /** Custom context menu items */
  contextItems?: ContextMenuItem[];
  /** On context menu item click */
  onContextAction?: (id: string) => void;
  /** Zoom level (0-100) */
  zoom?: number;
  /** On zoom change */
  onZoomChange?: (zoom: number) => void;
  /** Extra toolbar elements (right side) */
  toolbarExtra?: React.ReactNode;
  /** Show minimap toggle */
  showMinimap?: boolean;
  /** Minimap visible state */
  minimapVisible?: boolean;
  /** On minimap toggle */
  onMinimapToggle?: (v: boolean) => void;
  /** Class name for canvas wrapper */
  className?: string;
}

export function CanvasArea({
  children,
  contextItems = DEFAULT_CONTEXT_MENU,
  onContextAction,
  zoom = 100,
  onZoomChange,
  toolbarExtra,
  showMinimap = true,
  minimapVisible = false,
  onMinimapToggle,
  className = "",
}: CanvasAreaProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    window.addEventListener("pointerdown", handler, { once: true });
    return () => window.removeEventListener("pointerdown", handler);
  }, [menu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleAction = useCallback(
    (id: string) => {
      setMenu(null);
      onContextAction?.(id);
    },
    [onContextAction]
  );

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full overflow-hidden bg-[#0a0a0f] ${className}`}
      onContextMenu={handleContextMenu}
    >
      {/* Canvas content */}
      {children}

      {/* ── Context Menu ── */}
      {menu && (
        <div
          className="fixed z-[9999] min-w-[200px] rounded-xl border border-white/10 bg-[#1a1a24] py-1.5 shadow-2xl shadow-black/50 backdrop-blur-md"
          style={{ left: menu.x, top: menu.y }}
        >
          {contextItems.map((item) =>
            item.divider ? (
              <div key={item.id} className="my-1 h-px bg-white/6" />
            ) : (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => handleAction(item.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed text-gray-600"
                    : item.danger
                    ? "text-red-400 hover:bg-red-500/10"
                    : "text-gray-300 hover:bg-white/8"
                }`}
              >
                <span className="shrink-0 text-gray-500">{item.icon}</span>
                {item.label}
              </button>
            )
          )}
        </div>
      )}

      {/* ── Bottom Toolbar ── */}
      <div className="absolute bottom-3 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-[#1a1a24]/90 px-1.5 py-1 shadow-lg shadow-black/30 backdrop-blur-md">
          {/* Send / Run button */}
          <ToolbarButton
            title="执行"
            onClick={() => onContextAction?.("run")}
            active
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 12h14m-7-7l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Zoom out */}
          <ToolbarButton title="缩小" onClick={() => onZoomChange?.(Math.max(10, zoom - 10))}>
            −
          </ToolbarButton>

          {/* Zoom level */}
          <span className="min-w-[48px] text-center text-xs text-gray-400 tabular-nums">
            {zoom}%
          </span>

          {/* Zoom in */}
          <ToolbarButton title="放大" onClick={() => onZoomChange?.(Math.min(400, zoom + 10))}>
            +
          </ToolbarButton>

          <ToolbarDivider />

          {/* Fit screen */}
          <ToolbarButton title="适应屏幕" onClick={() => onContextAction?.("fit-view")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </ToolbarButton>

          {/* Toggle visibility */}
          <ToolbarButton title="显示/隐藏" onClick={() => onContextAction?.("toggle-visibility")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Undo */}
          <ToolbarButton title="撤销" onClick={() => onContextAction?.("undo")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
            </svg>
          </ToolbarButton>

          {/* Redo */}
          <ToolbarButton title="重做" onClick={() => onContextAction?.("redo")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" />
            </svg>
          </ToolbarButton>

          {/* Extra */}
          {toolbarExtra}
        </div>
      </div>

      {/* ── Minimap Toggle (bottom-left) ── */}
      {showMinimap && (
        <button
          type="button"
          onClick={() => onMinimapToggle?.(!minimapVisible)}
          className={`absolute bottom-3 left-3 z-40 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
            minimapVisible
              ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : "border-white/10 bg-[#1a1a24]/80 text-gray-500 hover:text-gray-300"
          } backdrop-blur-sm`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          小地图
        </button>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────── */

function ToolbarButton({
  children,
  onClick,
  title,
  active = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-colors ${
        active
          ? "bg-white/10 text-white hover:bg-white/15"
          : "text-gray-400 hover:bg-white/6 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px bg-white/10" />;
}

/* ── Menu Icons ──────────────────────────────────────── */

function MenuIconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}
function MenuIconText() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  );
}
function MenuIconImage() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
function MenuIconVideo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><path d="M10 8l6 4-6 4V8z" />
    </svg>
  );
}
function MenuIconAudio() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  );
}
function MenuIconAgent() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}
function MenuIconPlugin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
function MenuIconFit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
    </svg>
  );
}
function MenuIconPaste() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}
