"use client";

import { clamp } from "~/lib/clamp";
import React from "react";
import { BaseEdge, type EdgeProps, Position } from "@xyflow/react";
import { shouldDimEdge, type EdgeFocusRole } from "./flow-focus-endpoints";
import { readEdgeFocusRole } from "./hooks/use-related-edges-highlight";

/**
 * WorkflowEdge —— ComfyUI 风格的贝塞尔连线。
 *
 * 为什么**不用** React Flow 自带的 `getBezierPath`：
 *
 *   自带算法把控制点偏移写成源与目标之间**距离**的函数。
 *   对于短距离的 L→R 或 T→B
 *   连线，偏移植会塌缩到几个像素，于是曲线读起来就是
 *   一条直线 —— 视觉上等于完全没有边样式。
 *
 *   ComfyUI 的 lit-renderer 则一律按**句柄朝向**拉一个
 *   近乎固定的偏移量，与距离无关。
 *   我们这里照做。
 *
 *   结果：
 *     • L→R / R→L 的边得到干净的 S 形曲线，两端各锚出 100 px。
 *     • T→B / B→T（竖向）的边**同样**弯曲，因为偏移落在
 *       *句柄*方向上（竖向），而不是源→目标轴上。
 *     • 斜向的边把偏移在 x 与 y 之间分摊。
 *
 * 数据模型（id / source / target / handles / style）不动
 * —— 本组件只决定曲线怎么画。
 */
const HANDLE_OUT: Record<Position, [number, number]> = {
  [Position.Left]: [-1, 0],
  [Position.Right]: [1, 0],
  [Position.Top]: [0, -1],
  [Position.Bottom]: [0, 1],
};

/** 可调参数：每个控制点沿句柄轴被拉出多远。 */
const MIN_OFFSET = 80;
const MAX_OFFSET = 240;
const OFFSET_RATIO = 0.55;

function pickOffset(sx: number, sy: number, tx: number, ty: number) {
  // 沿更长的那条轴取近似曼哈顿距离，这样极短的
  // 线仍能看出弯，而极长的线也不会甩成
  // 巨大的 C 形。
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const longAxis = Math.max(dx, dy);
  const mag = clamp(longAxis * OFFSET_RATIO, MIN_OFFSET, MAX_OFFSET);
  return mag;
}

/** 三次贝塞尔在 t = 0.5 处的中点。 */
function bezierMidpoint(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
): [number, number] {
  const x = (p0x + 3 * p1x + 3 * p2x + p3x) / 8;
  const y = (p0y + 3 * p1y + 3 * p2y + p3y) / 8;
  return [x, y];
}

/** 选中态下的提亮公式：把线色朝白色插值 45%。
 *
 *  为什么是「提亮」而不是「换色」：连线的颜色承载着数据类型的语义
 *  （IMAGE / MODEL / LATENT…，见 portColor），换成品牌色会把这个语义抹掉，
 *  用户反而更难判断「选中节点连过去的到底是什么」。提亮只改明度，保留色相。 */
const FOCUS_LIGHTEN_RATIO = 0.45;

function focusColor(color: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) return "#ffffff";
  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * FOCUS_LIGHTEN_RATIO);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

/** 解析 `#rgb` / `#rrggbb`；其它写法（`url(#grad)`、`rgb(...)`）返回 null。 */
function parseHexColor(color: string): [number, number, number] | null {
  const hex = color.trim();
  if (!hex.startsWith("#")) return null;
  const body = hex.slice(1);
  if (body.length === 3) {
    const [r, g, b] = body.split("");
    if (!r || !g || !b) return null;
    return [
      Number.parseInt(r + r, 16),
      Number.parseInt(g + g, 16),
      Number.parseInt(b + b, 16),
    ];
  }
  if (body.length === 6) {
    const value = Number.parseInt(body, 16);
    if (Number.isNaN(value)) return null;
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  return null;
}

export const WorkflowEdge = React.memo(function WorkflowEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    data,
  } = props;

  const sPos = sourcePosition ?? Position.Right;
  const tPos = targetPosition ?? Position.Left;

  const sOut = HANDLE_OUT[sPos] ?? [1, 0];
  const tOut = HANDLE_OUT[tPos] ?? [-1, 0];

  const offset = pickOffset(sourceX, sourceY, targetX, targetY);

  const c1x = sourceX + sOut[0] * offset;
  const c1y = sourceY + sOut[1] * offset;
  const c2x = targetX + tOut[0] * offset;
  const c2y = targetY + tOut[1] * offset;

  const edgePath = `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`;
  const [labelX, labelY] = bezierMidpoint(
    sourceX,
    sourceY,
    c1x,
    c1y,
    c2x,
    c2y,
    targetX,
    targetY,
  );

  /* 选中节点的相关连线：加粗 + 提亮，其余连线在选中态下降噪，让「这个节点连到
   * 哪里」一眼可读。关注级别由 `useRelatedEdgesHighlight` 写在 edge.data 上；
   * 没有选中任何节点时全图都是 "none"，观感与改动前完全一致。 */
  const edgeData = data;
  const focusRole: EdgeFocusRole = readEdgeFocusRole({ data: edgeData });
  const focused = focusRole === "upstream" || focusRole === "downstream";
  /* 画布是否有选中项由 hook 写在边数据上（每条边都读同一份全局值）——边渲染层
   * 拿不到「选中了什么」，只有这个开关能告诉它「现在该给无关连线降噪了」。 */
  const hasSelection = edgeData?.focusActive === true;
  const dimmed = shouldDimEdge({ focus: focusRole, hasSelection });
  const wireStroke = style?.stroke ?? "rgba(167,139,250,1)";
  /* 提亮：把线的颜色往白里推，而不是换一种颜色 —— 换色会让「这是 IMAGE 线还是
   *  MODEL 线」的类型语义丢失，而类型颜色正是用户读图的依据。 */
  const focusStroke = focusColor(wireStroke);

  return (
    <>
      {/* 外层「光晕」层，让一条细细的 2.5px 描边在深色画布上
       *  仍读得出是连线（尤其对那少数
       *  顶层边 —— 子图内部节点没被缝合进渲染图时它们会留下来）。
       *  先画它，好让干净的前景描边压在它模糊的光晕之上。 */}
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          ...style,
          stroke: focused ? focusStroke : wireStroke,
          strokeWidth: focused ? 9 : 6,
          opacity: focused ? 0.55 : dimmed ? 0.16 : 0.35,
          filter: focused ? "blur(3px)" : "blur(2.5px)",
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: focused ? focusStroke : wireStroke,
          strokeWidth: focused ? 4 : dimmed ? 2 : 2.5,
          opacity: focused ? 1 : dimmed ? 0.45 : 1,
        }}
      />
      {/* 曲线中点处的 ComfyUI 风格枢纽圆点。比默认的
       *  r=3.5 / 0.55 略大（r=4）也更亮，好让它在低
       *  缩放下也存活 —— 那时线本身只有几个屏幕像素。
       *  相关连线上的圆点同步放大 —— 线被加粗后原尺寸的点会「缩」进去。 */}
      <circle
        cx={labelX}
        cy={labelY}
        r={focused ? 5 : 4}
        /* 中点圆点两态都必须可见：原写死 `#ffffff` / `rgba(255,255,255,0.85)`
           （focused 纯白）在浅色画布上与背景几乎同色，标记整条消失。
           改随主题 token（浅色 = 深中性点、深色 = 白点）。focus/dim 的
           强弱区分仍由 `r` 与 `opacity` 承担，不靠填充色的明暗。 */
        fill="var(--color-edge-hub-dot)"
        stroke={focused ? focusStroke : "rgba(167,139,250,0.9)"}
        strokeWidth={focused ? 2 : 1}
        opacity={focused ? 1 : dimmed ? 0.5 : 1}
        pointerEvents="none"
      />
    </>
  );
});
