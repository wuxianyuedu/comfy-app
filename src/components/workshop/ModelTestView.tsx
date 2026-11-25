"use client";

// ── 「测试模型能力」**视图**（规范 §17 第③层：只渲染 + 上抛）─────────────
// 三栏 Bento 布局：左栏 = 用途 / 模式 / 模型 合并成的一棵树（布局可切换，
// ISSUE #4916 / #4952）+ 通道提示；中栏 = 统一输入 + 生成 CTA + 进度 / 告警 +
// 执行日志；右栏 = 产物 / 请求与响应（ModelTestResultPanel）。候选 / 适配器 /
// 契约 / 生成动作都在
// `hooks/use-model-test.ts`（第②层）与 `model-test-config.ts`（第①层）；
// 本文件不出现 fetch / api.*。

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Boxes,
  Compass,
  History,
  Info,
  Play,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { FormField } from "~/components/ui/form-field";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { sizeSourceForMode } from "~/lib/workflow/workflow-size-source";
import type { QueueTaskLogTarget } from "~/components/studio/queue/QueueTaskLogModal";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { cn } from "~/lib/utils";
import type { ModelTestRetryPayload } from "~/components/studio/history/history-detail-derive";
import {
  MODEL_TEST_KIND_LABELS,
  serializeModelTestJson,
  type ModelTestControl,
  type ModelTestKind,
} from "./model-test-config";
import { InputRow } from "./ModelTestInputRow";
import { ModelTestProgressPanel } from "./ModelTestProgressPanel";
import { ModelTestSizeField } from "./ModelTestSizeField";
import { ModelTestTree } from "./ModelTestTree";
import { ReferenceImageField, RequiredBadge } from "./ReferenceImageField";
import { SectionCard } from "./ModelTestSectionCard";
import { useModelTest } from "./hooks/use-model-test";
import { useModelTestTree } from "./hooks/use-model-test-tree";
import { LogsCard, ModelTestResultPanel } from "./ModelTestResultPanel";

/* 「大屏查看日志」弹窗：与历史记录 / 队列页同一份（QueueTaskLogModal 按 taskId
 * 直连 SSE）。dynamic 加载断开它携带的重依赖（react18-json-view 等），与
 * HistoryList 的接法同款。 */
const QueueTaskLogModal = dynamic(() =>
  import("~/components/studio/queue/QueueTaskLogModal").then((m) => m.QueueTaskLogModal),
);

type ModelTestController = ReturnType<typeof useModelTest>;

/** 空态引导（还没选模型时占住中栏）：三步指路，不出现任何网络 / 导航动作。 */
function OnboardingPanel({ c }: { c: ModelTestController }) {
  const kindLabel = MODEL_TEST_KIND_LABELS[c.kind];
  const steps = [
    "在左栏选用途与模式（当前：图片 / 视频 / 对话 分栏测试）",
    "从「模型」里挑一个候选 —— 本地模型来自工作流库，远端模型来自「设置 → 远程模型」",
    `填写提示词等统一输入，点「生成」查看${kindLabel}真实产物`,
  ];
  return (
    <SectionCard
      className="flex-1 items-center justify-center py-10"
      hint="与工坊生成走同一条通道"
      icon={<Compass />}
      title="选择一个模型开始测试"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="bg-primary-soft text-primary-strong flex size-14 items-center justify-center rounded-full">
          <Compass className="size-7" />
        </span>
        <span className="mt-2 text-base font-semibold">三步跑通一次真实调用</span>
        <span className="text-muted-foreground max-w-md text-xs leading-relaxed">
          当前「{kindLabel}」用途下共有 {c.kindCandidateCount}{" "}
          个候选模型；选中后这里会展开统一输入表单。
        </span>
      </div>
      <ol className="mt-2 flex w-full max-w-md flex-col gap-2">
        {steps.map((step, i) => (
          <li
            className="border-border bg-surface-1 text-ink flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-xs"
            key={step}
          >
            <span className="bg-subtle text-muted-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-bold tabular-nums">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

/** 左栏：用途 + 模式 + 模型合并成的一棵树（ISSUE #4952）。树本身管展开、
 *  布局切换与选中回填，空态 / 骨架屏仍在这里按页面口径给。左栏是**普通静态
 *  栏**（ISSUE #4997，#4983 的三类诉求）：不吸顶、不做内部滚动容器、高度=
 *  内容自然高度（不被拉伸填补空白）——树很高时随页面整体滚动查看，页面底部
 *  的既有内边距就是栏底空隙。 */
function LeftColumn({
  c,
  tree,
}: {
  c: ModelTestController;
  /** 树形条目的装配（跨三种用途；ISSUE #4916 / #4952）。 */
  tree: ReturnType<typeof useModelTestTree>;
}) {
  /* 树叶自带「用途 + 模式 + 模型」路径语义：选中即一次回填页面三态。
   * setKind 会重置模型与模式，顺序必须 kind → mode → model；后两步拿到的
   * 都是旧闭包也不会错 —— setMode 对已重置的选中项不再清第二遍，
   * selectModel 最后落值。 */
  const handleTreeSelect = (kind: ModelTestKind, mode: string, value: string) => {
    if (c.kind !== kind) {
      c.setKind(kind);
    }
    if (c.mode !== mode) {
      c.setMode(mode);
    }
    c.selectModel(value);
  };

  return (
    /* 普通静态栏（ISSUE #4997）：不吸顶、不设 max-h / 内部滚动、h-fit——
     * 高度随内容，底部空隙由页面既有内边距给。 */
    <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-64">
      <SectionCard hint="布局可切换" icon={<Boxes />} title="用途 / 模式 / 模型">
        {c.loading || tree.loading ? (
          /* 骨架屏（ISSUE #4749）：与模型列表条目同形的占位条。 */
          <div aria-label="加载中" className="flex flex-col gap-2" role="status">
            {[0, 1, 2].map((i) => (
              <Skeleton className="h-9 w-full rounded-lg" key={i} />
            ))}
          </div>
        ) : tree.entries.length === 0 ? (
          <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs leading-relaxed">
            {c.kind === "chat"
              ? "还没有可测的对话模型 —— 本地模型到「设置 → 本地模型」添加 Ollama 候选；远端模型到「设置 → 远程模型」添加用途为 文本 的条目。"
              : `还没有可测的模型 —— 本地模型到工作流库导入${
                  c.kind === "image" ? "生图" : "视频"
                }工作流（工坊封装就绪后出现在这里）；远端模型到「设置 → 远程模型」添加并启用用途为 ${
                  c.kind === "image" ? "图像" : "视频"
                } 的条目。`}
          </p>
        ) : (
          <ModelTestTree
            className="min-h-0 flex-1 text-sm"
            currentKind={c.kind}
            currentMode={c.mode}
            entries={tree.entries}
            generatingModels={c.generatingModels}
            loading={false}
            onSelect={handleTreeSelect}
            selectedValue={c.selectedModel}
          />
        )}
      </SectionCard>
    </aside>
  );
}

export function ModelTestView({
  onConsumeReprint,
  pendingReprint,
}: {
  /** 一次性载荷消费完的回调（#4841）：工作区持有 pending state，这里落定后清。 */
  onConsumeReprint?: () => void;
  /** 历史页「重试」折好的带参载荷（#4841）：工作区经页签栈送过来的一次性
   *  载荷 —— 视图挂载后应用一次即清空（沿用 pendingCanvasWorkflow 同款形状）。 */
  pendingReprint?: ModelTestRetryPayload | null;
}) {
  const c = useModelTest();
  /* 选中的本地工作流声明「尺寸取自首图」时，尺寸口不可配置（工坊链路本就不下发
   * 尺寸值），改为只读展示第一张参考图的实际像素。远端通道没有工作流声明，不受影响。 */
  const sizeFromReference =
    sizeSourceForMode(c.selectedWorkflow?.paramMap, c.mode) === "reference-image";
  /* 响应摘要的显示形态：默认格式化，可切回原始单行。 */
  const [excerptPretty, setExcerptPretty] = useState(true);
  /* 「大屏查看日志」弹窗目标：存打开那一刻的快照（与 HistoryList 同款），
   * 生成态变化不重挂弹窗、不重订 SSE（#4743）。 */
  const [logTarget, setLogTarget] = useState<QueueTaskLogTarget | null>(null);
  /* 输入方式（ISSUE #4769）：统一输入表单 ⇄ JSON 粘贴，两栏内容双向同步
   * （ISSUE #4922）：切到 JSON 把当前生效值（含默认档 / 工作流默认 / 重试
   * 预填）序列化成 { mode, inputs } 预填进文本框；切回统一输入把 JSON 里
   * 认得的键解析落回表单（解析失败留在 JSON 栏，错误落反馈位）。jsonText
   * 是纯展示态，留在视图层；解析与应用在 controller（applyJsonValues）。 */
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  /* 历史页「重试」的带参载荷应用一次即清（#4841）：payload 非 null 的那次
   * 提交里切模式页签 + 预填统一输入；StrictMode 双跑同载荷重复应用无副作用。 */
  useEffect(() => {
    if (pendingReprint === undefined || pendingReprint === null) {
      return;
    }
    c.applyReprintPrefill(pendingReprint);
    onConsumeReprint?.();
    // 载荷到达即消费一次；applyReprintPrefill / onConsumeReprint 身份稳定，
    // 不进依赖（进去了也会因会话 state 变化反复触发）。
    // oxlint-disable-next-line react/exhaustive-deps
  }, [pendingReprint]);
  const openLogScreen = () => {
    if (c.taskId === null || c.taskId === "") {
      return;
    }
    setLogTarget({
      id: c.taskId,
      /* 弹窗内的徽标会按 SSE 流自行翻面，这里只是打开那一刻的初值。 */
      status: c.generating ? "RUNNING" : c.error === null ? "SUCCEEDED" : "FAILED",
      workflowName: c.selectedWorkflow?.name ?? c.selectedModel,
    });
  };

  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  /* 适配器映射了的统一输入类型集合：契约行通道承接得住、但适配器没映射时，
   * 生成不会带上那个值 —— 行上明说，不静默丢（映射关系只在有适配器时存在）。 */
  const mappedTypes = new Set<WorkshopInputType>(
    (selectedAdapter?.inputs ?? []).map((row) => row.type),
  );
  const hasModel = c.selectedModel !== "";

  /* 页面树的条目装配（ISSUE #4916 / #4952）：跨三种用途取候选、按可测模式
     展开成条目；生成中徽标由 generatingModels 集合驱动（#4838 同一读数）。 */
  const treeCatalog = useModelTestTree();

  return (
    <DocumentFrame className="flex flex-col gap-5 px-4 pt-4 pb-10 sm:px-6 sm:pt-5" width="full">
      <PageHeader srTitle={pageHeaderTitle("model-test")} />

      {/* 历史页「重试」带来的预填提示（#4841）：亮出来源任务，说清下一步是
          「点生成才算重试」；用户改任意输入后预填层退场，这条也随之消失。 */}
      {c.reprintPrefill !== null && (
        <p
          className="bg-info/10 text-info-strong flex items-center gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed"
          role="status"
        >
          <History className="size-3.5 shrink-0" data-icon="inline-start" />
          <span>
            已从历史任务
            <code className="bg-canvas mx-1 rounded px-1 py-0.5 font-mono">
              {c.reprintPrefill.sourceTaskId.slice(0, 8)}
            </code>
            预填参数 —— 确认后点「生成」开始重试；改动任意输入即恢复普通测试。
          </span>
        </p>
      )}

      <div className="flex flex-row items-start gap-4">
        {/* ── 左栏：用途 / 模式 / 模型 一棵树（拆成子组件 —— §12.13；
            空态与「生成中」徽标的说明见 `LeftColumn`）── */}
        <LeftColumn c={c} tree={treeCatalog} />

        {/* ── 中栏 + 右栏包一层（ISSUE #4978）：左栏在窄窗口下也侧立吸附，
            不再参与堆叠；右栏窄窗口落到表单下方，xl 起仍三栏并排。 ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            {/* ── 中栏：统一输入 + 生成 CTA（未选模型时给三步引导）──
                max-h 与左栏同口径（ISSUE #4983/#4991）：xl 下三栏各自封顶在
                显示区域高度、超出在栏内滚动，页面本身不再出现滚动条。 */}
            <div className="flex min-w-0 flex-1 flex-col gap-4 xl:max-h-[calc(100dvh-96px)] xl:overflow-y-auto">
              {hasModel ? (
                <>
                  <SectionCard
                    className="flex-1"
                    hint="与工坊生成走同一份模式契约"
                    icon={<SlidersHorizontal />}
                    title={jsonMode ? "JSON 输入" : "统一输入"}
                  >
                    {/* 输入方式切换（ISSUE #4769）：表单逐项填 ⇄ 粘贴历史「复制去重投」
                    复制的整份 JSON 重跑。两栏双向同步（ISSUE #4922）：切 JSON
                    带出当前值，切回表单落回 JSON 里的值。 */}
                    <div aria-label="输入方式" className="flex flex-wrap gap-2" role="radiogroup">
                      <SelectChip
                        onClick={() => {
                          if (jsonMode && jsonText.trim() !== "") {
                            /* 切回统一输入前先落账：JSON 里认得的键写回表单；
                             * 解析失败留在 JSON 栏（错误已在反馈位），不丢输入。 */
                            const parsed = c.applyJsonValues(jsonText);
                            if (!parsed.ok) {
                              return;
                            }
                          }
                          setJsonMode(false);
                        }}
                        selected={!jsonMode}
                        shape="pill"
                      >
                        统一输入
                      </SelectChip>
                      <SelectChip
                        onClick={() => {
                          setJsonText(serializeModelTestJson(c.mode, c.values));
                          setJsonMode(true);
                        }}
                        selected={jsonMode}
                        shape="pill"
                      >
                        JSON 输入
                      </SelectChip>
                    </div>
                    {jsonMode ? (
                      <FormField
                        hint="已按当前统一输入预填（含默认档）；直接改或粘贴历史「复制去重投」的 JSON，点「生成」或切回统一输入时按这里的参数应用；认不得的键会忽略"
                        id="model-test-json"
                        label="提交参数 JSON"
                        labelClassName="mb-1.5"
                      >
                        {(a11y) => (
                          <Textarea
                            {...a11y}
                            className="border-border bg-surface-1 focus:border-primary w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm outline-none"
                            onChange={(e) => {
                              setJsonText(e.target.value);
                            }}
                            placeholder={
                              '{\n  "mode": "T2I",\n  "inputs": {\n    "prompt": "…",\n    "seed": "…"\n  }\n}'
                            }
                            rows={12}
                            spellCheck={false}
                            value={jsonText}
                          />
                        )}
                      </FormField>
                    ) : (
                      <div className="flex flex-col gap-4">
                        {c.inputRows.map((row, i) => {
                          if (row.control === "size") {
                            return (
                              <FormField
                                hint={
                                  row.disabled
                                    ? "API 通道暂未承接尺寸输入（工坊完整链路才有）"
                                    : "比例 / 像素（分辨率 · 百万像素）/ 倍数一次选完，与工作流库同款；已按最常用档预置默认值"
                                }
                                id={`model-test-size-${String(i)}`}
                                key={`${row.id}-${String(i)}`}
                                label={
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <TruncatedText className="truncate">
                                      {row.disabled ? `${row.label}（未承接）` : row.label}
                                    </TruncatedText>
                                    <RequiredBadge required={row.required} />
                                  </span>
                                }
                                labelClassName="mb-1.5"
                              >
                                {() => (
                                  <ModelTestSizeField
                                    disabled={row.disabled}
                                    mode={c.mode}
                                    onPatchValues={c.patchValues}
                                    referenceImageSrc={c.referenceImages[0]}
                                    sizeFromReference={sizeFromReference}
                                    values={c.values}
                                  />
                                )}
                              </FormField>
                            );
                          }
                          const control: ModelTestControl = row.control;
                          const id = `model-test-input-${row.id}`;
                          /* 通道承接得住、但适配器没映射 → 提示「生成不会带上」。 */
                          const unmapped =
                            !row.disabled &&
                            row.valueKey !== null &&
                            selectedAdapter !== null &&
                            !mappedTypes.has(row.valueKey);
                          const hint = row.disabled
                            ? "API 通道暂未承接这类输入（工坊完整链路才有）—— 填了也会被忽略"
                            : unmapped
                              ? "适配器没有映射这个输入 —— 本次生成不会带上它；要带上请到「模型适配」为它配字段映射"
                              : undefined;
                          if (row.id === "reference-image" && control === "image") {
                            return (
                              <ReferenceImageField
                                disabled={row.disabled}
                                hint={hint}
                                id={`${id}-${String(i)}`}
                                images={c.referenceImages}
                                key={`${row.id}-${String(i)}`}
                                label={row.label}
                                onAdd={(files) => {
                                  void c.addReferenceImages(files);
                                }}
                                onError={c.showNotice}
                                onRemove={c.removeReferenceImage}
                                required={row.required}
                              />
                            );
                          }
                          return (
                            <InputRow
                              control={control}
                              disabled={row.disabled}
                              hint={hint}
                              id={`${id}-${String(i)}`}
                              key={`${row.id}-${String(i)}`}
                              label={row.disabled ? `${row.label}（未承接）` : row.label}
                              onChange={(value) => {
                                if (row.valueKey !== null) {
                                  c.patchValue(row.valueKey, value);
                                }
                              }}
                              onError={c.showNotice}
                              onPickFile={(file) => {
                                if (row.valueKey === "first-frame" || row.valueKey === "image") {
                                  void c.setInputFromFile(row.valueKey, file);
                                }
                              }}
                              onRandom={
                                row.valueKey === "prompt"
                                  ? () => {
                                      c.randomizePrompt();
                                    }
                                  : undefined
                              }
                              required={row.required}
                              value={row.valueKey === null ? "" : (c.values[row.valueKey] ?? "")}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* 生成（生成中可取消；对话用途是「发送」）。JSON 输入模式先解析
                    粘贴的载荷并写回表单值，再带着这份值生成（ISSUE #4769）。 */}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        className="h-10 rounded-lg px-6"
                        disabled={c.generating}
                        onClick={() => {
                          if (jsonMode) {
                            const parsed = c.applyJsonValues(jsonText);
                            if (!parsed.ok) {
                              return;
                            }
                            /* 切回统一输入：填进去的参数看得见，错误也在同一反馈位。 */
                            setJsonMode(false);
                            void c.generate(undefined, parsed.values);
                            return;
                          }
                          void c.generate();
                        }}
                        variant="primary-solid"
                      >
                        <Play className="size-4" data-icon="inline-start" />
                        {c.generating
                          ? c.kind === "chat"
                            ? "发送中…"
                            : "生成中…"
                          : c.kind === "chat"
                            ? "发送"
                            : "生成"}
                      </Button>
                      {c.generating && (
                        <Button
                          className="h-10 rounded-lg px-4"
                          onClick={() => {
                            c.cancelGenerate();
                          }}
                          variant="outline"
                        >
                          {c.kind === "chat" ? "取消发送" : "取消生成"}
                        </Button>
                      )}
                      <span className="text-2xs text-muted-foreground">
                        {c.kind === "chat"
                          ? "真实调用被测模型 —— 本地模型走设置里配置的本地服务，远端模型按名直连。"
                          : c.selectedWorkflow === null
                            ? "真实调用，按上游计费 —— 与工坊生成走同一条通道。"
                            : "真实运行本地工作流 —— 与工坊生成走同一条本地通道（ComfyUI）。"}
                      </span>
                    </div>

                    {/* 本地工作流任务的实时进度：SSE state 帧，整百分比变化才更新。
                    明细行是 tqdm 那一行的可读版（步数 / 速度 / 已用 / 预估剩余）。 */}
                    <ModelTestProgressPanel
                      generating={c.generating}
                      progress={c.workflowProgress}
                      since={c.generatingSince}
                    />

                    {c.error !== null && (
                      <p className="bg-destructive/10 text-destructive flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span>{c.error}</span>
                      </p>
                    )}

                    {c.notice !== null && (
                      <p
                        className={cn(
                          "flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed",
                          c.notice.kind === "ok"
                            ? "bg-subtle text-muted-foreground"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{c.notice.text}</span>
                      </p>
                    )}
                  </SectionCard>

                  {/* 执行日志放中栏：紧贴生成动作（进度 → 日志），列宽也容得下
                  等宽字体行，不再挤在窄右栏里 */}
                  <LogsCard
                    logs={c.taskLogs}
                    onOpenScreen={c.taskId === null ? undefined : openLogScreen}
                  />
                </>
              ) : (
                <OnboardingPanel c={c} />
              )}
            </div>

            {/* ── 右栏：产物 / 请求与响应（选中模型后才出现）── */}
            {hasModel && (
              <ModelTestResultPanel
                c={c}
                excerptPretty={excerptPretty}
                onExcerptPretty={setExcerptPretty}
              />
            )}
          </div>
        </div>
      </div>

      {/* 大屏查看日志弹窗（与历史记录 / 队列页同一份；task 为 null 时不渲染）。 */}
      <QueueTaskLogModal
        onClose={() => {
          setLogTarget(null);
        }}
        task={logTarget}
      />
    </DocumentFrame>
  );
}
