"use client";

// ── 「模型适配」**视图**（规范 §17.2 第③层：只渲染 + 上抛）。项目无关的配置面（此前是弹窗）：给每条远端模型 × 每种工坊模式配输入/输出适配器
//（统一输入清单见 lib/workshop/model-mode-contract.ts，产物按 outputField 提取）。只管**模型适配**（接口级）；模式级的「模式契约」是并列独立视图
//（`mode-contract/ModeContractView.tsx`），两处读写同一份注册表。（ISSUE #1423 改版：选中态走 `ui/select-chip`，根因与修法见其文件头。）
// ISSUE #3622 改版：① 模型清单收成左侧树形页签（图像 / 视频分组、已配的模型标「已配」），
// 与模式契约的 `ModeContractModeNav` 同一形态；② 同一时刻只显示一个模式的编辑卡，
// 模式 chip 即切换页签；③ 删除模式走二次确认。
// ISSUE #3631：端点路径整格撤出本页 —— 它是模型级配置，与模式无关，且已在
// 「设置 → 远程模型」的接口端点下拉配置过（#3656）；本页只管字段映射与产物提取。

import React from "react";

import {
  WORKSHOP_INPUT_TYPES,
  isWorkshopInputType,
  workshopInputLabel,
} from "~/lib/workshop/remote-model-adapter";
import type { RemoteModeAdapter, WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { ALL_WORKFLOW_TYPES, getWorkflowType } from "~/lib/workflow/workflow-types";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Disclosure } from "~/components/ui/disclosure";
import { FormField } from "~/components/ui/form-field";
import { Hint } from "~/components/ui/hint";
import { WorkspaceFrame } from "~/components/studio/ViewContainer";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { TreeChildren } from "~/components/ui/tree-rows";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { cn } from "~/lib/utils";
import { useModelAdapters, type AdapterCandidate } from "./hooks/use-model-adapters";

const MODE_GROUPS: Array<{
  category: "image" | "video" | "audio";
  label: string;
}> = [
  { category: "image", label: "图像" },
  { category: "video", label: "视频" },
  { category: "audio", label: "音频" },
];

/** 左栏模型树的分组（候选只有 image / video 两类；chat 不参与工坊生图视频）。 */
const MODEL_KIND_GROUPS: Array<{ kind: "image" | "video"; label: string }> = [
  { kind: "image", label: "图像" },
  { kind: "video", label: "视频" },
];

function modeLabel(mode: string): string {
  return getWorkflowType(mode)?.label ?? mode;
}

/** 键值对形式的字段标签：中文名 + 机器 id 上标。
 *
 * id 是 `text-2xs` 且 `font-mono` —— 它**不是给读的文案**，是给「代码 / 日志 /
 * 配置里对得上」的记号，所以允许比正文小一档。中文名本身必须落在
 * `text-xs`(12px) 及以上，此前这里整条是 10px。 */
function FieldLabelRow({ label, id }: { id?: string; label: string }) {
  return (
    <span className="text-ink/80 text-xs font-medium">
      {label}
      {id !== undefined && id !== "" && (
        <span className="text-muted-foreground/60 text-2xs ml-1 font-mono">{id}</span>
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
  index: number;
  mode: string;
  onChange: (next: { field: string; type: WorkshopInputType }) => void;
  onRemove: () => void;
  row: { field: string; type: WorkshopInputType };
}) {
  return (
    <div className="flex items-center gap-2">
      <SelectMenu
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行统一输入类型`}
        className="w-52 shrink-0 text-xs"
        labels={Object.fromEntries(
          WORKSHOP_INPUT_TYPES.map((t) => [t.type, `${workshopInputLabel(t.type)}（${t.type}）`]),
        )}
        onChange={(value) => {
          if (isWorkshopInputType(value)) {
            onChange({
              type: value,
              field: row.field,
            });
          }
        }}
        options={WORKSHOP_INPUT_TYPES.map((t) => t.type)}
        value={row.type}
      />
      <span aria-hidden className="text-muted-foreground/50 shrink-0 text-xs">
        →
      </span>
      <input
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行的请求体字段名`}
        className="border-border bg-bg focus:border-primary min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
        onChange={(event) => {
          onChange({ type: row.type, field: event.target.value });
        }}
        placeholder="请求体字段名"
        value={row.field}
      />
      <Button
        aria-label={`删除第 ${index + 1} 行输入映射`}
        className="text-muted-foreground/60 hover:text-danger-strong shrink-0 hover:bg-transparent"
        onClick={onRemove}
        size="icon-sm"
        variant="ghost"
      >
        ✕
      </Button>
    </div>
  );
}

/** 固定值的一行（#3590）：请求体字段名 → 每次请求原样带上的值。
 *  有些接口要求请求体里带「不是用户输入」的字段（如 Agnes 视频必填的
 *  mode:"text" / size:"720P"）—— 统一输入表达不了这类常量，单列一栏。 */
function ConstantRow({
  mode,
  row,
  index,
  onChange,
  onRemove,
}: {
  index: number;
  mode: string;
  onChange: (next: { field: string; value: string }) => void;
  onRemove: () => void;
  row: { field: string; value: string };
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行固定值的请求体字段名`}
        className="border-border bg-bg focus:border-primary w-40 shrink-0 rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
        onChange={(event) => {
          onChange({ field: event.target.value, value: row.value });
        }}
        placeholder="请求体字段名"
        value={row.field}
      />
      <span aria-hidden className="text-muted-foreground/50 shrink-0 text-xs">
        =
      </span>
      <input
        aria-label={`${modeLabel(mode)} 第 ${index + 1} 行固定值的取值`}
        className="border-border bg-bg focus:border-primary min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
        onChange={(event) => {
          onChange({ field: row.field, value: event.target.value });
        }}
        placeholder="固定值，如 text / 720P"
        value={row.value}
      />
      <Button
        aria-label={`删除第 ${index + 1} 行固定值`}
        className="text-muted-foreground/60 hover:text-danger-strong shrink-0 hover:bg-transparent"
        onClick={onRemove}
        size="icon-sm"
        variant="ghost"
      >
        ✕
      </Button>
    </div>
  );
}

/** 左栏的模型导航：一棵竖向的树（与模式契约的 `ModeContractModeNav` 同一形态，
 *  #3622：候选多了平铺 chip 会乱，按图像 / 视频分组、可折叠、已配置的模型标
 *  「已配」）。父行 = 模型用途，子行 = 模型（`aria-checked` 标当前）。 */
function ModelNav({
  activeModel,
  adaptedCountOf,
  candidates,
  onSelect,
}: {
  /** 当前选中的模型名（null / 空串 = 未选）。 */
  activeModel: string;
  /** 该模型已配置的模式数（>0 标「已配」）。 */
  adaptedCountOf: (name: string) => number;
  candidates: Array<AdapterCandidate>;
  onSelect: (name: string) => void;
}) {
  /* 类别 → 是否展开。**初始全部展开**（把每个类别先表一次态），收起是「先看
     别的类别」的临时动作，默认折着等于把当前模型藏起来。 */
  const groups = MODEL_KIND_GROUPS.map((group) => ({
    ...group,
    models: candidates.filter((c) => c.kind === group.kind),
  })).filter((group) => group.models.length > 0);
  const categoryExpansion = useExpansionSet(Object.fromEntries(groups.map((g) => [g.kind, true])));

  return (
    /* 一排模型里只有一个能选中 —— 单选语义（`role="radiogroup"` / `radio`），
       与模式契约的模式清单同一条契约。 */
    <div aria-label="选择要配置的模型" className="flex flex-col gap-3" role="radiogroup">
      {groups.map((group) => {
        const open = categoryExpansion.isExpanded(group.kind);
        return (
          <Disclosure
            className="hover:text-ink gap-1 px-2 text-xs font-medium"
            key={group.kind}
            marker="caret"
            onOpenChange={() => {
              categoryExpansion.toggle(group.kind);
            }}
            open={open}
            trigger={
              <span className="text-ink-fainter min-w-0 flex-1 truncate" data-kind={group.kind}>
                {group.label}
              </span>
            }
          >
            <TreeChildren className="flex flex-col gap-0.5" depth={1}>
              {group.models.map((c) => {
                const active = activeModel === c.name;
                const adapted = adaptedCountOf(c.name) > 0;
                return (
                  /* 全名悬停提示走 `ui/hint`（P82：原生 title= 不走）——行名
                     truncate 后看不全，Hover 看全名是这一行的显性需求。 */
                  <Hint key={c.name} label={c.name}>
                    <Button
                      aria-checked={active}
                      className={cn(
                        "h-auto w-full justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
                        active
                          ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                          : "text-ink-muted hover:text-ink",
                      )}
                      /* `data-model` 是给用例锚「这一行是哪条模型」的记号（按可访问名
                         找会随文案变，name 才是身份）。 */
                      data-model={c.name}
                      onClick={() => {
                        onSelect(c.name);
                      }}
                      role="radio"
                      variant="ghost"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                      {adapted && (
                        <span
                          className={cn(
                            "text-2xs shrink-0",
                            active ? "text-primary/70" : "text-ink-fainter",
                          )}
                        >
                          已配
                        </span>
                      )}
                    </Button>
                  </Hint>
                );
              })}
            </TreeChildren>
          </Disclosure>
        );
      })}
    </div>
  );
}

/** 「＋ 添加模式」展开的分类面板（图像 / 视频 / 音频各一组）。 */
function AddModePopover({
  availableModes,
  onPick,
}: {
  availableModes: Array<(typeof ALL_WORKFLOW_TYPES)[number]>;
  onPick: (code: string) => void;
}) {
  return (
    <div className="border-border bg-bg mt-3 flex flex-col gap-3 rounded-xl border p-3">
      {MODE_GROUPS.map((group) => {
        const modes = availableModes.filter((t) => t.category === group.category);
        if (modes.length === 0) {
          return null;
        }
        return (
          <div key={group.category}>
            <p className="text-muted-foreground mb-1.5 text-xs font-medium">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {modes.map((t) => (
                <SelectChip
                  key={t.code}
                  onClick={() => {
                    onPick(t.code);
                  }}
                  selected={false}
                  shape="compact"
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
  );
}

/** 当前选中模式的适配编辑卡：输入映射 + 固定值 + 产物字段路径。
 *  端点路径不在这页（#3631）—— 模型级端点在「设置 → 远程模型」的接口端点下拉。 */
function AdapterCard({
  adapter,
  onChange,
}: {
  adapter: RemoteModeAdapter;
  onChange: (updater: (a: RemoteModeAdapter) => RemoteModeAdapter) => void;
}) {
  const update = onChange;
  return (
    <section className="border-border bg-surface mt-4 rounded-xl border p-4">
      <div className="border-border mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <h4 className="text-ink text-sm font-semibold">
          {modeLabel(adapter.mode)}
          <span className="text-muted-foreground/60 text-2xs ml-1.5 font-mono">{adapter.mode}</span>
        </h4>
        <span className="text-muted-foreground text-xs">
          产物：
          {getWorkflowType(adapter.mode)?.category === "video" ? "视频（video）" : "图片（image）"}
        </span>
      </div>

      <div className="mt-1">
        <SectionLabel hint="每行把一种统一输入映射到该接口的请求字段">输入映射</SectionLabel>
        <div className="flex flex-col gap-2">
          {adapter.inputs.map((row, i) => (
            <InputMappingRow
              index={i}
              key={`${adapter.mode}-${row.type}-${i}`}
              mode={adapter.mode}
              onChange={(next) => {
                update((x) => ({ ...x, inputs: x.inputs.map((r, j) => (j === i ? next : r)) }));
              }}
              onRemove={() => {
                update((x) => ({ ...x, inputs: x.inputs.filter((_, j) => j !== i) }));
              }}
              row={row}
            />
          ))}
          <SelectChip
            className="self-start px-2.5 py-1 text-xs"
            onClick={() => {
              update((x) => {
                const used = new Set(x.inputs.map((r) => r.type));
                const next =
                  WORKSHOP_INPUT_TYPES.find((t) => !used.has(t.type)) ?? WORKSHOP_INPUT_TYPES[0];
                return { ...x, inputs: [...x.inputs, { type: next.type, field: next.type }] };
              });
            }}
            selected={false}
            shape="dashed"
          >
            ＋ 添加输入映射
          </SelectChip>
        </div>
      </div>

      {/* 固定值字段（#3590）：不是用户输入、每次请求都带上的键值。 */}
      <div className="mt-4">
        <SectionLabel hint="每次请求都原样带上的请求体键值（接口必填的固定参数写这里）">
          固定值
        </SectionLabel>
        <div className="flex flex-col gap-2">
          {(adapter.constants ?? []).map((row, i) => (
            <ConstantRow
              index={i}
              key={`${adapter.mode}-const-${row.field}-${i}`}
              mode={adapter.mode}
              onChange={(next) => {
                update((x) => ({
                  ...x,
                  constants: (x.constants ?? []).map((r, j) => (j === i ? next : r)),
                }));
              }}
              onRemove={() => {
                update((x) => ({
                  ...x,
                  constants: (x.constants ?? []).filter((_, j) => j !== i),
                }));
              }}
              row={row}
            />
          ))}
          <SelectChip
            className="self-start px-2.5 py-1 text-xs"
            onClick={() => {
              update((x) => ({
                ...x,
                constants: [...(x.constants ?? []), { field: "", value: "" }],
              }));
            }}
            selected={false}
            shape="dashed"
          >
            ＋ 添加固定值
          </SelectChip>
        </div>
      </div>

      <FormField
        /* 「通用提取」说清楚找哪些字段（#3622）：留空不该是一句黑话。 */
        hint="留空走通用提取：按 url / image_url / video_url / download_url 等常见字段名在响应里自动搜索（b64_json 等载荷转成 data URL）；视频响应还会认 id / task_id / video_id 等任务键，命中后进轮询。"
        id={`adapter-output-${adapter.mode}`}
        label={<FieldLabelRow id="响应 JSON 内，如 url / data.0.url" label="产物字段路径" />}
        labelClassName="mt-4 mb-1.5"
      >
        {(a11y) => (
          <input
            {...a11y}
            className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
            onChange={(event) => {
              update((x) => ({ ...x, outputField: event.target.value }));
            }}
            placeholder="url"
            value={adapter.outputField}
          />
        )}
      </FormField>
    </section>
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
    summary,
  } = controller;

  const [addModeOpen, setAddModeOpen] = React.useState(false);
  /* 删除模式的二次确认（#3622）：chip 上的 ✕ 只记下「待删谁」，真删在确认弹窗里。 */
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null);
  /* 当前展示哪张适配卡（#3622：所有模式不再一条条堆叠，同一时刻只显示一个）。 */
  const [activeMode, setActiveMode] = React.useState<string | null>(null);

  const adaptedCount = React.useMemo(
    () => new Map(summary.map((s) => [s.name, s.modes.length])),
    [summary],
  );

  const availableModes = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative);

  /* 未点选 chip 时回落第一份草稿（新选模型 / 删掉激活模式后都有得看）。 */
  const current = draft.find((a) => a.mode === activeMode) ?? draft[0] ?? null;

  const updateAdapter = (
    mode: string,
    updater: (a: (typeof draft)[number]) => (typeof draft)[number],
  ) => {
    setDraft((prev) => prev.map((a) => (a.mode === mode ? updater(a) : a)));
  };

  return (
    <WorkspaceFrame className="bg-canvas text-ink">
      <div className="flex h-full min-h-0 flex-col">
        {/* 页头走 `ui/page-header`（规范 03 §3.10 / 16 §16.2.4.73）。屏名已经由页签给出，
            按 ISSUE #1693 那一档收：不传可见 `title`（屏名退成 `sr-only`，读屏仍按标题
            跳转），那句字段映射口径挂成悬浮「说明」—— 由顶栏标题右侧那颗问号承载
            （`viewHelp()`），页眉因此不占那一行。**不自绘关闭按钮**：「关」由页签承担。
            存放位置徽标（#3625）随页眉的 `extra` 进顶栏说明那侧。 */}
        <div className="px-4 sm:px-8">
          <PageHeader
            className="pt-4 pb-3 sm:pt-5"
            extra={<DataLocationBadge id="model-adapter" />}
            srTitle={pageHeaderTitle("model-adapters")}
          />
        </div>

        {/* 两栏分屏（与模式契约同一外壳，ISSUE #1870 同款）：左 = 模型树，右 = 当前模型
            的适配编辑区，两栏各自滚动。`min-h-0` 让两栏都能在自己的滚动条里收缩。 */}
        <div className="flex min-h-0 flex-1 gap-6 px-4 pb-5 sm:px-8">
          {/* 左栏：模型树（自己的滚动条，不推正文）。 */}
          <nav
            aria-label="选择要配置的模型"
            className="custom-scrollbar w-48 shrink-0 overflow-y-auto pb-2"
          >
            <SectionLabel>选择要配置的模型</SectionLabel>
            {loading ? (
              <p className="text-muted-foreground pt-2 text-sm">加载中…</p>
            ) : candidates.length === 0 ? (
              <p className="bg-warning/10 text-warning-strong mt-2 rounded-lg px-3 py-2 text-xs">
                还没有远端模型 —— 到「设置 → 模型」添加用途为 图像 / 视频 的远端条目后，
                回来为它配置各模式的输入输出。
              </p>
            ) : (
              <ModelNav
                activeModel={selectedModel}
                adaptedCountOf={(name) => adaptedCount.get(name) ?? 0}
                candidates={candidates}
                onSelect={selectModel}
              />
            )}
          </nav>

          {/* 右栏：当前模型的适配编辑区（自己的滚动条）。 */}
          <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">
            {selectedModel === "" ? (
              <p className="text-muted-foreground pt-2 text-sm">
                从左侧选一条模型，为它的各模式配字段映射。
              </p>
            ) : (
              <>
                {/* 端点路径不在这页（#3631）：它是模型级配置，与模式无关，且已在
                    「设置 → 远程模型」的接口端点下拉配置过 —— 这里只管字段映射。 */}

                {/* 支持的工坊模式：chip 即页签（点一枚切到它的编辑卡）。 */}
                <section>
                  <SectionLabel hint="同一时刻只显示一个模式的编辑卡，点 chip 切换">
                    支持的工坊模式
                  </SectionLabel>
                  <div
                    aria-label="选择要编辑的模式"
                    className="flex flex-wrap items-center gap-1.5"
                    role="radiogroup"
                  >
                    {draft.map((a) => (
                      <span className="inline-flex items-center" key={a.mode}>
                        <SelectChip
                          className="pr-1.5"
                          onClick={() => {
                            setActiveMode(a.mode);
                          }}
                          selected={current?.mode === a.mode}
                          shape="pill"
                          title={a.mode}
                        >
                          {modeLabel(a.mode)}
                        </SelectChip>
                        <Button
                          aria-label={`删除模式 ${modeLabel(a.mode)}`}
                          className="text-muted-foreground/60 hover:text-danger-strong -ml-0.5 hover:bg-transparent"
                          onClick={() => {
                            setPendingRemove(a.mode);
                          }}
                          size="icon-xs"
                          variant="ghost"
                        >
                          ✕
                        </Button>
                      </span>
                    ))}
                    <SelectChip
                      aria-expanded={addModeOpen}
                      className="px-3 py-1 text-xs"
                      onClick={() => {
                        setAddModeOpen((v) => !v);
                      }}
                      selected={false}
                      shape="dashed"
                    >
                      ＋ 添加模式
                    </SelectChip>
                  </div>
                  {addModeOpen && (
                    <AddModePopover
                      availableModes={availableModes}
                      onPick={(code) => {
                        addMode(code);
                        setActiveMode(code);
                        setAddModeOpen(false);
                      }}
                    />
                  )}
                </section>

                {/* 当前模式的适配编辑卡：同一时刻只渲染一份（#3622）。 */}
                {current === null ? (
                  <p className="text-muted-foreground mt-4 text-sm">
                    还没有配置任何模式 —— 点「＋ 添加模式」为它配第一个模式的字段映射。
                  </p>
                ) : (
                  <AdapterCard
                    adapter={current}
                    onChange={(updater) => {
                      updateAdapter(current.mode, updater);
                    }}
                  />
                )}

                {message && (
                  <p
                    className={`mt-4 rounded-lg px-3 py-2 text-xs ${
                      message.kind === "ok"
                        ? "bg-success/10 text-success-strong"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {message.text}
                  </p>
                )}

                {/* 保存这一行跟着上面那段映射表单一起出现（同一判据 `selectedModel`）：
                    没选模型时右栏只有引导语，这一颗就成了一条悬在空白里的禁用件。
                    主 CTA 档（h-auto px-4 py-2），与全站其余实心按钮同形。 */}
                <div className="mt-4 flex items-center justify-end">
                  <Button
                    className="h-auto px-4 py-2"
                    disabled={saving}
                    onClick={() => {
                      void save();
                    }}
                    variant="primary-solid"
                  >
                    {saving ? "保存中…" : "保存适配器"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 删除模式的二次确认（#3622）：确认才从草稿里摘掉（保存后落库）。
          删的是「还没保存」的配置也不会静默 —— 弹窗里写明动作对象。 */}
      <ConfirmDialog
        danger
        description={`将移除「${pendingRemove === null ? "" : modeLabel(pendingRemove)}」模式的字段映射配置，点「保存适配器」后生效。`}
        onClose={() => {
          setPendingRemove(null);
        }}
        onConfirm={() => {
          if (pendingRemove !== null) {
            const removed = pendingRemove;
            setDraft((prev) => prev.filter((x) => x.mode !== removed));
            setActiveMode(null);
          }
          setPendingRemove(null);
        }}
        open={pendingRemove !== null}
        title="删除这个模式？"
      />
    </WorkspaceFrame>
  );
}
