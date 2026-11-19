## Changed

- **B3 子批 3：47 份 / 282 处 `typescript/require-await` 直接清零**。判决面挂账 94 份 → 47 份；
  台账同步为「子批1–3：141 份 / 514 处已清，剩 47 份 / 240 处」。
- 摘 `async` 的连带修复：测试替身与假响应对象按 `Promise.resolve(...)` 保住 Promise 契约
  （`json`/`text`/`arrayBuffer`/`read`、仓储桩、`fetch` 桩），共 130 处；3 份业务源码
  （`importSource.ts`、`lifecycle-launch.ts`、`drizzle-studio/lifecycle.ts`）保持对外 Promise 形态。
- 清账总账：#3181（本批挂 `Refs`）。
