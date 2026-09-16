/* Visual presets for the CustomNodesSettings dialog.
 * Moved verbatim from the original single-file CustomNodesSettings.tsx. */

import type { RowState } from "./types";

export const ROW_STATE_PRESET: Record<
  RowState["kind"],
  {
    bg: string;
    fg: string;
    label: string;
    chip: string;
    btn: string;
    btnLabel: string;
  }
> = {
  loaded: {
    bg: "rgba(16,185,129,0.10)",
    fg: "#10B981",
    label: "✓ 已加载",
    chip: "border-emerald-500/30",
    btn: "border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10",
    btnLabel: "重新解析",
  },
  outdated: {
    bg: "rgba(245,158,11,0.10)",
    fg: "#F59E0B",
    label: "↻ 有更新",
    chip: "border-amber-500/40",
    btn: "bg-amber-500 text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  unimported: {
    bg: "rgba(107,114,128,0.10)",
    fg: "#9CA3AF",
    label: "未导入",
    chip: "border-gray-500/30",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "导入此包",
  },
  error: {
    bg: "rgba(239,68,68,0.10)",
    fg: "#EF4444",
    label: "解析出错",
    chip: "border-red-500/40",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  missing: {
    bg: "rgba(245,158,11,0.10)",
    fg: "#F59E0B",
    label: "目录不存在",
    chip: "border-amber-500/40",
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无法解析",
  },
  empty: {
    bg: "rgba(107,114,128,0.08)",
    fg: "#9CA3AF",
    label: "无 NODE_CLASS_MAPPINGS",
    chip: "border-gray-500/30",
    btn: "border border-border text-muted-foreground cursor-not-allowed",
    btnLabel: "无可导入节点",
  },
};

export const STATUS_STYLE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  ok: { bg: "rgba(16,185,129,0.15)", fg: "#10B981", label: "已加载" },
  missing: { bg: "rgba(245,158,11,0.18)", fg: "#F59E0B", label: "目录不存在" },
  error: { bg: "rgba(239,68,68,0.18)", fg: "#EF4444", label: "解析出错" },
  empty: {
    bg: "rgba(107,114,128,0.18)",
    fg: "#9CA3AF",
    label: "无 NODE_CLASS_MAPPINGS",
  },
};
