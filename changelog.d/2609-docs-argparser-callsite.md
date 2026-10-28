## Fixed

- **`#2585` 那一批删了 `value()` 的形参、没改两处调用点 —— `scripts/generate-api-docs.mjs`
  带着 `TS2554` ×2 落进了主干（ISSUE #2609）**：`pnpm run docs` 的 `--out <dir>` /
  `--attempts <n>` 解析里，`opts.out = value("out")` 与 `Number.parseInt(value("attempts"), 10)`
  两处给一个**不收参数**的函数传了实参。JS 里多传实参不报错 ⇒ **运行期没有任何症状**；
  红只出现在类型层，而那一层此前看不到这个文件（它从没被任何入口 import，主
  `tsconfig.json` 的 `include` 里也没有 `**\/*.mjs` —— 见 ISSUE #2524）。

  读数不是印象：合并 `origin/master` 之后，ISSUE #2524 那条新判据当场报出两格**新增**并拒绝放行

  ```
  $ node scripts/check-scripts-typecheck.cjs
  [scripts-typecheck] 实跑：program 内 939 份文件，脚本档报错 312 处 / 29 份文件
  [scripts-typecheck] ✗ 脚本档新增类型错误 / 死代码（ISSUE #2524 / 规范 §13.5.14）：
      · scripts/generate-api-docs.mjs TS2554: 基线 0 → 当前 2（新增 2 处）

  $ node node_modules/typescript/lib/tsc.js -p tsconfig.scripts.json --noEmit --pretty false
  scripts/generate-api-docs.mjs(61,71): error TS2554: Expected 0 arguments, but got 1.
  scripts/generate-api-docs.mjs(63,39): error TS2554: Expected 0 arguments, but got 1.
  ```

  修法是**两处调用点去掉多余实参**（`value()`），而不是把那个形参加回去：形参之所以被删，
  是因为它确实没被读过（`arg` 已经决定了行为，名字只是给人看的），加回去就是让
  `#2585` 那条 lint 收编再响一次。行为一字未变。

  **这一格是 #2524 那句「面不收口，这类东西不是偶尔漏掉、是永远读不到」的第二例**
  （第一例是 `quality-gate.mjs` 的 `fail()`，#2588）。它也解释了为什么 #2524 坚持把
  `.mjs` 全量收进判决面：`#2585` 那一批的 84 条死代码清零是**对的动作**，而一次形参删除
  在整个仓库里没有任何一条既有判据会红 —— 除了这次新加的那条。

  顺带（同一次合并读出来的，不另开单）：`#2585` 把 `TS6133`（声明了没用到）那一类在
  `scripts/**` 里清干净了，所以脚本档账本的实测从登记时的 **320 处 / 31 份** 收到
  **310 处 / 29 份**，`TS6133` **账上 0 格** —— 这一档从一开始就不给死代码留额度。
