## Fixed

- **视图层 host 元素不再用原生 `title=`——新增 `P88` 硬闸（#3681，出口 A）**。浏览器画的原生
  `title=` 气泡样式 / 延迟 / 主题全部不归设计 token 管（暗色主题下是白底气泡、长文案单行铺开）。
  P82 只盯 `<Button>` 一个锚点，宿主面（`<span>` / `<div>` / `<p>` / `<code>` / `<kbd>` …）
  上的原生 `title=` 散落全库且没有任何判据认识它。本轮：

  - 新增 **P88**（`ui-primitives-engine.cjs` 的 `countHostTitle()`，与 P82 的五档分级同源；
    `iframe` / `object` / `embed` 与 SVG `<title>` 豁免——前者是无障碍强制项、不是 tooltip）；
    引入时门禁扫描面实测 **107 处 / 59 文件**；
  - 107 处一次全部改写成 `<Hint label=…>`（`~/components/ui/hint`，Base UI Tooltip，
    与 P82 出口同一件东西）—— 映射迭代子的 `key=` 同步挪到 `<Hint>` 上；
  - §16.2.3 三步走落完：判据先看见全部存量 → 棘轮冻结只许降不许升 → 清零后升为
    **硬闸**，棘轮基线退役（`.ui-primitives-baseline.json` 现在只登记仍是棘轮的规则，
    空对象是正常状态）。

  顺带修了一个 `.stories.tsx` 里被判据漏扫的 1 处（`WorkflowNodeParts.stories.tsx`）。
