## Fixed

- **`master` 上 `tsc --noEmit` / `eslint` / 全量单测同时红，根因是一个合并把三批已落地的改动整片回退**（ISSUE #1282）。干净检出上 `pnpm check:all` 在 `Typecheck` 与 `ESLint` 两步就拦下，红的是 `tests/task-list-wire-contract.test.ts` 引用的 **4 个已经不存在的导出**：`videoTaskRowSchema` / `parseVideoRows` / `videoRowSchema` 系与 `historyTaskRowSchema`。
  - `ad81a912`（「复算基线 + 按需档索引」）的合并解析把 `src/lib/media/video-queue-client.ts`、`src/lib/project-canvas/history-panel-client.ts`、`src/server/api/routers/task.ts` 三份**回退到了 `695438b2` 之前** —— 而 `695438b2`（#1579「修掉镜像声明了线上从来不发的列」）加的正是这三份的导出 + 服务端 `videoPath` + 契约判据。**判据留着、被判的东西被退掉**，于是 21 条契约用例一起红。
  - 同一个合并还**静默删掉两条钩子步骤**：`check-click-keyboard.cjs`（`c3feb00a` / #1498）与 `check-deps-freshness.mjs --staged`（`17d6ead0` / #1569）—— 两处都是「两侧都在 D 组末尾追加了一条」，合并时取了单边。表现是 `check-gate-executors.cjs`（判据「判定型不许无执行者」）当场点名这两条，而**判据本身还在、只是没人跑它**。
  - 同一批还把 `c3feb00a` 的 a11y 收口**从组件侧退回**（`HistoryTaskCard` 主体块 / `MessageCenterPanel` 消息行 / `MultiModeSelect` / `AttributeMultiSelect` / `DebugChainFooter`）而行为用例留着 —— 4 条键盘可达性用例红，`check-click-keyboard.cjs` 的棘轮当场数出 3 处新增。
  - 修法 = **把这三批按各自的源提交取回**（不回退、不重写）：`#1579` 的三份源 + 三份夹具的 `videoPath`、`#1498` 的五个组件（其中 `multi-mode-select.tsx` 需重放 `9be1fe0e` 的 `text-[13px]` → `text-sm`，否则 typography 棘轮红）、`#1569` / `#1498` 的两条钩子步骤（并同步 `D(N)` 与 §13.1 清单）。
  - 三批的合并态都已用**各自的反向判据**自证：契约 21 条、`check-click-keyboard.cjs` 归 0、`check-gate-executors.cjs` 57 有执行者 / 0 无执行者、`doc:check` 三向一致、键盘可达性 5 条。
  - ⚠️ **这条留了个教训**：`ad81a912` 的提交信息自己写着「四处冲突均为『两侧都动过同一段』」，而**真实被丢的是不相邻的内容**（钩子末尾两条 `run` + 五份组件 + 三份源）。合并解析只看冲突块是不够的 —— 判据全绿不等于没丢东西，因为**丢掉的往往正好是那些判据所在的行**。

- **全量单测的退出码被一条 unhandled error 打非零，而所有用例都是绿的**（ISSUE #1282）。现场是 `ReferenceError: window is not defined`，出自 React scheduler 的一条 `setImmediate` 回调 —— 它落在 jsdom 环境被拆掉**之后**。根因不在任何一份用例里：`@testing-library/react` 的自动清理只在 `typeof afterEach === "function"` 的**那一刻**注册，而本仓库 `globals: false`（`vitest.config.ts`）⇒ `globalThis.afterEach` 是 `undefined` ⇒ `cleanup` **从不注册**（实测 `globalThis.afterEach === undefined`）。于是挂载的组件从不被卸载、跨用例残留，scheduler 的活在环境拆掉后落地。
  - 修法 = **地基补在 `tests/setup.ts` 一处**（§12.18）：`afterEach(() => cleanup())`。`cleanup` 幂等、对不渲染的 node 用例零代价；而要求全仓 169 份用 RTL 的用例各自手写一行，正是这套机制当初失效的形态（仓里此前已有两份各自补过）。
  - 判据 `tests/global-setup-cleanup.test.ts`（进 C 组固定清单）：**真起一份探针用例**去跑，判「前一条挂的组件在下一条里已经不在」。**不纯文本判** —— 「`setup.ts` 里出现过 `cleanup`」与「清理真的注册上了」是两件事，前者在把注册挪进一个永不执行的分支里时照样为真（正是它当初的死法）。探针文件写在 `tests/` 树内：两个 project 的 `include` 都是 `src/**` / `tests/**`，树外文件会被 `No test files found` 过滤成假绿。变异核过：去掉注册 ⇒ 该条红。

- **`src/lib/log/capture-streams.server.test.ts` 的「按 mtime 取最新」用例串行也闪**（ISSUE #1282）。夹具在 `freshInstall()` **之后**用 `Date.now()` 当 mtime 摆两份文件，而 `installStreamCapture()` 自己就在同一个 `tmp` 里建了本次运行那一份（`nextjs-panel-<pid>-<时刻>.log`）——它的 mtime 与 `Date.now()` 只差**亚毫秒**，谁大取决于「`utimesSync` 取时刻」与「模块写文件」谁先落地。
  - 这**不是产品缺陷**：`latestPanelLogFile` 正确地返回了真正最新的那一份；错的是夹具没把模块自建的那份算进去。实测的失败现场里返回的 pid 是**真实进程 pid**而不是夹具的 `12345`。
  - 修法 = 夹具在 install 之后**清场再摆**，两份文件按明确的时间差写进空目录，「谁是最新」由夹具自己决定、与调度无关。实测 8/8 绿（改前在本机全量跑下 ~1/3 失败）。
  - **定性手法留在用例注释里**：这类「串行也红」不是预算问题，`--no-file-parallelism` 隔离重跑才是判红的第一步（§11.13）。

- **`master` 上 `check:all` 必红：依赖审计棘轮两条 `critical`（`handlebars`）**（ISSUE #1282）。advisory 库更新后新出现的两条（`#1241677` / `#1241678`，受影响范围 `>=4.0.0 <=4.7.9`）命中的是 lint 工具链里的传递依赖 `eslint-plugin-boundaries > @boundaries/elements > handlebars`。
  - 现场是**回填**：此前已有一条 `'handlebars@4': '4.7.10'` 的 override，被上游改动整条删掉之后版本落回 **4.7.9**，而新 advisory 的范围恰好把它包进去 —— 同一处被填了两次、删一次就复发。
  - 修法 = 按 `§13.5.9` 走出路 ①（有最小可达修复版就别登记进基线）：把 `'handlebars@4': '4.7.10'` 加回 `pnpm-workspace.yaml` 的 overrides，并在注释里写清「这条是回填、删 override 等于把修复一起删掉」。
  - 实测：`check-dependency-audit.mjs` 改前 2 条红 → 改后 ✓ 无基线外新增；`pnpm why handlebars` 只剩 1 个版本；`pnpm install` 无 `ERR_PNPM_IGNORED_BUILDS`；lockfile 改动只含 handlebars 相关行。**在干净基线 worktree 上复算过同样红**（§13.6.2），不是我引入的。

- **`tests/daily-tracks.test.ts` 的「空行分隔」用例拿『两笔背靠背提交时间相等』当判据**（ISSUE #1282）。`%cI` 的精度是**秒**，而夹具是两次连续 `git commit` —— 它们只在**恰好落在同一秒**时才相等，跨秒就红（实测：全量并行档偶发，隔离重跑必绿）。那量的是机器调度，不是状态机。改成判**顺序关系**（`src/` 先提交 ⇒ 不晚于 `scripts/`），而「空行没把 `stamp` 提前清掉」这条边界照样被钉住（stamp 被提前清 ⇒ 两边都 null）。变异核过：把状态机改回「遇空行清 stamp」⇒ 该条仍红。

## Docs

- 规范 §11.17.6（新增）：全局 setup 的 RTL 逐用例卸载 —— 「注册在那一刻的 `if` 里」的失效形态、为什么修法在地基、以及判据为什么必须**真跑探针**而不能纯文本判。
