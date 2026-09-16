"use client";

/* 工作流库「画布节点」预览左侧的**对外参数卡片列**。
 *
 * 每个对外参数一张卡片（视觉本体复用 workflow-editor/WorkflowParamCard）：
 *   · 卡片头是参数名（作者在编辑器里勾选/改名后的那个名字）；
 *   · 卡片体逐行列出它包含的端口名与类型，端口行尾标出该端口落到宿主卡片的
 *     哪一行参数（只有一个端口时标「→ <参数名>」）；
 *   · 卡片右侧有一颗**带类型的小圆点端点**（输出端口）。
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
  type ParamEntry,
  type ParamOutputPort,
} from "~/lib/workflow-param-mapping";
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
  /** 宿主卡片此刻真的画得出来的端口（ioKey 集合）—— 候选圆点按它收窄：
   *  画不出端点的端口不给拖，拖过去也落不上。缺省 = 不收窄。 */
  reachableKeys?: ReadonlySet<string>;
  /** 端点槽位（每个候选端口一颗）：消费方注入 `<Handle>` 或只读圆点。 */
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
  reachableKeys,
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
        const style = paramClassStyle(entry.cls);
        return (
          <WorkflowParamCard
            key={entry.id}
            /* 选中的卡片（含被点选的线那一端）提亮：一条线上有三处（卡片、
             * 圆点、宿主行），选中状态必须同时在两端看得出来。 */
            selected={selectedEntryId === entry.id}
            onSelect={onSelect ? () => onSelect(entry.id) : undefined}
            entryId={entry.id}
            cls={entry.cls}
            label={
              contractEntries?.find((item) => item.id === entry.id)?.label ??
              entry.label
            }
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
            /* 带类型的输出端口：与编辑器同一份派生（类型跟着落点走），库里也
             * 读得到「提示词 → STRING」。 */
            outputPorts={paramOutputPorts(
              entry,
              io,
              resolved[entry.id],
              reachableKeys,
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
