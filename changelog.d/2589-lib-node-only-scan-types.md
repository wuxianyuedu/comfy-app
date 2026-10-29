## Fixed

- **脚本档清账批 2：`scripts/lib-node-only-scan.mjs` 21 格一次清完，账从 294 处 / 21 份降到
  273 处 / 20 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是 §18.4「Node-only 三选一」
  那条判据的扫描器（`tests/lib-node-only-declarations.test.ts` 用它），此前它自己从没被
  类型检查过 —— 19 格 `TS7006` 是各函数的形参没写 JSDoc 类型。

  **剩下那两格不是「补类型」，是同一件事的两端**，所以按本单那条口径逐条看：
  `parseImports()` 里 `m[1]` / `m[2]` 直接进返回对象 —— 解出来的那一格是
  `string | undefined`（`TS2532` 报的就是这一位），于是它交出去的形状带着
  「`spec` 可能 `undefined`」，下游 `NODE_BUILTINS.test(im.spec)` 就是那格 `TS2345`。
  **在消费点写 `im.spec ?? ""` 会把这一格推到别处去**（每处调用点
  各兜一次底，而那两个捕获组在正则里是要求成立的、永远不为 `undefined`）。
  改法是**在产出那一名上把形状写实**：`parseImports` 声明
  `@returns {Array<{ clause: string, spec: string }>}`，两个 `while (exec)` 循环各用一次
  解构（`const [, clause = "", spec = ""] = m`）把类型检查器要的收窄交给它，
  运行期那条兜底分支永远不会走。这样 `TS2532` 与 `TS2345` 是**一格改动同时清掉**的。

  **行为没变，而且不是靠人说**：同一条命令在 HEAD 那一版与这一版各跑一次，输出逐字相同
  （`扫描 1144 个模块：顶层 import Node 内建 77 个（server-only 48 / .server.ts 9）` +
  `未声明（§18.4 三选一，应为 0 或已登记）：28` + 那 28 行名单）；
  它的用例 `tests/lib-node-only-declarations.test.ts` 5 条绿。
  本地其余读数：`tsc --noEmit` 0 处 · `check-scripts-typecheck` 面 210 / 存量 273 = 基线 273 ·
  `eslint --max-warnings 0` 绿 · `scripts-typecheck-ratchet` + `ratchet-update-guards` 22 条绿
  （后者认这本账的 `--update` 拒涨那一支，本笔只降了 21 格）。

  推进切法回到本单建议的那一条：**一文件一提交**（批 1 那八份最小的合一批，已在 #2589
  的评论里报备过）。
