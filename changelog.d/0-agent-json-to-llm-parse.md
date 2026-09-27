## Fixed

- **agent 的 LLM JSON 提取统一到全库唯一出口 `~/lib/llm/parse`（§12.18 / 消跨模块重复实现）**：`agent/executor.ts` 的 `parseCharactersFromJson` / `parseCharacterFull` / `parseShotsFromJson` 与 `agent/prompts.ts` 的 `parseJsonInstruction` 此前各自手搓「fence-strip + search 括号 + lastIndexOf + JSON.parse」的扫描（executor 还自带一份 `stripFences`），而全库的 `llm/prompts.ts`（parseCharacter/parseStoryboard）与 workshop 侧早已统一走 `extractJson/extractJsonArray`。现把这四处扫描层收口到同一出口（各自的字段映射 / 过滤 / 纯对象守卫原样保留）。行为等价由既有 agent + llm 测试（319 用例）全绿兜底；顺带删掉 `stripFences` 及其两处 `fence[1]!` 非空断言（`!` 总数 195→193）。
  - 数组解析此前对「对象包裹的内层数组」有手搓的额外容错，而 prompt 契约本要求「严格 JSON 数组」，且共享的 `parseStoryboard` 也从不 salvage 包裹形态——统一到 `extractJsonArray` 是与全库标准对齐、消离群实现，非收窄契约内行为。
