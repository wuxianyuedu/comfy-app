"use client";

import { useMemo } from "react";
import {
  Activity,
  AlertCircle,
  Boxes,
  CheckCircle2,
  ListChecks,
  ListOrdered,
  Pause,
  Play,
  RefreshCcw,
  WifiOff,
  X,
} from "lucide-react";

import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ViewActions } from "~/components/studio/ViewActions";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { Skeleton } from "~/components/ui/skeleton";
import { TruncatedText } from "~/components/ui/truncated-text";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { SectionCard } from "~/components/workshop/ModelTestSectionCard";
import { ModelTestTree } from "~/components/workshop/ModelTestTree";
import { displayValue } from "~/lib/display-value";
import { taskStatusLabel } from "~/lib/task-state";

import type { QueueModelTreeController } from "./hooks/use-queue-model-tree";
import type { QueueMonitorController } from "./hooks/use-queue-monitor";
import type { QueueRow } from "./queue-monitor-config";
import { Field, QueueRowLine, SectionHeading } from "./QueueMonitorParts";
import {
  offlineBannerText,
  offlineEmptyText,
  offlineRunningCardNote,
  runningHintText,
} from "./queue-monitor-config";

/** 队列与运行 · 第③层（纯视图）：只渲染 controller，不发请求、不含业务规则。
 * 三段顺序即读屏顺序：跑动中（还要多久）→ 排队中（下一条是不是我的）→ 最近结果（失败原因）。
 * 离线出口指向侧栏「ComfyUI」页（ISSUE #1900），不再送去设置页（那里只管路径、没有启动按钮）。
 * 离线不整页替换：列表来自本地库 task.list，离线照样拿得到；有任务时只加 warning 横幅、列表照常，
 * 离线且一条任务都没有才退回整页空态。
 * 左栏树（ISSUE #5019）：与测试模型页同一份「用途 / 模式 / 模型」候选树
 * （useModelTestTree），选中一片叶子 = 按那个模型过滤三段列表；再点同一片取消。
 * 列表逐条带模型徽标，排队 / 最近行可就地展开看输入参数（#5010 的能力并入这里）。 */
export function QueueMonitorView({
  c,
  onOpenComfyui,
  tree,
}: {
  c: QueueMonitorController;
  onOpenComfyui: () => void;
  tree: QueueModelTreeController;
}) {
  /* 先收成局部常量：属性上的收窄在事件闭包里会失效，不收就得写
   * `c.running?.id ?? ""` 这种「拿空串假装它存在」的兜底。 */
  const running = c.running;
  /* 按左树选中的模型过滤三段列表（#5019）：位次保持真实队列序，不因筛选重排。 */
  const allRows = useMemo(
    () => [...c.runningRows, ...c.queued.map((entry) => entry.row), ...c.recent],
    [c.runningRows, c.queued, c.recent],
  );
  const keepIds = useMemo(() => tree.filterIds(allRows), [tree, allRows]);
  const runningRows = c.runningRows.filter((row) => keepIds.has(row.id));
  const queued = c.queued.filter((entry) => keepIds.has(entry.row.id));
  const recent = c.recent.filter((row) => keepIds.has(row.id));
  /* 空态判据看**未筛选**的全量：筛到一个不剩时不能误报「一条任务都没有」。 */
  const hasAny =
    running !== null || c.runningRows.length > 0 || c.queued.length > 0 || c.recent.length > 0;
  const empty = offlineEmptyText();
  const banner = offlineBannerText();
  const runningHint = runningHintText(c.online, c.waitingCount);
  const offlineNote = offlineRunningCardNote();
  /* 树选中的用途收窄到三档（选中为空时给 image，selectedValue 为空串不会误亮叶子）。 */
  const treeKind = tree.selection?.kind;
  const treeCurrentKind = treeKind === "video" || treeKind === "chat" ? treeKind : "image";

  const rowProps = (row: QueueRow) => ({
    row,
    busy: c.isBusy(row.id),
    paramsExpanded: c.expandedId === row.id,
    paramRows: c.expandedId === row.id ? c.paramRows : [],
    paramsLoading: c.expandedId === row.id && c.detailLoading,
    onToggleParams: () => {
      c.toggleExpanded(row.id);
    },
    onCancel: () => {
      void c.cancel(row.id, row.workflowName);
    },
    onCopy: () => {
      void c.copyForReprint(row);
    },
    onOpenFolder: () => {
      void c.openFolder(row);
    },
    onOpenLog: () => {
      c.openLog(row);
    },
  });

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="wide"
    >
      {/* 屏名由页签给出，页头不再重复一次可见标题（`srTitle` 只留给读屏）——
          此前页签写「队列」、这里的大标题也写「队列」，同一件事占两行而读者
          什么都没多知道（ISSUE #1693，接 ISSUE #1423 没走完的那一半）。
          那句「多久读一次、位次怎么排」不是每次看屏都要读的，收成悬浮说明 ——
          由顶栏标题右侧那颗问号承载（`viewHelp()`），页头里不再放第二颗。 */}
      <PageHeader srTitle={pageHeaderTitle("queue")} />

      {/* 位次统计与刷新挂到顶栏（`ViewActions`）—— 见 `ViewActions` 里那段
          「屏名由页签给出之后，留在屏内那一行只剩右对齐的几颗控件」（ISSUE #1871）。 */}
      <ViewActions>
        <span className="text-ink-faint text-xs tabular-nums">
          {`待执行 ${String(c.waitingCount)}`}
        </span>
        {/* 生图暂停态角标 + 播放 / 暂停按钮（ISSUE #5055）：暂停语义在执行器
            闸门——当前任务照常跑完，之后不再领取生图任务；图标随状态切换。 */}
        {c.paused ? (
          <span className="bg-warning/10 text-warning-strong rounded-full px-2.5 py-0.5 text-xs font-medium">
            生图已暂停
          </span>
        ) : null}
        <Button
          aria-label={c.paused ? "恢复生成" : "暂停生成"}
          className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
          disabled={c.pauseBusy}
          onClick={c.togglePause}
          size="xs"
          variant="outline"
        >
          {c.paused ? (
            <Play aria-hidden className="size-3" data-icon="inline-start" />
          ) : (
            <Pause aria-hidden className="size-3" data-icon="inline-start" />
          )}
          {c.paused ? "恢复生成" : "暂停生成"}
        </Button>
        <Button
          aria-label="立即重新读取队列"
          className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
          onClick={c.refresh}
          size="xs"
          variant="outline"
        >
          <RefreshCcw aria-hidden className="size-3" data-icon="inline-start" />
          刷新
        </Button>
      </ViewActions>

      {c.loadError !== null && c.loadError !== "" ? (
        <EmptyState
          className="mb-6"
          description="读不到任务记录时不沿用旧数据 —— 把已经结束的条目显示成还在跑，比读到空更坏。"
          title={c.loadError}
          variant="hint"
        />
      ) : null}

      {/* 离线且还有任务：横幅说明「不会开始」，列表照常铺开（数据来自本地库） */}
      {!c.online && hasAny ? (
        <Alert className="mb-6" variant="warning">
          <WifiOff />
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.description}</AlertDescription>
          <AlertAction>
            <Button
              className="border-warning/40 text-warning-strong hover:bg-warning/10 h-auto gap-1 rounded-lg px-2.5 py-1"
              onClick={onOpenComfyui}
              size="xs"
              variant="outline"
            >
              去「ComfyUI」页启动
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {/* 离线且一条任务都没有：保留整页空态（有按钮的引导入口） */}
      {!c.online && !hasAny ? (
        <EmptyState
          action={
            <Button onClick={onOpenComfyui} size="sm" variant="outline">
              去「ComfyUI」页启动
            </Button>
          }
          description={empty.description}
          icon={ListChecks}
          title={empty.title}
        />
      ) : null}

      {c.online || hasAny ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* ── 左栏：用途 / 模式 / 模型 树（#5019）—— 选中一片叶子即按模型
              过滤右侧三段列表；再点同一片取消筛选。候选口径与测试模型页
              同一份（useModelTestTree）。 ── */}
          <aside className="w-full shrink-0 xl:w-64">
            <SectionCard hint="按模型筛选队列" icon={<Boxes />} title="用途 / 模式 / 模型">
              {tree.loading ? (
                <div aria-label="加载中" className="flex flex-col gap-2" role="status">
                  {[0, 1, 2].map((i) => (
                    <Skeleton className="h-9 w-full rounded-lg" key={i} />
                  ))}
                </div>
              ) : tree.entries.length === 0 ? (
                <p className="text-ink-muted bg-canvas rounded-lg px-3 py-2 text-xs leading-relaxed">
                  还没有可选的模型候选 —— 到测试模型页或「设置 → 远程模型」配置后出现在这里。
                </p>
              ) : (
                <ModelTestTree
                  className="text-sm"
                  currentKind={treeCurrentKind}
                  currentMode={tree.selection?.mode ?? ""}
                  entries={tree.entries}
                  generatingModels={new Set([])}
                  loading={false}
                  onSelect={tree.select}
                  selectedValue={tree.selection?.value ?? ""}
                />
              )}
            </SectionCard>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-6">
            {/* 筛选提示：选中模型后亮出来源与清除入口，不靠记忆记住当前筛的是谁。 */}
            {tree.activeLabel ? (
              <p
                className="border-primary/30 bg-primary-soft text-primary-strong flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
                role="status"
              >
                已按模型筛选：{tree.activeLabel}
                <Button
                  aria-label="清除模型筛选"
                  className="h-auto gap-1 rounded-full px-2 py-0.5"
                  onClick={tree.clear}
                  size="xs"
                  variant="ghost"
                >
                  <X aria-hidden className="size-3" data-icon="inline-start" />
                  清除
                </Button>
              </p>
            ) : null}

            {/* ── 顶部指标带（重设计稿）：先一眼回答「现在什么规模」，再看三段明细。
                四格读数全部来自 controller 的纯派生（`queueStats`），视图不算数；
                指标始终是**全局**数，不随左树筛选变化。 */}
            <div aria-label="队列概览" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {(
                [
                  {
                    chip: "bg-info/10 text-info-strong",
                    icon: Activity,
                    label: "运行中",
                    value: c.stats.running,
                  },
                  {
                    chip: "bg-warning/10 text-warning-strong",
                    icon: ListOrdered,
                    label: "排队中",
                    value: c.stats.queued,
                  },
                  {
                    chip: "bg-success/10 text-success-strong",
                    icon: CheckCircle2,
                    label: "今日完成",
                    value: c.stats.succeededToday,
                  },
                  {
                    chip: "bg-destructive/10 text-danger-strong",
                    icon: AlertCircle,
                    label: "失败",
                    value: c.stats.failedToday,
                  },
                ] as const
              ).map(({ chip, icon: Icon, label, value }) => (
                <div
                  className="border-border bg-card flex items-center gap-3.5 rounded-2xl border p-4"
                  key={label}
                >
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${chip}`}
                  >
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-ink-bright block text-[22px] leading-none font-bold tabular-nums">
                      {String(value)}
                    </span>
                    <span className="text-ink-faint mt-1 block text-xs">{label}</span>
                  </span>
                </div>
              ))}
            </div>

            <section aria-labelledby="queue-running-heading">
              <SectionHeading id="queue-running-heading">跑动中</SectionHeading>
              {running !== null && keepIds.has(running.id) ? (
                <article className="bg-card border-border rounded-2xl border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-ink-bright min-w-0 flex-1 text-sm font-semibold">
                      <TruncatedText className="block truncate">
                        {displayValue(running.workflowName, {
                          fallback: "（未知工作流）",
                        })}
                      </TruncatedText>
                    </h3>
                    <StatusBadge label={taskStatusLabel("RUNNING")} status="RUNNING" />
                  </div>
                  <ProgressBar className="mt-3" label="采样进度" value={running.progressPct} />
                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="已跑">{running.elapsedText}</Field>
                    <Field label="预计剩余">{running.remainingText}</Field>
                    <Field label="步数">{running.stepsText}</Field>
                    <Field label="速度">{running.rateText}</Field>
                    <Field label="当前节点">{running.nodeText}</Field>
                    <Field label="主模型">{running.modelText}</Field>
                  </dl>
                  <div className="mt-3 flex justify-end gap-1">
                    <Button
                      aria-label="查看正在跑这条的执行日志"
                      className="h-auto gap-1"
                      onClick={() => {
                        c.openLog({
                          id: running.id,
                          workflowName: running.workflowName,
                          status: "RUNNING",
                        });
                      }}
                      size="xs"
                      variant="ghost"
                    >
                      日志
                    </Button>
                    <Button
                      aria-label="取消正在跑的这条"
                      className="border-border rounded-lg"
                      disabled={c.isBusy(running.id)}
                      onClick={() => {
                        void c.cancel(running.id, running.workflowName);
                      }}
                      size="xs"
                      variant="outline"
                    >
                      {c.isBusy(running.id) ? "处理中" : "取消这条"}
                    </Button>
                  </div>
                </article>
              ) : running === null && runningRows.length > 0 ? (
                <ol className="flex flex-col gap-3">
                  {runningRows.map((row) => (
                    <li className="bg-card border-border rounded-2xl border p-4" key={row.id}>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-ink-bright min-w-0 flex-1 text-sm font-semibold">
                          <TruncatedText className="block truncate">
                            {displayValue(row.workflowName, {
                              fallback: "（未知工作流）",
                            })}
                          </TruncatedText>
                        </h3>
                        <StatusBadge label={taskStatusLabel("RUNNING")} status="RUNNING" />
                      </div>
                      <ProgressBar className="mt-3" label="采样进度" value={row.progress} />
                      <p className="text-ink-fainter mt-2 text-xs">{offlineNote}</p>
                      <div className="mt-3 flex justify-end gap-1">
                        <Button
                          aria-label="查看正在跑这条的执行日志"
                          className="h-auto gap-1"
                          onClick={() => {
                            c.openLog({
                              id: row.id,
                              workflowName: row.workflowName,
                              status: row.status,
                              error: row.error,
                            });
                          }}
                          size="xs"
                          variant="ghost"
                        >
                          日志
                        </Button>
                        <Button
                          aria-label="取消正在跑的这条"
                          className="border-border rounded-lg"
                          disabled={c.isBusy(row.id)}
                          onClick={() => {
                            void c.cancel(row.id, row.workflowName);
                          }}
                          size="xs"
                          variant="outline"
                        >
                          {c.isBusy(row.id) ? "处理中" : "取消这条"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  description={runningHint.description}
                  minHeightClass="min-h-30"
                  title={runningHint.title}
                  variant="hint"
                />
              )}
            </section>

            <section aria-labelledby="queue-waiting-heading">
              <SectionHeading id="queue-waiting-heading">
                {`排队中（${String(queued.length)}）`}
              </SectionHeading>
              {queued.length > 0 ? (
                <ol className="border-border bg-card overflow-hidden rounded-2xl border">
                  {queued.map(({ row, position }) => (
                    <li className="border-border border-b px-4 py-3 last:border-b-0" key={row.id}>
                      <QueueRowLine leading={`第 ${String(position)} 位`} {...rowProps(row)} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-ink-fainter flex items-center gap-1.5 text-xs">
                  <ListOrdered aria-hidden className="size-3.5" />
                  没有排队中的条目。提交新任务后它会出现在这里，位次按提交先后排。
                </p>
              )}
            </section>

            <section aria-labelledby="queue-recent-heading">
              <SectionHeading id="queue-recent-heading">最近结果</SectionHeading>
              {recent.length > 0 ? (
                <ul className="border-border bg-card overflow-hidden rounded-2xl border">
                  {recent.map((row) => (
                    <li className="border-border border-b px-4 py-3 last:border-b-0" key={row.id}>
                      <QueueRowLine {...rowProps(row)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-fainter text-xs">
                  还没有跑完过的任务。完整历史在侧栏「历史」里看。
                </p>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </DocumentFrame>
  );
}
