## Added

- **给 `docs/DESIGN.md` 装上执行者**（`tests/design-md-contract-sync.test.ts`，并进
  `scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS`）：契约正文引用了 41 颗裸
  `--color-*` 名、语义角色表里有 15 行 / 30 个两态取值，而 `docs/` 根级 `.md` **不在**
  `doc:check` 的遍历面上（`SCOPED_DOC_DIRS` 只含 `docs/standards` 与 `docs/guides`）——
  也就是「改了 token 的名或值、忘了改文档」一条判据都不会红，属规范 §13.5.8 的零执行者
  那一族。现在两格都机器核：① 引用面（文档引用的名字必须在编译产物里有声明，即
  §3.6.1.1②「幽灵 token」判据的**文档方向**）；② 取值面（单一 hex 的格子必须等于产物
  解析出的该态值，`同值` 按浅色档判）。取值一律走 `tests/helpers/theme-tokens.ts`
  真编译 + 解 `var()` 链，不读源码正则、不用 `getComputedStyle`。
  **为什么进固定清单而不是跟着改动面跑**：改 `docs/DESIGN.md` 不会被任何 import 图追溯到
  这份用例，而改 `.githooks/**` 时本层放弃收窄、只跑固定清单 —— 挂在受影响层等于让
  「下一次真正会漂移的那次提交」恰好跑不到它（#1372 同一课）。
  **判据不空转的三种证明**：用例内含「取到 0 条即红」的两条锚（引用数 > 20、表行 > 5）
  与三条负控制；另在真目标上做了两种变异 —— 把文档里 `#6b6b76` 改成 `#6b6b77` 只有取值
  那条红并点名 `--color-ink-muted light: 文档 #6b6b77 / 产物 #6b6b76`；把 token 名改成
  产物里不存在的 `--color-ink-mutated` 则引用面与取值面同时红。两种变异都已还原。
  顺带由这条判据查出并修掉一处真缺陷：契约「待定 4」原文写着 `--color-brand-gradient`
  这颗**从未存在**的 token 名（提建议的写法撞上了幽灵 token 的口径），已改为不点名的表述。
