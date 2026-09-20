/**
 * upper-token —— 「把一个可能带空白 / 缺省的外来串归一成大写记号」的
 * **唯一出口**（规范 16 §16.2.4.64）。
 *
 * 为什么收口：全库有 **26 处**各写一遍 `(x ?? "").trim().toUpperCase()` 这一族，
 * 而它们**并不是同一件事**，差别只在两个语义决定上：
 *
 * | 决定的 | 做法 A | 做法 B |
 * |------|--------|--------|
 * | **要不要吃空白** | `.trim().toUpperCase()` | 只有 `.toUpperCase()` |
 * | **缺省给什么** | `(x ?? "").toUpperCase()`（空串） | `(x ?? "*").toUpperCase()`（放开记号） |
 *
 * 「要不要 trim」这一条最要紧，因为**它决定匹配成败**：ComfyUI 的
 * `object_info` 里类型字段带尾随空白的形态真实存在，而模式码来自用户输入
 * （前后空格是手滑的常态）。收口前的实况是同一个文件里两种写法并存 ——
 * `model-mode-contract.ts` 的 `builtInModeContract` 用
 * `mode.trim().toUpperCase()`，`modeContractEntries` 用
 * `(mode ?? "").toUpperCase()`：**同一个模块码，经过前者匹配得上、经过后者
 * 匹配不上**，而两处都看不出来自己在做不同的事。
 *
 * 因此本出口只有**一个口径**：**吃空白**。想「不吃空白」的调用处没有正当理由
 *（空白从来不携带语义，`" INT "` 与 `"INT"` 在 ComfyUI 里是同一个类型），
 * 所以这里刻意不提供开关 —— 提供开关就等于把那条分歧留在库里。
 *
 * ⚠️ 两类「看起来像」的写法**不属于本模块**：
 *   · `x.toUpperCase()` 且 `x` 是**类型上非空**的 `string`（例如 `type: string`
 *     的入参）—— 那不是「归一外来串」，只是把已知值画成大写展示，
 *     换成 `upperToken(x)` 会把「必有值」的类型信息抹成 `string | null | undefined`；
 *   · `.toLowerCase()` 的对应族 —— 那是**另一条账**（`workflow-io` 的
 *     `name` 折小写做关键词匹配），是否有出口见调用处，别合并到这里。
 */

/**
 * 归一外来串为大写记号：**缺省给空串、吃前后空白**。
 *
 * ```ts
 * upperToken(" script ")   // "SCRIPT"（吃空白）
 * upperToken("")           // ""（缺省给空串）
 * upperToken(null)         // ""（同上）
 * upperToken(undefined)    // ""（同上）
 * ```
 *
 * 想「缺省给放开记号 `*`」的调用处用 {@link upperTokenOr} ——
 * 那是个**域决定**（`*` 意味着「类型未知、不替作者做决定」），
 * 不该变成全库默认。
 */
export function upperToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * 同上，但缺省给一个**具名兜底记号**（缺省 `"*"`）。
 *
 * ```ts
 * upperTokenOr(e.type)        // 缺省时给 "*"
 * upperTokenOr(e.type, "INT") // 缺省时给 "INT"
 * upperTokenOr(" image ")     // "IMAGE"（与 upperToken 同口径）
 * ```
 *
 * 注意兜底**不做 trim / 大写**（调用处传什么就是什么）：它是调用处自己的
 * 常量，替它改写只会让「我明明写了 `INT` 怎么变成了 `INT`」无从解释。
 */
export function upperTokenOr(value: unknown, fallback = "*"): string {
  const token = upperToken(value);
  return token.length > 0 ? token : fallback;
}
