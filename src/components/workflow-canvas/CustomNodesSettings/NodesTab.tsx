"use client";

import { ROW_STATE_PRESET } from "./constants";
import { NodePreviewCard } from "./NodePreviewCard";
import { ManifestSummary, ParseProgressBanner } from "./SettingsParts";
import type { CustomNodesSettingsController } from "./useCustomNodesSettings";

export function NodesTab({ ctrl }: { ctrl: CustomNodesSettingsController }) {
  const {
    pathsText,
    setPathsText,
    saving,
    saveErr,
    onParseAll,
    summary,
    loading,
    progress,
    savedPaths,
    savedAt,
    parsing,
    totalAcrossParents,
    parentBlocks,
    expandedParents,
    setExpandedParents,
    perPkgParsing,
    onParseAllParent,
    expandedNodeList,
    setExpandedNodeList,
    manifestByNode,
    nodeExpanded,
    setNodeExpanded,
    onParseSingle,
  } = ctrl;
  return (
    <>
      {/* 自定义节点目录（CUSTOM_NODES_PATH）—— 原始 section */}
      <section className="mb-4 rounded-xl border border-border bg-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-sm font-medium text-ink">
            自定义节点目录（CUSTOM_NODES_PATH）
          </label>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "rgba(16,185,129,0.18)", color: "var(--color-success-strong)" }}
            title="解析器只读取这些目录里的 .py、绝不修改其中任何文件"
          >
            🔒 只读
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          每行一个目录（也可英文逗号分隔）。支持相对（项目根）或绝对路径。解析器只读取这些目录、绝不修改其中任何文件。
        </p>
        <textarea
          value={pathsText}
          onChange={(event) => setPathsText(event.target.value)}
          rows={Math.max(2, Math.min(savedPaths.length || 2, 6))}
          placeholder={"scripts/fixtures/sample_custom_nodes\nD:/ComfyUI/custom_nodes"}
          className="mb-2 w-full resize-none rounded-lg border border-border bg-surface p-3 font-mono text-xs text-ink outline-none placeholder:text-gray-500 focus:border-primary"
        />
        <div className="mb-4 flex items-center justify-between text-xs">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {saving && (
              <span className="flex items-center gap-1.5 text-primary">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                自动保存中…
              </span>
            )}
            {!saving && saveErr && <span className="text-red-400">⚠ {saveErr}</span>}
            {/* Directory overview chips — show totals + outdated count when any subpackage is detected. */}
            {totalAcrossParents.total > 0 && (
              <>
                <span className="rounded-full bg-white/6 px-2 py-0.5 text-ink">
                  总览 {totalAcrossParents.total} 个子包
                </span>
                {totalAcrossParents.loaded > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 font-medium"
                    style={{ background: "rgba(16,185,129,0.18)", color: "var(--color-success-strong)" }}
                  >
                    ✓ 已加载 {totalAcrossParents.loaded}
                  </span>
                )}
                {totalAcrossParents.outdated > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 font-medium"
                    style={{ background: "rgba(245,158,11,0.22)", color: "var(--color-warning)" }}
                  >
                    ↻ 有更新 {totalAcrossParents.outdated}
                  </span>
                )}
              </>
            )}
            {!saving && !saveErr && loading && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 animate-spin rounded-full border border-muted border-t-transparent" />
                加载中…
              </span>
            )}
            {!saving && !saveErr && !loading && savedAt && totalAcrossParents.total === 0 && (
              <span className="text-emerald-400">✓ 已自动保存 {savedAt}</span>
            )}
            {!saving && !saveErr && !loading && !savedAt && totalAcrossParents.total === 0 && (
              <span>未配置 — 上面输入至少一个目录</span>
            )}
          </div>
          <button
            onClick={onParseAll}
            disabled={parsing || savedPaths.length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {parsing ? "解析全部中…" : "▶ 解析全部"}
          </button>
        </div>
      </section>

      {/* Live manifest summary */}
      {summary && (
        <ManifestSummary summary={summary} />
      )}
      {loading && !summary && (
        <ParseProgressBanner progress={progress} />
      )}

      {/* Group-by-parent collapsible view. Each top-level dir is its own
          block; subpackages inside a block can be hidden / shown via the
          chevron so the user can focus on one source tree at a time. */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">
            可导入的节点包
            {totalAcrossParents.outdated > 0 && (
              <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "rgba(245,158,11,0.18)", color: "var(--color-warning)" }}>
                ↻ {totalAcrossParents.outdated} 个有更新
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            共 {totalAcrossParents.total} 个子包
            {savedPaths.length > 0
              ? ` · 已加载 ${totalAcrossParents.loaded + totalAcrossParents.outdated}/${totalAcrossParents.total}`
              : ""}
          </span>
        </div>
        {savedPaths.length === 0 && !loading && (
          <div className="rounded-lg border border-dashed border-border bg-bg/50 p-4 text-center text-xs text-muted-foreground">
            上面输入至少一个目录后，会自动发现其下的节点包。
          </div>
        )}
        <div className="space-y-2">
          {parentBlocks.map(({ parent, subs, cnt, total }) => {
            const isOpen = !!expandedParents[parent];
            const parentParsed = total > 0 && cnt.unimported + cnt.missing + cnt.empty === 0;
            return (
              <div key={parent} className="rounded-xl border border-border bg-bg">
                {/* Parent header — clickable to toggle.
                    IMPORTANT: must NOT be a <button>, because the row contains a
                    nested action <button> ("解析本目录"). Nested <button> in HTML
                    is invalid and triggers React hydration errors. We use a div
                    with role/keyboard handlers so a11y is preserved. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedParents((parents) => ({ ...parents, [parent]: !parents[parent] }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedParents((parents) => ({ ...parents, [parent]: !parents[parent] }));
                    }
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="font-medium text-ink">📁</span>
                      <span
                        className="truncate font-mono text-[12px] text-ink"
                        title={parent}
                      >
                        {parent}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{total} 个子包</span>
                      {cnt.loaded > 0 && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(16,185,129,0.18)", color: "var(--color-success-strong)" }}>
                          ✓ {cnt.loaded}
                        </span>
                      )}
                      {cnt.outdated > 0 && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(245,158,11,0.20)", color: "var(--color-warning)" }}>
                          ↻ {cnt.outdated}
                        </span>
                      )}
                      {cnt.unimported > 0 && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(107,114,128,0.20)", color: "#9CA3AF" }}>
                          {cnt.unimported} 未导入
                        </span>
                      )}
                      {cnt.error > 0 && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(239,68,68,0.18)", color: "#EF4444" }}>
                          ⚠ {cnt.error}
                        </span>
                      )}
                      {cnt.missing > 0 && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(245,158,11,0.20)", color: "var(--color-warning)" }}>
                          ⚠ {cnt.missing} 不存在
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onParseAllParent(parent);
                      }}
                      disabled={!!parsing || total === 0 || (parentParsed && cnt.outdated === 0)}
                      className="rounded-lg border border-border bg-bg px-3 py-1 text-[11px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      title={parentParsed && cnt.outdated === 0 ? "已加载、无更新" : "重新解析此目录下所有子包"}
                    >
                      {parsing ? "…" : "解析本目录"}
                    </button>
                  </div>
                </div>

                {/* Subpackages — only when expanded */}
                {isOpen && subs.length > 0 && (
                  <div className="border-t border-border bg-surface/50 p-2">
                    <div className="space-y-1.5">
                      {subs.map(({ sub, saved, state }) => {
                        const preset = ROW_STATE_PRESET[state.kind];
                        const toolTip = state.kind === "outdated"
                          ? `上次解析保存的 hash ${state.savedHash.slice(0, 8)}… / 当前磁盘 hash ${state.diskHash.slice(0, 8)}…（节点源文件有改动）`
                          : state.kind === "loaded"
                          ? `内容未变（hash ${state.savedHash.slice(0, 8)}…）`
                          : sub.path;
                        const nodeCount =
                          state.kind === "loaded" || state.kind === "outdated"
                            ? state.kind === "loaded"
                              ? state.nodeCount
                              : state.savedNodeCount
                            : sub.packageFileCount;
                        // Click-to-expand is only available for packages that
                        // actually have parsed nodes. Unimported / missing /
                        // empty packages don't have anything to show.
                        const nodesAreLoaded =
                          state.kind === "loaded" || state.kind === "outdated";
                        const nodeListOpen = !!expandedNodeList[sub.path];
                        const nodeTypeList = saved?.nodeTypes ?? [];
                        return (
                          <div key={sub.path}>
                            <div
                              className="flex items-center justify-between gap-2 rounded-lg border bg-bg p-2 pl-3"
                              style={{ borderColor: preset.fg + "30", background: preset.bg }}
                              title={toolTip}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-ink">{sub.name}</span>
                                  <span
                                    className={"rounded-full border px-2 py-0.5 text-[10px] font-medium " + preset.chip}
                                    style={{ color: preset.fg }}
                                  >
                                    {state.kind === "loaded" && saved?.parsedAt ? `已加载 ${saved.parsedAt.split("T")[1]?.slice(0, 5) ?? ""}` : preset.label}
                                  </span>
                                </div>
                                <div className="truncate font-mono text-[10px] text-muted-foreground" title={sub.path}>
                                  {sub.path}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                                {nodesAreLoaded ? (
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setExpandedNodeList((nodeList) => ({
                                        ...nodeList,
                                        [sub.path]: !nodeList[sub.path],
                                      }));
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setExpandedNodeList((nodeList) => ({
                                          ...nodeList,
                                          [sub.path]: !nodeList[sub.path],
                                        }));
                                      }
                                    }}
                                    className="cursor-pointer rounded-md px-1.5 py-1 text-right transition-colors hover:bg-white/5"
                                    title={
                                      nodeListOpen
                                        ? "收起节点列表"
                                        : `点击查看已加载的 ${nodeCount} 个节点`
                                    }
                                  >
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="font-mono text-sm font-semibold text-ink">
                                        {nodeCount}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {nodeListOpen ? "▾" : "▸"}
                                      </span>
                                    </div>
                                    <div className="text-[10px]">节点</div>
                                  </div>
                                ) : (
                                  <div className="text-right">
                                    <div className="font-mono text-sm font-semibold text-ink">
                                      {nodeCount}
                                    </div>
                                    <div className="text-[10px]">映射文件</div>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onParseSingle(sub.path)}
                                  disabled={
                                    !!perPkgParsing[sub.path] ||
                                    parsing ||
                                    state.kind === "missing" ||
                                    state.kind === "empty"
                                  }
                                  className={"rounded-md px-3 py-1.5 text-xs font-medium " + preset.btn}
                                >
                                  {perPkgParsing[sub.path] ? "解析中…" : preset.btnLabel}
                                </button>
                              </div>
                            </div>
                            {/* Expandable ComfyUI-style node previews. Only
                                rendered when the user clicks the count cell.
                                Each card is its own collapse/expand target so
                                a 146-node package stays scannable. */}
                            {nodesAreLoaded && nodeListOpen && (
                              <div
                                className="ml-3 mt-1 space-y-1 border-l-2 border-dashed py-1 pl-3"
                                style={{ borderColor: preset.fg + "30" }}
                              >
                                {nodeTypeList.length === 0 ? (
                                  <div className="text-[10px] italic text-muted-foreground">
                                    此包的清单中没有列出节点类型
                                  </div>
                                ) : (
                                  nodeTypeList.map((ct) => (
                                    <NodePreviewCard
                                      key={ct}
                                      data={manifestByNode[ct]}
                                      fallbackName={ct}
                                      expanded={!!nodeExpanded[ct]}
                                      onToggle={() =>
                                        setNodeExpanded((expanded) => ({
                                          ...expanded,
                                          [ct]: !expanded[ct],
                                        }))
                                      }
                                    />
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {isOpen && subs.length === 0 && (
                  <div className="border-t border-border bg-surface/50 p-3 text-center text-[11px] text-muted-foreground">
                    这个目录下没有发现包含 NODE_CLASS_MAPPINGS 的子包
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
