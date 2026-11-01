## Added

- **`pnpm gates:which`：按改动面回答「该跑哪几条门禁 / 该跑哪份用例 / 该读哪一节规范」**（ISSUE #2765）。
  本地默认档只跑形态档 D0，于是「不知道该跑哪条」直接等于「推上去让平台告诉我红了哪格」
  （一次往返是分钟到十几分钟）。新入口对给定改动面打印三件事，**全部转述既有执行者的原值**：
  门禁分档取自 `.githooks/pre-commit` 的步骤行（`readHookSteps()` / `localTierLabels()`）+
  `ci-incremental-gates.mjs` 的收窄登记（`narrowingEntryForScript()` / `faceTouched()`，与平台
  `ifModify` 同一份 glob）、一键门禁档取自 `quality-gate.mjs` 导出的 `GATES`；用例那一半直接起
  `scripts/affected-tests.mjs --changed-stdin --json` 那条判决链（本入口不重算 import 图）；
  规范那一半读 `scripts/doc-reading-map.mjs` —— `AGENTS.md`「强制先读规范文档的改动范围」那张表的
  **机器可读副本**，两边由 `tests/gates-which.test.ts` 双向核对（范围名集合相等 + 数据里的章节记号
  必须出现在表里那一格），改一边忘另一边当场红。两条「按动作判断」的行（视图层新增 IO、抽共享模块）
  路径匹配不出来，**单列**在输出里，不因没命中而消失。
  边界逐条印在输出里：**「建议跑」不是「已跑」**（本地只有 D0，重档与受影响用例的执行者在平台）；
  用例是**静态 import 图**的增量面、不是全量凭证（§13.5.8）；**改动面为空 / 取不到基线 / 用例链
  读不到 / 不认识的旗标一律退 2 = 没有结论**，不落「什么都不用跑」。默认按当前分支相对基线取改动面，
  `--changed <路径…>` 给显式名单（改名旧侧要自己一并给出）。只读：不跑门禁、不写文件、不挂进
  pre-commit。判据在 `tests/gates-which.test.ts`（24 条：参数 / 脚本识别 / 分堆口径 / 用例链注入 /
  规范匹配 / 表与副本双向对账 / 入口三态）。
- **`quality-gate.mjs` 导出 `GATES` 并加直接执行守卫**：只有被 `node` 直接执行时才跑 `main()`，
  import 一下不会把整套门禁跑起来（判法取既有的 realpath 比较，ISSUE #1961）；`gates:which`
  因此能拿这张表当唯一口径来源，而不是抄一份档名。
