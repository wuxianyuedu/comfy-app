"use client";

/* 对外参数卡片的**视觉本体**（无 React Flow 依赖）。
 *
 * 卡片有两个消费场景：
 *   · 编辑器画布 —— 由 WorkflowParamNode 包一层 <Handle>，端点可拖线（编辑）；
 *   · 工作流库画布 —— 只读展示，端点画成装饰圆点。
 * 两处的头部 / 带类型的输出端口 / 「恢复默认」必须完全一致，故把视觉收敛到这里，
 * 消费方只负责在输出端口行右侧挂「端点」。
 *
 * 卡片体就是**一行一个端口：端点 + 参数名 + 类型**（`outputPorts`）。
 *
 * 此前这里另有一段「输入端口行」把同一批端口再列一遍（`text  STRING`），与下面
 * 的输出端口行（`text  STRING  ●`）说同一件事 —— 单端口条目上读起来就是同一个
 * 信息重复两遍，用户圈出来要求去掉（ISSUE #355 复审）。现在只保留输出端口这一段：
 * 它就是「全量候选出口」本身（每个候选一颗端点），名称与类型贴着端点画。
 */

import type { DOMAttributes } from "react";
import { RotateCcw } from "lucide-react";

import type { ParamEntry, ParamOutputPort } from "~/lib/workflow-param-mapping";
import {
  PARAM_NODE_HEADER_H,
  PARAM_NODE_OUTPUT_ROW_H,
} from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";

export interface WorkflowParamCardProps {
  entryId: string;
  cls: ParamEntry["cls"];
  label: string;
  /** 分类中文名（悬停提示用）。 */
  classLabel: string;
  hostNodeId: string;
  width: number;
  /** 是否允许连线：false 时卡片置灰。
   *
   *  编辑器画布上恒为 true —— 对外参数卡片就是接线面板，**没有模式也要能连**
   *  （模式只是这条线归属的命名空间，不影响拖线本身是否成立）。
   *
   *  注意与 `readOnly` 的区别：`canWire=false` 表达「这张卡当前不可编辑」
   *  （如库内只读消费），**不等于**「因为没有模式所以不能连线」——只读卡片上
   *  不写任何编辑提示，否则会出现「节点上明明已经选了单图生视频，卡片却说需要
   *  选模式」这种自相矛盾的提示。 */
  canWire: boolean;
  /** 只读消费（库内卡片列）：不渲染任何编辑提示。 */
  readOnly?: boolean;
  /** 页脚说明（一句话说清这个口现在连上了没有、该怎么改）。只读消费不传。 */
  footNote?: string;
  /** 该对外参数在当前模式下是否**已经落到了**宿主卡片的某一行。
   *
   *  只影响页脚的观感（已连 = 静默，未连 = 提示色）；文案由 `footNote` 给 ——
   *  卡片本体不替消费方拼句子。 */
  wired?: boolean;
  /** 「恢复默认」是否可用。只读消费处不传回调（按钮根本不渲染）。 */
  canReset: boolean;
  onReset?: () => void;
  /** 该口子的**输出端口**（提示词 → STRING…）——一个候选一颗圆点。
   *
   *  由 `paramOutputPorts` 从「真正落到的端口」派生 —— 同一个「尺寸」口落到
   *  `width` 是 INT、落到 `resolution_preset` 是 COMBO，类型跟着落点走。
   *  未连线时逐个列出候选，不谎报类型。 */
  outputPorts: readonly ParamOutputPort[];
  /** **每一行**输出端口右侧的端点槽位（编辑器 = <Handle>，库里 = 只读圆点）。
   *
   *  每颗圆点各带自己的 handle id（见 `ParamOutputPort.handleId`），拖哪颗点就连到
   *  哪个候选端口。没有模式（返回 null）时该行不渲染端点 = 那个候选连不了。 */
  endpoint?: (port: ParamOutputPort, index: number) => React.ReactNode;
  /** 卡片元素的 ref（节点渲染器用 useHoverElevation 生成）—— 悬浮态由该钩子
   *  写到 React Flow 的节点外壳上，由 CSS 抬起层级压住连线（ISSUE #400）。
   *  命名刻意不含端点类关键字：本文件是**画布无关**的视觉本体（见
   *  workflow-canvas-io-isolation 的守卫）。 */
  hoverRef?: (element: HTMLDivElement | null) => void;
  /** 鼠标进出卡片本体时的事件（节点渲染器用 useHoverElevation 生成）。 */
  hoverEvents?: DOMAttributes<HTMLDivElement>;
}

export function WorkflowParamCard({
  entryId,
  cls,
  label,
  classLabel,
  hostNodeId,
  width,
  canWire,
  readOnly = false,
  canReset,
  onReset,
  outputPorts,
  footNote,
  wired = false,
  endpoint,
  hoverRef,
  hoverEvents,
}: WorkflowParamCardProps) {
  const style = paramClassStyle(cls);
  const disabled = !canWire || readOnly;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
      style={{
        width,
        borderColor: disabled ? "rgba(148,163,184,0.28)" : `${style.color}66`,
        background: "var(--color-card, #16161C)",
        isolation: "isolate",
      }}
      /* 悬浮态由消费方（画布节点）的钩子写到 React Flow 外壳上 —— 抬层级的是
       *  外壳（它自带 position:absolute + z-index，自成层叠上下文），不是这张
       *  卡片（见 HoverElevation 的注释）。 */
      ref={hoverRef}
      {...hoverEvents}
      data-testid={`param-node-${entryId}`}
    >
      {/* 头部：分类圆点 + 对外参数名 + 「恢复默认」 */}
      <div
        className="flex shrink-0 items-center gap-1.5 px-2"
        style={{
          height: PARAM_NODE_HEADER_H,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: `${style.color}14`,
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: style.color,
            boxShadow: `0 0 6px ${style.color}`,
          }}
        />
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-(--color-ink-bright)"
          title={`${classLabel} · ${hostNodeId}`}
        >
          {label}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset}
            className={`nodrag nopan shrink-0 rounded p-0.5 transition-colors ${
              canReset
                ? "text-(--color-ink-soft) hover:bg-white/8 hover:text-(--color-ink-bright)"
                : "cursor-default text-(--color-ink-fainter)"
            }`}
            data-testid={`param-node-reset-${entryId}`}
            title={
              canReset
                ? "恢复默认：撤销该对外参数在当前模式下的连线，回到自动探测的默认线"
                : "已是默认连线状态"
            }
            aria-label="恢复默认"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* ── 输出端口 ──
          每行 = 一个候选落点 + 它自己的圆点端点：圆点出去的是什么类型、叫什么
          名字，看这一行即可。类型跟着当前落点走（提示词落到 STRING 文本口就是
          STRING；尺寸落到 COMBO 的预设口就是 COMBO），尚未连线的候选照给类型
          —— 那是它落到那一行时的类型，不是谎报。
          端点槽位（`endpoint`）压在这一行的右端，所以「类型 + 名称」整组**右对齐
          到端点**：圆点就是这一行在说什么的那个口，名字与类型贴着它才读得出
          「这颗点连到谁」。 */}
      <div className="flex flex-col px-2 pb-1">
        {outputPorts.map((port, index) => (
          <div
            key={`${port.name}-${index}`}
            /* `relative` 是端点定位的锚：注入的端点（画布上的 <Handle>、库内
             *  的只读圆点）都以**这一行**为参照居中，而不是整张卡片 —— 否则
             *  多行输出端口时圆点会全部叠在卡片中线，看不出连的是哪一行。 */
            className="relative flex min-w-0 items-center justify-end gap-1.5 text-[10.5px]"
            style={{ height: PARAM_NODE_OUTPUT_ROW_H }}
            data-testid={`param-node-out-${entryId}-${index}`}
            title={`输出端口 ${port.name} · ${port.type}`}
          >
            <span
              className={`min-w-0 truncate ${
                port.connected
                  ? "text-(--color-ink-soft)"
                  : "text-(--color-ink-fainter)"
              }`}
            >
              {port.name}
            </span>
            <span
              className="shrink-0 rounded px-1 font-mono text-[9px] leading-[14px]"
              style={{
                color: style.color,
                background: `${style.color}1f`,
                border: `1px solid ${style.color}44`,
              }}
              data-testid={`param-node-out-type-${entryId}-${index}`}
            >
              {port.type}
            </span>
            {endpoint?.(port, index)}
          </div>
        ))}
      </div>

      {/* 页脚说明由消费方给出（`footNote`）：卡片本体是画布无关的视觉本体，它
          不该知道「连线手势怎么用」。库内只读消费不传它 —— 那里没有可做的操作。
          没有这段说明，卡片上就只剩一颗圆点：「默认线」「作者改过的线」「一个候选
          都落不上」三种状态读起来一模一样（ISSUE #355：「对外参数卡片连不了线，
          点击端点拉线会出现禁用标记」）。 */}
      {!readOnly && footNote && (
        <div
          className={`px-2 pb-1.5 text-[9.5px] leading-relaxed ${
            wired ? "text-(--color-ink-fainter)" : "text-amber-500/80"
          }`}
          data-testid={`param-node-hint-${entryId}`}
        >
          {footNote}
        </div>
      )}
    </div>
  );
}
