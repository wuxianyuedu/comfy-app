## Fixed

- **`E2E 关键流程` 跑到 36 分钟被墙钟 kill、日志零行**（ISSUE #1998，PR #1998 的 CI 红）：
  平台侧 `cnb-m0t-1k54oljem` 那一跑的读数只有一行 `timeout of 2160000ms exceeded`，
  连 `e2e-run` 自己的前置读数都没有。真因不在判据，在**取证链的缓存位置**：
  `scripts/e2e-run.mjs` 用 `spawnSync(process.execPath, [entry, …], { stdio: "inherit" })`
  起 Playwright，而 `spawnSync` 的「同步」意味着它**必须**自己收着子进程的输出 ——
  `inherit` 只继承 fd，`res.stdout` 照旧攒一整份，而本文件从不读那个字段。被 kill 时
  那份缓冲随进程一起消失（与 §13.5.3 第十二处同形、不同层：那一处是外壳攒到 `close`
  才发，这一处缓存落在调用方）。
  起法换成 `spawn` + `inherit`，落在新文件 `scripts/e2e-run-playwright.mjs`
  （`resolvePlaywrightInvocation()` / `runChild()`，唯一出处；`e2e-run.mjs` 再导出，
  既有调用方不用改）。同批把开跑前的读数（端口 / Python / schema / 浏览器）从
  「算一条打一条、夹在几条短路 `return 2` 之间」收成 `runPreflightReadings()` 一步 ——
  **拦之前先把已算出来的说出口**，判据一个字没搬。
  ⚠️ 拆文件不是风格：`scripts/e2e-run.mjs` 加上这两半后越过 900 行硬闸
  （`check-infra-file-size.cjs`，存量已清零、无基线可登记），出口只有拆。
  判据：`tests/e2e-run.test.ts` 新增 10 条（起法判形状 —— 这一格在 Linux 上跑一遍
  是看不见的；编排判顺序与第一条阻断生效），接线三条既有判据的落点跟着改到新的
  起法那一跳。

- **e2e 的并发档：`CI` 档不再「用 Playwright 默认」**（同 ISSUE，那 36 分钟的另一半）：
  `playwright.config.ts` 的 `resolveE2eWorkers()` 此前在 `CI` / `PNPM_START` 那一档回
  `undefined`，理由写的是「生产构建下首屏零编译，并发不是自由度」—— 而并发不是**编译**
  的问题，是「这台机同时开几个浏览器 + 几个 worker」的问题：默认 `cpus - 1`，16 核节点上
  就是 15 个 worker + 两条 webServer + `fullyParallel`。
  现在两档都收敛到 2（上界来自 #1834 的实测档），并按现场核数
  （`CNB_CPUS` → `os.availableParallelism()`）取 `max(1, min(2, cpus - 1))`。
  `timeout: 60_000` 一个字节没动 —— **降的是负载，不是预算**（§11.13）。
  判据：`tests/e2e-runtime-budget.test.ts` 的并发档那组（含「小机器不开 2」「不合法
  核数不静默变成 0」「`CI` 档也说得出并发」三条新用例，以及那条 `timeout` 红线）。
