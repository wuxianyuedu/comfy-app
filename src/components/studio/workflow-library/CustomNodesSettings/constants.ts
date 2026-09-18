/* CustomNodesSettings 弹窗的视觉预设。
 * 从原来的单文件 CustomNodesSettings.tsx 原样搬来。 */

import type { RowState } from "./types";

export const ROW_STATE_PRESET: Record<
  RowState["kind"],
  {
    /** `ui/status-badge` 认的状态键（配色只有那一处，规范 16 §16.2.4.5）。 */
    status: string;
    label: string;
    /** 整行的底色 / 边框（语义 token）。 */
    rowCls: string;
    /** 展开区左侧竖轨。 */
    railCls: string;
    /** 行内动作按钮（配色走 Button 变体 + 本模块的排布补充）。 */
    btn: string;
    btnLabel: string;
  }
> = {
  loaded: {
    status: "SUCCEEDED",
    label: "✓ 已加载",
    rowCls: "border-success/20 bg-success/5",
    railCls: "border-success/20",
    btn: "border border-success/40 text-success-strong hover:bg-success/10",
    btnLabel: "重新解析",
  },
  outdated: {
    status: "QUEUED",
    label: "↻ 有更新",
    rowCls: "border-warning/20 bg-warning/5",
    railCls: "border-warning/20",
    btn: "bg-warning text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  unimported: {
    status: "IDLE",
    label: "未导入",
    rowCls: "border-border-strong bg-subtle",
    railCls: "border-border-strong",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "导入此包",
  },
  error: {
    status: "ERROR",
    label: "解析出错",
    rowCls: "border-destructive/30 bg-destructive/5",
    railCls: "border-destructive/30",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  missing: {
    status: "QUEUED",
    label: "目录不存在",
    rowCls: "border-warning/20 bg-warning/5",
    railCls: "border-warning/20",
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无法解析",
  },
  empty: {
    status: "IDLE",
    label: "无 NODE_CLASS_MAPPINGS",
    rowCls: "border-border-strong bg-subtle",
    railCls: "border-border-strong",
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无可导入节点",
  },
};

/* 自定义节点状态 → 文案。配色不在这里 —— 由 `ui/status-badge` 按状态键
 * 统一给出（此前本文件另存一份 rgba/hex，与页面其余状态徽标各写一套）。 */
export const STATUS_STYLE: Record<string, { label: string }> = {
  ok: { label: "已加载" },
  missing: { label: "目录不存在" },
  error: { label: "解析出错" },
  empty: { label: "无 NODE_CLASS_MAPPINGS" },
};
