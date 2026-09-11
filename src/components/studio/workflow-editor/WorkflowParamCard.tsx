"use client";

/* 对外参数卡片的**视觉本体**（无 React Flow 依赖、无连线能力）。
 *
 * 卡片只出现在**只读消费视角**（工作流库详情的「画布节点」页签）：每个对外参数
 * 一张卡，卡片里逐行列出它含的端口名与类型。它回答的是「这个对外参数由哪些端口
 * 组成」，与宿主卡片里的**表单行**互补 —— 表单行是「当前填的是什么值」，两者
 * 各表达一件事，不重复：表单行回答值，卡片回答归属（哪些 pin 合成这一个对外口）。
 *
 * 连线（谁落到哪个端口）以「端口行名 + 目标行尾徽标」的方式在表单区表达：
 *   ① 某对外参数只有一个端口时，卡片行尾标出它落到的那一行参数名；
 *   ② 宿主卡片里被落到的那一行，行尾标出它属于哪个对外参数。
 * 两处对得上，一眼看出「提示词到底喂给了哪一行」。
 */

import type { ParamEntry } from "~/lib/workflow-param-mapping";
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
  /** 该对外参数当前落到的端口名（`null` = 该条目的端口不在当前工作流的
   *  IO 表里，无从判定去问哪一行）。 */
  targetName?: string | null;
}

export function WorkflowParamCard({
  entryId,
  cls,
  label,
  classLabel,
  hostNodeId,
  pins,
  width,
  targetName,
}: WorkflowParamCardProps) {
  const style = paramClassStyle(cls);

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
      style={{
        width,
        borderColor: `${style.color}66`,
        background: "var(--color-card, #16161C)",
        isolation: "isolate",
      }}
      data-testid={`param-node-${entryId}`}
    >
      {/* 头部：分类圆点 + 对外参数名 */}
      <div
        className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
        style={{
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
      </div>

      {/* 端口行：一行一个 pin；只有一个端口时在行尾标出它落到宿主卡片的哪一行。 */}
      <div className="flex flex-col px-2 py-1">
        {pins.map((pin) => (
          <div
            key={pin.ioKey}
            className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-(--color-ink-soft)"
            style={{ height: 18 }}
            title={`${pin.name} · ${pin.type}`}
          >
            <span className="min-w-0 flex-1 truncate">{pin.name}</span>
            {targetName && pins.length === 1 ? (
              <span
                className="shrink-0 truncate text-[9.5px] text-(--color-ink-fainter)"
                title={`落点：${targetName}`}
              >
                → {targetName}
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[9.5px] text-(--color-ink-fainter)">
                {pin.type}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
