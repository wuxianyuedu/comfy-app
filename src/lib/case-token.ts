/**
 * case-token —— 「标识符的两种书写法之间怎么换算」的**唯一出口**
 * （规范 16 §16.2.4.59）。
 *
 * 为什么收口：全库只有 **1 处**做这件事（`lib/shell/overlay-z` 的 `zClass`），
 * 但它把判据写在**表达式里**而不是写下来 —— 于是「`canvasUi` 该变成
 * `z-canvas-ui` 还是 `z-canvasui`」这件事，读代码的人得在心里跑一遍正则；
 * 更要紧的是 5 个工具类名（`z-canvas-ui` / `z-canvas-max` …）与 CSS 里的
 * `@theme` 变量必须与它一致，而一致性此前**只靠命名直觉**：错误的方式是
 * 静默的（Tailwind 找不到类名不会报错，只是那一层没有 `z-index`）。
 *
 * 本模块只做换算，不做「哪个档叫什么名字」的域决定（那在调用处）。
 *
 * ⚠️ 两类「看起来像」的替换**不属于本模块**，别硬搬进来：
 *   · `replace(/:/g, "-")`（把时刻写进文件名）—— 那是「哪些字符非法」的账，
 *     落点见 `log-export` / `comfyui/trainer`；
 *   · `replace(/[^…]/g, "_")`（文件名安全化）—— 见 §16.2.4.53 的
 *     `~/lib/safe-name`。
 * 本条账的形态只有一个：**大写字母前插连字符**。
 */

/**
 * 驼峰 / 帕斯卡 → kebab-case。
 *
 * 判据是**逐字符**的（不是 `split` 再 `join`）：每个大写字母前插一个
 * 连字符并转小写，其余原样。
 *
 * 三条刻意不做的**花活**（每一种都有人以为「该这样」，写下来才不会有人来加）：
 *   1. **不处理连续大写**（`HTTPServer` → `h-t-t-p-server`，不是
 *      `http-server`）—— 本仓库的档名全是单驼峰（`canvasUi` / `popup`），
 *      要处理缩写就得引入「哪里是词边界」的猜测；
 *   2. **不 `trim` 连字符**（`_base` → `_base`，不是 `-base`）—— 前导下划线
 *      是「私有」的语义，抹掉它等于改名字；
 *   3. **不转数字与符号**（`z2` → `z2`）—— 那不在本条账的形态里。
 *
 * 已由 `~/lib/shell/overlay-z` 的 `zClass` 消费（`canvasUi` → `z-canvas-ui`，
 * 与 `globals.css` 的 `@theme` 变量逐字一致）。
 */
export function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * kebab-case → 驼峰（连字符后一个字母转大写，其余原样）。
 *
 * 与 {@link toKebabCase} 是**一对**，收在同一处：只要一边在、另一边散落别处，
 * 下一次就会有人写出「只处理第一个连字符」的版本（`a-b-c` → `aB-c`）。
 * 目前没有消费方 —— 它是为「读回自己的输出」准备的（例如从 `z-canvas-ui`
 * 反查档名），所以**有测试、没有调用处**：判据先立着，比等人再猜一次划算。
 */
export function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
