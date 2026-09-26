"use client";

import type { DragEventHandler } from "react";
import { textHandler } from "~/lib/form-props";
import { AlertTriangle, Search, Download } from "lucide-react";
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
import { Spinner } from "~/components/ui/spinner";
import { deriveEncapsulationStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { SourceTag } from "~/components/ui/source-tag";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusDot } from "~/components/ui/status-dot";
import { ListBadge } from "~/components/ui/list-badge";

interface WorkflowLibraryListProps {
  workflows: WorkflowRow[];
  pendingRows?: PendingRow[];
  selectedId?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onLoadPending?: (pending: PendingRow) => void;
  /** 列表仍在拉取中；此时「一条都没有」不代表「没有工作流」。 */
  loading?: boolean;
  /** 拉取超过预期时长仍未返回（服务在响应但查询没回来）。 */
  stalled?: boolean;
  /** 重试拉取（超时提示里的动作）。 */
  onRefresh?: () => void;
  /** 本地工作流目录侧的可读原因（没解析到根 / 根不可访问 / 目录里没有文件）；
   * 非空时用它替换默认空态文案，说明「为什么是空」。 */
  localRootsHint?: string | null;
  /** 拖入 JSON 导入：整片列表侧栏就是投放区，这里接管高亮与投放事件
   * （与导入面板共用同一个文件漏斗，见 useWorkflowImport）。 */
  dragActive?: boolean;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** 文件入口（拖入）失败的可读原因。 */
  fileErr?: string | null;
  /** 单个待载入项的「载入中」标志（按 id 查表）：载入按钮据此禁用并改文案，
   * 避免重复点击把同一份磁盘文件重复载入。 */
  pendingLoading?: Record<string, boolean>;
}

/**
 * 左侧工作流列表：搜索 + 可滚动条目。选中项高亮，右侧详情面板联动。
 *
 * 三态必须可区分（规范 10.5：空态要说清「为什么是空的」）：
 * 加载中 / 数据没回来 → 进度提示，绝不渲染成「未找到匹配的工作流」；
 * 拉取超时 → 提示「仍在加载」并说明可以做什么，不假装是空库；
 * 确实没有（且未筛选）→ 指引导入或配置本地目录。
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
  dragActive = false,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  fileErr = null,
  pendingLoading = {},
}: WorkflowLibraryListProps) {
  const empty = workflows.length === 0 && pendingRows.length === 0;
  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        "border-border-subtle bg-panel-deep flex h-full w-full min-w-0 flex-col border-r",
        /* 拖入高亮用 outline：不参与布局，不会让列表在拖拽时抖一下。 */
        dragActive ? "outline-info/60 outline-2 -outline-offset-2" : "",
      ].join("")}
    >
      {/* 搜索栏。`shrink-0` 必须有：排查过的一个现场是搜索框连同下面的列表一起
 纵向压缩 —— flex 列容器里`p-3` 的固定块默认`flex-shrink: 1`，
 列表内容一多它就被压，输入框看着像「瘪了」。 */}
      <div className="border-border-subtle shrink-0 border-b p-3">
        <div className="relative">
          <Search className="text-ink-fainter pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            type="text"
            value={search}
            onChange={textHandler(onSearchChange)}
            placeholder="搜索工作流名称…"
            className="border-border bg-subtle text-ink-bright placeholder:text-ink-fainter focus-visible:border-primary-500/40 focus-visible:ring-primary/30 h-8 w-full rounded-lg border pr-3 pl-8 text-xs"
          />
        </div>
      </div>

      {dragActive && (
        <p className="border-info/30 bg-info/10 text-info-strong border-b px-3 py-1.5 text-center text-[11px]">
          松开即可读取该工作流 JSON
        </p>
      )}
      {fileErr && (
        <p className="border-destructive/25 bg-destructive/8 text-destructive border-b px-3 py-1.5 text-[11px]">
          ⚠ {fileErr}
        </p>
      )}

      {/* 列表：已载入工作流排在前 */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {empty && loading ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            title="正在加载工作流…"
            description="本地目录会一起扫描，文件多时首次载入需要几秒。"
            icon={<Spinner className="size-6" />}
          />
        ) : empty && stalled ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            variant="error"
            icon={AlertTriangle}
            title="工作流列表还没返回"
            description={
              <>
                应用服务可能在编译或重启。可稍候重试；若持续如此，按{""}
                <kbd className="border-border rounded border px-1 font-mono">
                  Ctrl+Shift+L
                </kbd>
                {""}
                打开日志面板查看具体原因。
              </>
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-1 text-[11px]"
              >
                重试
              </Button>
            }
          />
        ) : empty ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            title={search ? "未找到匹配的工作流" : "还没有工作流"}
            description={
              search
                ? "换个关键词，或清空搜索框看全部。"
                : (localRootsHint ??
                  "点右上角「导入工作流」粘贴 JSON，或在设置里配置本地工作流目录后自动扫描。")
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {workflows.map((workflow) => (
              <WorkflowListItem
                key={workflow.id}
                workflow={workflow}
                selected={selectedId === workflow.id}
                onClick={() => onSelect(workflow.id)}
              />
            ))}
          </ul>
        )}

        {/* 未载入的本地工作流排在已载入之后 */}
        {pendingRows.length > 0 && (
          <div className="border-info/25 bg-info/[0.04] mt-3 mb-3 rounded-xl border border-dashed p-2.5">
            <p className="text-info-strong mb-2 flex items-center gap-1.5 text-[10px] font-medium">
              {/* 状态点走`ui/status-dot`（全库唯一实现，规范 16 §16.2.4.5）；
`probing` 表达「还没载入、等待中」。 */}
              <StatusDot state="probing" sizeClass="size-1.5" />
              未载入的本地工作流
            </p>
            <ul className="flex flex-col gap-1">
              {pendingRows.map((pending) => {
                const loadingPending = !!pendingLoading[pending.id];
                /* 整行不可点：点击即载入会被误触（只想看看名字 / 选中某一行的
                 * 用户会顺手点上去），因此载入动作只挂在右侧按钮上。 */
                return (
                  <li key={pending.id}>
                    <div className="border-border-subtle bg-subtle flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
                      <span
                        className="text-ink-strong truncate text-[11px]"
                        title={pending.name}
                      >
                        {pending.name}
                      </span>
                      <Hint label={`载入「${pending.name}」`} wrap>
                        <Button
                          variant="info"
                          onClick={() => onLoadPending?.(pending)}
                          disabled={loadingPending}
                          className="h-auto shrink-0 gap-1 rounded-md px-2 py-1 text-[10px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Download
                            data-icon="inline-start"
                            className="size-3"
                          />
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
      <div className="border-border-subtle text-ink-fainter shrink-0 border-t px-3 py-2 text-[10px]">
        共 {workflows.length + pendingRows.length} 个工作流
        {pendingRows.length > 0 ? `（${pendingRows.length} 个未载入）` : ""}
      </div>
    </div>
  );
}

/**
 * 列表项的名称最大显示宽度（px）。
 *
 * 侧栏是固定宽度（`w-80` = 320px，减去内边距与两侧 gap 后约 280px 可用），
 * 而工作流名常来自磁盘文件名 ——`22WorkflowsI2VSVI2_fastfidelityCAIoV88`
 * 这类可以长到 40+ 字符。名称不设上限时有两种坏法，两种都真发生过：
 *
 * ① 名称吃掉整行宽度，右侧徽标被挤出侧栏，被根容器的`overflow-hidden`
 * 裁掉（用户看到的是「徽标不见了」）；
 * ② 名称在换行点折成两行，行高翻倍，一屏少看好几条。
 *
 * 因此给出显式上限：`truncate` +`max-w-[132px]` 把可截断的那块钉住，
 * 宽度压力由它承担，徽标一律`shrink-0`（规范 03 §3.8.1：可截断的块要有
 * 贴着实测宽度的下限，按钮/徽标不许被压扁）。完整名称仍在`title` 里。
 */
const NAME_MAX_WIDTH_CLASS = "max-w-[132px]";

function WorkflowListItem({
  workflow,
  selected,
  onClick,
}: {
  workflow: WorkflowRow;
  selected: boolean;
  onClick: () => void;
}) {
  const { usable } = deriveFormatFlags(workflow);
  const { missing, canResync } = deriveSyncFlags(workflow);
  const isTech = isTechnicalName(workflow.name);
  /* 对外参数封装状态（与生成链路同口径）：提示词口已有落点 = 工坊可直接驱动。 */
  const encapsulation = deriveEncapsulationStatus({
    io: workflow.workflowIO ?? null,
    paramMap: workflow.paramMap ?? null,
    mode: workflow.defaultMode ?? workflow.taskType ?? null,
  });

  return (
    <li>
      <Button
        variant="ghost"
        onClick={onClick}
        className={[
          "h-auto w-full min-w-0 rounded-lg border px-2 py-1.5 text-left font-normal hover:bg-transparent",
          // p71-allow:start brand 渐变 · 选中态 violet→fuchsia 双色（项目品牌视觉 · 与卡片头 logo 呼应）
          selected
            ? "border-violet-500/40 bg-linear-to-br from-violet-500/15 to-fuchsia-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]"
            : "bg-subtle hover:border-border hover:bg-subtle border-transparent",
          // p71-allow:end
        ].join("")}
      >
        {/* 单行布局：名称 + 徽标同一行，降低每项高度 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={[
              NAME_MAX_WIDTH_CLASS,
              "shrink truncate text-[12px] leading-tight font-medium",
              isTech ? "text-ink-strong font-mono" : "text-ink-bright",
            ].join("")}
            title={workflow.name}
          >
            {workflow.name}
          </span>
          {!usable && (
            <ListBadge
              tone="danger"
              title="没有工作流(RAW)原件 —— 没有可执行内容"
            >
              无可执行内容
            </ListBadge>
          )}
          {/* 对外参数：状态收成一枚 1 字标记（✓ / ！），完整说明在 tooltip 里。
 此前这里是一整块`对外参数未配置` 文字，与名称争夺同一行宽度，
 是列表超框的主因。颜色 + 形状都表达「配好了没有」，所以不必靠
 文字长度来承载（`title` 里给全口径：已配置几个口 / 缺哪些口）。 */}
          {usable && (
            <ListBadge
              tone={encapsulation.ready ? "success" : "warning"}
              className={
                encapsulation.ready ? "" : "text-encap-pending bg-warning/12"
              }
              title={
                encapsulation.ready
                  ? `对外参数已配置（${encapsulation.resolvedCount}/${encapsulation.entries.length}）`
                  : `对外参数未配置：${encapsulation.missingLabels.join("、") || "提示词口未落到端口"}`
              }
            >
              {encapsulation.ready ? "✓" : "！"}
            </ListBadge>
          )}
          {canResync && (
            <ListBadge
              tone="warning"
              title={missing ? "本地文件已丢失" : "本地文件有更新"}
            >
              {missing ? "已丢失" : "有更新"}
            </ListBadge>
          )}
          <SourceTag source={workflow.source} />
        </div>

        {(workflow.taskType || (workflow.modelTags?.length ?? 0) > 0) && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <TaskTypeChip taskType={workflow.taskType} />
            {workflow.modelTags?.slice(0, 2).map((tag) => (
              <ListBadge
                key={tag}
                tone="neutral"
                title={tag}
                className="max-w-[72px] truncate rounded-full"
              >
                {tag}
              </ListBadge>
            ))}
            {(workflow.modelTags?.length ?? 0) > 2 && (
              <span className="text-ink-fainter shrink-0 text-[9px]">
                +{(workflow.modelTags?.length ?? 0) - 2}
              </span>
            )}
          </div>
        )}
      </Button>
    </li>
  );
}
