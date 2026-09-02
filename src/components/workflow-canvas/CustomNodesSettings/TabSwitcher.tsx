"use client";

import type { CustomNodesSettingsController } from "./useCustomNodesSettings";

// 两个页面：本地工作流（仅路径输入）vs 自定义节点（解析/清单/日志）。
// 底部指示用项目 aurora 渐变（#A855F7 → #6366F1，见 globals.css）。每个 tab 带
// 状态 chip，免切换即可知哪侧已配。
export function TabSwitcher({ ctrl }: { ctrl: CustomNodesSettingsController }) {
  const { tab, setTab, savedLocalPaths, totalAcrossParents, savedPaths } = ctrl;
  return (
    <div
      role="tablist"
      aria-label="配置区域"
      className="mb-4 flex items-center gap-1 border-b border-border"
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "workflows"}
        onClick={() => setTab("workflows")}
        className={
          "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors " +
          (tab === "workflows" ? "text-ink" : "text-muted-foreground hover:text-ink")
        }
      >
        <span aria-hidden>📁</span>
        <span>本地工作流</span>
        {savedLocalPaths.length > 0 && (
          <span className="rounded-full bg-white/6 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            已配 {savedLocalPaths.length}
          </span>
        )}
        {tab === "workflows" && (
          <span
            aria-hidden
            className="absolute -bottom-px left-0 right-0 h-0.5 rounded-t"
            style={{ background: "linear-gradient(90deg,#A855F7,#6366F1)" }}
          />
        )}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "nodes"}
        onClick={() => setTab("nodes")}
        className={
          "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors " +
          (tab === "nodes" ? "text-ink" : "text-muted-foreground hover:text-ink")
        }
      >
        <span aria-hidden>{"\u{1F9E9}"}</span>
        <span>自定义节点</span>
        {totalAcrossParents.total > 0 && (
          <span className="rounded-full bg-white/6 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {totalAcrossParents.loaded}/{totalAcrossParents.total}
          </span>
        )}
        {!totalAcrossParents.total && savedPaths.length > 0 && (
          <span className="rounded-full bg-white/6 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            扫描中…
          </span>
        )}
        {tab === "nodes" && (
          <span
            aria-hidden
            className="absolute -bottom-px left-0 right-0 h-0.5 rounded-t"
            style={{ background: "linear-gradient(90deg,#A855F7,#6366F1)" }}
          />
        )}
      </button>
    </div>
  );
}
