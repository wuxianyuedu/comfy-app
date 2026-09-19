// ── 「值不存在时显示什么」的唯一出口 ────────────────────────────────────────
//
// 此前全库有 30+ 处裸写 `?? "—"` / `!= null ? x : "—"`，而「什么算不存在」
// 各家判得都不一样：
//   · 有的用 `??`（只管 null / undefined）
//   · 有的用 `||`（把 `0` 与 `""` 也当不存在 —— 于是「步数 0」显示成「—」）
//   · 有的写 `value > 0 ? value : "—"`（`LogPanel` 那处）
//   · 已有一个出口 `workflow-utils.ts` 的 `renderWidgetValue`，但按函数名扫
//     找不出来（问题不是「值怎么渲染」，而是「没有值的时候显示什么」）
//
// 这条账的形状是**判断口径**，不是某个组件：`??` 与 `||` 只差一个字符，
// 都编译、都运行、类型都对，差别只在「0 与空串算不算有值」这一个语义决定上，
// 而它散在 30 处就永远不会被统一说出来。
//
// 口径（本文件是全库唯一的定义处）：
//   · `undefined` / `null` → 占位符
//   · `""`（空串）→ 占位符 —— 这是**显示层**：一个空白的单元格看不出
//     「取到了空串」还是「根本没取到」，而用户要的是「这一格有没有内容」
//   · `0` / `false` / `NaN` 之后的值 → **照常显示**。它们是**真实测到的值**
//     不是缺值：把 `steps=0` 显示成「—」是在撒谎

/** 缺值占位符。em dash 而不是 `N/A` —— 它在等宽与比例字体下都不抢眼，
 *  也不会让表格看起来像出了错（这是「这项没有数据」，不是异常）。 */
export const EMPTY_PLACEHOLDER = "—";

/**
 * 值 → 展示文本；缺值给 `EMPTY_PLACEHOLDER`。
 *
 * ```ts
 * // 有值给文本，缺值给默认占位符
 * displayValue(output.seed)  // 如 12345，或 "—"
 * // 需要别的占位符时显式传
 * displayValue(output.seed, { fallback: "-" })  // 需要别的占位符时
 * ```
 *
 * **`0` 会原样显示成 `"0"`** —— 这是本函数与 `x || "—"` 的关键差别。
 * 想把 `0` 也当缺值的域（如「0 表示尚未探测到体积」，见
 * `model-library-config.ts` 的 `fmtSize`）**必须显式写判据**，不能靠本函数兜。
 */
export function displayValue(
  value: unknown,
  options: { fallback?: string } = {},
): string {
  const fallback = options.fallback ?? EMPTY_PLACEHOLDER;
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value === "" ? fallback : value;
  if (typeof value === "number")
    return Number.isNaN(value) ? fallback : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  /* 其余（symbol / function / 对象数组）交给它们的自有 `toString` —— 与
   * `String(value)` 运行时一致（显式收窄以满足 no-base-to-string）。 */
  return (value as { toString(): string }).toString();
}

/**
 * `displayValue` 的「可空结果」版本：仍给缺值时返回 `null`。
 *
 * 用于**调用方要自己决定隐藏还是占位**的落点（如
 * `fmtBytes(x) ?? displayValue(...)` 这类组合）。写这一份是因为组合里
 * 最常见的误写是 `fmtBytes(x) ?? "—"` —— 占位符又被硬编码了一遍，
 * 而本次收口的意义正是「占位符只有一处定义」。
 */
export function nonEmpty(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  return displayValue(value);
}
