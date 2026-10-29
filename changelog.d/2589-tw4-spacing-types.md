## Fixed

- **脚本档清账批 15：`scripts/tw4-spacing-canonical.mjs` 10 格清零，账从 45 处 / 7 份
  （原 55 / 8）（ISSUE #2589 / 规范 §13.5.14.1）**：这份是「`min-h-[22px]` 这类任意值 px
  写法 ↔ spacing 倍数等价」那条硬闸的执行体。10 格表面是常规的一套（5 个函数形参、
  一个生成器 `TS7023`、三处下标读取），**但把类型指实的过程当场量出两件事**：

  ① **同一个数组在 `master` 上有三份互相不一样的声明**（`:92` / `:166` / `:193`）：
  `canonicalize` 的 `@returns` 说元素是 `{from, to, key}`，`rewriteText` 的 `@param` 与
  调用点的 `@type` 都说 `{from, to}`。合成一份 `Change` typedef 时 `key` **只能写成可选**
  —— 因为同值合并那一路（`:156`）压根不给它。于是「没有读者」这件事被显式暴露：
  当场逐个核过消费点（`:204` 只取 `from`/`to`、`:197` 与屏幕上那句「N 处」只取 `length`、
  `rewriteText` 只判 `changes.length > before`）⇒ **全文件没有一处读 `key`**。
  这与 ISSUE #2675（`note` 写进对象而从不念）是同一形的字段版，
  **另立 ISSUE #2717**（不在类型笔里顺手删字段 —— 那是改输出，不是改类型）。

  ② **同一条链上两个 `null` 不是一回事**：`canonicalize` 返回 `null` 是「这个 token 不该换算」，
  而 `rewriteText` 交给内核的 `null` 是「这一段没被改写过，原样保留」（幂等性靠它）。
  `rewriteStringContent` 自己则**永远返回字符串** —— 第一版顺手写 `@returns {string|null}`
  就是把这两个 `null` 混成一件事，按实现改回 `{string}` 才算如实。

  其余按既有口径：`read` / `loadStylesheet` / `canonicalize` / `rewriteStringContent` / `walk`
  的形参与返回（`walk` 又是 `TS7023`：`yield* walk(full)` 的递归，与批 7 那份
  `tw4-canonical-report.mjs` 同名函数同一形 —— **两份是各自实现的**（一份扫 `.css`/`.snap`、
  一份只扫 TS），不是抄漏了注解）；`canonicalize` 的三个捕获组在解构处给默认值
  （`key` 是下游分组用的槽位名，留 `undefined` 进去就是假分组）。
  **这是「补类型不是纯减法」的第七次现场**：把参数类型指实之后，`wSlots` / `hSlots`
  那圈循环里两次 `W_TOKEN.exec(pieces[i])` 新冒 2 格（隐式 any 期间从不报），
  同样在产生端收（取一次 + `undefined` 守卫），零格登记成已知存量。

  **顺带量到一条不属于本批的红，已立案不顺手修（ISSUE #2716，P2）**：本判据的 `--check`
  在 `master` 上有 **1 处**存量（`NodesTab.tsx:28` 的 `max-h-[480px]`，4px 一格 ⇒ `max-h-120`）。
  归属由 `scripts/base-check.mjs` 当场判：**干净基线上同样命中 ⇒ 别线的红**。
  它活得下来的原因也当场读出来了：这条判据登记在 `scripts/.gate-executor-ledger.json`
  的 **`onDemand`** 一节（只有 `why` / `who`，没有自动执行者）⇒ 「判据在场、执行者不在场」。
  **本批不动视图文件**（动它要 `--write` + `vitest -u` 重生成快照，是另一条凭据链）。

  凭据（三条都跑了）：
  ① 硬闸行为用例 `tests/tw4-hardgate-behaviour.test.ts` 串行 = **8 条全绿**
  （两半都覆盖：`tw4-canonical-report` 4 条 + `tw4-spacing-canonical` 4 条，含
  「注释里的示例不算候选（`--write` 也不会去改它）」与「`--update` 这个出口已不存在」）；
  ② **跨版本等价不是靠推断**：同一份输入上，master 那份（由 `base-check` 在干净快照里执行）
  与本分支这份给出的判定**逐字一致** —— 都是「待改写 1 处 / 1 个文件」且点名同一行
  `NodesTab.tsx：1 处`，`--check` 同为 `EXIT=1`；
  ③ `node --check` 通过、`pnpm exec eslint` 零输出；棘轮 `--update` 后复算 = 面 214 /
  存量 **45** / **7** 份。
