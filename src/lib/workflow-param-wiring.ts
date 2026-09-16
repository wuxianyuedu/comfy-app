/* ── 对外参数映射的**编辑动作**（纯函数，无 React、无 IO）──
 *
 * 映射在两个界面上都能改：
 *   · 工作流编辑器画布 —— 卡片端点即 React Flow 的 <Handle>，拖一条线即完成映射；
 *   · 工作流库的画布预览 —— 同一张卡片、同一份「对外参数 → 宿主端口」事实，
 *     库里那层也是 React Flow 画布（ISSUE #529），闸门与落库动作完全共用。
 *
 * 「库内能不能编辑」这一点上，用户的答复是明确的：库里也要能改
 * （ISSUE #355：「连线要能编辑，现在编辑不了」）。所以库内不再是只读呈现 ——
 * 它复用同一份映射模型，把拖线结果写回 `paramMap.source.mode:<模式>`，
 * 与编辑器落库的形状逐字一致（见 workflow-param-mapping 的 serializeParamMapping）。
 *
 * 本模块只做「把一次连线动作落到 paramMap 上」这一件事：
 *   ① 校验这条线表不表达一条映射（两端方向 + 落点真实存在）；
 *   ② 写进该模式的覆盖表（`ioKey` = 新落点；`null` = 显式断开）。
 * 写入是**合并式**的：paramMap 里 `source` 之外的命名空间原样保留。
 */

import {
  parseParamMapping,
  serializeParamMapping,
  type ParamMapping,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

/** 一条连线动作：把某个对外参数在这个模式下连到 `ioKey`（`null` = 断开）。 */
export interface ParamWireEdit {
  entryId: string;
  /** 目标落点的 ioKey；`null` = 该模式下显式断开。 */
  ioKey: string | null;
  /** 该次编辑归属的模式码。没有模式时无法落库（见下）。 */
  mode: string | null;
}

/** 这条连线动作是否可落库（两端都成立）。
 *
 *  两个条件缺一不可：
 *   · 有模式 —— 落点覆盖必须归属一个模式，不存在脱离模式的覆盖
 *     （见 workflow-param-mapping 的文件头说明）；
 *   · 目标 ioKey 在 workflowIO 里真实存在 —— 否则线画得出来、运行期却落不到值
 *     （静默失效），宁可当场拒绝。
 *
 *  断开（`ioKey === null`）只需要有模式。 */
export function canApplyWireEdit(
  edit: ParamWireEdit,
  io: WorkflowIOMap | null | undefined,
): boolean {
  if (!edit.mode) return false;
  if (edit.ioKey === null) return true;
  return !!io?.[edit.ioKey];
}

/** 把一次连线动作合并进 paramMap（返回新对象，不改入参）。
 *
 *  落库形状与编辑器完全一致：`source.mode:<模式> = { <entryId>: ioKey | null }`。
 *  paramMap 里其它命名空间（`positiveNode` 等）原样保留 —— 库内改一条线不该
 *  顺手抹掉别人写进去的东西。 */
export function applyWireEdit(
  paramMap: Record<string, unknown> | null | undefined,
  edit: ParamWireEdit,
): Record<string, unknown> {
  const base = paramMap && typeof paramMap === "object" ? paramMap : {};
  const parsed = parseParamMapping(base);
  const mapping: ParamMapping = {
    manualByMode: { ...(parsed.manualByMode ?? {}) },
  };
  const mode = edit.mode ?? "";
  mapping.manualByMode![mode] = {
    ...(mapping.manualByMode![mode] ?? {}),
    [edit.entryId]: edit.ioKey,
    /* 显式断开也落库（`null`）—— 不落的话刷新后就变成「还没连过」。 */
  };
  return serializeParamMapping(mapping, base);
}

/** 该对外参数在这个模式下是否被作者改过（含显式断开）。 */
export function hasWireEdit(
  paramMap: Record<string, unknown> | null | undefined,
  entryId: string,
  mode: string | null,
): boolean {
  if (!mode) return false;
  const parsed = parseParamMapping(paramMap);
  const byEntry = parsed.manualByMode?.[mode];
  return !!byEntry && Object.prototype.hasOwnProperty.call(byEntry, entryId);
}

/** 撤销某个对外参数在这个模式下的手工线（回到「未配置」）。
 *
 *  与 `applyWireEdit({ ioKey: ... })` 的区别：那个是「改成另一条线」，这个是
 *  「这条线不再由作者指定」—— 卡片的「恢复默认」用它。 */
export function clearWireEdit(
  paramMap: Record<string, unknown> | null | undefined,
  entryId: string,
  mode: string | null,
): Record<string, unknown> {
  const base = paramMap && typeof paramMap === "object" ? paramMap : {};
  if (!mode) return base;
  const parsed = parseParamMapping(base);
  const byEntry = { ...(parsed.manualByMode?.[mode] ?? {}) };
  delete byEntry[entryId];
  const manualByMode = { ...(parsed.manualByMode ?? {}) };
  if (Object.keys(byEntry).length > 0) manualByMode[mode] = byEntry;
  else delete manualByMode[mode];
  return serializeParamMapping({ manualByMode }, base);
}

/** 命中容差（px）：端点圆点只有 12px，手指/光标稍微偏一点仍然应该受理。
 *  与 React Flow 的 `connectionRadius` 默认值同量级。 */
export const DROP_TOLERANCE = 12;

/** 只保留矩形需要的最小字段（DOMRect 之外也便于单测传普通对象）。 */
export interface DOMRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
}

/** 拖线落点解析：一次拖拽在某个位置松开时，命中的宿主落点 ioKey（`null` = 没落上）。
 *
 *  画布上这件事由 React Flow 的 `isValidConnection` + `onConnect` 承担，库内那层
 *  也是 React Flow（ISSUE #529）—— 两边共用同一个闸门判据，不存在「同一个手势在
 *  两个界面一个受理、一个拒绝」的余地。本函数保留给非 React Flow 的落点命中场景
 *  （如按坐标判定「松手处是哪一格」）。
 *
 *  `candidates` 由调用方给（本轮渲染真的画出来的落点行/控件）。命中时取**最小的
 *  那个矩形**：端点圆点（`data-port-dot`，12px）比整行、比组合控件都小，于是
 *  「精确落在圆点上」永远胜过「大致落在行里」。都没命中（拖到空白处）返回 `null`，
 *  调用方据此不改动任何映射，不留悬空线。
 *
 *  `point` 与 `candidates[].rect` **必须在同一个坐标系**里：库内画布是可缩放
 *  视口，调用方要么两边都取屏幕坐标，要么两边都换算回容器局部坐标 —— 一边屏幕
 *  一边局部，缩放不是 100% 时命中判定会整片偏移（拖到圆点上却落不上，或落在
 *  隔壁行上）。容差随坐标系由调用方按需缩放，这里不做二次换算。 */
export function resolveDropTarget(
  point: { x: number; y: number },
  candidates: readonly { ioKey: string; rect: DOMRectLike }[],
): string | null {
  let hit: { ioKey: string; height: number } | null = null;
  for (const candidate of candidates) {
    const { rect } = candidate;
    const inside =
      point.x >= rect.left - DROP_TOLERANCE &&
      point.x <= rect.right + DROP_TOLERANCE &&
      point.y >= rect.top - DROP_TOLERANCE &&
      point.y <= rect.bottom + DROP_TOLERANCE;
    if (!inside) continue;
    if (!hit || rect.height < hit.height) {
      hit = { ioKey: candidate.ioKey, height: rect.height };
    }
  }
  return hit?.ioKey ?? null;
}
