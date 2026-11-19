## Changed

- **B3 子批 2：47 份 / 128 处 `typescript/require-await` 直接清零**。做法同子批 1：摘掉无
  `await` 的 `async`；返回 Promise 的契约处改显式 `Promise.resolve(...)`（`use-workspace*`
  的删除确认、`getSettings`、agent executor 的 `execute`、若干测试替身与 `fetch` mock）。
  判决面挂账从 141 份降到 94 份。
- 连带处理 18 处 `typescript/await-thenable`（`await` 已同步的 `act(...)` 等）与 3 个
  随之变全同步的 `it(...)` 回调（去 `async`）。
- 台账同步：B3 行改「清账中（子批1+2：94 份 / 232 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
