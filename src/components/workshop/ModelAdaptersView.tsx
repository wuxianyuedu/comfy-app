"use client";

// ── 「模型适配」**视图**（规范 §17.2 第③层：只渲染 + 上抛）────────────────
// 它此前是弹窗（`WorkshopModelAdapterModal`，由侧栏那组「全局浮层入口」点开）。
// 改成视图的理由与设置 / 控制台同一批：它是项目无关的配置面，弹窗形态下没有页签、
// 不能一边配着一边看别处，而配置一张适配器往往要回头对照工作流库的模式定义。
// 「关」这件事因此交给页签自己的关闭按钮，视图内部不再自绘退路。
//
// 替代旧的「API 通道设置」：不再配一个全局端点，而是给每条远端模型配置
// 「工坊每种模式下的输入/输出适配器」——模式即工作流库定义的模式
// （文生图 T2I 的输入 = 提示词 + 宽高比 + 百万像素 + 倍数，输出 = 图片；图生图 =
// 图片 + 提示词…）。统一输入类型清单见 lib/workshop/model-mode-contract.ts，
// 每行把一种统一输入映射到该接口请求体里的字段名；产物按 outputField 提取。
// 契约层的「尺寸」是一个口，到适配器层才拆成这三行（与尺寸选择器的两类表达对齐）。
//
// 这里只管**模型适配**（接口级：每个远端模型 × 每个模式）；「模式契约」
// （模式级：每种模式对外有哪些统一输入 / 输出）是并列的独立视图，
// 见 `mode-contract/ModeContractView.tsx` —— 两个入口读写同一份注册表。
//
// ── 本次改版（ISSUE #1423）：字号收敛 + 选中态修好 ────────────────────────
//
// **字号**：改版前这一屏实测 **9 种字号 / 37 个文本叶节点**（10px×16、11px×8、
// 12px×5、14px×8），10px 那档还落在「选择远端模型」「支持的工坊模式」这种
// **区块标签**上 —— 用户的原话是「字体太多，有的字体太小看的费劲」。现在全屏只
// 用三档：`text-sm`(14px) 正文与控件、`text-xs`(12px) 副说明、`text-2xs`(11px)
// 只留给机器 id 上标（`--text-3xs` 10px 那一档是「角标 / 极小徽标」，不承载
// 可读文案，本屏零使用）。**层级改由字重、分隔线与留白承担**，不再靠字号堆。
//
// **选中态**：改版前模型 chip 的选中分支只写了 `border-primary text-primary
// bg-primary/10`，而 `Button variant="outline"` 自带 `hover:text-foreground`
// —— 鼠标划到**已选中**的那一枚上，字色翻白、底色翻灰（用户原话：
// 「按钮的选中状态悬浮和非悬浮一个紫色，一个白色」）。根因与修法见
// `ui/select-chip.tsx` 文件头；本屏现在直接用它。

import React from "react";

import {
  WORKSHOP_INPUT_TYPES,
  workshopInputLabel,
  type WorkshopInputType,
} from "~/lib/workshop/model-mode-contract";
import {
  ALL_WORKFLOW_TYPES,
  getWorkflowType,
} from "~/lib/workflow/workflow-types";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { cn } from "~/lib/utils";
import { useModelAdapters } from "./hooks/use-model-adapters";

const MODE_GROUPS: Array<{
  category: "image" | "video" | "audio";
  label: string;
}> = [
  { category: "image", label: "图像" },
  { category: "video", label: "视频" },
  { category: "audio", label: "音频" },
];

function modeLabel(mode: string): string {
  return getWorkflowType(mode)?.label ?? mode;
}

/** 键值对形式的字段标签：中文名 + 机器 id 上标。
 *
 * id 是 `text-2xs` 且 `font-mono` —— 它**不是给读的文案**，是给「代码 / 日志 /
 * 配置里对得上」的记号，所以允许比正文小一档。中文名本身必须落在
 * `text-xs`(12px) 及以上，此前这里整条是 10px。 */
function FieldLabelRow({ label, id }: { label: string; id?: string }) {
  return (
    <span className="text-ink/80 text-xs font-medium">
      {label}
      {id && (
        <span className="text-muted-foreground/60 text-2xs ml-1 font-mono">
          {id}
        </span>
      )}
    </span>
  );
}

/** 输入映射的一行：统一输入类型 → 请求体字段名。
 *
 * 三格 + 一枚删除按钮。此前它是一行里塞 SelectMenu / 箭头 / input / ✕ 四件，
 * 且全部 10–11px；现在每一格按自己的角色取档（下拉与输入框 12px，箭头弱化）。 */
function InputMappingRow({
  mode,
  row,
  index,
  onChange,
  onRemove,
}: {
  mode: string;
  row: { type: WorkshopInputType; field: string };
  index: number;
  onChange: (next: { type: WorkshopInputType; field: string }) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <SelectMenu
        value={row.type}
        onChange={(value) =>
          onChange({ type: value as WorkshopInputType, field: row.field })
        }
        options={WORKSHOP_INPUT_TYPES.map((t) => t.type)}
        labels={Object.fromEntries(
          WORKSHOP_INPUT_TYPES.map((t) => [
            t.type,
            `${workshopInputLabel(t.type)}（${t.type}）`,
          ]),
        )}
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行统一输入类型`}
        className="w-52 shrink-0 text-xs"
      />
      <span aria-hidden className="text-muted-foreground/50 shrink-0 text-xs">
        →
      </span>
      <input
        value={row.field}
        onChange={(event) =>
          onChange({ type: row.type, field: event.target.value })
        }
        placeholder="请求体字段名"
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行的请求体字段名`}
        className="border-border bg-bg focus:border-primary min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`删除第 ${index + 1} 行输入映射`}
        onClick={onRemove}
        className="text-muted-foreground/60 hover:text-danger-strong shrink-0 hover:bg-transparent"
      >
        ✕
      </Button>
    </div>
  );
}

export function ModelAdaptersView() {
  const controller = useModelAdapters();
  const {
    candidates,
    loading,
    draft,
    setDraft,
    selectModel,
    selectedModel,
    addMode,
    save,
    saving,
    message,
  } = controller;

  const [addModeOpen, setAddModeOpen] = React.useState(false);

  const updateAdapter = (
    mode: string,
    updater: (a: (typeof draft)[number]) => (typeof draft)[number],
  ) => {
    setDraft((prev) => prev.map((a) => (a.mode === mode ? updater(a) : a)));
  };

  const availableModes = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative);

  /* 视图型外壳：整屏滚动、居中宽栏，高度与滚动都由 `DocumentFrame` 给。
     页眉**不自绘关闭按钮** —— 「关」这件事在视图这一层由页签自己的关闭按钮承担，
     这里再画一枚就是两个入口做同一件事（弹窗时代才需要自绘，那时没有页签）。 */
  return (
    <DocumentFrame
      width="wide"
      className="flex flex-col gap-6 px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
    >
      {/* 页头走 `ui/page-header`（规范 03 §3.10 / 16 §16.2.4.73）。屏名已经由页签给出，
          按 ISSUE #1693 那一档收：不传可见 `title`（屏名退成 `sr-only`，读屏仍按标题
          跳转），那句字段映射口径挂成悬浮「说明」—— 由顶栏标题右侧那颗问号承载
          （`viewHelp()`），页眉因此不占那一行。屏名仍从注册表
          取（`pageHeaderTitle`），与侧栏 / 页签同一个出处。 */}
      <PageHeader srTitle={pageHeaderTitle("model-adapters")} />

      {/* 选择远端模型 */}
      <section>
        <SectionLabel hint="选中一个模型，下面为它逐模式配字段映射">
          远端模型
        </SectionLabel>
        {loading ? (
          <p className="text-muted-foreground text-sm">加载中…</p>
        ) : candidates.length === 0 ? (
          <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
            还没有远端模型 —— 到「设置 → 模型」添加 kind=图片 / 视频
            的远端条目后， 回来为它配置各模式的输入输出。
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="选择远端模型"
            className="flex flex-wrap gap-2"
          >
            {candidates.map((c) => (
              <SelectChip
                key={c.name}
                selected={selectedModel === c.name}
                onClick={() => selectModel(c.name)}
                shape="pill"
              >
                {c.name}
                <span
                  className={cn(
                    "text-2xs ml-1.5",
                    selectedModel === c.name
                      ? "text-primary/70"
                      : "text-muted-foreground/70",
                  )}
                >
                  {c.kind === "image" ? "生图" : "视频"}
                </span>
              </SelectChip>
            ))}
          </div>
        )}
      </section>

      {selectedModel && (
        <>
          {/* 支持的工坊模式 */}
          <section>
            <SectionLabel hint="每个模式一张卡片，下面配它的字段映射">
              支持的工坊模式
            </SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              {draft.map((a) => (
                <span
                  key={a.mode}
                  className="border-border text-ink/80 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
                >
                  {modeLabel(a.mode)}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`移除模式 ${modeLabel(a.mode)}`}
                    onClick={() =>
                      setDraft((prev) => prev.filter((x) => x.mode !== a.mode))
                    }
                    className="text-muted-foreground/60 hover:text-danger-strong hover:bg-transparent"
                  >
                    ✕
                  </Button>
                </span>
              ))}
              <SelectChip
                shape="dashed"
                selected={false}
                aria-expanded={addModeOpen}
                onClick={() => setAddModeOpen((v) => !v)}
                className="px-3 py-1 text-xs"
              >
                ＋ 添加模式
              </SelectChip>
            </div>
            {addModeOpen && (
              <div className="border-border bg-bg mt-3 flex flex-col gap-3 rounded-xl border p-3">
                {MODE_GROUPS.map((group) => {
                  const modes = availableModes.filter(
                    (t) => t.category === group.category,
                  );
                  if (modes.length === 0) return null;
                  return (
                    <div key={group.category}>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {modes.map((t) => (
                          <SelectChip
                            key={t.code}
                            shape="compact"
                            selected={false}
                            onClick={() => {
                              addMode(t.code);
                              setAddModeOpen(false);
                            }}
                            title={t.code}
                          >
                            {t.label}
                          </SelectChip>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 每个已配置模式的适配器编辑 */}
          {draft.map((a) => (
            <section
              key={a.mode}
              className="border-border bg-surface rounded-xl border p-4"
            >
              <div className="border-border mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                <h4 className="text-ink text-sm font-semibold">
                  {modeLabel(a.mode)}
                  <span className="text-muted-foreground/60 text-2xs ml-1.5 font-mono">
                    {a.mode}
                  </span>
                </h4>
                <span className="text-muted-foreground text-xs">
                  产物：
                  {getWorkflowType(a.mode)?.category === "video"
                    ? "视频（video）"
                    : "图片（image）"}
                </span>
              </div>

              <FormField
                label={
                  <FieldLabelRow label="端点路径" id="拼在模型 Base URL 后" />
                }
                id={`adapter-endpoint-${a.mode}`}
                labelClassName="mb-1.5"
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={a.endpointPath}
                    onChange={(event) =>
                      updateAdapter(a.mode, (x) => ({
                        ...x,
                        endpointPath: event.target.value,
                      }))
                    }
                    className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                  />
                )}
              </FormField>

              <div className="mt-4">
                <SectionLabel hint="每行把一种统一输入映射到该接口的请求字段">
                  输入映射
                </SectionLabel>
                <div className="flex flex-col gap-2">
                  {a.inputs.map((row, i) => (
                    <InputMappingRow
                      key={`${a.mode}-${row.type}-${i}`}
                      mode={a.mode}
                      row={row}
                      index={i}
                      onChange={(next) =>
                        updateAdapter(a.mode, (x) => ({
                          ...x,
                          inputs: x.inputs.map((r, j) => (j === i ? next : r)),
                        }))
                      }
                      onRemove={() =>
                        updateAdapter(a.mode, (x) => ({
                          ...x,
                          inputs: x.inputs.filter((_, j) => j !== i),
                        }))
                      }
                    />
                  ))}
                  <SelectChip
                    shape="dashed"
                    selected={false}
                    className="self-start px-2.5 py-1 text-xs"
                    onClick={() =>
                      updateAdapter(a.mode, (x) => {
                        const used = new Set(x.inputs.map((r) => r.type));
                        const next =
                          WORKSHOP_INPUT_TYPES.find((t) => !used.has(t.type)) ??
                          WORKSHOP_INPUT_TYPES[0];
                        return {
                          ...x,
                          inputs: [
                            ...x.inputs,
                            { type: next.type, field: next.type },
                          ],
                        };
                      })
                    }
                  >
                    ＋ 添加输入映射
                  </SelectChip>
                </div>
              </div>

              <FormField
                label={
                  <FieldLabelRow
                    label="产物字段路径"
                    id="响应 JSON 内，如 url / data.0.url"
                  />
                }
                id={`adapter-output-${a.mode}`}
                hint="留空走通用提取。"
                labelClassName="mt-4 mb-1.5"
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={a.outputField}
                    onChange={(event) =>
                      updateAdapter(a.mode, (x) => ({
                        ...x,
                        outputField: event.target.value,
                      }))
                    }
                    placeholder="url"
                    className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                  />
                )}
              </FormField>
            </section>
          ))}
        </>
      )}

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            message.kind === "ok"
              ? "bg-success/10 text-success-strong"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 保存这一行跟着上面那段映射表单一起出现（同一判据 `selectedModel`）：
          没选模型时上面什么都不渲染，这一颗就成了一条悬在空白里的禁用件 ——
          它此刻既点不动，也没有任何东西可保存。主 CTA 档（h-auto px-4 py-2），
          与全站其余实心按钮同形；此前它吃基元缺省 h-8 px-2.5，比这一屏上面
          每一行的控件都矮一档。 */}
      {selectedModel && (
        <div className="flex items-center justify-end">
          <Button
            variant="primary-solid"
            onClick={() => void save()}
            disabled={saving}
            className="h-auto px-4 py-2"
          >
            {saving ? "保存中…" : "保存适配器"}
          </Button>
        </div>
      )}
    </DocumentFrame>
  );
}
