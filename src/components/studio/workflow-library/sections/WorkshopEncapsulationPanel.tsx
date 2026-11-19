"use client";

// ── 工作流库详情「工坊封装」页签（规范 §17.2 第③层：只渲染 + 上抛）──
// 展示工坊会用哪些控件驱动这条工作流（提示词 / 尺寸 / 负向 / 参考图…），每个口
// 落到哪个 IO 端口；缺落点只在必填口上立状态徽标（可选口没落点是常态）。三件事
// 显式：必填/可选随模式契约（`ModeContract.required`，能不能跑只认必填口）；
// 模式可切换（只改「看/测哪个模式」，不动默认模式）；流程测试按封装口径真实跑一次。

import React, { useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { SelectMenu } from "~/components/ui/select-menu";
import { Hint } from "~/components/ui/hint";
import type { EncapsulationEntryStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { ContractRequiredBadge } from "~/components/workshop/mode-contract/ContractRequiredBadge";
import { getWorkflowType } from "~/lib/workflow/workflow-types";
import { modeLabel } from "../workflow-library-config";
import { sceneFromMode } from "~/lib/media/size-presets";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { workflowDefaultSizeSpec } from "~/components/studio/workflow-io";
import { useWorkflowEncapsulation } from "../hooks/use-workflow-encapsulation";
import { useEncapsulationTestRun } from "../hooks/use-encapsulation-test-run";
import { useLatestRunTaskId } from "../hooks/use-latest-run-task-id";
import { WorkflowRunLogButton } from "../WorkflowRunLogButton";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";
import { displayValue } from "~/lib/display-value";
import { EncapsulationTestForm } from "./EncapsulationTestForm";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";

/* 运行日志弹窗按需拉（规范 §12.19）：它下面挂着 `ui/json-viewer`
 * → `react18-json-view`，而本面板只在**真的点开日志**时才需要它。此前那条静态边
 * 会一路传进工作流库 → `components/studio/index.ts` → 入口（实测链见
 * `scripts/gates/check-barrel-heavy-deps.cjs` 的报告）。 */
const LazyWorkflowRunLogModal = React.lazy(() =>
  import("../WorkflowRunLogModal").then((m) => ({
    default: m.WorkflowRunLogModal,
  })),
);

type WorkshopEncapsulationPanelProps = {
  /** 工坊下拉/徽标展示名（模型标签优先；仅用于文案）。 */
  displayName: string;
  /** 当前模式（详情层持有，与「画布节点」页签同一份）。 */
  mode: string | null | undefined;
  /** 该工作流可跑的模式码（多于一个时渲染模式下拉）。 */
  modes?: ReadonlyArray<string>;
  /** 切换当前模式（**只改查看 / 测试语境，不落库**）：多模式工作流要能逐个
   * 模式跑一次流程测试 —— 文生图 / 图生图的封装口不同，只看默认模式测不出
   * 另一条能不能用。 */
  onModeChange?: (mode: string) => void;
  paramMap: Record<string, unknown> | null;
  /** RAW（UI 格式）工作流 JSON（`sourceData.source`）：流程测试的尺寸初值在
   *  暴露面没给尺寸口时从这里直读图内默认（ISSUE #4550）。 */
  rawJson?: unknown;
  workflowId: string;
  workflowIO: WorkflowIOMap | null;
};

/** 契约口状态徽标的形态（配色表；文案由`entryStateBadge` 按缺口给）。
 *  走语义 token（§4.11.1 / P71）：已落点→success、必填未落点→destructive。
 *  token 内部已含浅/深两态，bg 与 text 自动配套——不再需要手写 `dark:bg-*`
 *  单独切深底（此前的「浅绿字叠浅绿底、暗色看不清」事故正是这么补的）。 */
const RESOLVED_BADGE_CLASS = "bg-success/15 text-success-strong";
const MISSING_REQUIRED_BADGE_CLASS = "bg-destructive/15 text-destructive";

/** 落点状态 → 徽标：**已落点才给徽标**，没落点返回 null。
 *  没落点不再单独出徽标（ISSUE #720）：旁边的「必填/可选」标签读的正是同一份
 *  事实，再挂「可选 · 未落点」是同义反复。唯一例外是**必填口没落点** —— 那是
 *  缺件状态，必须一眼可见；用红系而非琥珀。 */
function entryStateBadge(entry: EncapsulationEntryStatus): {
  className: string;
  label: string;
} | null {
  if (entry.targetIoKey !== null) {
    return { label: "已落点", className: RESOLVED_BADGE_CLASS };
  }
  if (entry.required) {
    return { label: "未落点", className: MISSING_REQUIRED_BADGE_CLASS };
  }
  return null;
}

export function WorkshopEncapsulationPanel({
  workflowId,
  displayName,
  workflowIO,
  paramMap,
  rawJson,
  mode,
  modes,
  onModeChange,
}: WorkshopEncapsulationPanelProps) {
  /* 模式契约注册表：契约口清单、必备口与封装状态都经 `useWorkflowEncapsulation`
   * 取生效注册表（本机覆盖逐模式压过项目默认）—— 与模式契约编辑器、列表行徽标、
   * 远端适配器、实际生成链路同说一套话（ISSUE #596 / #4113）。 */
  const { contractIds, status } = useWorkflowEncapsulation({
    mode,
    io: workflowIO,
    paramMap,
  });

  /* 流程测试的运行编排（规范 §17.2 第②层）：与画布节点那次运行共用同一份
   * 运行登记表与日志弹窗，只是带自己的来源标记。视图这里只消费 controller。 */
  const test = useEncapsulationTestRun({
    workflowId,
    workflowName: displayName,
    mode: mode ?? null,
    contractIds,
  });

  /* 工作流的图内默认尺寸（ISSUE #4550）：流程测试表单的尺寸初值跟它走 ——
   * 作者在图内控件里配的尺寸（如 MiniMax H3 的 1:1 / 4M / 32）就是这条
   * 工作流的「默认尺寸」，测试不该另起一份全局默认。判据与画布组合控件
   * 同源（`workflowDefaultSizeSpec` 内部走 `inferDimensionGroup`）；认不出
   * 时给 null，表单回退全局默认。 */
  const defaultSize = useMemo(
    () => workflowDefaultSizeSpec({ io: workflowIO, mode: mode ?? null, rawJson }),
    [workflowIO, mode, rawJson],
  );

  /* 表单交上来的就是**工坊对外值**本身（口子清单 = 该模式的契约口，见
   *`EncapsulationTestForm`），这里不再做第二道字段过滤。 */
  const runTest = (values: WorkshopExposedValues) => {
    if (test.running || !status.ready) {
      return;
    }
    test.run(values);
  };

  /* 本页签独立的「执行日志」入口：带 encapsulation-test 来源过滤，与画布节点
   * 页签各自一处（ISSUE #611 旧形态：两个页签各写各的）。 */
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  /* 订阅运行登记表取最近一次（#4466）：此前 useMemo 依赖只有 workflowId，
   * 登记表变化不重算，摘要指向旧一次运行。 */
  const latestLogTaskId = useLatestRunTaskId(workflowId, "encapsulation-test");
  const logViewTaskId = logTaskId ?? latestLogTaskId;

  return (
    <div className="border-border bg-panel-deep mx-auto max-w-2xl flex-col gap-4 rounded-2xl border p-4">
      {/* 封装状态总览。执行日志入口**在本页签这一排**（带 encapsulation-test 来源），
 与画布节点页签各自独立（ISSUE #611 旧形态：两个页签各写各的）。 */}
      <div className="flex flex-wrap items-center gap-2">
        <WorkflowRunLogButton
          onOpen={() => {
            setLogOpen(true);
          }}
          source="encapsulation-test"
          taskId={logViewTaskId}
          workflowId={workflowId}
        />
        <h3 className="text-ink-strong text-sm font-medium">工坊封装</h3>
        {status.ready ? (
          <Badge size="pill-md" tone="success">
            已配置 · 工坊可用
          </Badge>
        ) : (
          <Badge size="pill-md" tone="warning">
            未配置
          </Badge>
        )}
        {mode !== null && mode !== undefined && mode !== "" && (
          <span className="text-muted-foreground text-2xs">
            {getWorkflowType(mode)?.label ?? mode}
            <span className="text-3xs font-mono">（{mode.toUpperCase()}）</span>
          </span>
        )}
        {/* 多模式工作流：在这里换模式逐个测（文生图 / 图生图的封装口不同，
         * 只看默认模式测不出另一条能不能用）。只改当前模式，不改默认模式。 */}
        {modes && modes.length > 1 && onModeChange && (
          <SelectMenu
            autoFitFromOptions={false}
            className="border-border-strong! text-2xs h-auto bg-transparent! px-2 py-0.5"
            labels={Object.fromEntries(modes.map((code) => [code, modeLabel(code)]))}
            onChange={onModeChange}
            options={[...modes]}
            popoverMinWidth={160}
            value={mode ?? modes.at(0) ?? ""}
          />
        )}
        {/* 计数写明「数的是什么」（ISSUE #4102）：分母 = 该模式契约口总数
         *（含可选与自定义口），分子 = 已连到工作流端口的口数。 */}
        <Hint
          label={
            `该模式共 ${status.entries.length} 个契约口（含可选口与自定义口），` +
            `其中 ${status.resolvedCount} 个已连到工作流端口。可选口未连不阻碍工坊运行；` +
            `必备口未连会标红并阻止流程测试。`
          }
        >
          <span className="text-muted-foreground text-2xs">
            已落点 {status.resolvedCount}/{status.entries.length} 个契约口
          </span>
        </Hint>
      </div>
      {!status.ready && (
        <p className="bg-warning/10 text-warning-strong text-2xs rounded-lg px-3 py-2">
          必填口 {status.missingRequired.join("、")}
          还没落到任何端口 —— 工坊（角色卡定妆照 / 镜头生图）无法驱动这条
          工作流。到「画布节点」页签把对应卡片的圆点拖到工作流里承载它的那一行
          参数上，再回这里跑流程测试。
        </p>
      )}
      {status.entries.some((e) => !e.required) && (
        <p className="text-muted-foreground/80 text-3xs">
          标注「可选」的口不必连到工作流：没有落点就用工作流图内的默认值执行。
        </p>
      )}

      {/* 工坊对外口一览：每个口 = 工坊控件形态 + 生效落点 */}
      <div className="flex flex-col gap-2">
        {status.entries.map((entry) => {
          /* 一行最多两个胶囊：**必填 / 可选**（随模式契约）+ 落点状态。
           * 「没落点」只有必填口才有状态徽标 —— 可选口没落点就是常态，见
           *`entryStateBadge` 的注释（ISSUE #720）。 */
          const badge = entryStateBadge(entry);
          return (
            /* 行布局走`KeyValueRows`（P17）：左侧「键」是一组可变的徽标 +
 标签 + 口 id，右侧「值」是生效落点。此前这一段是与其它四处
 「标签 + 值」行**各写一份**的`flex items-center` 布局。 */
            <KeyValueRows
              className="border-border/60 bg-surface rounded-lg border px-3 py-2"
              itemClassName="text-xs"
              items={[
                {
                  id: entry.id,
                  key: (
                    <>
                      {/* 必备 / 可选由**模式契约**判定（`ModeContract.required`），
                          不是写死的口名 —— 与「能不能跑」的判据同一份事实。形态与
                          「模式契约」编辑器里那一枚同源（共用
                          `ContractRequiredBadge`，ISSUE #4072）。 */}
                      <ContractRequiredBadge required={entry.required} />
                      {badge && (
                        <span
                          className={`text-3xs shrink-0 rounded px-1.5 py-0.5 font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      )}
                      <span className="text-ink text-xs font-medium">
                        {entry.label}
                        {/* 口 id 与中文字面并列：配置 / 日志 / 代码里用的是 id，
 而契约口与适配器口是两套 id，只写中文对不上。 */}
                        <span className="text-muted-foreground/60 text-3xs ml-1 font-mono">
                          {entry.id}
                        </span>
                      </span>
                    </>
                  ),
                  value: displayValue(entry.targetIoKey),
                  /* 悬停看全文：值是 IO 口标识符（`ckpt_name_2` / 中文 pin 名），窄列会截成省略号。 */
                  title: displayValue(entry.targetIoKey),
                },
              ]}
              key={entry.id}
              keyClassName="text-ink flex min-w-0 items-center gap-2 font-medium"
              valueClassName="text-muted-foreground/70 min-w-0 flex-1 truncate font-mono text-3xs"
            />
          );
        })}
      </div>

      {/* 参考图装载已拆到独立页签（ISSUE #4526，`sections/ReferenceLoaderTab.tsx`）：
       *  本页签只保留契约口一览与流程测试。 */}

      {/* 流程测试：按封装口径真实跑一次（提示词 / 负向 / 尺寸 / 图片 / 时长 → ComfyUI） */}
      <div className="border-primary-soft bg-primary-soft/30 rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-primary text-xs font-medium">流程测试</p>
          <span className="text-muted-foreground text-3xs">
            按工坊口径生成一张图，验证封装可用性
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {/* 输入框由**该模式的契约口清单**逐口渲染 —— 与上方「工坊对外口一览」
 同一份清单，不看有没有落点（没落点的口照样能填，值落不下去时由
 工作流图内的默认值兜底）。 */}
          <EncapsulationTestForm
            canRun={status.ready}
            entries={status.entries}
            initialSize={defaultSize}
            onRun={runTest}
            runDisabledReason={
              status.ready
                ? undefined
                : `${status.missingRequired.join("、") || "必备口"}未落到端口，工坊无法驱动这条工作流`
            }
            running={test.running}
            scene={sceneFromMode(mode)}
            uploadImage={test.uploadImage}
          />
          {test.running && (
            <ProgressBar
              minVisible={4}
              showValue={false}
              trackClassName="bg-elevated h-1"
              value={test.progress}
            />
          )}
          {test.error && (
            <p className="bg-destructive/10 text-destructive text-2xs rounded-lg px-3 py-2">
              {test.error}
            </p>
          )}
          {test.resultUrl !== null && test.resultUrl !== "" && (
            <div className="flex flex-col gap-1">
              <p className="text-primary text-2xs">流程测试通过 —— {displayName} 在工坊中可用。</p>
              <MediaThumbnail
                alt="流程测试产物"
                className="border-border max-h-56 rounded-lg border"
                src={test.resultUrl}
              />
            </div>
          )}
          <p className="text-muted-foreground/70 text-3xs">
            工作流图内的其余参数（步数 / 采样器等）按图内默认值执行，不在工坊对外暴露。
          </p>
        </div>
      </div>
      {/* 懒分块的边界必须**就地**：本面板在「选中一条工作流」的同步更新里挂载，
          首帧渲染就会触发这份 import()；没有局部 Suspense 时 suspend 会一路冒到
          路由级 fallback（app/workspace/loading.tsx），把顶栏标题、左侧列表与侧栏
          选中态整屏顶成加载骨架（ISSUE #4525）。弹窗默认关闭，fallback 给 null
          即可 —— 分块在后台下载，其余内容照常显示。 */}
      <React.Suspense fallback={null}>
        <LazyWorkflowRunLogModal
          onClose={() => {
            setLogOpen(false);
          }}
          onViewTaskIdChange={setLogTaskId}
          open={logOpen}
          source="encapsulation-test"
          viewTaskId={logViewTaskId}
          workflowId={workflowId}
        />
      </React.Suspense>
    </div>
  );
}
