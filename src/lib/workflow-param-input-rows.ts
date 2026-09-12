/* ── 对外参数卡片的**输入端口行** ──
 *
 * 卡片上半部分逐行列出「这个对外参数由哪些端口组成」。此前这一列直接取
 * `entry.pins`，与宿主表单的实际渲染**脱节**：宽 / 高、比例 / 像素、时长 / 画质 /
 * 比例这些端口被组合控件（`DimensionControl` / `VideoControl`）吞掉，表单里没有
 * 独立的一行，卡片却照列 —— 用户读卡片看到的「有端口」，在宿主卡片上找不到对应的
 * 行，连线也落不到那两行上（ISSUE #355 复审：红框那块占满空间、要看到这些参数的
 * 输入端口）。
 *
 * 现在两件事一起收口：
 *   ① 卡片不再重复列「被组合控件占用的端口」—— 那块组合控件本身就是它们的入口，
 *      列在卡片里既不落线也不填值；
 *   ② 未被组合控件占用的端口，**一个端口一行**，行数即输入行数（几何同口径），
 *      连线按「是哪一行」落点，不再靠吞掉整块控件来近似。
 *
 * 组合控件占用了哪些端口，派生态（`DimensionGroup` / `VideoGroup`）本身就是答案
 * （`groupedEntries`），这里只做集合差，不重算一遍组合判定 —— 两处各判一次必然
 * 会漂移。无 React、无 IO（规范 §17.2 第①层）。
 */

import type { ParamEntry } from "~/lib/workflow-param-mapping";

/** 卡片的初始化上下文：宿主表单把哪些端口交给了组合控件。 */
export interface ParamInputRowCtx {
  /** 被组合控件接管的 ioKey（这些端口在表单上没有独立行）。 */
  groupedKeys?: ReadonlySet<string>;
}

/** 端口 → 组合控件锚点 id（它就是被组合控件接管的那一行）。
 *
 *  React Flow 的 handle id 在画布上必须**全局唯一**，否则边会接到同名 handle 上；
 *  组合控件被多个端口共用，那几颗点必须指向同一个位置但各自有不同的 handle id。
 *  所以组合端口用 `dim:<该控件覆盖的 ioKey>` 当 handle id —— 量测侧
 *  （`WorkflowParamWires`）按它反查锚点，落在组合控件那块上。 */
export const GROUPED_HANDLE_PREFIX = "dim:";

/** 组合端口的 handle id。 */
export function groupedHandleId(ioKeys: readonly (string | undefined)[]): string {
  return (
    GROUPED_HANDLE_PREFIX +
    ioKeys.filter((key): key is string => Boolean(key)).join(",")
  );
}

/** 端口所属的节点 id（ioKey 形如 `<nodeId>::<kind>::<name>`）。
 *
 *  端口名本身**可能含 `::`**，所以只切前两段取节点 id —— 后两段不参与解析。 */
export function nodeIdOfIoKey(ioKey: string): string {
  const parts = ioKey.split("::");
  return parts.length >= 2 ? parts[0]! : ioKey;
}

/** 同一个宿主节点上的组合控件覆盖到的端口（`handleIdForPin` 用它算 handle id）。 */
export function groupedKeysOfNode(
  groupedKeys: ReadonlySet<string> | undefined,
  ioKey: string,
): string[] {
  if (!groupedKeys) return [];
  const nodeId = nodeIdOfIoKey(ioKey);
  return [...groupedKeys].filter((key) => nodeIdOfIoKey(key) === nodeId);
}

/** 某个入口（表单行 / 控件）渲染时要挂的 `data-io-pins` 值。
 *
 *  这是卡片连线要落到的那一格的**精确**锚点：
 *   · 组合控件 → 它覆盖的全部端口（被落到其中任一个，线指向这块控件）；
 *   · 独立参数行 → 只有它自己。
 *  两侧（渲染 / 量测）必须用同一个函数算，否则线会落到别的控件上。 */
export function wirePinsForEntry(
  ioKey: string,
  opts?: { grouped?: boolean; groupedKeys?: ReadonlySet<string> },
): string {
  if (opts?.grouped) {
    const keys = groupedKeysOfNode(opts.groupedKeys, ioKey);
    if (keys.length > 0) return keys.join(",");
  }
  return ioKey;
}

/** 卡片要列出的输入端口行（顺序 = `entry.pins` 顺序，稳定）。 */
export function inputRowsForEntry(
  entry: ParamEntry,
  ctx?: ParamInputRowCtx,
): ParamEntry["pins"] {
  const grouped = ctx?.groupedKeys;
  if (!grouped || grouped.size === 0) return entry.pins;
  return entry.pins.filter((pin) => !grouped.has(pin.ioKey));
}

/** 组合控件的 handle id（= 它覆盖的端口集合，被落在其中任一个都指向这一格）。 */
export function groupedHandleForKeys(
  groupedKeys: ReadonlySet<string> | undefined,
  ioKey: string,
): string {
  return groupedHandleId(groupedKeysOfNode(groupedKeys, ioKey));
}

/** 该端口落点的 handle id —— 组合端口走组合控件锚点，其余走自己那一行（pin 名）。
 *
 *  · 独立行 → 端口名（那张卡片的输出端点 id，也是宿主行上的落点锚点）；
 *  · 组合端口 → `dim:<该控件覆盖的 ioKeys>`（组合控件那一格的锚点）。
 *
 *  两个键空间必须分清（见 `handleIdForIoKey`）：ioKey 是落库与运行期的键，
 *  handle id 只用于画布 / 量测的 DOM 锚点。 */
export function handleIdForPin(
  pin: { ioKey: string; name: string },
  ctx?: ParamInputRowCtx,
): string {
  if (ctx?.groupedKeys?.has(pin.ioKey)) {
    return groupedHandleId(groupedKeysOfNode(ctx.groupedKeys, pin.ioKey));
  }
  return pin.name;
}

/** 输入端口行的展示类型（组合控件那一行是控件本身，不是某个端口）。 */
export function inputRowType(pin: { type: string }): string {
  const type = (pin.type ?? "").trim().toUpperCase();
  return type.length > 0 ? type : "*";
}
