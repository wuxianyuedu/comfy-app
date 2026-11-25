"use client";

import { useState, type DragEventHandler } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { textHandler } from "~/lib/form-props";
import { AlertTriangle, Search, Download, X } from "lucide-react";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  type PendingRow,
  type WorkflowRow,
} from "./workflow-library-config";
import { Hint } from "~/components/ui/hint";
import { TaskTypeChip } from "~/components/ui/task-type-chip";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useWorkflowEncapsulation } from "./hooks/use-workflow-encapsulation";
import { SourceTag } from "~/components/ui/source-tag";
import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusDot } from "~/components/ui/status-dot";
import { ListBadge } from "~/components/ui/list-badge";

/** 窗口化列表的两个常量（ISSUE #4557，与 CustomNodesSettings/NodesTab 同款模式）。
 *  行高是**估计值**：行恒为单行（名称 + 类型 + 状态徽标 + 来源，#4667），真高
 *  由 `measureElement` 量到，估计只影响首帧窗口宽度。 */
const WORKFLOW_ROW_ESTIMATE_PX = 34;
const WORKFLOW_ROW_GAP_PX = 4;

type WorkflowLibraryListProps = {
  /** 拖入 JSON 导入：整片列表侧栏就是投放区，这里接管高亮与投放事件
   * （与导入面板共用同一个文件漏斗，见 useWorkflowImport）。 */
  dragActive?: boolean;
  /** 文件入口（拖入）失败的可读原因。 */
  fileErr?: string | null;
  /** 列表查询**失败**的可读原因（服务 500 等，#4464）：空列表据此给
   * 「加载失败 + 重试」的第四态，不再误显示成「还没有工作流」。 */
  loadError?: string | null;
  /** 列表仍在拉取中；此时「一条都没有」不代表「没有工作流」。 */
  loading?: boolean;
  /** 本地工作流目录侧的可读原因（没解析到根 / 根不可访问 / 目录里没有文件）；
   * 非空时用它替换默认空态文案，说明「为什么是空」。 */
  localRootsHint?: string | null;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onLoadPending?: (pending: PendingRow) => void;
  /** 重试拉取（超时提示里的动作）。 */
  onRefresh?: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  /** 单个待载入项的「载入中」标志（按 id 查表）：载入按钮据此禁用并改文案，
   * 避免重复点击把同一份磁盘文件重复载入。 */
  pendingLoading?: Record<string, boolean>;
  pendingRows?: Array<PendingRow>;
  search: string;
  selectedId?: string | null;
  /** 拉取超过预期时长仍未返回（服务在响应但查询没回来）。 */
  stalled?: boolean;
  workflows: Array<WorkflowRow>;
};

/**
 * 左侧工作流列表：搜索 + 可滚动条目，选中项高亮，右侧详情联动。三态必须可区分
 * （规范 10.5）：加载中/数据没回来 → 进度提示，绝不渲染成「未找到」；拉取超时 →
 * 提示「仍在加载」；确实没有（且未筛选）→ 引导导入或配置本地目录。
 */
export function WorkflowLibraryList({
  workflows,
  pendingRows = [],
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onLoadPending,
  loading = false,
  stalled = false,
  onRefresh,
  localRootsHint = null,
  loadError = null,
  dragActive = false,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  fileErr = null,
  pendingLoading = {},
}: WorkflowLibraryListProps) {
  const empty = workflows.length === 0 && pendingRows.length === 0;
  /* 窗口化渲染（ISSUE #4557）：库大时整表渲染让每次筛选/快照同步都挂上几百行的
   * DOM（每行还各挂一个封装状态 hook）。视口外不挂载；量测前（jsdom clientHeight
   * 恒 0）退化为全量渲染，否则清单变空白 —— 与 NodesTab 同一条兜底。 */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // 与 ModelLibrary / ProjectOutputs / NodesTab 同一条误报豁免：virtualizer 的
  // 读数只在本组件 render 内消费，不外传给被 memo 的子组件。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: workflows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => WORKFLOW_ROW_ESTIMATE_PX,
    overscan: 6,
    gap: WORKFLOW_ROW_GAP_PX,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0;
  return (
    <div
      className={[
        "border-border-subtle bg-panel-deep flex h-full w-full min-w-0 flex-col border-r",
        /* 拖入高亮用 outline：不参与布局，不会让列表在拖拽时抖一下。 */
        dragActive ? "outline-info/60 outline-2 -outline-offset-2" : "",
      ].join("")}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* 搜索栏。`shrink-0` 必须有：排查过的一个现场是搜索框连同下面的列表一起
 纵向压缩 —— flex 列容器里`p-3` 的固定块默认`flex-shrink: 1`，
 列表内容一多它就被压，输入框看着像「瘪了」。 */}
      <div className="border-border-subtle shrink-0 border-b p-3">
        <div className="relative">
          <Search className="text-ink-fainter pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            className="border-border bg-subtle text-ink-bright placeholder:text-ink-fainter focus-visible:border-primary-500/40 h-8 w-full rounded-lg border pr-8 pl-8 text-xs"
            onChange={textHandler(onSearchChange)}
            placeholder="搜索工作流名称…"
            type="text"
            value={search}
          />
          {/* 清空钮只在有输入时出现（#5058）：点一下回到全量列表，不必全选删除。 */}
          {search !== "" && (
            <Button
              aria-label="清空搜索"
              className="text-ink-fainter hover:text-ink-bright absolute top-1/2 right-1.5 size-6 -translate-y-1/2 rounded-md p-0"
              onClick={() => {
                onSearchChange("");
              }}
              size="icon-xs"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        {/* 列表里的工作流有两个来源（ISSUE #3625）：原件在用户自己配的磁盘目录里、
            导入后的记录在库里。徽标把两处落点说清 —— 换机器时两样都得搬，
            只搬一样会变成「有记录没有原件」。 */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DataLocationBadge id="workflow-library-disk" />
          <DataLocationBadge id="workflow-library-db" />
        </div>
      </div>

      {dragActive && (
        <p className="border-info/30 bg-info/10 text-info-strong text-2xs border-b px-3 py-1.5 text-center">
          松开即可读取该工作流 JSON
        </p>
      )}
      {fileErr !== null && fileErr !== undefined && fileErr !== "" && (
        <p className="border-destructive/25 bg-destructive/8 text-destructive text-2xs border-b px-3 py-1.5">
          ⚠ {fileErr}
        </p>
      )}

      {/* 列表：已载入工作流排在前。滚动容器挂 ref（窗口化的视口判据）。 */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5" ref={setScrollEl}>
        {empty && loading ? (
          /* 首次载入的加载态收在**骨架行**（ISSUE #4073 第 1 条）：不再用
           * 带转圈的整块加载界面占住列表列——「加载中」的转圈交给右侧详情区
           * （见 WorkflowLibrary 的右栏）。骨架不做动画（P3：视图里不许
           * 手写 animate-pulse / animate-spin）。 */
          <ul aria-label="正在加载工作流列表" className="flex flex-col gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map((row) => (
              <li
                className="border-border-subtle bg-subtle rounded-lg border px-2 py-2"
                key={`skeleton-${row}`}
              >
                <div className="bg-border-strong h-3 w-2/3 rounded" />
                <div className="bg-border mt-1.5 h-2.5 w-1/3 rounded" />
              </li>
            ))}
          </ul>
        ) : empty && stalled ? (
          <EmptyState
            action={
              <Button
                className="border-border text-muted-foreground hover:bg-subtle text-2xs h-auto rounded-lg px-3 py-1"
                onClick={onRefresh}
                size="sm"
                variant="outline"
              >
                重试
              </Button>
            }
            description={
              <>
                应用服务可能在编译或重启。可稍候重试；若持续如此，按
                <kbd className="border-border rounded border px-1 font-mono">Ctrl+Shift+L</kbd>
                打开日志面板查看具体原因。
              </>
            }
            icon={AlertTriangle}
            minHeightClass="min-h-40"
            title="工作流列表还没返回"
            variant="error"
          />
        ) : empty && loadError ? (
          /* #4464：查询硬失败（服务 500 等）是第四态 —— 不能落进「还没有工作流」
           * 的空态（像是工作流全没了）。给失败原因 + 重试入口。 */
          <EmptyState
            action={
              <Button
                className="border-border text-muted-foreground hover:bg-subtle text-2xs h-auto rounded-lg px-3 py-1"
                onClick={onRefresh}
                size="sm"
                variant="outline"
              >
                重试
              </Button>
            }
            description={loadError}
            icon={AlertTriangle}
            minHeightClass="min-h-40"
            title="工作流列表加载失败"
            variant="error"
          />
        ) : empty ? (
          <EmptyState
            description={
              search
                ? "换个关键词，或清空搜索框看全部。"
                : (localRootsHint ??
                  "点右上角「导入工作流」粘贴 JSON，或在设置里配置本地工作流目录后自动扫描。")
            }
            minHeightClass="min-h-40"
            title={search ? "未找到匹配的工作流" : "还没有工作流"}
          />
        ) : measured ? (
          <div
            className="relative w-full"
            role="list"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const workflow = workflows[vi.index];
              if (!workflow) {
                return null;
              }
              return (
                <div
                  data-index={vi.index}
                  key={workflow.id}
                  ref={virtualizer.measureElement}
                  role="listitem"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <WorkflowListItem
                    onClick={() => {
                      onSelect(workflow.id);
                    }}
                    selected={selectedId === workflow.id}
                    workflow={workflow}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          /* 量测前（jsdom / 首帧）退化为全量渲染：窗口化依赖量到的视口高度。 */
          <ul className="flex flex-col gap-1">
            {workflows.map((workflow) => (
              <li key={workflow.id}>
                <WorkflowListItem
                  onClick={() => {
                    onSelect(workflow.id);
                  }}
                  selected={selectedId === workflow.id}
                  workflow={workflow}
                />
              </li>
            ))}
          </ul>
        )}

        {/* 未载入的本地工作流排在已载入之后 */}
        {pendingRows.length > 0 && (
          <div className="border-info/25 bg-info/4 mt-3 mb-3 rounded-xl border border-dashed p-2.5">
            <p className="text-info-strong text-3xs mb-2 flex items-center gap-1.5 font-medium">
              {/* 状态点走`ui/status-dot`（全库唯一实现，规范 16 §16.2.4.5）；
`probing` 表达「还没载入、等待中」。 */}
              <StatusDot sizeClass="size-1.5" state="probing" />
              未载入的本地工作流
            </p>
            <ul className="flex flex-col gap-1">
              {pendingRows.map((pending) => {
                const loadingPending = pendingLoading[pending.id] === true;
                /* 整行不可点：点击即载入会被误触（只想看看名字 / 选中某一行的
                 * 用户会顺手点上去），因此载入动作只挂在右侧按钮上。 */
                return (
                  <li key={pending.id}>
                    <div className="border-border-subtle bg-subtle flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
                      <Hint label={pending.name}>
                        <span className="text-ink-strong text-2xs truncate">{pending.name}</span>
                      </Hint>
                      <Hint label={`载入「${pending.name}」`} wrap>
                        <Button
                          className="text-3xs h-auto shrink-0 gap-1 rounded-md px-2 py-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={loadingPending}
                          onClick={() => onLoadPending?.(pending)}
                          variant="info"
                        >
                          <Download className="size-3" data-icon="inline-start" />
                          {loadingPending ? "载入中…" : "载入"}
                        </Button>
                      </Hint>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* 底部计数 */}
      <div className="border-border-subtle text-ink-fainter text-3xs shrink-0 border-t px-3 py-2">
        共 {workflows.length + pendingRows.length} 个工作流
        {pendingRows.length > 0 ? `（${pendingRows.length} 个未载入）` : ""}
      </div>
    </div>
  );
}

/**
 * 列表行的名称空间策略（#5058）：名称占**行内剩余全部宽度**（`flex-1` +
 * `min-w-0` + `truncate`），徽标一律 `shrink-0` —— 侧栏约 400px 宽，名称
 * 可读到 20+ 字符才截断，比早年钉死 132px 的 `max-w-33` 可读性好得多；
 * 徽标不会被挤出（它们不参与收缩）。 */

function WorkflowListItem({
  workflow,
  selected,
  onClick,
}: {
  onClick: () => void;
  selected: boolean;
  workflow: WorkflowRow;
}) {
  const { usable } = deriveFormatFlags(workflow);
  const { missing, canResync } = deriveSyncFlags(workflow);
  const isTech = isTechnicalName(workflow.name);
  /* 对外参数封装状态（与生成链路同口径）：提示词口已有落点 = 工坊可直接驱动。
   * 契约口与必备口读生效注册表（本机覆盖优先）—— 与详情「工坊封装」页签
   * 同一份口径（ISSUE #4113：此前列表行回落内置默认，用户改过的契约不生效）。 */
  const { status: encapsulation } = useWorkflowEncapsulation({
    io: workflow.workflowIO ?? null,
    paramMap: workflow.paramMap ?? null,
    mode: workflow.defaultMode ?? workflow.taskType ?? null,
  });

  return (
    <Button
      className={[
        "h-auto w-full min-w-0 rounded-lg border px-2 py-1.5 text-left font-normal hover:bg-transparent",
        selected
          ? "border-primary/40 from-primary/15 to-accent/10 bg-linear-to-br"
          : "bg-subtle hover:border-border hover:bg-subtle border-transparent",
      ].join("")}
      onClick={onClick}
      variant="ghost"
    >
      {/* 单行布局（#4667）：名称 + 类型 + 状态徽标 + 来源，全部同一行。
          参考图挂载徽标与模型标签不再上列表——前者意义不大，后者挤行；
          完整信息（挂载节点 / 模型标签）仍在右侧详情里看。 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Hint label={workflow.name}>
          <span
            className={[
              "min-w-0 flex-1 truncate text-xs leading-tight font-medium",
              isTech ? "text-ink-strong font-mono" : "text-ink-bright",
            ].join("")}
          >
            {workflow.name}
          </span>
        </Hint>
        {workflow.taskType && (
          <span className="shrink-0">
            <TaskTypeChip taskType={workflow.taskType} />
          </span>
        )}
        {!usable && (
          <ListBadge title="没有工作流(RAW)原件 —— 没有可执行内容" tone="danger">
            无可执行内容
          </ListBadge>
        )}
        {/* 对外参数：状态收成一枚 1 字标记（✓ / ！），完整说明在 tooltip 里。
 此前这里是一整块`对外参数未配置` 文字，与名称争夺同一行宽度，
 是列表超框的主因。颜色 + 形状都表达「配好了没有」，所以不必靠
 文字长度来承载（`title` 里给全口径：已配置几个口 / 缺哪些口）。 */}
        {usable && (
          <ListBadge
            className={encapsulation.ready ? "" : "text-encap-pending bg-warning/12"}
            title={
              encapsulation.ready
                ? `对外参数已配置（${encapsulation.resolvedCount}/${encapsulation.entries.length}）`
                : `对外参数未配置：${encapsulation.missingLabels.join("、") || "提示词口未落到端口"}`
            }
            tone={encapsulation.ready ? "success" : "warning"}
          >
            {encapsulation.ready ? "✓" : "！"}
          </ListBadge>
        )}
        {canResync && (
          <ListBadge title={missing ? "本地文件已丢失" : "本地文件有更新"} tone="warning">
            {missing ? "已丢失" : "有更新"}
          </ListBadge>
        )}
        <SourceTag source={workflow.source} />
      </div>
    </Button>
  );
}
