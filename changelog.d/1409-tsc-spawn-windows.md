## Fixed

- **`tests/storybook-tsc-input.test.ts` 在 Windows 上恒红：它 `spawnSync` 直接执行包里的
  bin 路径，而那个路径是 pnpm 落下的、没有可执行位的 JS 壳**（ISSUE #1409 那刀的跟进）。
  后果不是「报了一条错」，而是 `status: null` + `stdout`/`stderr` 全空 —— 于是
  **「tsc 报了 TS2307」与「tsc 一个进程都没起来」在断言里长成同一个形状**，而
  `resolveTscBin()` 把 `r.error` 丢了，所以话术里那句「实际输出：」后面是空白。
  这条躺在 `FIXED_STRUCTURAL_TESTS` 里 ⇒ 拦住的是从这份基线分出去的**每一次**提交
  （组 C 固定清单，与改了什么无关），而 #1409 本体（注入层不再静态 import 生成件）
  在 Linux 形态下是好的，所以只有 Windows 检出会撞到。
  修法 = 照本仓既有口径经 `process.execPath` 起（`spawn(process.execPath, [bin, …])`），
  并把 `error.code` 一并写进 `output` 备用定性。
- **读数**：改前 `2 failed | 5 passed`，两条红的收口形态都是 `status: null` / 输出空；
  改后 `7 passed`。**「进程没起来」与「tsc 真跑了」的区分证据**：本文件自带的那条反证
  （在临时目录里造一个静态 import 缺件的最小复现）改前拿到的是空串、改后拿到真的
  `TS2307` —— 这条用例从「假绿的空转」变回「有执行者的反证」，本身就是修好了的证明。
- **修好启动之后暴露的第二格：④ 的预算**。直接 spawn 起不来时那两次调用是**秒失败**的，
  所以「跑全仓 `tsc --noEmit` **两遍**」这个成本从来没被发现；改成 `process.execPath`
  之后 ④ 实测单跑 **10.8~15.1s**，在组 C 的池子里（本块 28 份并发）直接
  `Test timed out in 30000ms` —— 串行绿、池子红，属预算与 `maxWorkers` 那一族。
  **没有抬超时**（那是掩盖成本），而是去掉第二次全量编译：它原本承担的活是
  「证明上面那次不是 tsc 根本没跑」，而 ① 仓库 A 组每次提交都在跑同一份
  `tsc --noEmit`，那是重复劳动；② 这件事现在由一次 `--version` 证（成本 0.5s），
  并且失败消息里带着 `[spawn-error] ENOENT`，「进程没起来」不再伪装成绿。
  ④ 独有的断言只剩「**缺件**那一次退 0」，实测 **15.1s → 7.2s**，池子里整钩子通过。
- 顺带一条自打与一个真实的工具分歧：本次修改的第一版把 `r.error.code` 直接写出来，被
  自己刚修的这条判据的 ④ 拦下（`tests/storybook-tsc-input.test.ts(305,49): error TS2339:
  Property 'code' does not exist on type 'Error'`）—— 因为 ④ 跑的是**全仓 `tsc --noEmit`**。
  而改用 `as (Error & { code?: string })` 收窄之后，eslint 的
  `@typescript-eslint/no-unnecessary-type-assertion` 又说「这个断言没改变类型」。**两侧结论
  相反**，我没有去判哪边对（那需要另一整套关于 `SpawnSyncReturns<T>` 在 `encoding` 重载下
  `error` 到底窄化成什么的取证），而是绕开：`String(r.error)` 本身就带 `ENOENT:` 字样，
  定性够用、两边都满意。这条分歧本身值得记：**在 `.code` 上 tsc 与 eslint 当前不同源**，
  以后谁要真取 `code` 先量一遍两侧。
