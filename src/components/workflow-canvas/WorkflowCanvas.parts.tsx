"use client";

/**
 * WorkflowCanvas 的展示子组件：浮动工具栏、加节点菜单、导出弹窗。
 * 从 WorkflowCanvas.tsx 抽出，使主组件聚焦于画布状态与数据流。
 */

import { CATEGORY_LABELS, getAllNodeTypes, getNodeConfig } from "./node-registry";
import type { ComfyGraph } from "./types";

/* ── Floating toolbar ── */
export function CanvasToolbar({
  onToggleAddMenu,
  onDeleteSelected,
  canDelete,
  onGenerate,
  onToggleExport,
}: {
  onToggleAddMenu: () => void;
  onDeleteSelected: () => void;
  canDelete: boolean;
  onGenerate: () => void;
  onToggleExport: () => void;
}) {
  return (
    <div className="wf-toolbar">
      <button
        className="wf-toolbar__btn"
        onClick={onToggleAddMenu}
        title="添加节点"
      >
        +
      </button>
      <button
        className="wf-toolbar__btn"
        onClick={onDeleteSelected}
        disabled={!canDelete}
        title="删除选中"
      >
        {"\u2715"}
      </button>
      <span className="wf-toolbar__sep" />

      <button
        className="wf-toolbar__btn wf-toolbar__btn--primary"
        onClick={onGenerate}
        title="生成图像"
      >
        {"\u25B6"} 生成
      </button>
      <button
        className="wf-toolbar__btn"
        onClick={onToggleExport}
        title="导出 JSON"
      >
        {"\u{1F4BE}"}
      </button>
    </div>
  );
}

/* ── Add-node menu ── */
export function AddNodeMenu({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (classType: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="wf-add-menu" onMouseLeave={onClose}>
      <div className="wf-add-menu__header">添加节点</div>
      {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
        <div key={cat} className="wf-add-menu__group">
          <div className="wf-add-menu__group-label">{label}</div>
          {getAllNodeTypes()
            .filter((ct) => getNodeConfig(ct).category === cat)
            .map((ct) => {
              const cfg = getNodeConfig(ct);
              return (
                <button
                  key={ct}
                  className="wf-add-menu__item"
                  onClick={() => onAdd(ct)}
                >
                  <span style={{ color: cfg.color }}>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                  <span className="wf-add-menu__item-type">{ct}</span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/* ── Export modal ── */
export function ExportModal({
  open,
  onClose,
  graph,
}: {
  open: boolean;
  onClose: () => void;
  graph: ComfyGraph;
}) {
  if (!open) return null;
  return (
    <div className="wf-export-modal" onClick={onClose}>
      <div
        className="wf-export-modal__card"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>导出工作流 JSON</h3>
        <p style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          ComfyUI API 格式，可直接导入 ComfyUI 或保存为模板
        </p>
        <textarea
          readOnly
          value={JSON.stringify(graph, null, 2)}
          rows={12}
          style={{
            width: "100%",
            background: "#0D0818",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#A99BC7",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: 10,
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            className="wf-toolbar__btn wf-toolbar__btn--primary"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(graph));
              onClose();
            }}
          >
            复制到剪贴板
          </button>
          <button className="wf-toolbar__btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
