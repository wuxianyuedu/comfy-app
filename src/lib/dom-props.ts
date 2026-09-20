// ── 「透传一组 props 给底层元素，但要先剔掉自己的私有 prop」的唯一出口（规范 16 §16.2.4.61）──
//
// 按**形态**扫出来的账（ISSUE #672）：十几个基元都有同一段
// 「从 props 里摘掉自己的私有字段、剩下的 `...rest` 原样透传给底层元素」，
// 而**剔除表各写各的**，且**类型侧与运行时侧是两份**：
//
//   类型侧：`interface XxxProps extends Omit<React.ComponentProps<"input">, "type" | "value" | "onChange">` …
//   运行时侧：解构摘掉这三个字段，剩下的 `...props` 摊到 `<input>` 上
//
// 两处必须逐字一致，而它们**没有任何机器判据**：
//
//   · 表里有、解构里漏 → 该字段**静默透传给 DOM**。React 19 对未知属性只是
//     一条 console 警告（构建与测试都不拦），而 `value` / `onChange` 这类
//     受控字段漏掉的表现是**双份受控**：既有基元的受控状态、又有调用处经 DOM
//     直接写进去的值 —— 界面表现为「输入框里有值但状态没变」；
//   · 解构里有、表里漏 → TS 报错，这一侧安全（所以真正会漏的只有上一条）；
//   · 同一件事（如 `className` 的合并、`onLoad` 的包装）在两处各写一遍表，
//     改一处漏一处的代价是**同一个基元在两个文件里形态不同**。
//
// 收口口径：把剔除表**只写一遍**（`as const` 的键名数组），类型侧经
// `OmitOwnProps` 拿它算、运行时侧经 `splitDomProps` 拿同一个数组剥。
// 一处改动两侧同时生效，**结构上不可能漂移**。
//
// 一句话判据：**基元要「先剔自己的字段再透传」就用本模块**；
// 单纯把 `className` 与 `...props` 一起拼（没有私有字段）不属于本条账。

/**
 * 类型侧的剔除：`Omit` 的**具名**封装。
 *
 * 与直接写 `Omit<Base, "a" | "b">` 等价 —— 存在的意义是让「这一串键是**本基元的
 * 私有字段**」在类型上有一个说得出口的名字（读代码的人不必去对比解构），
 * 并且让下面那对 `keys` / `splitDomProps` 能在同一行里被引用。
 *
 * 用法：先写一份 `as const` 的私有键表，再用它同时算类型与运行时 ——
 *
 * ```ts
 * const PRIVATE = ["type", "value", "onChange"] as const; // 私有键表，只写一遍
 * type Props = OwnProps<React.ComponentProps<"input">, typeof PRIVATE> & {}; // 类型侧
 * ```
 */
export type OmitOwnProps<Base, Keys extends keyof Base | string> = Omit<
  Base,
  Extract<Keys, keyof Base>
>;

/**
 * 运行时侧的剔除：按 `keys` 把私有字段摘出来，`rest` 只有底层的属性。
 *
 * `keys` 传 **`as const` 的数组**（与 {@link OmitOwnProps} 同一份），
 * 于是「剔了哪些」在类型与运行时是同一个事实。
 *
 * ```ts
 * // 入参：私有字段 + 要透传的字段混在一起
 * const props = { value: 3, onChange: fn, id: "a", title: "t" }; // 混合的一包
 * const { own, rest } = splitDomProps(props, ["value", "onChange"] as const); // 同一份表
 * // own 拿到私有字段（own.value === 3，own.onChange 是那个函数）
 * // rest 只剩底层的属性 → 可直接 <input {...rest} />
 * ```
 *
 * **不做值层面的改写**（不给默认值、不合并 `className`）：那些是调用处的域决定，
 * 放进这里会让「这个字段到底是不是被改过」只能去读实现。本函数只做「搬」。
 */
export function splitDomProps<
  T extends object,
  const Keys extends readonly string[],
>(
  props: T,
  keys: Keys,
): {
  own: Pick<T, Extract<Keys[number], keyof T>>;
  rest: Omit<T, Extract<Keys[number], keyof T>>;
} {
  const own: Record<string, unknown> = {};
  const rest = { ...props } as Record<string, unknown>;
  for (const key of keys) {
    /* 调用处没传的私有键**不出现在 own 里**（不凭空补 `undefined`）——
     * 那会让「区分不出「没传」与「传了 undefined」」这个信息在出口里丢掉。 */
    if (key in rest) {
      own[key] = rest[key];
      delete rest[key];
    }
  }
  return { own, rest } as {
    own: Pick<T, Extract<Keys[number], keyof T>>;
    rest: Omit<T, Extract<Keys[number], keyof T>>;
  };
}

/**
 * 「自己的私有 prop 有哪些」的**合并**：基元同时扩展两类底层（如 `img` 与
 * `video`）时，两张表的**交集**才是该剔掉的（两个底层共同的字段）。
 *
 * 单独给这个函数是因为「合并两张剔除表」这件事本身容易被写成
 * `[...A, ...B]`（**并集**）—— 那会把只属于其中一个底层的字段也剔掉，
 * 于是那个底层再也拿不到它该有的属性，且**没有报错**。
 *
 * ```ts
 * // 两张表取交集：只有两边都列出的字段才该被剔
 * commonOwnProps(["src", "alt"], ["src", "poster"]); // 只给 "src"
 * ```
 */
export function commonOwnProps<A extends string, B extends string>(
  a: readonly A[],
  b: readonly B[],
): (A & B)[] {
  const setB = new Set<string>(b as readonly string[]);
  return (a as readonly string[]).filter((k) => setB.has(k)) as (A & B)[];
}
