// ── 「可搜索列表过滤」的唯一出口（规范 16 §16.2.4.16）──────────────────────
//
// 这条账的形状和 `display-value` / `format-bytes` 同族：**不是重复代码，是口径**。
// 全库有 8 处各写一遍「搜索框 + 过滤」，而它们对三件事各判各的：
//
//   ① **关键字怎么归一化** —— 「去空白 + 折小写」这套出现 6 次（`AttributeMultiSelect` /
//      `model-library-config` 两处 / `workflow-library-config` 两处 / `log-store` /
//      `RgthreeBodies` / `multi-mode-select`），但 `AttributeMultiSelect` 只做了去空白：
//      那处的候选值当时全是中文，大小写无差别 —— 看起来「也对」，
//      直到候选里出现 `JK制服` / `T恤` 这类含拉丁字母的项（真在 `COSTUME_OPTIONS` 里），
//      用户输入 `jk` 就一条也搜不到。**同一个决定散在多处，就不会被统一说出来。**
//   ② **命中哪些字段** —— `filterModels` 命中的是「名称 + 文件名」拼接后的整串
//      （所以搜 `model.safetensors` 也能中），`workflow-library-config` 只看 `name`，
//      `RgthreeBodies` 只看 `group.title`。这是**域决定**，留在调用处（见下）。
//   ③ **过滤后空组怎么处理** —— `AttributeMultiSelect` 丢了空组（并在全空时给
//      「未找到匹配项」），其余几处根本没有「组」这一层。**保序 + 丢空组**这一对
//      是分组过滤里唯一说得清的语义：分组顺序由数据决定（不是命中数，否则用户一
//      输入关键字分组就重排），空组必须丢（否则搜出「中式」这个标题下面什么都没有）。
//
// 所以本模块只做「可机器判定的那一半」：归一化、命中判决、分组骨架。
// **命中哪些字段**是域语义 —— 由调用处给 `haystack`（怎么把一行折成可搜文本）
// 与 `match`（要不要子串之外的规则）。
//
// 与 §12.12「跨文件重复块」的区别：那三条是「同一段代码抄了几份」，本模块是
// 「同一个决定有几种写法」——`includes` 与 `toLowerCase().includes` 都编译、
// 都运行、类型都对，差别只在「`JK` 能不能被 `jk` 搜到」这一个语义上。

/** 规范化搜索关键字：两侧空白去掉 + 折成小写。
 *
 *  `trim()` 与 `toLowerCase()` 必须**一起**做，这是本模块存在的理由 ——
 *  此前 `AttributeMultiSelect` 只做了前者，于是含拉丁字母的候选
 *  （`JK制服` / `T恤` / `3D`）大小写敏感，而候选值里明明有它们的现实来源。
 *
 *  空关键字返回 `""`（调用方据此短路：不搜 = 全留），不是 `null` ——
 *  「没输入」与「输了空格」是同一件事，都该当作不过滤。 */
export function normalizeNeedle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 一行是否命中关键字。`""` 关键字恒命中（不搜 = 全留）。
 *
 *  `haystack` 由调用处给：它决定「这一行有哪些字段可搜」。**不要**在调用处
 *  再写 `toLowerCase()` —— 归一化只在本模块做一次。 */
export function matchesNeedle(needle: string, haystack: string): boolean {
  if (!needle) return true;
  /* 两侧都折小写。**只折 haystack 是不够的**：`needle` 由调用处传进来，
   * 而调用处漏掉归一化正是这条账的成因（`AttributeMultiSelect` 只 `trim()`）。
   * 这里把 `needle` 再折一次是幂等的（`normalizeNeedle` 是幂等函数），
   * 收益是「单用 `matchesNeedle` 的调用处不可能因为忘了折小写而不一致」。 */
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * 分组过滤的通用形状：一个 `title` + 一组条目。
 *
 * **数组字段名是可配的泛型参数**（`OptionGroup` 叫 `options`，其余多数叫
 * `items`）—— 硬性要求统一改名会牵动 `character-options.ts` 的 300+ 行数据，
 * 那是「为了出口而改数据」，与本仓库「只搬定义、不动取值」的口径相悖。
 *
 * `G` 是**原分组的完整类型**（如 `OptionGroup`），所以调用处拿回的结果保留
 * 它自己的全部字段 —— 出口只保证 `title` 与 `G[K]` 这一对语义。
 */
/**
 * 分组过滤：**保组序 + 丢空组**。
 *
 * 两条语义各有一条反例作证：
 *
 * 1. **组序按原数据**，不按命中数重排 —— `COSTUME_OPTIONS` 的顺序（中式 / 日韩 /
 *    西式…）是内容组织，用户搜「旗袍」时不该因为「日韩」命中更多就把它提到前面：
 *    同一个关键字连输两次、分组顺序会跳，那是「界面在动」而不是「结果在变」。
 *
 * 2. **空组必须丢** —— `AttributeMultiSelect` 此前只在**全空**时给「未找到匹配
 *    项」，中间的空标题仍会渲染出来：搜「旗袍」时「中式」下面一条结果、
 *    紧跟着的「日韩」下面什么都没有，却还是留着一个小标题。
 *
 * 返回新对象数组，原数组不动 —— 调用处直接 `map` 是安全的。
 */
export function filterGroups<G extends { title: string }, K extends keyof G>(
  groups: G[],
  needle: string,
  /** 条目数组的字段名（`items` / `options` / …）。 */
  field: K,
  /** 单条是否命中。默认对 `String(item)` 子串匹配（小写化在出口内做）。 */
  hit?: (item: ItemOf<G, K>) => boolean,
): G[] {
  if (!needle) return groups;
  const out: G[] = [];
  for (const group of groups) {
    const all = (group[field] as ItemOf<G, K>[] | undefined) ?? [];
    const keep =
      hit ?? ((item: ItemOf<G, K>) => matchesNeedle(needle, String(item)));
    const kept = all.filter(keep);
    if (kept.length === 0) continue;
    out.push({ ...group, [field]: kept });
  }
  return out;
}

/** `G[K]` 的元素类型（`G[K]` 必须是数组）。 */
export type ItemOf<G, K extends keyof G> = G[K] extends readonly (infer I)[]
  ? I
  : never;

/**
 * 「先归一化、再分组过滤」的一步式入口（`AttributeMultiSelect` 那个形态）。
 *
 * 合成一个调用点，是因为**分开写就有人只写一半** —— 这正是这条账的成因
 * （`AttributeMultiSelect` 归一化了 `trim()` 却没折小写）。要单用其中一步的场景
 * （如先按别的条件筛、最后再按关键字）直接用上面的函数。
 */
export function filterGroupsByKeyword<
  G extends { title: string },
  K extends keyof G,
>(
  groups: G[],
  rawKeyword: string,
  field: K,
  hit?: (item: ItemOf<G, K>) => boolean,
): G[] {
  return filterGroups(groups, normalizeNeedle(rawKeyword), field, hit);
}
