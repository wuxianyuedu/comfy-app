## Changed

- **`it.each` 存量收口到 0，并给「已全部收口」这句话一个执行者（ISSUE #1498，第 3 批）**：
  §11.15 那句「本仓库已全部转换完，63 处」**没有执行者在守** —— `scripts/check-*.cjs`
  里一条都不认识 `it.each`（`grep -c each scripts/check-*.cjs` = 0），CI 又随 ISSUE #623
  删除，于是规范里的那句话是它唯一的执行者，而规范文本不会自己响。

  实测：`c9f349ca` 收口 63 处之后，`.each(` 又长出 **2 处**，且都是那句话之后的产物：
  - `tests/tw4-canonical-ratchet.test.ts` 的 `describe.each` —— 收口那轮**只扫了
    `it.each`**、把它漏在门外；
  - `src/components/studio/ViewTabStrip.test.tsx` 的 `it.each` —— PR #1558 新写，
    就在收口之后四天。

  两处一并转成 `it.for` / `describe.for`（元组由回调自己解构 + `as const`，
  按 §11.15 的写法）。这与裸 `sleep`（20 → 38）、`waitFor`（206 → 211）是同一种病：
  **口径写在规范里、数字漂在盘点里，中间没有执行者**。

## Added

- `scripts/check-test-it-each.cjs`（接进 pre-commit 的 D 组，并自动被
  `check-gate-executors.cjs` 的盘点面认到）：判**净数不许涨**（棘轮
  `scripts/.test-it-each-baseline.json`，只许降；`--update` **拒绝**把数字往上涨）。
  三条口径细节：
  - `it.each` / `test.each` / `describe.each` **一视同仁** —— 按名字收窄就会漏
    （`describe.each` 就是这么活下来的）；
  - 只认**从 `vitest` 导入**的宿主名字，本地同名 helper 整文件跳过（认 import 事实、
    不是名字，同 §11.14.3 的 `waitFor` 口径）；
  - 夹具字符串与注释里的 `.each(` 由 `maskNonCode` 挡住，判据自己的夹具登记
    `FIXTURE_SKIP`（§11.14.2）。

  纯文本扫描 624 份用例约 **0.3s**、零网络、零子进程（照 §13.5.4 该进钩子）。
- `tests/test-it-each-gate.test.ts`（10 条，进 `FIXED_STRUCTURAL_TESTS`）：跑真脚本 +
  只放被测文件的临时仓库，逐条钉判定口径 —— 该拦的（三种宿主 / `--update` 上涨）
  与该放的（棘轮内 / 本地同名 helper / 夹具字符串 / 夹具文件）。

## Docs

- 规范 §11.15 开头那句「本仓库已全部转换完，63 处」改为指向判据执行者；
  **新增 §11.15.1**（收口有执行者：判什么 / 三条口径细节 / 成本），
  §13.1 自查清单补上这一步。
