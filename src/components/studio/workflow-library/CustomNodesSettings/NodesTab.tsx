"use client";

import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Spinner } from "~/components/ui/page-loading";
import { StatusBadge } from "~/components/ui/status-badge";
import { cn } from "~/lib/utils";
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
    parentExpansion,
    perPkgParsing,
    onParseAllParent,
    nodeListExpansion,
    manifestByNode,
    nodeCardExpansion,
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
            {/* 目录总览章 —— 检测到任何子包时显示总数 + 过期数。 */}
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

      {/* 实时清单摘要 */}
      {summary && <ManifestSummary summary={summary} />}
      {loading && !summary && <ParseProgressBanner progress={progress} />}

      {/* 按父级分组的可折叠视图。每个顶层目录自成
          一块；块内的子包可经箭头隐藏 / 显示，
          好让用户一次专注一棵源码树。 */}
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
            const isOpen = parentExpansion.isExpanded(parent);
            const parentParsed =
              total > 0 && cnt.unimported + cnt.missing + cnt.empty === 0;
            return (
              <div
                key={parent}
                className="border-border bg-bg rounded-xl border"
              >
                {/* 父级头 —— 可点击切换。`▸/▾`、`role`、`tabIndex`、
                    Enter/Space 全交给 `Disclosure`（规范 16 §16.2.4.13）——
                    此前是自绘的 `role="button"` div，注释里写着「不能用原生
                    button 因为嵌 button 非法」，而那个嵌进去的按钮正是右侧的
                    「解析本目录」：改走基元的 `trailing` 后，它不再被嵌在
                    触发按钮里。面板 = 子包列表（见下方 `subs.map`）。 */}
                <Disclosure
                  open={isOpen}
                  onOpenChange={() => parentExpansion.toggle(parent)}
                  marker="caret"
                  /* 整排的排布在 Root 上（`rootClassName`）：触发开关与右侧的
                   * 「解析本目录」是 Root 的**并列**子元素，Root 不写 `flex`
                   * 它们就各自独占一行（规范 16 §16.2.4.13 迁移口径第 2 条）。 */
                  rootClassName="flex items-center gap-2"
                  className="hover:bg-subtle w-auto flex-1 justify-between gap-2 rounded-xl px-3 py-2.5"
                  panelClassName="contents"
                  trigger={
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
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
                  }
                  trailing={
                    <Button
                      variant="outline"
                      onClick={() => void onParseAllParent(parent)}
                      disabled={
                        !!parsing ||
                        total === 0 ||
                        (parentParsed && cnt.outdated === 0)
                      }
                      className="border-border bg-bg text-ink hover:bg-subtle h-auto shrink-0 rounded-lg px-3 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        parentParsed && cnt.outdated === 0
                          ? "已加载、无更新"
                          : "重新解析此目录下所有子包"
                      }
                    >
                      {parsing ? "…" : "解析本目录"}
                    </Button>
                  }
                />
                {/* 子包 —— 仅展开时显示 */}
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
                        // 点击展开只对有已解析节点的包可用。
                        // 未导入 / 缺失 /
                        // 空的包没东西可显示。
                        const nodesAreLoaded =
                          state.kind === "loaded" || state.kind === "outdated";
                        const nodeListOpen = nodeListExpansion.isExpanded(
                          sub.path,
                        );
                        const nodeTypeList = saved?.nodeTypes ?? [];
                        return (
                          <div key={sub.path}>
                            <div
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-lg border p-2 pl-3",
                                preset.rowCls,
                              )}
                              title={toolTip}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-ink font-medium">
                                    {sub.name}
                                  </span>
                                  <StatusBadge
                                    status={preset.status}
                                    label={
                                      state.kind === "loaded" && saved?.parsedAt
                                        ? `已加载 ${saved.parsedAt.split("T")[1]?.slice(0, 5) ?? ""}`
                                        : preset.label
                                    }
                                    dot={false}
                                    className="px-2 py-0.5 text-[10px]"
                                  />
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
                                  /* 「节点计数」单元是一个折叠开关：点开看该包
                                     已加载的节点清单。此前是自绘的
                                     `role="button"` + `tabIndex` + 手写
                                     Enter/Space 处理（规范 16 §16.2.4.13）——
                                     基元把这些语义一次给全。`panelClassName`
                                     留空：面板是下面那个 rail（由外面的条件渲染
                                     承担），此处的 `Disclosure` 只接管这一行。 */
                                  <Disclosure
                                    open={nodeListOpen}
                                    onOpenChange={() =>
                                      nodeListExpansion.toggle(sub.path)
                                    }
                                    marker="caret"
                                    className="hover:bg-subtle flex-row-reverse items-end justify-end gap-1 rounded-md px-1.5 py-1 text-right"
                                    panelClassName="hidden"
                                    trigger={
                                      <div
                                        title={
                                          nodeListOpen
                                            ? "收起节点列表"
                                            : `点击查看已加载的 ${nodeCount} 个节点`
                                        }
                                      >
                                        <div className="text-ink font-mono text-sm font-semibold">
                                          {nodeCount}
                                        </div>
                                        <div className="text-[10px]">节点</div>
                                      </div>
                                    }
                                  />
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
                                  className={cn(
                                    "h-auto rounded-md px-3 py-1.5 text-xs font-medium",
                                    preset.btn,
                                  )}
                                >
                                  {perPkgParsing[sub.path]
                                    ? "解析中…"
                                    : preset.btnLabel}
                                </Button>
                              </div>
                            </div>
                            {/* 可展开的 ComfyUI 风节点预览。只在
                                用户点击计数单元时渲染。
                                每张卡片都是自己的收起 / 展开目标，好让
                                一个 146 节点的包仍可扫读。 */}
                            {nodesAreLoaded && nodeListOpen && (
                              <div
                                className={cn(
                                  "mt-1 ml-3 space-y-1 border-l-2 border-dashed py-1 pl-3",
                                  preset.railCls,
                                )}
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
                                      expanded={nodeCardExpansion.isExpanded(
                                        ct,
                                      )}
                                      onToggle={() =>
                                        nodeCardExpansion.toggle(ct)
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
