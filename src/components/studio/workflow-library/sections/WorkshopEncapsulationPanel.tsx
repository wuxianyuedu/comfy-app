"use client";

// ── 工作流库详情「工坊封装」页签（规范 §17.2 第③层：只渲染 + 上抛）────────
// 替代旧的「可配置参数」草稿表单：工坊不把工作流的全部参数摊给用户，这里
// 展示的是**工坊会用哪些控件驱动这条工作流**（提示词 / 尺寸【宽高比+百万像素】/
// 负向提示词 / 参考图…），每个口落到哪个 IO 端口，缺落点时只在「必填口」上
// 立一个状态徽标（可选口没落点是常态，不是状态，见 entryStateBadge）。
//
// 三件事必须显式：
//   · **必填 / 可选**（随模式契约，`ModeContract.required`）——「能不能跑」只认
//     必填口；可选口不必连到工作流，缺的值由工作流图内的默认值兜底；
//   · **模式可切换**：多模式工作流（文生图 / 图生图…）在这里逐个换模式跑测试，
//     只测默认模式验不全另一条链路。切模式只改「看/测哪个模式」，不动默认模式；
//   · 「流程测试」按封装口径真实跑一次生成（提示词 + 尺寸 → ComfyUI），验证它在
//     工坊里的可用性 —— 与定妆照 / 镜头生图同一条 buildLibraryWorkflowInput 链路。

import React from "react";

import { ProgressBar } from "~/components/ui/progress-bar";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { SelectMenu } from "~/components/ui/select-menu";
import {
  deriveEncapsulationStatus,
  type EncapsulationEntryStatus,
} from "~/lib/workshop/workshop-encapsulation-status";
import { useModeContracts } from "~/components/workshop/mode-contract/hooks/use-mode-contracts";
import {
  modeContractEntries,
  requiredInputsFor,
} from "~/lib/workshop/model-mode-contract";
import { getWorkflowType } from "~/lib/workflow/workflow-types";
import { modeLabel } from "../workflow-library-config";
import { sceneFromMode } from "~/lib/media/size-presets";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { useEncapsulationTestRun } from "../hooks/use-encapsulation-test-run";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";
import { displayValue } from "~/lib/display-value";
import { EncapsulationTestForm } from "./EncapsulationTestForm";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { WorkflowRunLogButton } from "../WorkflowRunLogButton";
import { WorkflowRunLogModal } from "../WorkflowRunLogModal";

interface WorkshopEncapsulationPanelProps {
  workflowId: string;
  /** 工坊下拉/徽标展示名（模型标签优先；仅用于文案）。 */
  displayName: string;
  workflowIO: WorkflowIOMap | null;
  paramMap: Record<string, unknown> | null;
  /** 当前模式（详情层持有，与「画布节点」页签同一份）。 */
  mode: string | null | undefined;
  /** 该工作流可跑的模式码（多于一个时渲染模式下拉）。 */
  modes?: readonly string[];
  /** 切换当前模式（**只改查看 / 测试语境，不落库**）：多模式工作流要能逐个
   *  模式跑一次流程测试 —— 文生图 / 图生图两条链路的封装口往往不同，只看默认
   *  模式测不出另一条能不能用。 */
  onModeChange?: (mode: string) => void;
}

/** 契约口状态徽标的形态（配色表；文案由 `entryStateBadge` 按缺口给）。 */
const RESOLVED_BADGE_CLASS =
  "bg-emerald-100 text-emerald-800 dark:text-emerald-300";
const MISSING_REQUIRED_BADGE_CLASS =
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";

/** 落点状态 → 徽标：**已落点才给徽标**，没落点返回 null。
 *
 *  为什么「没落点」不再单独出一个徽标（ISSUE #720）：那一列里已经有
 *  「必填 / 可选」标签，而它读的正是「没落点会不会挡住运行」这同一份事实
 *  （`ModeContract.required`）——再挂一个「可选 · 未落点」，是把**已经说过的
 *  话**换个说法再说一遍，还占着一列的视觉重量。实测截图里那一行三个胶囊：
 *  `可选` `可选 · 未落点` `负向提示词`，前两个是同义反复。
 *
 *  留白只有一种例外：**必填口没落点**。那不是复述，是**状态**（缺了它这条
 *  工作流跑不了）——它必须一眼看得出来，且它在「必填」标签上读不出来（必填
 *  口照样可能已经落好点）。所以只保留这一个红色缺口徽标。
 *
 *  琥珀在这里刻意不用：没落点且必填 = 缺件，是问题状态（同「未配置」总览的
 *  红系），不是「待办提示」。 */
function entryStateBadge(entry: EncapsulationEntryStatus): {
  label: string;
  className: string;
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
  mode,
  modes,
  onModeChange,
}: WorkshopEncapsulationPanelProps) {
  /* 本页签独立的执行日志入口（按 source="encapsulation-test" 过滤） */
  const [logOpen, setLogOpen] = React.useState(false);
  const [logTaskId, setLogTaskId] = React.useState<string | null>(null);
  /* 模式契约注册表：用户改过的模式用自定义口径，未改过的用内置默认 ——
   * 封装视图与远端适配器、实际生成链路同说一套话。清单本身经
   * `modeContractEntries` 取，与「画布节点」页签的卡片列**同一份**
   * （ISSUE #596：两个页签各读各的，口径就对不上了）。 */
  const { contracts: storedContracts } = useModeContracts();
  /* 必备口来自模式契约（可配置，「模式契约」编辑器里勾选的那个勾）——本页的
   *  「能不能用」判据读它，不再写死「提示词」。 */
  const requiredInputs = React.useMemo(
    () =>
      requiredInputsFor({
        inputs: modeContractEntries(mode, storedContracts).map((e) => e.id),
        required: storedContracts.find(
          (c) => c.mode === (mode ?? "").toUpperCase(),
        )?.required,
      }),
    [mode, storedContracts],
  );
  const status = React.useMemo(
    () =>
      deriveEncapsulationStatus({
        io: workflowIO,
        paramMap,
        mode: mode ?? null,
        contractEntries: modeContractEntries(mode, storedContracts),
        requiredInputs,
      }),
    [workflowIO, paramMap, mode, storedContracts, requiredInputs],
  );

  /* 流程测试的运行编排（规范 §17.2 第②层）：与画布节点那次运行共用同一份
   *  运行登记表与日志弹窗，只是带自己的来源标记。视图这里只消费 controller。 */
  const test = useEncapsulationTestRun({
    workflowId,
    workflowName: displayName,
    mode: mode ?? null,
  });

  /* 表单交上来的就是**工坊对外值**本身（口子清单 = 该模式的契约口，见
   *  `EncapsulationTestForm`），这里不再做第二道字段过滤。 */
  const runTest = (values: WorkshopExposedValues) => {
    if (test.running || !status.ready) return;
    test.run(values);
  };

  return (
    <div className="border-border bg-panel-deep mx-auto max-w-2xl space-y-4 rounded-2xl border p-4">
      {/* 封装状态总览 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-ink-strong text-sm font-medium">工坊封装</h3>
        <WorkflowRunLogButton
          workflowId={workflowId}
          taskId={logTaskId}
          source="encapsulation-test"
          alwaysVisible
          onOpen={() => setLogOpen(true)}
        />
        {status.ready ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-300">
            已配置 · 工坊可用
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
            未配置
          </span>
        )}
        {mode && (
          <span className="text-muted-foreground text-[11px]">
            {getWorkflowType(mode)?.label ?? mode}
            <span className="font-mono text-[10px]">
              （{mode.toUpperCase()}）
            </span>
          </span>
        )}
        {/* 多模式工作流：在这里换模式逐个测（文生图 / 图生图的封装口不同，
         *  只看默认模式测不出另一条能不能用）。只改当前模式，不改默认模式。 */}
        {modes && modes.length > 1 && onModeChange && (
          <SelectMenu
            value={mode ?? modes[0]!}
            onChange={onModeChange}
            options={[...modes]}
            labels={Object.fromEntries(
              modes.map((code) => [code, modeLabel(code)]),
            )}
            popoverMinWidth={160}
            autoFitFromOptions={false}
            className="!border-border-strong h-auto !bg-transparent px-2 py-0.5 text-[11px]"
          />
        )}
        <span className="text-muted-foreground text-[11px]">
          {status.resolvedCount}/{status.entries.length} 个对外口已落到端口
        </span>
      </div>
      {!status.ready && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          必填口 {status.missingRequired.join("、")}
          还没落到任何端口 —— 工坊（角色卡定妆照 / 镜头生图）无法驱动这条
          工作流。到「画布节点」页签把对应卡片的圆点拖到工作流里承载它的那一行
          参数上，再回这里跑流程测试。
        </p>
      )}
      {status.entries.some((e) => !e.required) && (
        <p className="text-muted-foreground/80 text-[10px]">
          标注「可选」的口不必连到工作流：没有落点就用工作流图内的默认值执行。
        </p>
      )}

      {/* 工坊对外口一览：每个口 = 工坊控件形态 + 生效落点 */}
      <div className="space-y-2">
        {status.entries.map((entry) => {
          /* 一行最多两个胶囊：**必填 / 可选**（随模式契约）+ 落点状态。
           *  「没落点」只有必填口才有状态徽标 —— 可选口没落点就是常态，见
           *  `entryStateBadge` 的注释（ISSUE #720）。 */
          const badge = entryStateBadge(entry);
          return (
            /* 行布局走 `KeyValueRows`（P17）：左侧「键」是一组可变的徽标 +
                标签 + 口 id，右侧「值」是生效落点。此前这一段是与其它四处
                「标签 + 值」行**各写一份**的 `flex items-center` 布局。 */
            <KeyValueRows
              key={entry.id}
              className="border-border/60 bg-surface rounded-lg border px-3 py-2"
              itemClassName="text-[12px]"
              keyClassName="text-ink flex min-w-0 items-center gap-2 font-medium"
              valueClassName="text-muted-foreground/70 min-w-0 flex-1 truncate font-mono text-[10px]"
              items={[
                {
                  id: entry.id,
                  key: (
                    <>
                      {/* 必备 / 可选由**模式契约**判定（`ModeContract.required`），
                          不是写死的口名 —— 与「能不能跑」的判据同一份事实。 */}
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          entry.required
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                            : "bg-subtle text-muted-foreground/80 border-border-strong border"
                        }`}
                      >
                        {entry.required ? "必填" : "可选"}
                      </span>
                      {badge && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      )}
                      <span className="text-ink text-[12px] font-medium">
                        {entry.label}
                        {/* 口 id 与中文字面并列：配置 / 日志 / 代码里用的是 id，
                            而契约口与适配器口是两套 id，只写中文对不上。 */}
                        <span className="text-muted-foreground/60 ml-1 font-mono text-[10px]">
                          {entry.id}
                        </span>
                      </span>
                    </>
                  ),
                  value: displayValue(entry.targetIoKey),
                },
              ]}
            />
          );
        })}
      </div>

      {/* 流程测试：按封装口径真实跑一次（提示词 / 负向 / 尺寸 / 图片 / 时长 → ComfyUI） */}
      <div className="border-primary-soft bg-primary-soft/30 rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-primary text-xs font-medium">流程测试</p>
          <span className="text-muted-foreground text-[10px]">
            按工坊口径生成一张图，验证封装可用性
          </span>
        </div>
        <div className="space-y-2">
          {/* 输入框由**该模式的契约口清单**逐口渲染 —— 与上方「工坊对外口一览」
              同一份清单，不看有没有落点（没落点的口照样能填，值落不下去时由
              工作流图内的默认值兜底）。 */}
          <EncapsulationTestForm
            entries={status.entries}
            scene={sceneFromMode(mode)}
            running={test.running}
            canRun={status.ready}
            runDisabledReason={
              status.ready
                ? undefined
                : `${status.missingRequired.join("、") || "必备口"}未落到端口，工坊无法驱动这条工作流`
            }
            onRun={runTest}
            uploadImage={test.uploadImage}
          />
          {test.running && (
            <ProgressBar
              value={test.progress}
              minVisible={4}
              showValue={false}
              trackClassName="bg-elevated h-1"
            />
          )}
          {test.error && (
            <p className="rounded-lg bg-red-100 px-3 py-2 text-[11px] text-red-800 dark:text-red-300">
              {test.error}
            </p>
          )}
          {test.resultUrl && (
            <div className="space-y-1">
              <p className="text-primary text-[11px]">
                流程测试通过 —— {displayName} 在工坊中可用。
              </p>
              <MediaThumbnail
                src={test.resultUrl}
                alt="流程测试产物"
                className="border-border max-h-56 rounded-lg border"
              />
            </div>
          )}
          <p className="text-muted-foreground/70 text-[10px]">
            工作流图内的其余参数（步数 /
            采样器等）按图内默认值执行，不在工坊对外暴露。
          </p>
        </div>
      </div>

      {/* 本页签独立的执行日志弹窗（按 source="encapsulation-test" 过滤） */}
      <WorkflowRunLogModal
        open={logOpen}
        workflowId={workflowId}
        source="encapsulation-test"
        viewTaskId={logTaskId}
        onViewTaskIdChange={setLogTaskId}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}
