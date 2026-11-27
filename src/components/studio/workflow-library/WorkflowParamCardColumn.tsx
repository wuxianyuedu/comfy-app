"use client";

/* 工作流库「画布节点」预览左侧的对外参数卡片列：每个对外参数一张卡片（视觉本体
 * 复用 workflow-editor/WorkflowParamCard）。一个口一颗圆点，尺寸卡每个形态一行
 * 一颗点。卡片可连线（ISSUE #355）：拖圆点到宿主某一行即改落点，卡片头 ↺ 撤销。
 * 端点由消费方注入 `<Handle>`（ISSUE #529），「能不能连」由画布判，卡片列不碰
 * React Flow。卡片说「由哪些端口组成」，表单行说「填什么值」，不重复表达。 */

import {
  paramOutputPorts,
  sizeGroupIds,
  sizeSubLabel,
  sizeSubTypeDisplay,
  SIZE_SUB_IDS,
  type ParamEntry,
  type ParamOutputPort,
} from "~/lib/workflow/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { exposedParamDisplayLabel } from "~/lib/workflow/workflow-exposed-params";
import { useMemo, type ReactNode } from "react";
import { Switch } from "~/components/ui/switch";
import { FieldLabel } from "~/components/ui/field";

import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { paramClassStyle } from "./workflow-param-mapping-ui";

/** 卡片宽度：与项目画布节点同宽，两列并排时仍放得下。 */
const CARD_WIDTH = 220;

export type WorkflowParamCardColumnProps = {
  /** 是否允许连线：库里也允许（拖圆点改落点）—— 没有模式时不给（写入无归属）。 */
  canWire?: boolean;
  /** 契约口清单（`modeContractEntries` / `exposedParamsForMode` 的产物）。
   *  卡片头必须与「工坊封装」页签说同一句话（ISSUE #596）；这里按 id 覆盖
   *  `entry.label`：契约口清单是产品对用户承诺的那几个口，名字只该有一套。
   *  形状只要求 id + label。
   */
  contractEntries?: ReadonlyArray<{ id: string; label: string }>;
  /** 端点槽位：消费方注入 `<Handle>` 或只读圆点。 */
  endpoint?: (port: ParamOutputPort, index: number) => ReactNode;
  entries: ReadonlyArray<ParamEntry>;
  io: WorkflowIOMap | null;
  /** 该对外参数在当前模式下是否被作者改过（决定「恢复默认」可用性）。 */
  isManual?: (entryId: string) => boolean;
  onReset?: (entryId: string) => void;
  onSelect?: (entryId: string | null) => void;
  /** 切换尺寸来源（写入 `paramMap.sizeSource.mode:<模式>`）。只读消费方不传。 */
  onSizeFromReferenceChange?: (enabled: boolean) => void;
  /** 当前模式下「条目 → 目标 ioKey」的生效落点。 */
  resolved: Record<string, string | null>;
  /** 作者手里正选中的条目（线被点选 / 卡片被点）。 */
  selectedEntryId?: string | null;
  /** 该模式是否声明「尺寸取自第一张参考图」。开启时尺寸卡不接受连线，
   *  展示来源说明而不是「未配置」。 */
  sizeFromReference?: boolean;
};

export function WorkflowParamCardColumn({
  entries,
  contractEntries,
  resolved,
  io,
  canWire = false,
  selectedEntryId = null,
  onSelect,
  isManual,
  onReset,
  endpoint,
  sizeFromReference = false,
  onSizeFromReferenceChange,
}: WorkflowParamCardColumnProps) {
  /* 尺寸卡只画一次：六子口聚成一张卡（每行一形态），原实现把
   * `entries.filter(...)` 放进 `entries.map()` 的循环里，每个尺寸子口都全量重扫
   * 一遍（#5224 A2，典型 O(n²)）。这里在循环外算一次。 */
  const sizeForms = useMemo(
    () => entries.filter((item) => SIZE_SUB_IDS.includes(item.cls)),
    [entries],
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="对外参数"
      className="flex shrink-0 flex-col gap-2 self-start"
      data-testid="workflow-param-card-column"
      style={{ width: CARD_WIDTH }}
    >
      <p className="text-ink-faint text-2xs px-0.5 font-medium">
        {canWire ? "对外参数 · 拖圆点改落点" : "对外参数"}
      </p>
      {entries.map((entry) => {
        /* 尺寸在映射层是六个子口（形态由作者声明），但**卡片只有一张**：六行形态、
         * 每行一颗圆点，不再并排六张卡（用户口径：「尺寸这里不要显示这么多节点，
         * 尺寸只显示一个节点」）。只在第一个子口的位置画这一张，其余跳过。 */
        if (SIZE_SUB_IDS.includes(entry.cls)) {
          const forms = sizeForms;
          if (entry !== forms[0]) {
            return null;
          }
          const first = forms[0];
          const sizeLabel =
            contractEntries?.find((item) => item.id === "size")?.label ?? sizeSubLabel("size");
          return (
            <div className="flex flex-col gap-1" key="size">
              <WorkflowParamCard
                canReset={
                  canWire &&
                  !sizeFromReference &&
                  SIZE_SUB_IDS.some((id) => isManual?.(id) === true)
                }
                canWire={canWire && !sizeFromReference}
                classLabel={paramClassStyle("size").label}
                cls="size"
                endpoint={sizeFromReference ? undefined : endpoint}
                entryId="size"
                footNote={
                  sizeFromReference ? "尺寸由第一张参考图决定，无需连线、不下发尺寸值" : undefined
                }
                hostNodeId={first.hostNodeId || first.nodeId}
                idLabel="size"
                label={sizeLabel}
                /* 一行 = 一个子口：卡片头的 ↺ 把六条线一起撤掉（只撤其中一条会
                 *  让卡片看着「还有线」）。上抛的是聚合 id `size`，由消费方一次
                 *  展开成六个子口交给 `resetMany` —— 逐个上抛会每次落库，后一次
                 *  把前一次的删除覆盖回去（用户口径：「重置也清不掉」）。 */
                onReset={canWire && !sizeFromReference ? () => onReset?.("size") : undefined}
                onSelect={
                  onSelect
                    ? () => {
                        onSelect("size");
                      }
                    : undefined
                }
                /* 行 = 形态（「尺寸 · 宽高比」），不是候选端口：形态由作者从哪一行
                 * 拖出去声明，handle id 就是子口 id（连线层按它反查条目）。 */
                outputPorts={forms.map((item) => {
                  const target = resolved[item.id] ?? null;
                  /* 类型**恒为这个形态自己的类型**，不随落点变（用户口径：「尺寸上是
                   *  什么类型就显示什么类型，不要跟连接的参数类型变换」）。
                   *  宽度 / 高度 / 像素量 = FLOAT，分辨率档 / 倍数 = INT，宽高比 =
                   *  COMBO（见 `sizeSubTypeDisplay`）。 */
                  return {
                    name: item.id,
                    display: sizeSubLabel(item.cls),
                    type: sizeSubTypeDisplay(item.cls),
                    connected: target !== null && target !== "",
                    ioKey: target ?? "",
                    handleId: item.id,
                    active: target !== null && target !== "",
                  };
                })}
                readOnly={!canWire}
                /* 选中的可能是这张卡（`size`）或它的某一条线（子口 id）：两种都点亮。 */
                selected={sizeGroupIds(selectedEntryId).some((id) => SIZE_SUB_IDS.includes(id))}
                width={CARD_WIDTH}
              />
              {onSizeFromReferenceChange ? (
                <FieldLabel className="text-ink-faint hover:text-ink text-2xs flex cursor-pointer items-center gap-1.5 px-0.5">
                  <Switch
                    checked={sizeFromReference}
                    onCheckedChange={onSizeFromReferenceChange}
                    size="sm"
                  />
                  使用首张参考图尺寸
                </FieldLabel>
              ) : null}
            </div>
          );
        }

        /* 参考图是**数组形态的同一个对外参数**：契约里 reference-image / -2 / -3
         * 各是一张图的槽位，但卡片只有一张 —— 每个槽位在卡里占一行、带自己的
         * 圆点（与「尺寸」六形态共一张卡同构）。连上第一条线后由消费方追加下一
         * 个槽位，这张卡就地长出第二个端点，不必去模式契约页手动加口。 */
        if (entry.cls === "reference-image") {
          const slots = entries.filter((item) => item.cls === "reference-image");
          if (entry !== slots[0]) {
            return null;
          }
          const cardLabel =
            contractEntries?.find((item) => item.id === "reference-image")?.label ??
            exposedParamDisplayLabel("reference-image");
          return (
            <WorkflowParamCard
              canReset={canWire && slots.some((item) => isManual?.(item.id) === true)}
              canWire={canWire}
              classLabel={paramClassStyle("reference-image").label}
              cls="reference-image"
              endpoint={endpoint}
              entryId="reference-image"
              hostNodeId={slots[0]?.hostNodeId || slots[0]?.nodeId || ""}
              idLabel="reference-image"
              key="reference-image"
              label={cardLabel}
              onReset={canWire ? () => onReset?.("reference-image") : undefined}
              onSelect={
                onSelect
                  ? () => {
                      onSelect("reference-image");
                    }
                  : undefined
              }
              /* 一行 = 一个参考图槽位；端口形状仍由 paramOutputPorts 产出，
               * handleId 就是槽位 id，连线的闸门与落库都按它认。 */
              outputPorts={slots.flatMap((item) =>
                paramOutputPorts(item, io, resolved[item.id], item.label),
              )}
              readOnly={!canWire}
              /* 选中这张卡或它下面任意一条线，都点亮整张卡。 */
              selected={slots.some((item) => selectedEntryId === item.id)}
              width={CARD_WIDTH}
            />
          );
        }
        const style = paramClassStyle(entry.cls);
        /* 这张卡片的名字只有一份：卡片头的标题与端口行都读它（见下方
         * `outputPorts` 的 `displayName`）—— 两处各取一份会让同一张卡片说
         * 两个名字（标题「提示词」、行上却写着工作流里的端口名）。 */
        const cardLabel =
          contractEntries?.find((item) => item.id === entry.id)?.label ?? entry.label;
        return (
          <WorkflowParamCard
            canReset={canWire && isManual?.(entry.id) === true}
            /* `canWire` 与 `readOnly` 分开表达：库里现在**可连线**（拖圆点改落点），
             * 但卡片本身仍是消费方托管的视觉本体 —— 不写「先选模式才能连线」那类
             * 编辑提示（节点上模式早就选好了，ISSUE #355）。 */
            canWire={canWire}
            classLabel={style.label}
            cls={entry.cls}
            /* 右侧小圆点端点：**每个候选一颗圆点**（与编辑器画布同口径）。
             *
             * 端点由消费方注入 —— 库里那层给的是 React Flow 的 `<Handle>`
             * （ISSUE #529），它自带拖线的起手手势与命中半径；卡片列只把槽位
             * 让出来，不碰 React Flow。 */
            endpoint={endpoint}
            entryId={entry.id}
            hostNodeId={entry.hostNodeId || entry.nodeId}
            /* 与「工坊封装」页签同口径：名字后面标出契约口 id（`prompt` /
               `size` / `reference-image-2`…），配置与日志里认的是 id。 */
            idLabel={entry.id}
            key={entry.id}
            label={cardLabel}
            onReset={canWire ? () => onReset?.(entry.id) : undefined}
            onSelect={
              onSelect
                ? () => {
                    onSelect(entry.id);
                  }
                : undefined
            }
            /* **一个口一颗点**：卡片只说「这个口对外是什么」（名字 + 类型），
             *  落点由线的另一端声明（拖到宿主哪一行就是哪一行）。 */
            outputPorts={paramOutputPorts(entry, io, resolved[entry.id], cardLabel)}
            readOnly={!canWire}
            /* 选中的卡片（含被点选的线那一端）提亮：一条线上有三处（卡片、
             * 圆点、宿主行），选中状态必须同时在两端看得出来。 */
            selected={selectedEntryId === entry.id}
            width={CARD_WIDTH}
          />
        );
      })}
    </aside>
  );
}
