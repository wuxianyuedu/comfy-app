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
