## Fixed

- `tests/check-a11y-rules.test.ts`：付「真求值一次 `eslint.config.js`」这笔钱的用例
  一直没有预算，吃全局 30s 档 —— 而它自己的文件头与
  `tests/helpers/a11y-effective-config.ts` 都写着「冷检出上 40s+」。本机隔离实测
  进程内首值 **36.4s**、`--report` 真子进程 **57.1s**，两条都在钩子的新进程里恒红
  （表现是一条与内容无关的 `Test timed out`，重跑碰运气）。现按 `CLI_BUDGET` 同一条
  口径登记 `CONFIG_BUDGET`（120s），并给同批四条真读配置的用例都挂上。
- 同一处把「只求值一次」的判据从墙钟换成实例比对：原先写的是 `firstMs > 0`，在
  `Date.now()` 粒度下冷进程恒真、暖进程恒假（缓存命中耗时就是 0），方向随机器状态翻。
  反向验证：摘掉 `configPromise` 记忆化并每次重建数组 → 只有这一条红；只改 `.then`
  里的值、留着记忆化 → 两条都绿（缓存的是那个 promise）。
