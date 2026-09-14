"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  ArrowRight,
  Clipboard,
  Eye,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Maximize,
  Music,
  RotateCcw,
  RotateCw,
  SquarePlay,
  Type,
  Upload,
  Wrench,
} from "lucide-react";

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
      className={`relative flex h-full w-full overflow-hidden bg-canvas ${className}`}
      onContextMenu={handleContextMenu}
    >
      {/* Canvas content */}
      {children}

      {/* ── Context Menu ── */}
      {menu && (
        <div
          className="fixed z-9999 min-w-[200px] rounded-xl border border-border-strong bg-panel py-1.5 shadow-2xl shadow-black/20 backdrop-blur-md"
          style={{ left: menu.x, top: menu.y }}
        >
          {contextItems.map((item) =>
            item.divider ? (
              <div key={item.id} className="my-1 h-px bg-border-strong" />
            ) : (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => handleAction(item.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed text-ink-fainter"
                    : item.danger
                    ? "text-red-700 hover:bg-red-500/10 dark:text-red-400"
                    : "text-ink-strong hover:bg-subtle"
                }`}
              >
                <span className="shrink-0 text-ink-fainter">{item.icon}</span>
                {item.label}
              </button>
            )
          )}
        </div>
      )}

      {/* ── Bottom Toolbar ── */}
      <div className="absolute bottom-3 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-xl border border-border-strong bg-panel/95 px-1.5 py-1 shadow-lg shadow-black/10 backdrop-blur-md">
          {/* Send / Run button */}
          <ToolbarButton
            title="执行"
            onClick={() => onContextAction?.("run")}
            active
          >
            <ArrowRight size={14} strokeWidth={2.5} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Zoom out */}
          <ToolbarButton title="缩小" onClick={() => onZoomChange?.(Math.max(10, zoom - 10))}>
            −
          </ToolbarButton>

          {/* Zoom level */}
          <span className="min-w-[48px] text-center text-xs text-ink-muted tabular-nums">
            {zoom}%
          </span>

          {/* Zoom in */}
          <ToolbarButton title="放大" onClick={() => onZoomChange?.(Math.min(400, zoom + 10))}>
            +
          </ToolbarButton>

          <ToolbarDivider />

          {/* Fit screen */}
          <ToolbarButton title="适应屏幕" onClick={() => onContextAction?.("fit-view")}>
            <Maximize size={13} />
          </ToolbarButton>

          {/* Toggle visibility */}
          <ToolbarButton title="显示/隐藏" onClick={() => onContextAction?.("toggle-visibility")}>
            <Eye size={13} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Undo */}
          <ToolbarButton title="撤销" onClick={() => onContextAction?.("undo")}>
            <RotateCcw size={13} />
          </ToolbarButton>

          {/* Redo */}
          <ToolbarButton title="重做" onClick={() => onContextAction?.("redo")}>
            <RotateCw size={13} />
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
              ? "border-violet-500/30 bg-violet-500/10 text-ink-strong"
              : "border-border-strong bg-panel/85 text-ink-fainter hover:text-ink-strong"
          } backdrop-blur-sm`}
        >
          <LayoutGrid size={12} />
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
          ? "bg-primary/12 text-ink-bright hover:bg-primary/18"
          : "text-ink-muted hover:bg-subtle hover:text-ink-strong"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px bg-border-strong" />;
}

/* ── Menu Icons ──────────────────────────────────────── */

function MenuIconUpload() {
  return <Upload size={14} />;
}
function MenuIconText() {
  return <Type size={14} />;
}
function MenuIconImage() {
  return <ImageIcon size={14} />;
}
function MenuIconVideo() {
  return <SquarePlay size={14} />;
}
function MenuIconAudio() {
  return <Music size={14} />;
}
function MenuIconAgent() {
  return <Layers size={14} />;
}
function MenuIconPlugin() {
  return <Wrench size={14} />;
}
function MenuIconFit() {
  return <Maximize size={14} />;
}
function MenuIconPaste() {
  return <Clipboard size={14} />;
}
