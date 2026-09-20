/**
 * clamp —— 「把一个数夹进一个区间」的**唯一出口**（规范 16 §16.2.4.63）。
 *
 * 为什么收口：全库有 **19 处**手写 `Math.min` / `Math.max` 的夹取，写法分四派，
 * 四派都编译、都运行、类型都对，差别只在**几个语义决定**上：
 *
 * | 决定的 | 做法 A | 做法 B |
 * |------|--------|--------|
 * | **参数顺序** | `Math.min(max, Math.max(min, x))` | `Math.max(min, Math.min(max, x))` |
 * | **整数从哪来** | 夹在取整**内层**（`Math.min(max, Math.max(min, Math.round(x)))`） | 夹在取整**外层**（`Math.round(Math.min(max, Math.max(min, x)))`） |
 * | **非有限数怎么办** | `Number.isFinite` 守卫，返回兜底值 | 直接进 `Math.max` —— `Math.max(0, NaN)` 是 `NaN`，一路带进 `style` / 落库 |
 * | **只有下限 / 只有上限** | 写成半个夹取（`Math.max(0, x)`） | 另写一个具名函数 |
 *
 * 参数顺序最要紧的一条是**它在类型上不可分辨**：`clamp(x, min, max)` 与
 * `clamp(min, max, x)` 都是 `(number, number, number) => number`，
 * 传反了不会报错，只在边界值上给出不同答案。
 *
 * 因此本出口的签名把**被夹的值放第一位**（`clamp(value, min, max)`）——
 * 与调用处「先有值、再定区间」的读法一致，也让人一眼看出哪个是被夹的那个。
 *
 * ⚠️ 两类「看起来像」的写法**不属于本模块**：
 *   · `Math.max(0, filtered.length - n)`（防负索引）—— 那是**半个**夹取，
 *     没有上限、也没打算有；它表达的是「不许为负」，不是「放进区间」。
 *     换成 `clamp(x, 0, Infinity)` 只会更绕，故不数（见判据 P59 的边界）；
 *   · `Math.min(a, b)` / `Math.max(a, b)` 的**双值比较** —— 那是取值不是夹取。
 *
 * 域内的进度百分比夹取仍在 `~/lib/progress` 的 `clampPct`（它自己带
 * 「非有限数 → 0」的域口径），**但它的实现改用本模块**，不再各写一份
 * 那份 `Math.min(PROGRESS_MAX, Math.max(0, …))` 的写法。
 */

/**
 * 把 `value` 夹进 `[min, max]`。
 *
 * **`NaN` 返回 `min`** —— 这是本条账唯一需要说清的一句：`Math.max(0, NaN)`
 * 是 `NaN`，而 `NaN` 交给 `style={{ width: NaN }}` 是无效值、交给数据库是
 * `null`、交给 `Math.round` 还是 `NaN`，它会在整条链路上**静默地**传播下去。
 * 夹取的语义是「给我一个落在这个区间里的数」，算不出来时给区间起点，
 * 比给 `NaN` 诚实。
 *
 * `±Infinity` 则**按大小夹取**（`Infinity` 显然大于任何上限）：它不是
 * 「算不出来」，而是一个明确大了 / 小了的数 —— 与 `NaN` 分两种处理。
 *
 * ```ts
 * clamp(120, 0, 100)  // 100
 * clamp(-3, 0, 100)   // 0
 * clamp(42, 0, 100)   // 42
 * clamp(NaN, 0, 100)  // 0
 * clamp(Infinity, 0, 100) // 100
 * ```
 *
 * 区间本身**不做校验**（`min > max` 时结果落在 `min`）：那是调用处的常量写错，
 * 在这里悄悄换序只会把错误藏起来。测试里钉住了这一条。
 */
export function clamp(value: number, min: number, max: number): number {
  /* `NaN` 与自身比较恒为 false，显式判一次（`Infinity` 不在此列：
   * 它比任何普通数都大，下面的两个比较就能给它正确的一端）。 */
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 夹取并取整（先夹后整，与 {@link clamp} 是同一口径的组合）。
 *
 * **顺序是「先夹后整」**：先取整再夹，`[0.4, 1]` 区间里 `0.6` 会被取整成 `1`、
 * 再夹成 `1`，看起来对，但 `[0, 0.4]` 里 `0.6` 会先取整成 `1`、再夹成 `0.4`
 * —— 得到一个**不是整数的整数值**。收口前 `media-source.server` 正是
 * `Math.round(Math.min(max, Math.max(min, n)))`（先夹后整），而
 * `video-studio-utils` 是 `Math.max(9, Math.min(121, Math.round(seconds * fps)))`
 * （先整后夹）—— 两处都「对」，因为它们的区间端点恰好是整数。
 *
 * `mode` 只在 `Math.round`（默认）与 `Math.floor` / `Math.trunc` 之间选，
 * 因为它确实是**域决定**：帧数取整与分页取整对「不足一个」的处理不同。
 *
 * ```ts
 * clampInt(120.4, 0, 100)                      // 100
 * clampInt(3.6, 0, 100)                        // 4（默认 round）
 * clampInt(3.6, 0, 100, { mode: "floor" })     // 3（向下取整）
 * ```
 */
export function clampInt(
  value: number,
  min: number,
  max: number,
  options: { mode?: "round" | "floor" | "trunc" } = {},
): number {
  const rounded =
    options.mode === "floor"
      ? Math.floor(value)
      : options.mode === "trunc"
        ? Math.trunc(value)
        : Math.round(value);
  /* 取整后的值同样可能非有限（`Math.round(NaN)` 还是 `NaN`，
   * `Math.round(Infinity)` 还是 `Infinity`），交给 `clamp` 走同一口径。 */
  return clamp(rounded, min, max);
}
