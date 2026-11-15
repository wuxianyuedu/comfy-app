#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P88（视图层 host 元素用原生 `title=`）
/**
 * `ui-primitives-rules.cjs` 的规则表分片 —— 单条 P88。
 *
 * 为什么它有自己的一份：编号区间分片按 P87 之后的尾部继续追加（与 P87 单独成片同一
 * 理由：前一片（p67-p86）的余量已撞 §12.6 R5 的 900 行硬闸，append-only 是这个表的
 * 既有切法）；合并层面零改动，追加在 `ui-primitives-rules.cjs` 的 `RULE_PARTS` 末尾。
 *
 * ── 为什么有这条判据（ISSUE #3681）─────────────────────────────────────
 *
 * 治理线的原文（P82 的注释里引的 shadcn `composition.md`）：图标按钮与悬停说明
 * 一律走 Tooltip，不走原生 `title=`。
 *
 * 浏览器画的原生 `title=` 气泡样式 / 延迟 / 主题全部不归设计 token 管（暗色主题下是
 * 一块白底气泡、长文案单行铺开；`#3672` 的现场就是这一面）。P82 把
 * "`<Button>` 上不许原生 `title=`" 判成硬闸之后，这条治理线就只覆盖 `<Button
 * 原生 `title=` 那一个锚点 —— 视图层 host 元素（`<span title=…>` / `<div title=…>` /
 * `<p title=…>` / `<code title=…>` / `<kbd title=…>` …）上的原生 `title=` 照旧散落在
 * 全库，没有任何判据认识它：「全库只用 `<Hint>`」这句话在这些面上永远不会红。
 *
 * 与 P82 逐条同口径（先剥注释 → 按开标签扫 multiline 属性段 → 五档判定 →
 * `violations = static + dynamic`），差异只有一处：**锚定的标签**。
 *   · P82  锚 `<Button`（字面开标签 + 后随 `[\s/>]`）；
 *   · P88 锚**小写 host 标签**（`<[a-z][a-z0-9-]*` + 后随 `[\s/>]`）——
 *     `<EmptyState title=…>` 这类 capitalized 组件是组件 prop、不是 native tooltip，
 *     不计；`<title>` 的 SVG 子元素是合法的无障碍落点，不计。
 *
 * 豁免：`title`（SVG 子元素的合法无障碍落点）与 `iframe` / `object` / `embed`
 * （这三个 host 元素的 `title` 是**无障碍强制项** —— `react/jsx-a11y` 的
 * `iframe-has-title` 一族强制要求，不是浏览器画的 tooltip）。
 *
 * ── 判据形态：硬闸（ISSUE #3681 清零后升的硬闸）────────────────────────
 *
 * 引入时门禁扫描面实测 **107 处 / 59 文件**。§16.2.3 的三步走（与 P82 同一路径）：
 * 先看见存量（本判据成立）→ 棘轮冻结只许降不许升 → 一次治理清零后升为硬闸
 * （P88 进 `HARD_GATE_RULES`，棘轮基线空对象退役）。
 *
 * 修法是**唯一一种**：`title={x}` → `<Hint label={x}>`（`~/components/ui/hint`，
 * Base UI Tooltip，走设计 token、主题化），与 P82 的治理出口同一件东西。
 */
const { countHostTitle } = require("./ui-primitives-engine.cjs");

module.exports = {
  P88: {
    label:
      "视图层 host 元素用原生 title=（应走 ~/components/ui/hint 的 <Hint label=…>；与 P82 <Button> 同一条治理线的另一面）",
    count: (t) => countHostTitle(t).violations,
  },
};
