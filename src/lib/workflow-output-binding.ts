/* ── 对外**输出**参数落在哪个端口 / 从哪一行取值（纯函数，无 React、无 IO）──
 *
 * 左列（对外输入参数）说「这个工作流对外**要**什么，落到节点哪一行」；右列（对外
 * 输出参数）说「它对外**给**什么」—— 两列对称，但默认的「给」此前只有一处来源：
 * `splitWorkflowIO` 按 `displayOrder` 排出来的输出行。作者想临时把 `images` 指到
 * 别处（ISSUE #355）时，没有任何键空间可写。
 *
 * 本模块补上这一处：输出的落点覆盖与输入侧同构 —— 按**模式**归拢，写进
 * `paramMap.output.mode:<模式> = { <ioKey>: <落点 ioKey> | null }`。
 *
 * 两处刻意与输入侧分开的取舍：
 *   · 键空间分开（`output` vs `source`）。输入侧的 `source` 是**运行期**
 *     载荷覆盖表（后端据此把对外值派到那个端口），输出侧的选取纯属视图层
 *     「这个概念从哪一行读值」。混在同一张表里，运行期会把一个输出 ioKey 当成
 *     输入覆盖去查，落空后行为不可预期。
 *   · **只有作者连过的线**。输入侧与输出侧现在同一条口径：没有线就是没有落点。
 *     输出的「没连过」回落读做「工作流自带的那一行」（`displayOrder` 排在首位的
 *     那一个）——这是输出侧的视图默认值，不是替作者猜的落点。
 *
 * 与编辑器画布的 `paramMap.source.mode:<模式>` 逐字同构的读写规则：显式 `null`
 * = 断开（卡片悬空），刷新后不会被默认落点复活。
 */

import { MODE_KEY_PREFIX } from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

/** `paramMap` 里输出落点覆盖所在的一级键。 */
export const OUTPUT_BINDING_NAMESPACE = "output";

/** 一个输出口的 default 落点：工作流把 `direction: "output"` 的条目按
 *  `displayOrder` 排出来的**第一个**（作者没手工摆过顺序时就是 IO 表的插入序，
 *  与宿主卡片上的输出行同源）。
 *
 *  刻意不给「每个输出口自动挑一个」的启发式：输出没有运行期语义，硬凑一个默认
 *  落点只会在作者没连过时凭空挪动取值来源。 */
export function defaultOutputSource(
  outputs: readonly { ioKey: string; displayOrder?: number }[],
): string | null {
  if (outputs.length === 0) return null;
  let best = outputs[0]!;
  for (const item of outputs) {
    if (item.displayOrder === undefined) continue;
    if (
      best.displayOrder === undefined ||
      item.displayOrder < best.displayOrder
    ) {
      best = item;
    }
  }
  return best.ioKey;
}

/** 该输出口的 default 落点是否就是它自己（没有任何手工覆盖时的判定依据）。 */
export function isDefaultOutputBinding(
  output: { ioKey: string; displayOrder?: number },
  outputs: readonly { ioKey: string; displayOrder?: number }[],
): boolean {
  return defaultOutputSource(outputs) === output.ioKey;
}

/** 某个模式下的输出覆盖表：`{ <输出口 ioKey>: <落点 ioKey> | null }`。
 *  没有键 = 用 default 落点；`null` = 作者显式断开。 */
function manualMapForMode(
  paramMap: unknown,
  mode: string | null | undefined,
): Record<string, string | null> {
  if (!mode) return {};
  if (!paramMap || typeof paramMap !== "object" || Array.isArray(paramMap))
    return {};
  const ns = (paramMap as Record<string, unknown>)[OUTPUT_BINDING_NAMESPACE];
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return {};
  const table = (ns as Record<string, unknown>)[`${MODE_KEY_PREFIX}${mode}`];
  if (!table || typeof table !== "object" || Array.isArray(table)) return {};
  const out: Record<string, string | null> = {};
  for (const [ioKey, value] of Object.entries(
    table as Record<string, unknown>,
  )) {
    if (typeof value === "string") out[ioKey] = value;
    else if (value === null) out[ioKey] = null;
  }
  return out;
}

/** 作者在某个模式下给这个输出口连的落点：`undefined` = 没连过（走 default），
 *  `string` = 连到别处，`null` = 显式断开。 */
export function manualOutputSource(
  paramMap: unknown,
  outputIoKey: string,
  mode: string | null | undefined,
): string | null | undefined {
  if (!mode) return undefined;
  const table = manualMapForMode(paramMap, mode);
  if (!Object.prototype.hasOwnProperty.call(table, outputIoKey))
    return undefined;
  return table[outputIoKey] ?? null;
}

/** 作者在这个模式下改过哪些输出口（模板「恢复默认」的可用性依据）。 */
export function hasManualOutputBinding(
  paramMap: unknown,
  mode: string | null | undefined,
): boolean {
  return Object.keys(manualMapForMode(paramMap, mode)).length > 0;
}

/** 某个输出口在当前模式下**从哪一行读值**：作者连过的优先，否则该输出自己的
 *  那一行（default 落点）。 */
export function resolveOutputSource(
  paramMap: unknown,
  output: { ioKey: string; displayOrder?: number },
  outputs: readonly { ioKey: string; displayOrder?: number }[],
  mode: string | null | undefined,
  io?: WorkflowIOMap | null,
): string | null {
  const manual = manualOutputSource(paramMap, output.ioKey, mode);
  if (manual !== undefined) {
    /* 断开（`null`）或连到一个已经不存在的端口（工作流改版）→ 悬空，如实为
     *  null；退回 default 会让「断开」看起来从没发生过。 */
    if (manual === null) return null;
    if (io && !io[manual]) return null;
    return manual;
  }
  return isDefaultOutputBinding(output, outputs) ? output.ioKey : null;
}

/** 写入一次输出落点编辑（返回新的 paramMap，不改入参）。
 *
 *  与输入侧 `applyWireEdit` 同构：`mode` 为空时原样返回（覆盖必须有归属），
 *  `paramMap` 里其它命名空间（`source` / `positiveNode` …）原样保留。 */
export function applyOutputBindingEdit(
  paramMap: Record<string, unknown> | null | undefined,
  edit: { outputIoKey: string; ioKey: string | null; mode: string | null },
): Record<string, unknown> {
  const base = paramMap && typeof paramMap === "object" ? { ...paramMap } : {};
  if (!edit.mode) return base;
  const ns = base[OUTPUT_BINDING_NAMESPACE];
  const table =
    ns && typeof ns === "object" && !Array.isArray(ns)
      ? { ...(ns as Record<string, unknown>) }
      : {};
  const key = `${MODE_KEY_PREFIX}${edit.mode}`;
  const byOutput = table[key];
  table[key] = {
    ...(byOutput && typeof byOutput === "object" && !Array.isArray(byOutput)
      ? byOutput
      : {}),
    [edit.outputIoKey]: edit.ioKey,
  };
  return { ...base, [OUTPUT_BINDING_NAMESPACE]: table };
}

/** 撤销某个输出口在当前模式下的手工落点（回到该输出自己那一行）。
 *
 *  只删这一个键：该模式下别的输出口的覆盖原样保留。删空之后整条
 *  `mode:<模式>` 一并去掉，落库形状不会留下空表。 */
export function clearOutputBindingEdit(
  paramMap: Record<string, unknown> | null | undefined,
  outputIoKey: string,
  mode: string | null,
): Record<string, unknown> {
  const base = paramMap && typeof paramMap === "object" ? { ...paramMap } : {};
  if (!mode) return base;
  const ns = base[OUTPUT_BINDING_NAMESPACE];
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return base;
  const table = { ...(ns as Record<string, unknown>) };
  const key = `${MODE_KEY_PREFIX}${mode}`;
  const byOutput = table[key];
  if (!byOutput || typeof byOutput !== "object" || Array.isArray(byOutput))
    return base;
  const next = { ...(byOutput as Record<string, unknown>) };
  delete next[outputIoKey];
  if (Object.keys(next).length > 0) table[key] = next;
  else delete table[key];
  if (Object.keys(table).length > 0) base[OUTPUT_BINDING_NAMESPACE] = table;
  else delete base[OUTPUT_BINDING_NAMESPACE];
  return base;
}

/** 一次落点编辑是否可落库：必须有模式（覆盖要归属一个模式），且落点要么是
 *  「断开」(`null`)、要么是本工作流真实存在的输出行。 */
export function canApplyOutputBindingEdit(
  edit: { ioKey: string | null; mode: string | null },
  io: WorkflowIOMap | null | undefined,
): boolean {
  if (!edit.mode) return false;
  if (edit.ioKey === null) return true;
  return io?.[edit.ioKey]?.direction === "output";
}
