## Fixed

- 契约口内置清单的展示名用例补上「种子」这一口：`tests/workshop-encapsulation-status.test.ts` 与 `src/components/studio/history/history-detail-derive.test.ts` 还按三口（提示词 / 负向 / 尺寸）断言，而内置口径早已是四口。
  归因：`33c92af`（API 通道改远端模型按模式适配器）把 `{ type: "seed", label: "种子" }` 加进 `model-mode-contract.ts` 的默认清单，同批只更新了 `src/lib/workshop/model-mode-contract.test.ts`（那条现在就断言「文生图 = 提示词 + 负向 + 尺寸 + 种子」），漏了这两处。**改断言不改代码** —— 这两条用例锁的是「展示名同一份出处」与「按内置口径摆几行」，与清单里多一口无关；后者的既有断言（取 `rows[0..2]` 的值）不受影响，种子排在末尾。
