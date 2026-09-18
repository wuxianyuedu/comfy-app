"use client";

/* 工作流库「画布节点」预览左侧的**对外参数卡片列**。
 *
 * 每个对外参数一张卡片（视觉本体复用 workflow-editor/WorkflowParamCard）：
 *   · 卡片头是参数名（作者在编辑器里勾选/改名后的那个名字）；
 *   · 卡片体一行：**这个口自己的名字 + 类型**（未连线用口自己的类型，连上后是
 *     落点那一行的类型；落到哪一行在行的 `title` 里可查）；
 *   · 卡片右侧**一颗**带类型的小圆点端点 —— **一个口一颗点**（落点由线的另一端
 *     声明：拖到宿主哪一行就是哪一行）。尺寸是唯一的多行卡片：一行 = 一个形态，
 *     每行一颗点，handle 取子口 id。
 *   · 卡片**可连线**（ISSUE #355：「连线要能编辑，现在编辑不了」）：从圆点按下
 *     并拖到宿主卡片上的某一行即改落点，卡片头的 ↺ 撤销该口的手工线。
 *
 * 端点由消费方注入（`endpoint`）：库里那层注入的是 React Flow 的 `<Handle>`
 * （ISSUE #529）——「能不能连」由画布的 `isValidConnection` 判，卡片列本身
 * 不碰 React Flow（见 workflow-canvas-io-isolation-guard 的守卫）。
 *
 * 与宿主卡片的**表单行**是同一条事实的两端，不重复表达：
 *   卡片 = 这个对外参数由哪些端口组成（归属）；
 *   表单行 = 这一格现在填的是什么值（值），行尾徽标标出它属于哪个对外参数。
 */

import {
  paramOutputPorts,
  sizeGroupIds,
  sizeSubLabel,
  sizeSubTypeDisplay,
  SIZE_SUB_IDS,
  type ParamEntry,
  type ParamOutputPort,
} from "~/lib/workflow/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { ReactNode } from "react";

import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { paramClassStyle } from "./workflow-param-mapping-ui";

/** 卡片宽度：与项目画布节点同宽，两列并排时仍放得下。 */
const CARD_WIDTH = 220;

export interface WorkflowParamCardColumnProps {
  entries: readonly ParamEntry[];
  /** 契约口清单（`modeContractEntries` / `exposedParamsForMode` 的产物）。
   *
   *  卡片头必须与「工坊封装」页签说同一句话（ISSUE #596：同一页面的两个页签，
   *  「尺寸」一处写全、一处只写两个字）。这里**按 id 覆盖** `entry.label`：
   *  `entry.label` 里可能混着用户自定义契约的措辞与历史落库的改名，而契约口
   *  清单是产品对用户承诺的那几个口，名字只该有一套。
   *
   *  形状只要求 id + label（消费方不必 import 契约模块的类型）。 */
  contractEntries?: readonly { id: string; label: string }[];
  /** 当前模式下「条目 → 目标 ioKey」的生效落点。 */
  resolved: Record<string, string | null>;
  io: WorkflowIOMap | null;
  /** 是否允许连线：库里也允许（拖圆点改落点）—— 没有模式时不给（写入无归属）。 */
  canWire?: boolean;
  /** 作者手里正选中的条目（线被点选 / 卡片被点）。 */
  selectedEntryId?: string | null;
  onSelect?: (entryId: string | null) => void;
  /** 该对外参数在当前模式下是否被作者改过（决定「恢复默认」可用性）。 */
  isManual?: (entryId: string) => boolean;
  onReset?: (entryId: string) => void;
  /** 端点槽位：消费方注入 `<Handle>` 或只读圆点。 */
  endpoint?: (port: ParamOutputPort, index: number) => ReactNode;
}

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
}: WorkflowParamCardColumnProps) {
  if (entries.length === 0) return null;

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 self-start"
      style={{ width: CARD_WIDTH }}
      aria-label="对外参数"
      data-testid="workflow-param-card-column"
    >
      <p className="text-ink-faint px-0.5 text-[11px] font-medium">
        {canWire ? "对外参数 · 拖圆点改落点" : "对外参数"}
      </p>
      {entries.map((entry) => {
        /* 尺寸在映射层是六个子口（形态由作者声明），但**卡片只有一张**：六行形态、
         * 每行一颗圆点，不再并排六张卡（用户口径：「尺寸这里不要显示这么多节点，
         * 尺寸只显示一个节点」）。只在第一个子口的位置画这一张，其余跳过。 */
        if (SIZE_SUB_IDS.includes(entry.cls)) {
          const forms = entries.filter((item) =>
            SIZE_SUB_IDS.includes(item.cls),
          );
          if (entry !== forms[0]) return null;
          const first = forms[0];
          const sizeLabel =
            contractEntries?.find((item) => item.id === "size")?.label ??
            sizeSubLabel("size");
          return (
            <WorkflowParamCard
              key="size"
              /* 选中的可能是这张卡（`size`）或它的某一条线（子口 id）：两种都点亮。 */
              selected={sizeGroupIds(selectedEntryId).some((id) =>
                SIZE_SUB_IDS.includes(id),
              )}
              onSelect={onSelect ? () => onSelect("size") : undefined}
              entryId="size"
              cls="size"
              label={sizeLabel}
              idLabel="size"
              classLabel={paramClassStyle("size").label}
              hostNodeId={first.hostNodeId || first.nodeId}
              width={CARD_WIDTH}
              canWire={canWire}
              readOnly={!canWire}
              canReset={canWire && SIZE_SUB_IDS.some((id) => !!isManual?.(id))}
              /* 一行 = 一个子口：卡片头的 ↺ 把六条线一起撤掉（尺寸是一张卡，
               * 只撤其中一条会让卡片看着「还有线」）。
               *
               *  上抛的是聚合 id `size` —— 由消费方**一次**展开成六个子口交给
               *  `resetMany`。在这里逐个上抛的话，消费方每收到一个就落一次库，
               *  后一次会把前一次的删除覆盖回去（用户口径：「重置也清不掉」）。 */
              onReset={canWire ? () => onReset?.("size") : undefined}
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
                  connected: !!target,
                  ioKey: target ?? "",
                  handleId: item.id,
                  active: !!target,
                };
              })}
              endpoint={endpoint}
            />
          );
        }
        const style = paramClassStyle(entry.cls);
        /* 这张卡片的名字只有一份：卡片头的标题与端口行都读它（见下方
         * `outputPorts` 的 `displayName`）—— 两处各取一份会让同一张卡片说
         * 两个名字（标题「提示词」、行上却写着工作流里的端口名）。 */
        const cardLabel =
          contractEntries?.find((item) => item.id === entry.id)?.label ??
          entry.label;
        return (
          <WorkflowParamCard
            key={entry.id}
            /* 选中的卡片（含被点选的线那一端）提亮：一条线上有三处（卡片、
             * 圆点、宿主行），选中状态必须同时在两端看得出来。 */
            selected={selectedEntryId === entry.id}
            onSelect={onSelect ? () => onSelect(entry.id) : undefined}
            entryId={entry.id}
            cls={entry.cls}
            label={cardLabel}
            /* 与「工坊封装」页签同口径：名字后面标出契约口 id（`prompt` /
               `size` / `reference-image-2`…），配置与日志里认的是 id。 */
            idLabel={entry.id}
            classLabel={style.label}
            hostNodeId={entry.hostNodeId || entry.nodeId}
            width={CARD_WIDTH}
            /* `canWire` 与 `readOnly` 分开表达：库里现在**可连线**（拖圆点改落点），
             * 但卡片本身仍是消费方托管的视觉本体 —— 不写「先选模式才能连线」那类
             * 编辑提示（节点上模式早就选好了，ISSUE #355）。 */
            canWire={canWire}
            readOnly={!canWire}
            canReset={canWire && !!isManual?.(entry.id)}
            onReset={canWire ? () => onReset?.(entry.id) : undefined}
            /* **一个口一颗点**：卡片只说「这个口对外是什么」（名字 + 类型），
             *  落点由线的另一端声明（拖到宿主哪一行就是哪一行）。 */
            outputPorts={paramOutputPorts(
              entry,
              io,
              resolved[entry.id],
              cardLabel,
            )}
            /* 右侧小圆点端点：**每个候选一颗圆点**（与编辑器画布同口径）。
             *
             * 端点由消费方注入 —— 库里那层给的是 React Flow 的 `<Handle>`
             * （ISSUE #529），它自带拖线的起手手势与命中半径；卡片列只把槽位
             * 让出来，不碰 React Flow。 */
            endpoint={endpoint}
          />
        );
      })}
    </aside>
  );
}
