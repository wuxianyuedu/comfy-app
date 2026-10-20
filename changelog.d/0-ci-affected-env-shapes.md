## Fixed

**同一格里两条红都是节点的形状，不是代码的结论**（ISSUE #2059；两个不同 sha 的构建各复现一次：
`cnb-jdn-1k5cg1e2m` / `cnb-966-1k5chdgbl`，都落在 `stage-9 受影响用例`）。这一格 2026-10-20 起
是「受影响用例」唯一的执行者（本地那两个执行者已被撤走），所以它一旦把环境读成红，
拦住的是每一条把这两份用例拉进受影响面的 PR。

- **① `tests/storybook-tsc-input.test.ts` 的「同卷」前提在 CI 节点上不成立。** 那一格造
  「缺了生成件」这个状态，靠把 `.storybook/generated/app-origin.json` **挪**进
  `node_modules/.cache/sb-generated-<pid>/`，而它自己的注释就写着「暂存点必须与仓库同一卷」——
  本地成立，节点上不成立：workspace 在 `G:\runner\…\workspace`，而
  `workspace\node_modules` 是指向 `F:\runner\ci-cache\comfy-app-t3\…\node_modules` 的链接
  ⇒ `renameSync` 直接 `EXDEV: cross-device link not permitted`。挪不动只表示**这一格没跑起来**，
  它判的「缺失态之下 tsc 退不退 0」一条读数都没拿到。
  修法：`moveFileAcrossVolumes` 先试 `rename`（同卷时最省，行为一字不变），只在
  `code === "EXDEV"` 时退成 `copyFile + unlink`（语义等价：原处不再有、暂存点有了）；
  **别的错误码原样抛**，不许被这条兜底读成「挪好了」。放回那一跳（还原生成件）走同一个挪法 ——
  那里同样是「暂存点 ↔ 仓库」两侧，跨卷时是第二条只会 EXDEV 的路。
  兜底在本机造不出跨卷（同卷 rename 一定成功），所以按形状替掉 `fs.renameSync` 补两条判据：
  EXDEV ⇒ 断言暂存点有内容、原处没了、且 rename 确实先被试过（取 `spy.mock.calls` 要排在
  `mockRestore()` **之前** —— 它把调用记录一起清了，排后面拿到 0，看起来像「rename 从没被试过」）；
  EPERM ⇒ 必须原样抛、两侧都不许出现文件。摘掉兜底只留一句 `renameSync` 复算 ⇒ 前一条当场红
  （`Tests 1 failed | 11 passed`），装回后 12/12 绿。
- **② `tests/core-barrel-entry-discipline.test.ts` 在并发探针上带栈崩掉。** 它的语料是
  walk 完目录再逐份 `readFileSync`，而 `tests/` 下有自造自删的探针（
  `.setup-cleanup-probe-*.test.tsx`）同时活动 ⇒ CI 上报的是
  `ENOENT …\.setup-cleanup-probe-15868-….test.tsx`，一句话都不指向本判据。
  修法不是在这里再写一个 `catch`：**这条竞态本仓已经有唯一一份实现**
  （`scripts/gate-scan-read.cjs`，十余个 `check-*.cjs` 都走它），于是遍历改走 `walkForScan`
  （它同时治「列目录时枚举本身消失」，老写法的 `statSync` 那一跳也有同一个窗口）、
  读取改走 `readForScan`，并按那层的第二条口径把**消失数进结论行**（`vanishedNote`）。
  老写法还吞掉过一件事：`readdirSync` 抛 ENOENT 时整个根被静默当成「没有输入」——
  现在补了根存在性断言（同一层「『根不存在』与『条目消失』是两回事」那条）：
  拿一个不存在的根复算 ⇒ 当场红「扫描根缺失 ⇒ 这一轮的语料是残缺的」，装回正常四根 3/3 绿。
  刻意**不**造「删文件的时机」当判据：那是一次概率窗口，而那层的判据已经钉住了
  `ENOENT ⇒ null` 这件事本身。
- 刻意没有动的两件事：暂存点的位置（`node_modules/.cache` 那处用途是既有约定，
  「同一处用途，不另造约定」那句话仍然作数）；以及 `testTimeout` / 并行度 —— 两条都不是
  时间型，重跑也不会变绿，抬预算只会把下一次同形故障藏得更久。
