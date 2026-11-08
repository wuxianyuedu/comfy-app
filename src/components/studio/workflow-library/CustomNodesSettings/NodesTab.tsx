"use client";

import { useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { FieldLegend } from "~/components/ui/field";
import { Hint } from "~/components/ui/hint";
import { TreeChildren } from "~/components/ui/tree-rows";
import { Spinner } from "~/components/ui/spinner";
import { StatusBadge } from "~/components/ui/status-badge";
import { cn } from "~/lib/utils";
import { ROW_STATE_PRESET } from "./constants";
import { NodePreviewCard } from "./NodePreviewCard";
import { ManifestSummary, ParseProgressBanner } from "./SettingsParts";
import { lastSegments } from "~/lib/path-display";
import type { CustomNodesSettingsController } from "./hooks/use-custom-nodes-settings";

/** 单包节点卡窗口化列表的三个常量（ISSUE #2191）。 */
/** 折叠态卡片的行高估计：一行标题（px-2.5 + 文本行）—— 展开后由
 * `measureElement` 实测接管，估计值只影响首帧与滚动条预算。 */
const CARD_ROW_ESTIMATE_PX = 44;
/** 卡间距，与 fallback 档的 `gap-1` 同一个值。 */
const CARD_GAP_PX = 4;
/** 卡列表的滚动视口上限：超过就容器内滚，不再把页面撑成几千像素。 */
const CARD_LIST_MAX_H_CLASS = "max-h-120 overflow-y-auto";

/** 单张卡（从层 3 的 `nodeTypeList.map` 里原样提出 —— 窗口化只改「哪几张在场」，
 * 不改卡本身的任何形态/行为）。 */
function CardRow({
  ct,
  manifestByNode,
  nodeCardExpansion,
}: {
  ct: string;
  manifestByNode: CustomNodesSettingsController["manifestByNode"];
  nodeCardExpansion: CustomNodesSettingsController["nodeCardExpansion"];
}) {
  return (
    <NodePreviewCard
      data={manifestByNode[ct]}
      expanded={nodeCardExpansion.isExpanded(ct)}
      fallbackName={ct}
      onToggle={() => {
        nodeCardExpansion.toggle(ct);
      }}
    />
  );
}

/**
 * 单包节点卡的窗口化列表（ISSUE #2191）。用独立滚动容器而非文档滚动锚：
 * 多包可同时展开，offsetTop 会随其它面板开合漂移。TreeChildren 仍是行容器；
 * 未量测环境（jsdom clientHeight 恒 0）退化为全量渲染，否则清单变空白。
 */
function NodeCardList({
  nodeTypeList,
  manifestByNode,
  nodeCardExpansion,
}: {
  manifestByNode: CustomNodesSettingsController["manifestByNode"];
  nodeCardExpansion: CustomNodesSettingsController["nodeCardExpansion"];
  nodeTypeList: Array<string>;
}) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // 与 ModelLibrary / ProjectOutputs 同一条误报豁免：virtualizer 的读数只在
  // 本组件 render 内消费，不外传给被 memo 的子组件。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: nodeTypeList.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => CARD_ROW_ESTIMATE_PX + CARD_GAP_PX,
    overscan: 6,
    gap: CARD_GAP_PX,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0;

  const renderCard = useCallback(
    (ct: string) => (
      <CardRow
        ct={ct}
        key={ct}
        manifestByNode={manifestByNode}
        nodeCardExpansion={nodeCardExpansion}
      />
    ),
    [manifestByNode, nodeCardExpansion],
  );

  if (!measured) {
    return (
      <div className={cn("flex flex-col gap-1", CARD_LIST_MAX_H_CLASS)} ref={setScrollEl}>
        {nodeTypeList.map(renderCard)}
      </div>
    );
  }
  return (
    <div className={CARD_LIST_MAX_H_CLASS} ref={setScrollEl}>
      <div
        style={{
          position: "relative",
          height: virtualizer.getTotalSize(),
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const ct = nodeTypeList[vi.index];
          if (ct === undefined) {
            return null;
          }
          return (
            <div
              data-index={vi.index}
              key={vi.key}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <CardRow
                ct={ct}
                manifestByNode={manifestByNode}
                nodeCardExpansion={nodeCardExpansion}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
          <FieldLegend className="text-ink text-sm font-medium" variant="label">
            自定义节点目录
          </FieldLegend>
          <Badge
            size="pill-sm"
            title="解析器只读取这些目录里的 .py、绝不修改其中任何文件"
            tone="success"
          >
            🔒 只读
          </Badge>
        </div>
        {savedPaths.length > 0 ? (
          <div className="flex flex-col gap-1">
            {savedPaths.map((path) => (
              <div
                className="border-border bg-surface text-ink truncate rounded-lg border px-3 py-2 font-mono text-xs"
                key={path}
                title={path}
              >
                {path}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            未找到自定义节点目录 —— 请先在 设置 → 创作后端 中配置 ComfyUI 安装路径，目录会自动推导为
            <code className="font-mono">&lt;comfyuiPath&gt;/custom_nodes</code>。
          </p>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2">
            {saveErr !== null && saveErr !== "" && (
              <span className="text-destructive">⚠ {saveErr}</span>
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
            {(saveErr === null || saveErr === "") && loading && (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Spinner className="size-3" />
                加载中…
              </span>
            )}
          </div>
          <Button
            className="h-auto rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
            disabled={parsing || savedPaths.length === 0}
            onClick={onParseAll}
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
              <Badge className="ml-2" size="pill-sm" tone="warning">
                ↻ {totalAcrossParents.outdated} 个有更新
              </Badge>
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
        <div className="flex flex-col gap-2">
          {parentBlocks.map(({ parent, subs, cnt, total }) => {
            const isOpen = parentExpansion.isExpanded(parent);
            const parentParsed = total > 0 && cnt.unimported + cnt.missing + cnt.empty === 0;
            return (
              <div className="border-border bg-bg rounded-xl border" key={parent}>
                {/* 父级头：`▸/▾`、role、tabIndex、Enter/Space 全交给 `Disclosure`
                    （规范 16 §16.2.4.13）；「解析本目录」已改走 `trailing`，
                    不再嵌在触发按钮里。 */}
                <Disclosure
                  className="hover:bg-subtle w-auto flex-1 justify-between gap-2 rounded-xl px-3 py-2.5"
                  marker="caret"
                  onOpenChange={() => {
                    parentExpansion.toggle(parent);
                  }}
                  open={isOpen}
                  panelClassName="contents"
                  /* 整排的排布在 Root 上（`rootClassName`）：触发开关与右侧的
                   * 「解析本目录」是 Root 的**并列**子元素，Root 不写`flex`
                   * 它们就各自独占一行（规范 16 §16.2.4.13 迁移口径第 2 条）。 */
                  rootClassName="flex items-center gap-2"
                  trailing={
                    <Hint
                      label={
                        parentParsed && cnt.outdated === 0
                          ? "已加载、无更新"
                          : "重新解析此目录下所有子包"
                      }
                      wrap
                    >
                      <Button
                        className="border-border bg-bg text-ink hover:bg-subtle text-2xs h-auto shrink-0 rounded-lg px-3 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!!parsing || total === 0 || (parentParsed && cnt.outdated === 0)}
                        // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
                        onClick={() => void onParseAllParent(parent)}
                        variant="outline"
                      >
                        {parsing ? "…" : "解析本目录"}
                      </Button>
                    </Hint>
                  }
                  trigger={
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-ink font-medium">📁</span>
                        <span className="text-ink truncate font-mono text-xs" title={parent}>
                          {parent}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-3xs mt-0.5 flex flex-wrap items-center gap-1.5">
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
                          <span className="bg-destructive/18 text-destructive rounded-full px-1.5 py-0.5">
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
                />
                {/* 子包 —— 仅展开时显示 */}
                {isOpen && subs.length > 0 && (
                  <TreeChildren
                    className="border-border bg-surface/50 flex flex-col gap-1.5 border-t p-2"
                    depth={0}
                  >
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
                      const nodesAreLoaded = state.kind === "loaded" || state.kind === "outdated";
                      const nodeListOpen = nodeListExpansion.isExpanded(sub.path);
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
                                <span className="text-ink font-medium">{sub.name}</span>
                                <StatusBadge
                                  className="text-3xs px-2 py-0.5"
                                  dot={false}
                                  label={
                                    state.kind === "loaded" &&
                                    saved?.parsedAt !== undefined &&
                                    // oxlint-disable-next-line no-unnecessary-condition -- saved 来自清单响应，parsedAt 逐字段判空沿用旧数据形状
                                    saved?.parsedAt !== null &&
                                    saved.parsedAt !== ""
                                      ? `已加载 ${saved.parsedAt.split("T")[1]?.slice(0, 5) ?? ""}`
                                      : preset.label
                                  }
                                  status={preset.status}
                                />
                              </div>
                              <div
                                className="text-muted-foreground text-3xs truncate font-mono"
                                title={sub.path}
                              >
                                {/* 同 SettingsParts：路径的语义在尾部，显式取末几段。 */}
                                {lastSegments(sub.path, 3)}
                              </div>
                            </div>
                            <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
                              {nodesAreLoaded ? (
                                /* 「节点计数」是折叠开关，语义由 `Disclosure` 提供
                                   （规范 16 §16.2.4.13）；`panelClassName` 留空，
                                   面板是下面那个 rail。 */
                                <Disclosure
                                  className="hover:bg-subtle flex-row-reverse items-end justify-end gap-1 rounded-md px-1.5 py-1 text-right"
                                  marker="caret"
                                  onOpenChange={() => {
                                    nodeListExpansion.toggle(sub.path);
                                  }}
                                  open={nodeListOpen}
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
                                      <div className="text-3xs">节点</div>
                                    </div>
                                  }
                                />
                              ) : (
                                <div className="text-right">
                                  <div className="text-ink font-mono text-sm font-semibold">
                                    {nodeCount}
                                  </div>
                                  <div className="text-3xs">映射文件</div>
                                </div>
                              )}
                              <Button
                                className={cn(
                                  "h-auto rounded-md px-3 py-1.5 text-xs font-medium",
                                  preset.btn,
                                )}
                                disabled={
                                  perPkgParsing[sub.path] === true ||
                                  parsing ||
                                  state.kind === "missing" ||
                                  state.kind === "empty"
                                }
                                onClick={() => onParseSingle(sub.path)}
                                variant="ghost"
                              >
                                {perPkgParsing[sub.path] === true ? "解析中…" : preset.btnLabel}
                              </Button>
                            </div>
                          </div>
                          {/* 可展开的 ComfyUI 风节点预览。只在
 用户点击计数单元时渲染。
 每张卡片都是自己的收起 / 展开目标；卡多时由
 `NodeCardList` 窗口化（ISSUE #2191）——
 一个 233 节点的包挂载成本不再线性涨。 */}
                          {nodesAreLoaded && nodeListOpen && (
                            <TreeChildren
                              className="flex flex-col gap-1"
                              depth={1}
                              railClassName={preset.railCls}
                            >
                              {nodeTypeList.length === 0 ? (
                                <div className="text-muted-foreground text-3xs italic">
                                  此包的清单中没有列出节点类型
                                </div>
                              ) : (
                                <NodeCardList
                                  manifestByNode={manifestByNode}
                                  nodeCardExpansion={nodeCardExpansion}
                                  nodeTypeList={nodeTypeList}
                                />
                              )}
                            </TreeChildren>
                          )}
                        </div>
                      );
                    })}
                  </TreeChildren>
                )}
                {isOpen && subs.length === 0 && (
                  <div className="border-border bg-surface/50 text-muted-foreground text-2xs border-t p-3 text-center">
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
