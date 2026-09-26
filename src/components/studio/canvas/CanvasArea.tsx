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
import { Button } from "~/components/ui/button";
import { zClass } from "~/lib/shell/overlay-z";

/* ── 画布区 + 右键菜单 + 底部工具栏 ────
  给内容（如 WorkflowCanvas）包上：
  - 右键上下文菜单
  - 底部缩放 / 工具栏条
  - minimap 开关（左下角）
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
  /** 自定义上下文菜单项 */
  contextItems?: ContextMenuItem[];
  /** 点上下文菜单项时 */
  onContextAction?: (id: string) => void;
  /** Zoom level (0-100) */
  zoom?: number;
  /** 缩放变化时 */
  onZoomChange?: (zoom: number) => void;
  /** 额外工具栏元素（右侧） */
  toolbarExtra?: React.ReactNode;
  /** 显示 minimap 开关 */
  showMinimap?: boolean;
  /** minimap 可见状态 */
  minimapVisible?: boolean;
  /** minimap 开关切换时 */
  onMinimapToggle?: (v: boolean) => void;
  /** 画布包裹层的 class 名 */
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

  // 点击外部时关闭菜单
  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    window.addEventListener("pointerdown", handler, { once: true });
    return () => window.removeEventListener("pointerdown", handler);
  }, [menu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAction = useCallback(
    (id: string) => {
      setMenu(null);
      onContextAction?.(id);
    },
    [onContextAction],
  );

  return (
    <div
      ref={containerRef}
      className={`bg-canvas relative flex h-full w-full overflow-hidden ${className}`}
      onContextMenu={handleContextMenu}
    >
      {/* Canvas content */}
      {children}

      {/* ── Context Menu ── */}
      {menu && (
        <div
          className={`border-border-strong bg-panel fixed ${zClass("popup")} min-w-[200px] rounded-xl border py-1.5 shadow-2xl shadow-black/20 backdrop-blur-md`}
          style={{ left: menu.x, top: menu.y }}
        >
          {contextItems.map((item) =>
            item.divider ? (
              <div key={item.id} className="bg-border-strong my-1 h-px" />
            ) : (
              <Button
                key={item.id}
                variant={item.danger ? "danger" : "ghost"}
                disabled={item.disabled}
                onClick={() => handleAction(item.id)}
                className={`flex h-auto w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-normal ${
                  item.disabled
                    ? "text-ink-fainter cursor-not-allowed"
                    : item.danger
                      ? "hover:bg-danger/10 text-danger-strong"
                      : "text-ink-strong hover:bg-subtle"
                }`}
              >
                <span className="text-ink-fainter shrink-0">{item.icon}</span>
                {item.label}
              </Button>
            ),
          )}
        </div>
      )}

      {/* ── Bottom Toolbar ── */}
      <div className="z-canvas-ui absolute bottom-3 left-1/2 -translate-x-1/2">
        <div className="border-border-strong bg-panel/95 flex items-center gap-0.5 rounded-xl border px-1.5 py-1 shadow-lg shadow-black/10 backdrop-blur-md">
          {/* 发送 / 运行按钮 */}
          <ToolbarButton
            title="执行"
            onClick={() => onContextAction?.("run")}
            active
          >
            <ArrowRight size={14} strokeWidth={2.5} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Zoom out */}
          <ToolbarButton
            title="缩小"
            onClick={() => onZoomChange?.(Math.max(10, zoom - 10))}
          >
            −
          </ToolbarButton>

          {/* Zoom level */}
          <span className="text-ink-muted min-w-[48px] text-center text-xs tabular-nums">
            {zoom}%
          </span>

          {/* Zoom in */}
          <ToolbarButton
            title="放大"
            onClick={() => onZoomChange?.(Math.min(400, zoom + 10))}
          >
            +
          </ToolbarButton>

          <ToolbarDivider />

          {/* Fit screen */}
          <ToolbarButton
            title="适应屏幕"
            onClick={() => onContextAction?.("fit-view")}
          >
            <Maximize size={13} />
          </ToolbarButton>

          {/* Toggle visibility */}
          <ToolbarButton
            title="显示/隐藏"
            onClick={() => onContextAction?.("toggle-visibility")}
          >
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

      {/* ── Minimap 开关（左下角） ── */}
      {showMinimap && (
        <Button
          variant="outline"
          onClick={() => onMinimapToggle?.(!minimapVisible)}
          className={`z-canvas-ui absolute bottom-3 left-3 flex h-8 gap-1.5 rounded-lg px-2.5 ${
            minimapVisible
              ? "text-ink-strong border-primary-500/30 bg-primary-500/10"
              : "border-border-strong bg-panel/85 text-ink-fainter hover:text-ink-strong"
          } backdrop-blur-sm`}
        >
          <LayoutGrid data-icon="inline-start" size={12} />
          小地图
        </Button>
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
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      title={title}
      className={`rounded-lg text-xs ${
        active
          ? "bg-primary/12 text-ink-bright hover:bg-primary/18"
          : "text-ink-muted hover:bg-subtle hover:text-ink-strong"
      }`}
    >
      {children}
    </Button>
  );
}

function ToolbarDivider() {
  return <div className="bg-border-strong mx-0.5 h-4 w-px" />;
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
