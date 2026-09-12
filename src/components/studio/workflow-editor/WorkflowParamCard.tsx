"use client";

/* 对外参数卡片的**视觉本体**（无 React Flow 依赖）。
 *
 * 卡片有两个消费场景：
 *   · 编辑器画布 —— 由 WorkflowParamNode 包一层 <Handle>，端点可拖线（编辑）；
 *   · 工作流库画布 —— 只读展示，端点不渲染，看的是「这个对外参数由哪些端口
 *     组成」。
 * 两处的头部 / 端口行 / 带类型的输出端口 / 「恢复默认」必须完全一致，故把视觉
 * 收敛到这里，消费方只负责在输出端口行右侧挂「端点」与在端口行尾补说明。
 *
 * 卡片上有两种「端口」，别混淆：
 *   · **输入端口行**（`pins`）= 这个对外参数落地时的候选/实际落点（工作流内部
 *     的 pin 名 + 类型）；
 *   · **带类型的输出端口**（`outputPorts`）= 这张卡右侧出去的是什么（对外语义
 *     的类型，如「提示词」出去的都是 STRING）。它跟着**当前落点**走：同一个
 *     「尺寸」口落到 `width` 是 INT、落到 `resolution_preset` 就是 COMBO。
 */

import type { DOMAttributes } from "react";
import { RotateCcw } from "lucide-react";

import type { ParamEntry, ParamOutputPort } from "~/lib/workflow-param-mapping";
import {
  PARAM_NODE_HEADER_H,
  PARAM_NODE_OUTPUT_ROW_H,
  PARAM_NODE_ROW_H,
} from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";

export interface WorkflowParamCardProps {
  entryId: string;
  cls: ParamEntry["cls"];
  label: string;
  /** 分类中文名（悬停提示用）。 */
  classLabel: string;
  hostNodeId: string;
  pins: ParamEntry["pins"];
  width: number;
  /** 是否允许连线：false 时卡片置灰。
   *
   *  注意与 `readOnly` 的区别：`canWire=false` 表达「这张卡当前不可编辑」
   *  （如库内只读消费），**不等于**「因为没有模式所以不能连线」——后者由
   *  `noModeHint` 单独表达。只读卡片上不写「先选模式才能连线」，否则会出现
   *  「节点上明明已经选了单图生视频，卡片却说需要选模式」这种自相矛盾的提示。 */
  canWire: boolean;
  /** 只读消费（库内卡片列）：不渲染任何编辑提示。 */
  readOnly?: boolean;
  /** 确实没有模式可归属时给出说明（只读卡片不显示）。 */
  noModeHint?: boolean;
  /** 「恢复默认」是否可用。只读消费处不传回调（按钮根本不渲染）。 */
  canReset: boolean;
  onReset?: () => void;
  /** 该口子的**带类型输出端口**（提示词 → STRING…）。
   *
   *  由 `paramOutputPorts` 从「真正落到的端口」派生 —— 同一个「尺寸」口落到
   *  `width` 是 INT、落到 `resolution_preset` 是 COMBO，类型跟着落点走。
   *  未连线时退到候选端口并标 `*`，不谎报类型。 */
  outputPorts: readonly ParamOutputPort[];
  /** 每条输出端口行右侧的端点槽位（编辑器 = <Handle>）。
   *
   *  只给**第一条**端口行挂端点即可（一个对外参数只有一个出口）；返回 null
   *  的行不渲染端点（没有模式 = 禁止连线，库里只读同理）。 */
  endpoint?: (port: ParamOutputPort, index: number) => React.ReactNode;
  /** 端口行的**行尾**内容（如落点说明）。
   *
   *  只给**多端口**条目用：落点跟着具体端口名走，多行之间需要区分。单端口条目
   *  的落点在下面那行带类型的输出端口里已经写了名字（且贴着端点），行尾再标一次
   *  就是把同一件事说两遍（ISSUE #355 复审「红框内那段没用，去掉」）。 */
  rowTrailing?: (pin: ParamEntry["pins"][number]) => React.ReactNode;
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
  pins,
  width,
  canWire,
  readOnly = false,
  noModeHint = false,
  canReset,
  onReset,
  outputPorts,
  endpoint,
  rowTrailing,
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

      {/* 端口行：一行一个 pin，仅作展示（真正的连线手柄在卡片右侧）。 */}
      <div className="flex flex-col px-2 py-1">
        {pins.map((pin) => (
          <div
            key={pin.ioKey}
            className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-(--color-ink-soft)"
            style={{ height: PARAM_NODE_ROW_H }}
            title={`${pin.name} · ${pin.type}`}
          >
            <span className="min-w-0 flex-1 truncate">{pin.name}</span>
            {rowTrailing?.(pin) ?? (
              <span className="shrink-0 font-mono text-[9.5px] text-(--color-ink-fainter)">
                {pin.type}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── 带类型的输出端口 ──
          这一行就是卡片右侧那颗**小圆点端点**的意思：圆点出去的是什么类型、
          叫什么名字。类型跟着当前落点走（提示词落到 STRING 文本口就是 STRING；
          尺寸落到 COMBO 的预设口就是 COMBO），只连了候选还没落定时标 `*`。
          端点槽位（`endpoint`）压在这一行的右端，所以「类型 + 名称」整组**右对齐
          到端点**，而不是像端口行那样左对齐 —— 圆点就是这一行在说什么的那个口，
          名字与类型贴着它才读得出「这颗点连到谁」。
          端口行不再在行尾重复标落点名（那与这一行同义，一处事实只说一次）。 */}
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

      {!readOnly && noModeHint && (
        <div className="px-2 pb-1.5 text-[9.5px] leading-relaxed text-amber-500/80">
          该工作流未声明模式，落点暂不可编辑
        </div>
      )}
    </div>
  );
}
