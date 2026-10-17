## Fixed

- **`lock.cancel-in-progress` 的默认 key 在 PR 上退化成「全仓共用一把锁」**（ISSUE #1981）：
  平台默认 key 是 `分支名-流水线名`，而 `pull_request` 事件下 `CNB_BRANCH` 取的是**目标分支名**
  （官方 `build-in-env.md` §CNB_BRANCH：「合并类事件 → 目标分支名」）—— 于是「分支名」这一半
  在所有 PR 上恒等于 `master`，`cancel-in-progress: true` 实际是「**全仓只留最新那一跑**」：
  任意两条并行 PR 互相掐停（现场：PR #1980 掐掉了 #1982 那条）。代价不是「慢」，
  是**白跑一整条**，而且被掐的那条连失败原因都不会留下。
  修法不是关掉 `cancel-in-progress`（那会退回 #1961 那条「几条全量流水线挤一台机、
  三条一起冻结」），而是把 key 写出来：`.cnb.yml` 的 `.common.lock` 现在显式声明
  `key: pr-$CNB_PULL_REQUEST_IID` —— PR 上 ⇒ `pr-<PR 编号>`（每个 PR 互不相同，同一 PR 里
  连推几个提交仍落回同一把锁），`push` 上 ⇒ `pr-`（该变量在非合并类事件上无值，而这一档
  只有一条流水线，「一条就够」）。依据两条都在官方文档里：`lock.key` 在 `build/env.md`
  「支持变量替换的属性」表中被点名支持变量替换；`CNB_PULL_REQUEST_IID` 见 `build-in-env.md`。
  **刻意不用** `CNB_BRANCH`（正是它会退化成目标分支），也**不用** `CNB_PULL_REQUEST_ID`
  （跨仓全局 ID，粒度比这里需要的粗）。

## Added

- **上面这件事现在有判据**（同一 ISSUE）：`tests/no-platform-ci-config.test.ts` 新增
  `pipelineLockKeyTemplate()`（摘 `.cnb.yml` 里那份 key 原文，没写 ⇒ 判红）与
  `resolveLockKey()`（把变量**真代进去**算平台会得到的 key —— 只看原文判不出「两条 PR
  会不会撞」）。三条断言：只能用白名单里的变量、两条不同 PR 的 key 必须不同、同一 PR 的
  key 必须相同。**反向复算实测过两种红形态**：删掉 `key` 那一行 ⇒ 判据点名「全仓所有 PR
  共用一把锁」；换回按目标分支的 `$CNB_BRANCH-质量门禁` ⇒ 白名单那条当场点名。
  口径与「为什么不按事件写两份 lock」的取舍写进规范 §13.5.3.9。

- **E2E「打开查看」那三条红在等的是一句**「明明已经在屏幕上」**的文案**（ISSUE #1981 的 CI 现场）：
  `openComfyControlPage()` 用 `getByText(/ComfyUI 运行中/)` 当「状态已落地」的判据，而这个
  判据有两处结构性问题 —— ① 匹配集**首帧是空的**（内容是客户端查回来的），`.first()` 在空集
  上的每一拍都落空；② 文案一出现，`.first()` 指到的是**跨元素**分布的那个节点
  （`ComfyUI 运行中（<base>）·<via>`，地址那段可能单独成盒），「匹配到」与「整体可见」之间
  隔着一次补间，实测会读到 `visible=false`，再取句柄时撞上 `Protocol error:
Runtime.callFunctionOn: … session closed`。于是红成「等文案超时」，而现场里那句文案好端端地
  在屏幕上（CI 日志里 `x 21 / x 29 / x 30` 三条、三跑全红）。
  修法是给它一个**不读文案分布**的锚点，而不是加预算：状态那句补上活区语义
  （`role="status"` + `aria-live="polite"` —— 状态变了自己会刷，读屏本来就该跟着播报），
  E2E 侧改成等这个节点的**文本**（`toHaveText(/ComfyUI 运行中/)`）。
  **第二次踩的坑一并记在代码里**：只等「状态行节点可见」是**过度修正** —— 那个容器首帧就在
  （内容没回来时写的是「ComfyUI 未运行」），判据当场成立，而「打开查看」此时仍是 `disabled`，
  后面那一击就点在被禁用的按钮上，红换成 `locator.click: element is not enabled`。
  文案一个字没改，仍由 `comfyui-control-config` 与 `ComfyuiControlView.test.tsx` 钉着
  （同批新增一条：这句必须是活区且以「ComfyUI」开头，属性掉了那条链路就会退回不稳定的形态）。
