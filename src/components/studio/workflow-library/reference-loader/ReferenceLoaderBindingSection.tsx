"use client";

// ── 参考图装载绑定区（#4376，规范 §17.2 第③层：只渲染 + 上抛）──────────────
// 工坊封装页签里，参考图槽位（reference-image(-n)）的装载配置：
//   · 装载预设：该槽位的图按哪条预设链装载（缺省 = 裸 LoadImage 直连）；
//   · 追加端口：除作者画的主落点线外，同一张图还要喂给哪些端口（扇出）。
// 写回 `paramMap` 的 `referenceLoaders` 命名空间（withReferenceLoaderBinding），
// 生成时由 `buildReferenceLoaderPlan` 变成执行期装载计划。

import { useMemo, useState } from "react";
import { Settings2, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { SelectMenu } from "~/components/ui/select-menu";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import type { WorkflowImageInputPort } from "~/lib/comfyui/workflow-detail-raw";
import {
  referenceLoaderBindingsForMode,
  referenceLoaderMax,
  REFERENCE_LOADER_CAP_LIMIT,
  withReferenceLoaderBinding,
  withReferenceLoaderMax,
  type ReferenceLoaderBinding,
} from "~/lib/workshop/reference-loader-binding";
import { referenceSlotOf } from "~/lib/workshop/workflow-encapsulation";
import { upperToken } from "~/lib/upper-token";

import { useReferenceLoaderPresets } from "../hooks/use-reference-loader-presets";
import { ReferenceLoaderPresetModal } from "./ReferenceLoaderPresetModal";

/** 上限候选：不设限（跟随模式契约）+ 1~16（与工坊喂图侧全局上限一致）。 */
const CAP_OPTIONS = [
  "",
  ...Array.from({ length: REFERENCE_LOADER_CAP_LIMIT }, (_, index) => String(index + 1)),
];
const CAP_LABELS: Record<string, string> = { "": "跟随模式契约" };
for (let value = 1; value <= REFERENCE_LOADER_CAP_LIMIT; value++) {
  CAP_LABELS[String(value)] = `${value} 张`;
}

type Props = {
  /** 该模式的契约口状态（只取参考图槽位）。 */
  entries: ReadonlyArray<{ id: string; label: string; targetIoKey: string | null }>;
  /** 全图 IMAGE / MASK 连线输入口（含未暴露的张量口，#4405）。
   *  只看已暴露的 workflowIO 时，MiniMax 这类多参考图工作流的消费口
   *  （`images.image_0..4`）不在候选里，追加端口下拉会是空的。 */
  graphImagePorts?: ReadonlyArray<WorkflowImageInputPort>;
  io: WorkflowIOMap | null;
  mode: string;
  /** 整份 paramMap 的写回口（详情层 PATCH workflow.update）。 */
  onPatchParamMap: (next: Record<string, unknown>) => void;
  paramMap: Record<string, unknown> | null;
};

export function ReferenceLoaderBindingSection({
  entries,
  graphImagePorts,
  io,
  mode,
  onPatchParamMap,
  paramMap,
}: Props) {
  const { presets, loading } = useReferenceLoaderPresets();
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const bindings = useMemo(() => referenceLoaderBindingsForMode(paramMap, mode), [paramMap, mode]);
  /* 预设下拉的标签表（含「直连」空档）；循环填，避免 fromEntries 的 any 推断。 */
  const presetLabels = useMemo(() => {
    const labels: Record<string, string> = { "": "直连（裸 LoadImage）" };
    for (const preset of presets) {
      labels[preset.id] = preset.name;
    }
    return labels;
  }, [presets]);
  /* 参考图上限（ISSUE #4537）：这条工作流实际最多使用几张参考图（工作流级）。
   * null = 未配置，跟随模式契约的槽位数。 */
  const cap = referenceLoaderMax(paramMap);
  /* 只渲染参考图槽位，且序号超过上限的槽位不出现（上限未配置 = 全部契约槽位）。 */
  const slots = useMemo(
    () =>
      entries.filter(
        (entry) =>
          referenceSlotOf(entry.id) >= 0 && (cap === null || referenceSlotOf(entry.id) < cap),
      ),
    [entries, cap],
  );
  /* 候选端口：工作流里图族的输入口（IMAGE / MASK）。两个来源按 ioKey 去重：
   * ① 已暴露的 workflowIO 图片口；② 全图图片族连线口（#4405，含未暴露的
   * 张量口 —— 多参考图工作流的消费口通常没被勾选暴露）。 */
  const candidates = useMemo(() => {
    const byKey = new Map<string, WorkflowImageInputPort>();
    for (const [ioKey, entry] of Object.entries(io ?? {})) {
      const type = upperToken(entry.type);
      if (entry.direction !== "input" || (type !== "IMAGE" && type !== "MASK")) {
        continue;
      }
      byKey.set(ioKey, {
        ioKey,
        label: `${entry.name}（${entry.nodeId}）`,
        name: entry.name,
        nodeId: entry.nodeId,
      });
    }
    for (const port of graphImagePorts ?? []) {
      if (!byKey.has(port.ioKey)) {
        byKey.set(port.ioKey, port);
      }
    }
    return [...byKey.values()];
  }, [io, graphImagePorts]);

  const write = (slotId: string, binding: ReferenceLoaderBinding | null) => {
    onPatchParamMap(withReferenceLoaderBinding({ paramMap, mode, slotId, binding }));
  };

  if (slots.length === 0) {
    return null;
  }

  return (
    <div className="border-border/60 bg-surface rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-ink text-xs font-medium">参考图装载</p>
          <p className="text-muted-foreground/70 text-3xs">
            每个参考图槽位按预设动态生成装载链（LoadImage → 处理节点 → 端口）；
            追加端口让同一张图喂到多处。不配预设 = 裸 LoadImage 直连。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 参考图上限（ISSUE #4537）：这条工作流实际最多使用几张参考图。
              空档 = 跟随模式契约；工坊喂图超出上限时只有前 N 张参与装载。 */}
          <span className="text-muted-foreground text-3xs shrink-0">参考图上限</span>
          <SelectMenu
            aria-label="参考图上限"
            autoFitFromOptions={false}
            className="text-3xs h-7"
            labels={CAP_LABELS}
            onChange={(next) => {
              onPatchParamMap(
                withReferenceLoaderMax({ paramMap, max: next === "" ? null : Number(next) }),
              );
            }}
            options={CAP_OPTIONS}
            placeholder="跟随模式契约"
            popoverMinWidth={170}
            value={cap === null ? "" : String(cap)}
          />
          <Button
            onClick={() => {
              setPresetModalOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            <Settings2 className="size-3.5" data-icon="inline-start" /> 管理预设
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const binding = bindings[slot.id] ?? {};
          const primary = slot.targetIoKey;
          const extras = binding.extraTargets ?? [];
          const selectable = candidates.filter(
            (candidate) => candidate.ioKey !== primary && !extras.includes(candidate.ioKey),
          );
          return (
            <div className="border-border/60 bg-panel rounded-lg border px-3 py-2" key={slot.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink text-xs font-medium">{slot.label}</span>
                <span className="text-muted-foreground/60 text-3xs font-mono">{slot.id}</span>
                <span className="text-muted-foreground/70 text-3xs">
                  主落点：{primary ?? "未连线"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-3xs shrink-0">装载预设</span>
                <SelectMenu
                  aria-label={`${slot.label} 装载预设`}
                  autoFitFromOptions={false}
                  className="text-3xs h-7"
                  labels={presetLabels}
                  onChange={(next) => {
                    write(slot.id, { ...binding, presetId: next === "" ? undefined : next });
                  }}
                  options={["", ...presets.map((preset) => preset.id)]}
                  popoverMinWidth={180}
                  value={binding.presetId ?? ""}
                />
                {extras.length > 0 && (
                  <span className="text-muted-foreground text-3xs shrink-0">追加端口</span>
                )}
                {extras.map((ioKey) => {
                  const label = candidates.find((c) => c.ioKey === ioKey)?.label ?? ioKey;
                  return (
                    <span
                      className="border-border bg-surface text-ink text-3xs flex items-center gap-1 rounded-md border px-2 py-0.5"
                      key={ioKey}
                    >
                      {label}
                      <Button
                        aria-label={`移除追加端口 ${label}`}
                        className="text-muted-foreground hover:text-destructive size-4 p-0"
                        onClick={() => {
                          write(slot.id, {
                            ...binding,
                            extraTargets: extras.filter((t) => t !== ioKey),
                          });
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <X className="size-3" data-icon="inline-start" />
                      </Button>
                    </span>
                  );
                })}
                {selectable.length > 0 && (
                  <SelectMenu
                    aria-label={`${slot.label} 追加端口`}
                    autoFitFromOptions={false}
                    className="text-3xs h-7"
                    labels={Object.fromEntries(
                      selectable.map((candidate) => [candidate.ioKey, candidate.label]),
                    )}
                    onChange={(next) => {
                      if (next === "") {
                        return;
                      }
                      write(slot.id, {
                        ...binding,
                        extraTargets: [...extras, next],
                      });
                    }}
                    options={selectable.map((candidate) => candidate.ioKey)}
                    placeholder="追加喂给端口…"
                    popoverMinWidth={200}
                    value=""
                  />
                )}
              </div>
            </div>
          );
        })}
        {loading && <p className="text-muted-foreground/70 text-3xs">预设清单加载中…</p>}
      </div>
      <ReferenceLoaderPresetModal
        onClose={() => {
          setPresetModalOpen(false);
        }}
        open={presetModalOpen}
      />
    </div>
  );
}
