"use client";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";
import { ROW_STATE_PRESET } from "./constants";
import { NodePreviewCard } from "./NodePreviewCard";
import { ManifestSummary, ParseProgressBanner } from "./SettingsParts";
import type { CustomNodesSettingsController } from "./hooks/use-custom-nodes-settings";

export function NodesTab({ ctrl }: { ctrl: CustomNodesSettingsController }) {
  const {
    saveErr,
    onParseAll,
    summary,
    loading,
    progress,
    savedPaths,
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
      {/* 节点目录只读展示：由设置的 ComfyUI 路径自动推导，不再支持手动配置 */}
      <section className="border-border bg-bg mb-4 rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-ink block text-sm font-medium">
            自定义节点目录
          </label>
          <span
            className="bg-success-strong/18 text-success-strong rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            title="解析器只读取这些目录里的 .py、绝不修改其中任何文件"
          >
            🔒 只读
          </span>
        </div>
        {savedPaths.length > 0 ? (
          <div className="space-y-1">
            {savedPaths.map((path) => (
              <div
                key={path}
                className="border-border bg-surface text-ink truncate rounded-lg border px-3 py-2 font-mono text-xs"
                title={path}
              >
                {path}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            未找到自定义节点目录 —— 请先在 设置 → 创作后端 中配置 ComfyUI
            安装路径，目录会自动推导为{" "}
            <code className="font-mono">&lt;comfyuiPath&gt;/custom_nodes</code>
            。
          </p>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2">
            {saveErr && (
              <span className="text-red-700 dark:text-red-400">
                ⚠ {saveErr}
              </span>
            )}
            {/* Directory overview chips — show totals + outdated count when any subpackage is detected. */}
            {totalAcrossParents.total > 0 && (
              <>
                <span className="bg-subtle text-ink rounded-full px-2 py-0.5">
                  总览 {totalAcrossParents.total} 个子包
                </span>
                {totalAcrossParents.loaded > 0 && (
                  <span className="bg-success-strong/18 text-success-strong rounded-full px-2 py-0.5 font-medium">
                    ✓ 已加载 {totalAcrossParents.loaded}
                  </span>
                )}
                {totalAcrossParents.outdated > 0 && (
                  <span className="bg-warning/22 text-warning rounded-full px-2 py-0.5 font-medium">
                    ↻ 有更新 {totalAcrossParents.outdated}
                  </span>
                )}
              </>
            )}
            {!saveErr && loading && (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Spinner className="size-3" />
                加载中…
              </span>
            )}
          </div>
          <Button
            onClick={onParseAll}
            disabled={parsing || savedPaths.length === 0}
            className="h-auto rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            {parsing ? "解析全部中…" : "▶ 解析全部"}
          </Button>
        </div>
      </section>

      {/* Live manifest summary */}
      {summary && <ManifestSummary summary={summary} />}
      {loading && !summary && <ParseProgressBanner progress={progress} />}

      {/* Group-by-parent collapsible view. Each top-level dir is its own
          block; subpackages inside a block can be hidden / shown via the
          chevron so the user can focus on one source tree at a time. */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-ink text-sm font-medium">
            可导入的节点包
            {totalAcrossParents.outdated > 0 && (
              <span className="bg-warning/18 text-warning ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium">
                ↻ {totalAcrossParents.outdated} 个有更新
              </span>
            )}
          </span>
          <span className="text-muted-foreground text-xs">
            共 {totalAcrossParents.total} 个子包
            {savedPaths.length > 0
              ? ` · 已加载 ${totalAcrossParents.loaded + totalAcrossParents.outdated}/${totalAcrossParents.total}`
              : ""}
          </span>
        </div>
        {savedPaths.length === 0 && !loading && (
          <div className="border-border bg-bg/50 text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
            配置 ComfyUI 安装路径后，会自动发现其下的节点包。
          </div>
        )}
        <div className="space-y-2">
          {parentBlocks.map(({ parent, subs, cnt, total }) => {
            const isOpen = !!expandedParents[parent];
            const parentParsed =
              total > 0 && cnt.unimported + cnt.missing + cnt.empty === 0;
            return (
              <div
                key={parent}
                className="border-border bg-bg rounded-xl border"
              >
                {/* Parent header — clickable to toggle.
                    IMPORTANT: must NOT be a native button element, because the
                    row contains a nested action button ("解析本目录"). Nested
                    button elements in HTML are invalid and trigger React
                    hydration errors. We use a div with role/keyboard handlers so
                    a11y is preserved. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedParents((parents) => ({
                      ...parents,
                      [parent]: !parents[parent],
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedParents((parents) => ({
                        ...parents,
                        [parent]: !parents[parent],
                      }));
                    }
                  }}
                  className="hover:bg-subtle flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="text-ink font-medium">📁</span>
                      <span
                        className="text-ink truncate font-mono text-[12px]"
                        title={parent}
                      >
                        {parent}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span>{total} 个子包</span>
                      {cnt.loaded > 0 && (
                        <span className="bg-success-strong/18 text-success-strong rounded-full px-1.5 py-0.5">
                          ✓ {cnt.loaded}
                        </span>
                      )}
                      {cnt.outdated > 0 && (
                        <span className="bg-warning/20 text-warning rounded-full px-1.5 py-0.5">
                          ↻ {cnt.outdated}
                        </span>
                      )}
                      {cnt.unimported > 0 && (
                        <span className="rounded-full bg-gray-500/20 px-1.5 py-0.5 text-gray-700 dark:text-gray-300">
                          {cnt.unimported} 未导入
                        </span>
                      )}
                      {cnt.error > 0 && (
                        <span className="rounded-full bg-red-500/18 px-1.5 py-0.5 text-red-700 dark:text-red-300">
                          ⚠ {cnt.error}
                        </span>
                      )}
                      {cnt.missing > 0 && (
                        <span className="bg-warning/20 text-warning rounded-full px-1.5 py-0.5">
                          ⚠ {cnt.missing} 不存在
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onParseAllParent(parent);
                      }}
                      disabled={
                        !!parsing ||
                        total === 0 ||
                        (parentParsed && cnt.outdated === 0)
                      }
                      className="border-border bg-bg text-ink hover:bg-subtle h-auto rounded-lg px-3 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        parentParsed && cnt.outdated === 0
                          ? "已加载、无更新"
                          : "重新解析此目录下所有子包"
                      }
                    >
                      {parsing ? "…" : "解析本目录"}
                    </Button>
                  </div>
                </div>

                {/* Subpackages — only when expanded */}
                {isOpen && subs.length > 0 && (
                  <div className="border-border bg-surface/50 border-t p-2">
                    <div className="space-y-1.5">
                      {subs.map(({ sub, saved, state }) => {
                        const preset = ROW_STATE_PRESET[state.kind];
                        const toolTip =
                          state.kind === "outdated"
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
                              className="bg-bg flex items-center justify-between gap-2 rounded-lg border p-2 pl-3"
                              style={{
                                borderColor: preset.fg + "30",
                                background: preset.bg,
                              }}
                              title={toolTip}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-ink font-medium">
                                    {sub.name}
                                  </span>
                                  <span
                                    className={
                                      "rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                                      preset.chip
                                    }
                                    style={{ color: preset.fg }}
                                  >
                                    {state.kind === "loaded" && saved?.parsedAt
                                      ? `已加载 ${saved.parsedAt.split("T")[1]?.slice(0, 5) ?? ""}`
                                      : preset.label}
                                  </span>
                                </div>
                                <div
                                  className="text-muted-foreground truncate font-mono text-[10px]"
                                  title={sub.path}
                                >
                                  {sub.path}
                                </div>
                              </div>
                              <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
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
                                      if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                      ) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setExpandedNodeList((nodeList) => ({
                                          ...nodeList,
                                          [sub.path]: !nodeList[sub.path],
                                        }));
                                      }
                                    }}
                                    className="hover:bg-subtle cursor-pointer rounded-md px-1.5 py-1 text-right transition-colors"
                                    title={
                                      nodeListOpen
                                        ? "收起节点列表"
                                        : `点击查看已加载的 ${nodeCount} 个节点`
                                    }
                                  >
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-ink font-mono text-sm font-semibold">
                                        {nodeCount}
                                      </span>
                                      <span className="text-muted-foreground text-[10px]">
                                        {nodeListOpen ? "▾" : "▸"}
                                      </span>
                                    </div>
                                    <div className="text-[10px]">节点</div>
                                  </div>
                                ) : (
                                  <div className="text-right">
                                    <div className="text-ink font-mono text-sm font-semibold">
                                      {nodeCount}
                                    </div>
                                    <div className="text-[10px]">映射文件</div>
                                  </div>
                                )}
                                <Button
                                  variant="ghost"
                                  onClick={() => onParseSingle(sub.path)}
                                  disabled={
                                    !!perPkgParsing[sub.path] ||
                                    parsing ||
                                    state.kind === "missing" ||
                                    state.kind === "empty"
                                  }
                                  className={
                                    "rounded-md px-3 py-1.5 text-xs font-medium " +
                                    preset.btn
                                  }
                                >
                                  {perPkgParsing[sub.path]
                                    ? "解析中…"
                                    : preset.btnLabel}
                                </Button>
                              </div>
                            </div>
                            {/* Expandable ComfyUI-style node previews. Only
                                rendered when the user clicks the count cell.
                                Each card is its own collapse/expand target so
                                a 146-node package stays scannable. */}
                            {nodesAreLoaded && nodeListOpen && (
                              <div
                                className="mt-1 ml-3 space-y-1 border-l-2 border-dashed py-1 pl-3"
                                style={{ borderColor: preset.fg + "30" }}
                              >
                                {nodeTypeList.length === 0 ? (
                                  <div className="text-muted-foreground text-[10px] italic">
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
                  <div className="border-border bg-surface/50 text-muted-foreground border-t p-3 text-center text-[11px]">
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
