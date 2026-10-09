## Changed

- **`await waitFor(...)` 收口到它的边界，并给这条边界一个执行者（ISSUE #1498，第 2 批）**：
  全仓 `await waitFor`（`@testing-library/react`）实测 **211 处 / 30 份文件**
  （上一轮盘点记的是 206 —— 期间别的 PR 又新写了 5 处，**又一次印证没有判据在数**）。

  `waitFor` 与裸 `sleep` 不同档：它是官方推荐写法、没被废弃，所以判据**不判「有没有
  waitFor」**，判的是**边界** —— 只有两种形态该留它，且两种都由判据自己认出来：
  - **等 DOM 出现 / 消失**（回调里用 jest-dom 匹配器）：`expect.poll` 与 jest-dom 的
    匹配器**类型上不兼容**（它们声明返回 void，`@typescript-eslint/await-thenable` 报红），
    这一档只能留 `waitFor`；
  - **站点落在假定时器窗口内**（`vi.useFakeTimers()` … `vi.useRealTimers()`）：
    只有 `waitFor` 会每轮自动 `advanceTimersByTime`（§11.14 明写的合法例外）。

- **改动**：205 处机械替换成 `expect.poll`（`await waitFor(() => expect(X).toBe(Y))`
  → `await expect.poll(() => X).toBe(Y)`），6 处等 DOM 与 1 处假定时器窗口内保留
  `waitFor`（全仓 RTL `waitFor` 从 211 处降到 **7 处**）；11 处带 `timeout: 3000`
  的覆盖一并去掉，吃 `vitest.config.ts` 那一处 **4000ms** 默认（§11.14「默认预算只写
  一次」）。一个回调两条断言的那 2 处（`use-draggable-position`）没有折成 `&&`,
  而是让轮询的值本身带越界信息（两条下限取 `Math.min`、上限取 `Math.max`），
  失败时打出来的仍是「哪一个数越界了」。
- 未用到的 `waitFor` import 同批清掉；`tsc` / `eslint --max-warnings 0` 零告警。

## Added

- `scripts/check-test-waitfor.cjs`（接进 pre-commit 的 D 组，并作为判定型判据登记进
  `check-gate-executors.cjs` 的盘点面）：按上面两条边界逐站点判，越界即阻断。
  它只认**从 `@testing-library/react` 导入**的 `waitFor` —— 本地同名 helper
  （`async function waitFor(pred, msg)`）不在此列，判据认的是 import 事实、不是名字。
  纯文本扫描 624 份用例约 **0.3s**、零网络、零子进程（照 §13.5.4 的成本判据该进钩子）。
- `tests/test-waitfor-gate.test.ts`（5 条，进 `FIXED_STRUCTURAL_TESTS`）：跑真脚本、
  只放被测文件的临时仓库，逐条钉判定口径 —— 该拦的（等值）与该放的（等 DOM /
  假定时器窗口内 / 本地同名 helper / 判据自己的夹具）。

## Docs

- 规范 §11.14 开头那句口径拆成「裸 sleep」与「`await waitFor`」两半、两个执行者；
- **新增 §11.14.3**：`waitFor` ⇄ `expect.poll` 的边界（判什么 / 两条正当形态的判据 /
  一个回调两条断言的写法 / 「只认 import 事实」这条踩出来的口径）、
  §13.1 自查清单补上这一步。
