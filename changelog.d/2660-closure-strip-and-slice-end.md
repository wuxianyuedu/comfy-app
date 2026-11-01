## Fixed

- **「跨平台启动编排」那几格反向断言此前判的是原文，而本仓的注释里就写着被禁的形状**
  （ISSUE #2660 的第四批收窄，对象 `tests/cross-platform-launcher.test.ts`）。
  这批动三处，都改完 36 条绿、`eslint` 退 0、`tsc --noEmit` 退 0。

  ### 一、先剥注释再判（10 个读入点）

  这一族的接收者里有现成的"红在文档上"形状 —— 不是我推测的：

  ```
  $ grep -rn 'process\.platform === "win32"' scripts/launcher-core/
  scripts/launcher-core/shell.mjs: * 写着 `process.platform === "win32" ? "pnpm.cmd" : "pnpm"`。那条判据在 Windows 上
  ```

  也就是说「编排器不许自己摸 platform」这条，拿着原文去判，会红在**正在解释为什么不该这么写**
  的那一行文档上。改法：新增 `readCode(rel)`（唯一实现 `./helpers/strip-comments` 的
  `{trailing:true}` 档）用在 9 处读入点，闭包那一处用 `stripJs(launcherChainSource())`，
  合计 10 处。

  **变异证明**：往 `scripts/dev-launcher.mjs` 追加一行
  `// 这里以前摸过 process.platform === "win32"，现在收在 launcher-core/shell.mjs 的 isWindows() 里` ⇒

  ```
  老那一版（原文去判）not.toMatch ⇒ 会红（假红：红在注释上）
  新这一版（剥完去判）not.toMatch ⇒ 通过（注释不算，代码里也确实没有）
  整份文件在变异在场时：Tests 36 passed | 1 skipped (37)
  ```

  **这批能做的前提是 ISSUE #2925**：旧那份剥注释实现会把真代码吃掉
  （`dev-launcher.mjs` 59 行 / `src-tauri/src/lib.rs` 50 行 / `build-desktop.mjs` 33 行 /
  `standalone-private-inputs.mjs` 33 行整行消失），所以这些接收者**当时**不许进剥注释面；
  #2925 落地（`8e70d135`）之后才允许。今天量下来这批**不改变任何判决**：那些反向 needle
  在剥前剥后命中都是 0 —— 它买的是"下一个人在注释里解释一句"不必被迫撒谎。

  **刻意没动的两份**：`scripts/dev-launcher.ps1` 与 `src-tauri/Cargo.toml` 仍是原文读。
  理由当场量过 —— JS 档剥 `.ps1` 前后**字符数完全相同**（2898 → 2898），即对 PowerShell
  等于没剥；而那一格自己的口径写着「判据是『不再调用』而不是『不再提及』：注释里说清
  以前用过什么是有价值的」。给它加 `#` 语法是另一件事 ⇒ **ISSUE #2934**（P3）。

  ### 二、`capabilities` 那一组从「手抄三份 + `continue`」改成目录派生

  原先是 `for (const cap of ["default","remote","splash"])` 配 `if (!fs.existsSync(file)) continue;`。
  一份 caps 被改名 ⇒ 那一轮静默少判一份，而"少判"与"三份都干净"的账面读数**逐字相同**。
  现在面从 `readdirSync` 派生，另加一格把历史那三份钉成锚点。

  **变异证明**：把 `src-tauri/capabilities/splash.json` 移出目录 ⇒

  ```
  AssertionError: 面里不见了 splash.json —— 「不许把执行能力透给前端」会静默少判这一份
  （目录派生的面只认得到的名字，改名 = 掉出去）:
    expected [ 'default.json', 'remote.json' ] to include 'splash.json'
  ```

  还原后 `sha1sum` 与快照逐字相同（`be386008…`）。

  ### 三、切片的**终点**原先不验，而这一族的三个接收者原先没有"不许是空文"

  - `launcherSrc.slice(start, launcherSrc.indexOf("\n}", start))`：起点那条早就有
    `toBeGreaterThan(-1)`，**终点没有**。取不到时给 -1，`slice(start, -1)` 就是
    "从实现起点到倒数第二个字符"—— 比整个函数宽得多，而那两条 `toContain` 照样成立。
    补上 `expect(end).toBeGreaterThan(start)`。
  - 新增一格 `这一族读的三个接收者都非空`，并加一条**关系型**断言（不写死数字）：
    闭包必须比 `dev-launcher.mjs` 单独一份剥完还大，且看得见
    `export function spawnExecutorHost(ctx)` 与 `export function maybeSpawnExecutorHost(`
    这两个内部分件的签名 —— `launcherChainSource()` 的递归一旦不再命中（改行动态 import、
    说明符换形态），闭包会静默缩成入口一份，那几组判据就退化成"只判入口"。
    **变异证明**：把 `scripts/standalone-private-inputs.mjs` 写成只剩一段注释 ⇒
    `AssertionError: 白名单那份剥完是空文: expected '' to not have a length of +0`。

  ### 一处**撤掉的**断言（写下来是因为它比留下的更能说明问题）

  我最初给切片加了一条"区间里只许有一个顶层 `export function`"当边界断言。拿字符串级模拟
  复算后撤掉了 —— 模拟读数：

  ```
  今天：区间 306 字符 · 顶层 export function 数 = 1
  模拟（把包装器自己的收尾改成缩进）：区间 1488 字符 · 顶层 export function 数 = 1   ← 不红
  ```

  也就是说区间放宽了 4.8 倍而那条断言**不红**，它守不住自己要守的东西。
  留下它就是把一个没验证过的形状当防护 —— 本批只保留有牙齿的 `end > start`，
  并把**判不到的那一形**（收尾缩进 + push 搬到后面的函数里）记在代码注释里：
  要覆盖它得做配对花括号或 AST 作用域，不在这一族里顺手做。
