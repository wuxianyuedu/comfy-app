/* CustomNodesSettings 弹窗的视觉预设。
 * 从原来的单文件 CustomNodesSettings.tsx 原样搬来。 */

import type { RowState } from "./types";

export const ROW_STATE_PRESET: Record<
  RowState["kind"],
  {
    /** 行内动作按钮（配色走 Button 变体 + 本模块的排布补充）。 */
    btn: string;
    btnLabel: string;
    label: string;
    /** 展开区左侧竖轨。 */
    railCls: string;
    /** 整行的底色 / 边框（语义 token）。 */
    rowCls: string;
    /** `ui/status-badge` 认的状态键（配色只有那一处，规范 16 §16.2.4.5）。 */
    status: string;
  }
> = {
  empty: {
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无可导入节点",
    label: "无 NODE_CLASS_MAPPINGS",
    railCls: "border-border-strong",
    rowCls: "border-border-strong bg-subtle",
    status: "IDLE",
  },
  error: {
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "重新解析",
    label: "解析出错",
    railCls: "border-destructive/30",
    rowCls: "border-destructive/30 bg-destructive/5",
    status: "ERROR",
  },
  loaded: {
    btn: "border border-success/40 text-success-strong hover:bg-success/10",
    btnLabel: "重新解析",
    label: "✓ 已加载",
    railCls: "border-success/20",
    rowCls: "border-success/20 bg-success/5",
    status: "SUCCEEDED",
  },
  missing: {
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无法解析",
    label: "目录不存在",
    railCls: "border-warning/20",
    rowCls: "border-warning/20 bg-warning/5",
    status: "QUEUED",
  },
  outdated: {
    btn: "bg-warning text-white hover:opacity-90",
    btnLabel: "重新解析",
    label: "↻ 有更新",
    railCls: "border-warning/20",
    rowCls: "border-warning/20 bg-warning/5",
    status: "QUEUED",
  },
  unimported: {
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "导入此包",
    label: "未导入",
    railCls: "border-border-strong",
    rowCls: "border-border-strong bg-subtle",
    status: "IDLE",
  },
};

/* 自定义节点状态 → 文案。配色不在这里 —— 由 `ui/status-badge` 按状态键
 * 统一给出（此前本文件另存一份 rgba/hex，与页面其余状态徽标各写一套）。 */
/* `ok` 单独具名：它是「状态键对不上时」的兜底文案，调用点写
 * `STATUS_STYLE[x] ?? OK_STATUS_STYLE` 即可，不必再补 `!`（表是索引签名）。 */
export const OK_STATUS_STYLE: { label: string } = { label: "已加载" };

export const STATUS_STYLE: Record<string, { label: string }> = {
  empty: { label: "无 NODE_CLASS_MAPPINGS" },
  error: { label: "解析出错" },
  missing: { label: "目录不存在" },
  ok: OK_STATUS_STYLE,
};
