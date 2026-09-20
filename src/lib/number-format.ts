// ── 「把一个数字按某档精度写成字符串」的唯一出口（规范 16 §16.2.4.54）──────
//
// 按**形态**扫出来的账：全库有 26 处 `toFixed(`，其中画布设置的 6 个
// `format` 回调各写各的小数位。而写法分四派 —— 每一派都编译、都运行、
// 类型都对，差别只在**几个语义决定**上：
//
//   · **小数位从哪来** —— 有的写死（`.toFixed(2)`），有的来自 props
//     （`NumberField` 的 `decimalPlaces`），有的来自「这个值量纲是几」
//     （训练页的 loss 与画布透明度用了同一个 2，纯属巧合）
//   · **末尾的零要不要留** —— `1.00` 还是 `1`？ComfyUI 会把 `"1.00"`
//     存成 `"1"`，于是「按两位小数显示」（`1.00`）与「按两位小数取值再
//     去尾零」（`1`）在节点卡片上并存，同一个值在两个面板里长得不一样
//   · **整数要不要也进格式化** —— `Number.isInteger(v)` 提前 `String(v)`
//     与直接 `v.toFixed(2)` 是两件事：前者给 `"3"`，后者给 `"3.00"`
//   · **大数值要不要绕开** —— `value >= 10000` 提前返回，否则
//     `12345.67` 这种「其实是秒数 / 像素」的量会被写成 `12345.67`
//     却又在另一个面板被 `Math.round` 掉
//
// 还有一处更隐蔽的：`(Math.round(value * 100) / 100).toFixed(2)` ——
// 先手动舍入到两位再 `toFixed(2)`，那是**两层舍入**。它看着是「防止
// `1.005` 舍成 `1.00`」，实际效果是「先按十进制舍、再按二进制舍」，
// 与直接 `toFixed(2)` 在边界值上给出不同答案。
//
// 口径（本文件是全库唯一的定义处）：
//   · **精度是调用处的域决定**，本文件给具名档，不替调用处选小数位
//   · **`toFixed` 只在 `fixed` 里出现一次**；别处要两位小数就调它
//   · **尾零剥离是显式选项**（`stripZeros`），不是默认行为 ——
//     「1.00」与「1」是两种观感，该由调用处说出来
//   · **非有限数一律走 `Number.isFinite` 判定**，不给 `NaN` / `Infinity`
//     写字面量（`NaN.toFixed(2)` 是 `"NaN"`，渲染出来是一个假的值）

/**
 * 把数字按固定小数位写成字符串（`toFixed` 的唯一落点）。
 *
 * 非有限数（`NaN` / `±Infinity`）返回 **`null`** —— 它们不是「某个值」，
 * 调用处该据此走缺值占位（`~/lib/display-value`），而不是显示 `"NaN"`。
 *
 * ```ts
 * fixed(0.5, 2)     // "0.50"
 * fixed(1, 2)       // "1.00"
 *   fixed(Number.NaN, 2)  → null（非有限数）
 * ```
 */
import { clampInt } from "~/lib/clamp";

export function fixed(value: number, digits: number): string | null {
  if (!Number.isFinite(value)) return null;
  const clamped = clampInt(digits, 0, 20, { mode: "trunc" });
  return value.toFixed(clamped);
}

/**
 * 按固定小数位写数，**去掉末尾的零**（`1.00` → `1`、`0.50` → `0.5`）。
 *
 * 这是「精度是上限、不是形态」那一档：ComfyUI 与配置文件里存的就是
 * 剥过零的形态（`"1"` / `"0.85"`），节点卡片与滑块读数要跟它一致，
 * 否则同一个值在画布上一个样、在设置里另一个样。
 *
 * `0` 永远返回 `"0"`（不返回空串）：`"0.00"` 剥完尾零会剩下 `"0."`，
 * 再去点才是 `"0"` —— 少走一步就会渲染出一个空单元格。
 *
 * ```ts
 * trimmed(1, 2)   // "1"
 * trimmed(0.5, 2) // "0.5"
 * trimmed(0, 2)   // "0"
 * trimmed(2.345, 2) // "2.35"（先按两位舍入再剥零）
 * ```
 */
export function trimmed(value: number, digits: number): string | null {
  const text = fixed(value, digits);
  if (text === null) return null;
  /* 只剥**小数点之后**的零 —— `100` 不能变成 `1`。 */
  if (!text.includes(".")) return text;
  const stripped = text.replace(/\.?0+$/, "");
  /* `"-0.00"` 剥完尾零会剩下 `"-0"` —— 这是一个**没有任何信息**的负零，
   * 显示出来会让用户以为「这个值小于 0」（它其实是被舍成 0 的
   * `-1e-9`）。归一到 `"0"`。 */
  return stripped === "-0" ? "0" : stripped;
}

/**
 * 数值 → 展示文本：整数不加小数点，小数按 `digits` 档（**去掉尾零**）。
 *
 * 这是节点卡片「值单元格」那一档：`3` 显示 `"3"`（不是 `"3.00"`），
 * `0.5` 显示 `"0.5"`（不是 `"0.50"`）。整数判据走 `Number.isInteger`
 * 而不是「舍入后是否相等」—— `1.0000001` 不该被当成整数。
 *
 * `NaN` → `null`（与 `fixed` / `trimmed` 同口径）。
 */
export function trimFixed(value: number, digits: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return trimmed(value, digits);
}

/**
 * 数字 → CSS `rgba()` 的 alpha 段写法（固定 3 位小数，**不剥尾零**）。
 *
 * 与上面几档的区别：那不是「给人读的数」，而是一个要交给 CSS 解析的
 * 语法片段 —— 剥尾零会让 `0.100` 变成 `0.1`，虽然等价，但一处写 3 位、
 * 一处写 1 位会让「同一件事有一处定义」这件事重新变得看不出来。
 * 调用处（画布网格的透明度）此前各写一遍 `.toFixed(3)`，正是为此。
 */
export function alphaText(value: number): string {
  const text = fixed(value, 3);
  return text ?? "0";
}
