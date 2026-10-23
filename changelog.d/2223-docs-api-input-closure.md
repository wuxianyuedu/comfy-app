## Fixed

- **`docs/api/**` 的收窄面罩不住真正的输入面 ⇒ 静默漏判**（ISSUE #2223）：平台侧那一格
  （`API 文档生成物与源同步`）的 `ifModify` 触发面原先只有三根（`src/lib` /
  `src/server` / `src/trpc`），判据的文件头当时写着「这**不是启发式收窄**，是『产物只由
  这些输入决定』的直接映射」—— **那句话是错的**：typedoc 沿 import 走，三根之外的文件
  也会进产物。现场：`BackupResult` 定义在 `scripts/db-backup-core.mjs`，被
  `src/lib/db-backup/backup.ts` 导入，它出现在
  `docs/api/functions/lib_db-backup_backup.createBackup.html` 里 ⇒ 改那份 `.mjs`
  **会改产物**，却**不在**触发面内 ⇒ 那一类改动永远不会被判到，而漏判是静默的
  （被 `ifModify` 跳过的形态与「判过且通过」在读数上无差别）。
  - **面** = 三根 ∪ **闭包叶子集**（实测 11 个根外文件，其中 10 个原先不在面内）。
    叶子集**不是手抄的**：新增 `scripts/docs-api-input-closure.mjs`，从 `typedoc.json`
    的 `entryPoints` 导出根、沿静态 import 走出传递闭包（typedoc 的 `exclude` 与
    entryPoint 里的 `!(*.test)` 都生效 ⇒ 测试文件不是入口点）。
  - **声明侧**在 `scripts/check-docs-api.cjs` 的 `CLOSURE_LEAVES`，**事实侧**在闭包
    模块；两侧由 `tests/docs-api-input-closure.test.ts` 双向对账 —— 闭包多出任何一个
    文件而面里没有它 ⇒ 当场红；面里声明的条目若已不在闭包里 ⇒ 同样红。
  - **兜底判据换掉了**：原来那条只比「窄面的第一段前缀是不是落在某条 glob 里」，于是
    `scripts/db-backup-core.mjs` 的前缀 `scripts` 被 `scripts/check-docs-api.cjs` 那条
    满足 ⇒ 任何 `scripts/` 下的新文件都算「已覆盖」。现在核的是**真「罩住」**：
    窄面命中的每一个文件都要被某条 glob 真的罩住（枚举办法是从每条正则里取出它锚定的
    字面前缀，把那个前缀下的文件逐个过）。
  - `.cnb.yml` 那一格的 `ifModify` 同步补齐那 10 条叶子（**别手加** —— 名单不是手抄的，
    加错了没人知道，那正是本 ISSUE 的由来）。
- **规范 §13.5.20 订正**：那段把收窄面称作「产物只由这些输入决定」的地方，补上了订正
  与处置，并留下一条教训 —— **一份收窄面必须有一份能算出来的事实与它对账**，否则它只是
  一串手抄的 glob，而手抄的那份永远比真相窄（真相是闭包，手抄的是入口点）。

## Added

- **`scripts/docs-api-input-closure.mjs`**：`docs/api/**` 输入面的传递闭包（事实面）。
  说明符解析复用 `scripts/affected-tests.mjs` 的 `specifiersOf`、glob 匹配复用
  `scripts/vitest-projects.cjs` 的 `globToRe` —— 不造第二套 import 解析与 glob 引擎。
  直接执行会打印根与叶子清单。
- **`tests/docs-api-input-closure.test.ts`**（进固定清单）：判「面 ⇄ 事实」。它必须在
  每次提交里跑 —— 触发它的改动是「某个 `src/lib` 下的模块新 import 了一个根外的文件」，
  那条改动不在它的静态 import 图里，只在受影响时才跑等于让它随下一次新增 import 过去。
