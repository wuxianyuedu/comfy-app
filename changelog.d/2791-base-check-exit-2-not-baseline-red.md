## Fixed

- **`base-check` 不再把「判据自己退 2」读成 `baseline-red`（ISSUE #2791）**。
  本仓门禁入口普遍是**三态**（`0` 绿 / `1` 事实红 / `2` 这一跳没有结论，且 2 压 1 ——
  同口径见 `check-daily-attendance` 的「退 2 不算绿」与 §13.5.25），而
  `scripts/base-check/verdict.mjs` 的 `judge()` 只看「非零」⇒ **2 与 1 在代码层面逐字同权**。
  当场现场（本检出，一条真命令）：

  ```
  $ node scripts/base-check.mjs "node scripts/ci-affected-tests.mjs"
  [base-check] 结论：baseline-red（本检出 2，origin/master @ 224a5a3d 2）
  [base-check] 基线那次输出的末尾：… ※ 这一档**不算绿也不算红** …
  ```

  两侧都是 2、被引用的那段输出自己声明「不算绿也不算红」，而结论是「别线的红」——
  后果不是难看，是**下一动作相反**：`baseline-red` 的处置是「就地修或按 §11.12 登记
  `KNOWN_FAILED_FILES`」，于是会把**一条从没判过的账**记进历史。这是 #2597
  （corepack 占位文件让每条 pnpm 形态的门禁退 **1** ⇒ 也被读成 `baseline-red`）的另一半：
  那一单修了「1 里有一种是环境」，这一单修「整整一档 2 从来没有入口」。

  改法（判语义不判码位巧合）：

  - `runState()` 的联合类型从三态变四态，新增 **`no-conclusion`**（`code === 2`），
    与 `did-not-run` **分开**是有内容的：前者命令跑起来了、是它自己答"没有结论"，
    后者是它没机会答。两者在 `judge()` 里同处置（都归 `inconclusive`），
    但**下一动作不同** ⇒ 报告必须说得出是哪一种。
    判序不变：**指纹优先于退出码**（`code: 2` 且带「一条用例都没收集到」指纹时仍报那一种）。
  - `didNotRunSide()` 认第三种形态，且两侧都是 2 时**两边都点名**
    （只报一句"没跑起来"会让人去查本检出的命令，而两边都没坏）。
  - `nextSteps("inconclusive")` 从「两种形态」变三种，并写出第三种的出口：
    **不是**修代码、**更不是**登记 `KNOWN_FAILED_FILES`，而是照它点名的前置清干净
    （例如环境里串进来的 `npm_config_*`）**再重跑这一次复算**。
  - 报告话术同批：`没跑起来：…` → **`没跑出结论：…`**（顶层与逐条那两行都改）。
    旧标签在第三形上是错的 —— 命令**跑起来了**。

  复述点一次订正（改了判据不许留旧话）：`scripts/base-check.mjs` 文件头那三处
  （五态表 / 优先级那句 / 整批结论那句）、规范 §13.6.2 的三处（五态表那一行、
  「它有两条入口」那张表 + 新增第三行与现场段、整批优先级那句）。
  查过**不动**的两处：`hook-steps.mjs:487` 与 `chained-steps.mjs:30` 那两句主语就是 127
  本身（「127 让 `judge()` 归 `inconclusive`」），没有过度声称，改它们是 churn。

  用例（`tests/base-check.test.ts`）：两侧 2 / 单侧 2 两个方向 ⇒ `inconclusive`；
  整批混着一条 2 ⇒ 压过那一批 `baseline-red`；`runState` 四态 + 判序；
  `didNotRunSide` 两侧都点名；话术里必须点得出「退 2」与 `KNOWN_FAILED_FILES`。
  ⚠️ **反方向对照**也钉住了：两侧都退 **1** 且无超时指纹 ⇒ 仍须 `baseline-red`
  （把「2 才算没结论」写歪成「非 0 都算」会把真·别线的红吞成没结论 —— 那比原来的错更坏）。

  顺带一条这一刀**照出来的东西**：`红的那几条基线上绿 ⇒ yours` 那条旧用例原来写的是
  `currentCode: 2` —— 那时 2 还没有含义，被当"任意非零"用。现在它是"没有结论"，
  那条用例于是红了，而红得对： fixture 换回真红 `1`，测试的仍是它自称的那一档。
  （同批跑过 `premerge-check` / `premerge-proof` / `quality-gate.ps1` 那三族消费者：63 条绿 ——
  `baseCheckMany` 走的是同一份 `judge()`，所以推送那一跳的段判也一起不再把 2 当红。）
