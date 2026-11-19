/* ── workflowIO 编辑态的纯变换 ────────────────────────────────────────────
 * 「改一个参数的显隐 / 默认值 / 显示名」这些动作对 workflowIO 表的改写规则，
 * 只有这一份。编辑器 IO 预览（经 Zustand store 动作，条目是 WorkflowIOParam）
 * 与工作流库详情的 IO 预览页签（经详情落库回调，条目是富化后的 WorkflowIOEntry）
 * 都调用这里，避免两处各写一份 modeOverrides 的读写口径漂移。
 * 泛型 T 让返回值保持调用方自己的条目类型；纯函数、无 React、无 IO。 */
import type { WorkflowIOEntry, WorkflowIOModeOverride } from "./workflow-io-types";

/** 写 / 删某个参数在某一模式下的覆盖项。
 *  `patch === null` 表示删掉该模式的整项覆盖（回到通用默认值 + 默认可见）；
 *  写入后若该条目的覆盖层已空，则把 `modeOverrides` 字段一并摘掉，避免向
 *  JSON 列里塞一个空对象。键不存在 / 模式码为空时原样返回同一引用。 */
export function withModeOverride<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  key: string,
  mode: string,
  patch: WorkflowIOModeOverride | null,
): Record<string, T> {
  const cur = io[key];
  if (!cur || !mode) {
    return io;
  }
  const modes: Record<string, WorkflowIOModeOverride> = { ...cur.modeOverrides };
  if (patch === null) {
    if (!(mode in modes)) {
      return io;
    }
    delete modes[mode];
  } else {
    modes[mode] = { ...modes[mode], ...patch };
  }
  const nextEntry: T =
    Object.keys(modes).length > 0
      ? { ...cur, modeOverrides: modes }
      : { ...cur, modeOverrides: undefined };
  return { ...io, [key]: nextEntry };
}

/** 恢复默认：清掉所有条目在给定模式下的覆盖项。没有任何命中时返回同一引用，
 *  调用方可据此跳过一次落库。 */
export function clearModeOverrides<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  mode: string,
): Record<string, T> {
  if (!mode) {
    return io;
  }
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, entry] of Object.entries(io)) {
    const modes = entry.modeOverrides;
    if (!modes || !(mode in modes)) {
      next[key] = entry;
      continue;
    }
    changed = true;
    const rest = { ...modes };
    delete rest[mode];
    next[key] =
      Object.keys(rest).length > 0
        ? { ...entry, modeOverrides: rest }
        : { ...entry, modeOverrides: undefined };
  }
  return changed ? next : io;
}

/** 作者重命名某个已暴露参数的显示名。空串 = 撤销重命名（显示名回到富化链）。
 *  键不存在、或新值与现值相同时返回同一引用。 */
export function withIOLabel<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  key: string,
  label: string,
): Record<string, T> {
  const cur = io[key];
  if (!cur) {
    return io;
  }
  const kept = label.trim() || undefined;
  if (kept === cur.label) {
    return io;
  }
  return { ...io, [key]: { ...cur, label: kept } };
}

/** IO 预览项的展示分组：与 `splitWorkflowIO` / 编辑器 `reorderIO` 同一判据 ——
 *  output 一组、widget 输入一组、wire 输入一组；用户只在组内调序，三组在
 *  视图里本就分段渲染（输入在上、输出在下），跨组挪动没有视觉意义。 */
function ioOrderGroup(entry: WorkflowIOEntry): "wire" | "widget" | "output" {
  if (entry.direction === "output") {
    return "output";
  }
  return entry.kind === "widget" ? "widget" : "wire";
}

/** 按 `displayOrder` 排序（缺失按 +∞，稳定保序）——与 `splitWorkflowIO` 的
 *  `byDisplayOrder` 同一口径；这里是纯数组排序，键序作稳定次序兜底。 */
function byDisplayOrder<T extends WorkflowIOEntry>(a: [string, T], b: [string, T]): number {
  const ao = a[1].displayOrder;
  const bo = b[1].displayOrder;
  if (ao === bo) {
    return 0;
  }
  if (ao === undefined) {
    return 1;
  }
  if (bo === undefined) {
    return -1;
  }
  return ao - bo;
}

/** 把重排后的同组序列写回原表：重编 `displayOrder`（1..N），也在对象键序上
 *  铺成新序（展示层以 displayOrder 为准，键序一致便于核对）。原 `io` 的组间
 *  相对位置不动 —— 在被移动组第一项的原位置一次性铺入新序列。 */
function writeReorderedGroup<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  group: "wire" | "widget" | "output",
  nextGroup: Array<[string, T]>,
): Record<string, T> {
  const newGroupEntries: Array<[string, T]> = nextGroup.map(([key, entry], i) => [
    key,
    { ...entry, displayOrder: i + 1 },
  ]);
  const allEntries = Object.entries(io);
  const groupFirstIdx = allEntries.findIndex(([, entry]) => ioOrderGroup(entry) === group);
  const out: Array<[string, T]> = [];
  for (const [i, [key, entry]] of allEntries.entries()) {
    if (i === groupFirstIdx) {
      out.push(...newGroupEntries);
    }
    if (ioOrderGroup(entry) === group) {
      continue;
    }
    out.push([key, entry]);
  }
  return Object.fromEntries(out);
}

/** 同组条目按当前 `displayOrder` 排好，作为一次调序的「视觉序列」。 */
function orderedGroup<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  group: "wire" | "widget" | "output",
): Array<[string, T]> {
  return Object.entries(io)
    .filter(([, entry]) => ioOrderGroup(entry) === group)
    .sort(byDisplayOrder);
}

/** 把 `keys` 这一组条目当作**一个整体**移到 `targetKey` 的前 / 后
 *  （`targetKey` 为空 = 移到该组末尾）。尺寸 / 视频等组合参数由多个 ioKey
 *  构成，在表单里只渲染成一块；拖动整块时这些 key 必须一起移动并保持块内
 *  顺序，否则「拖了组合块 → 只有代表键换了位、块又弹回原处」（ISSUE #4073
 *  复审第 5 条）。
 *
 *  约束：所有 key 必须同属一组（与 `withIOReordered` 同口径，不跨 wire/widget/output），
 *  且 `targetKey` 不能落在被搬的块里（拖到自己身上是无意义的自移动）。不满足时
 *  原样返回同一引用。 */
export function withIOGroupReordered<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  keys: Array<string>,
  targetKey: string | null,
  position: "before" | "after",
): Record<string, T> {
  const movingEntries: Array<[string, T]> = [];
  for (const key of new Set(keys)) {
    const entry = io[key];
    if (entry !== undefined) {
      movingEntries.push([key, entry]);
    }
  }
  const [first] = movingEntries;
  if (!first) {
    return io;
  }
  const group = ioOrderGroup(first[1]);
  if (movingEntries.some(([, entry]) => ioOrderGroup(entry) !== group)) {
    return io;
  }
  const movingKeys = movingEntries.map(([key]) => key);
  if (targetKey !== null && movingKeys.includes(targetKey)) {
    return io;
  }

  const moving = new Set(movingKeys);
  /* 块内顺序以调用方给出的 keys 为准（视图层按当前 displayOrder 传入），
   * 不从 ordered 里再排一遍 —— 否则同一个块在不同调用点会换内部顺序。 */
  const block = movingEntries;
  const ordered = orderedGroup(io, group);
  const without = ordered.filter(([key]) => !moving.has(key));
  let targetIdx = without.length;
  if (targetKey !== null && targetKey !== "") {
    const found = without.findIndex(([key]) => key === targetKey);
    if (found !== -1) {
      targetIdx = position === "after" ? found + 1 : found;
    }
  }
  without.splice(targetIdx, 0, ...block);
  return writeReorderedGroup(io, group, without);
}

/** 把 `fromKey` 那一项移到 `targetKey` 的前 / 后（`targetKey` 为空 = 移到该组末尾）。
 *  纯变换：与编辑器侧 `WorkflowStores.reorderIO` **同一口径** —— 只在被移动项
 *  所属组内重排，并重编该组的 `displayOrder`（1..N）；其余组原样保留。
 *
 *  为什么必须重编 `displayOrder` 而不只是改对象键序：IO 预览的展示经
 *  `splitWorkflowIO` 按 `displayOrder` 排序，只要条目带着旧的 order 数字，
 *  光改键序会被那道排序盖掉 —— 表现就是「能拖、松手又弹回原位」（ISSUE #4073
 *  复审第 4 条）。项都没有 `displayOrder` 时（既有工作流的常见形态）稳定排序
 *  保住键序，结果仍是纯插入序，与旧行为一致。
 *
 *  `fromKey` 不在表内、或与 `targetKey` 相同时原样返回同一引用。 */
export function withIOReordered<T extends WorkflowIOEntry>(
  io: Record<string, T>,
  fromKey: string,
  targetKey: string | null,
  position: "before" | "after",
): Record<string, T> {
  return withIOGroupReordered(io, [fromKey], targetKey, position);
}
