## Fixed

- **夹具的判决话术不再糊进 vitest 报告（平台侧读日志的人会把它当成真跑的结论）**。
  立案现场是 `cnb-n1j-1k5ct202i` 第 9 格（受影响用例）：那一格 **32 格全绿**，
  而日志里刷着一整屏 `[affected-launch] 每核负载 10.00（阈值 1.5）`、
  `**第 2 遍**全绿`、`**第 2 遍**指纹已消失（不再是调度形态）…按真红处置`、
  `这批用例本次记为**未校验**`，外加
  `[e2e-run] ✗ 起不了 Playwright（…\no-such-playwright-runner）：失败码 ENOENT` 与
  `[commit-claims] 2 处声明与事实矛盾（… ad81a912）`。
  **没有一条是那次构建的读数** —— 它们是四个用例文件**故意**走失败路径时打出来的：
  `tests/hook-affected-launch.test.ts` 用假 `spawn` 把 `runChunk` 的整条判决链跑一遍
  （指纹是「入口 vitest.mjs，本块 2 个用例，命令行约 31 字符」—— 真跑的命令行不可能
  这么短）、`tests/e2e-run.test.ts` 起一条不存在的 runner 断言 `status: null`、
  `tests/check-commit-claims.test.ts` 真跑 `ad81a912` 断言判据判出反事实、
  `tests/a11y-axe-stories.test.ts` 渲染故意抛错的 story。
  而它们与真跑的输出**逐字同形**，于是「这一格到底红没红」只能靠退出码才读得出来
  —— 那正是本仓反复在收的那一族：「看起来像结论的噪声」。

  修法分两处，都是**接住子进程的 stderr**，判据一个字没动：
  - `tests/hook-affected-launch.test.ts`：抓取机制收成模块级**一处**
    `captureStderr()`（`runCapturing` 改为委托它），7 处 `runChunk` 与 3 处
    `waitForLoadToSettle` 的调用点全部走它 —— 原先只有一部分走了 `runCapturing`，
    漏的那几处正是日志里最像结论的那几段（真红 / 未校验 / 每核负载）。
    各写一份会漂成「有的调用点抓得到、有的抓不到」（§12.12 / §12.18）。
  - `tests/check-commit-claims.test.ts`：`execFileSync` 显式给
    `stdio: ["ignore", "pipe", "pipe"]`。**不给 `stdio` 时它把子进程的 stderr 直接接到
    父进程的 stderr 上**（Node 文档原文），那条用例的预期产物「2 处声明与事实矛盾」
    因此原样进了报告；接住之后它进断言用的 `out`，行为不变。

  顺带补一条**这类漏点的判据**：`tests/hook-affected-launch.test.ts` 末尾断言本文件里
  不许出现「直接 await `runChunk` / `waitForLoadToSettle`」那种写法 —— 上面每一条都是
  **自觉地**走 `runCapturing` 的，新加一条忘了走的时候没有任何断言会红，
  只有读报告的人会看到。针尖按拼接构造：整段写成字面量会让它命中自己（恒红，
  而恒红的判据比没有更坏 —— 下一个人学到的动作是「先把它删掉」）。

## 顺带确认的一条性质（不是这次引入的）

- 平台侧那次构建里 `.storybook/main.ts` 的
  `One or more extensionless imports detected: "./app-origin-defaults"` 是**刻意形态**
  （ISSUE #1409：生成件改成纯数据 JSON，类型与缺省值由入库的
  `app-origin-defaults.ts` 承担，扩展名由 patcher 补），
  `tests/storybook-tsc-input.test.ts` / `tests/storybook-config.test.ts` 两条判据钉着它 ——
  改成带扩展名会当场红。它留在日志里，但它不是「待修」。
