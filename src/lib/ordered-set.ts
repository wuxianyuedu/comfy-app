// ── 「把一组值去重 / 合并成有序集合」的唯一出口（规范 16 §16.2.4.55）───────
//
// 按**形态**扫出来的账：`[...new Set(xs)]` 与 `Array.from(new Set(xs))`
// 在全库混用，而比选型更要紧的是**排序口径也不一** —— 同一份「候选列表」
// 在画布下拉框里按 `localeCompare` 排、在模型库里按入库顺序排、
// 在日志里按原始顺序排。三处都编译、都运行、类型都对。
//
// 收口前有四种形状，差的是**判据**不是风格：
//
//   ① `[...new Set(xs)]` —— 去重，**保留首次出现的顺序**
//   ② 去重 + **字典序**：`Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b))`
//      —— `localeCompare` 与 `<` 不是同一个判据：
//      前者按当前区域设置排序（`"a" < "B"` 为真），后者按 UTF-16 码位
//      （`"B" < "a"` 为真）—— 同一份文件列表在两处给出不同顺序
//   ③ 去重**同时挑一个字段做键**（键与值是两件事：`file.absPath` 做键、
//      整个 `LocalWorkflowFile` 做值）的形态：
//      它在代码里长这样：`const seen = new Set(); for (…) { if (seen.has(k)) continue; seen.add(k); … }`
//      写成 `[...new Set(xs)]` 表达不了「按哪个字段去重」，
//      于是各处的 `for` 循环又各写一遍
//   ④ 并集：先到先得的两路来源（`specOpts` 优先于 `localOpts`）
//
// 口径（本文件是全库唯一的定义处）：
//   · **顺序是显式参数**，不是默认行为 —— 去重必然产生「留哪一个」的
//     判据，默认保留首次出现（`unique`），要字典序就显式 `uniqueSorted`
//   · **按字段去重**（`uniqueBy`）与**按值去重**（`unique`）分开 ——
//     前者是这条账里最常被 `for` 循环手写的那一种
//   · **`localeCompare` 只在一处出现**：要按当前区域设置排序的都走
//     `compareText`，别处 `a < b` 的写法是另一种判据，该显式保留
//   · 不做 `Set` → 数组之外的事（取交集、差集目前没有落点，
//     不预置「将来可能用到」的 API）
//
// 为什么不是「统一改成 `[...new Set()]`」：那抹掉了「按哪个字段去重」与
// 「排不排序」这两个决定 —— 而它们正是这条账要收口的东西。

/**
 * 文本比较器（**当前区域设置**的字典序）。
 *
 * `localeCompare` 与 `a < b` 是两种判据：前者 `"a" < "B"` 为真
 * （大小写不敏感的相对顺序），后者 `"B" < "a"` 为真（按码位）。
 * 收口前两种混用，于是同一份 `["Zebra", "apple"]` 在不同面板顺序相反。
 * 要码位序的场合仍可直接写 `<`，但那时是**另一个判据**，该在注释里说明。
 */
export function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
 * 去重，保留**首次出现**的顺序。
 *
 * ```ts
 * unique([3, 1, 3, 2]) // [3, 1, 2]
 * ```
 *
 * 想要字典序用 {@link uniqueSorted}；按字段去重用 {@link uniqueBy}。
 */
export function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * 去重 + 按 **`compareText`** 升序。
 *
 * 与 `unique(xs).sort()` 的差别：`Array.prototype.sort()` 不带比较器时
 * 按**字符串码位**排（`[10, 9, 1]` 会排成 `[1, 10, 9]`）—— 而这一档
 * 的落点全是文件名 / 模型名 / 字段名，要的是给人看的顺序。
 * 数字要排序请显式传比较器（那是另一件事）。
 */
export function uniqueSorted(
  values: readonly string[],
  compare: (left: string, right: string) => number = compareText,
): string[] {
  return Array.from(new Set(values)).sort(compare);
}

/**
 * 按 `keyOf` 去重，保留首次出现的**整项**。
 *
 * 这是收口前最常被 `for` 循环手写的那一种：键与值是两件事
 * （`file.absPath` 做键、整个 `LocalWorkflowFile` 做值）。
 *
 * ```ts
 * uniqueBy(files, (f) => f.absPath)      // 按绝对路径去重
 * uniqueBy(rows, (r) => r.name.trim())   // 按去空白的名字去重
 * ```
 *
 * `keyOf` 返回**空值**（`""` / `null` / `undefined`）的项被跳过 ——
 * 收口前各处的写法是 `if (!key) continue` 或 `if (!name) continue`，
 * 语义一致：没有身份的项不进结果集。
 */
export function uniqueBy<T, K>(
  values: readonly T[],
  keyOf: (value: T) => K | null | undefined,
): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const value of values) {
    const key = keyOf(value);
    /* `0` / `false` 是**真实键**，只有 `null` / `undefined` / `""` 才是「没有身份」。 */
    if (key === null || key === undefined || (key as unknown) === "") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * 多路来源的并集，**先到先得**（前一路优先于后一路）。
 *
 * 收口前的写法是逐路手写一遍 `merged.add(o)` 再 `Array.from(merged)` ——
 * 手写两遍就是「漏一路不会报错、漏了也没人发现」的典型形态。
 *
 * 优先级那一路是**调用处的域决定**（`specOpts` 是服务端声明、
 * `localOpts` 是磁盘实测），本函数只保证「先到者留」这条判据只有一处。
 *
 * ```ts
 * union(specOptions, localFileNames) // 服务端声明的候选排在前面
 * ```
 */
export function union<T>(...sources: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const source of sources) {
    for (const value of source) {
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}
