/* ── 参数取值（未知值 → 可用值）──
 *
 * 工坊的生成参数现在一律走「工作流库工作流 + 对外参数封装」，缺省值由工作流自己
 * 的默认值给出，本模块只剩「读用户填的尺寸 / 帧率这类字符串与数值」的三个守卫。
 *
 * 本模块无 React、无副作用（规范 17 §17.2 第①层）。
 *
 * 与 `lib/error-message` 的空串口径一致：「空串 = 没有值」也适用于参数——
 * 参数表里留了个 `""` 通常是用户清空输入框的结果，应落回缺省值。
 */

/** 取字符串参数：非字符串、空串一律落回 fallback。 */
export function paramString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

/** 取数值参数：接受数字与数字字符串（参数可能来自 JSON / 表单），
 *  非有限值（NaN / Infinity / 对象 / 数组 / 布尔）落回 fallback。
 *
 *  空串要显式拦掉再解析：`Number("")` 是 **0** 而不是 NaN，直接解析会把
 *  「用户清空了步数输入框」变成「步数 = 0」（画面全黑），而不是回落到缺省值。 */
export function paramNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** 取整数参数：在 `paramNumber` 之上取整（steps 这类由 ComfyUI 按整数消费）。 */
export function paramInt(value: unknown, fallback: number): number {
  return Math.round(paramNumber(value, fallback));
}
