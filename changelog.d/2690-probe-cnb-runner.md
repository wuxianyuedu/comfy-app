## Fixed

- **`ci-probe-lock-readout.mjs` 起平台 CLI 改走现成那一格：本机从「一段 Node 栈」变成「一行读数」
  （ISSUE #2690）**：立案当时的读数——`node scripts/ci-probe-lock-readout.mjs report <仓库> <sn>`
  在 Windows 开发机上 `EXIT=1`，屏幕上只有 `Error: spawnSync cnb ENOENT` 加七八行栈。
  根因是两处叠起来：① `readBuild` 的 `execFileSync("cnb", …)` **不在 `try` 里**
  （那个 `try` 只盖 `JSON.parse`），② `spawnSync` 在 Windows 不按 `PATHEXT` 找 `.CMD` 垫片，
  而本地 `cnb` 正是 pnpm 目录里的垫片（实测把 `node_modules/.bin` 加进 PATH 也一样）。
  平台那一档不受影响（容器里 `cnb` 是真身），所以这一格从来不在 CI 读数面上——
  「红了也没人看见」正是它活到今天的原因。

  按硬规则 24 复用现成实现：`scripts/ship-exec.mjs` 的 `makeRunner()`（它经
  `pnpmInvocation(args, { name: "cnb" })` 起得来，且**把起不来变成一个读数**
  `{ status: -1, error: "ENOENT" }`），三个取数点（`readBuild` / `readRunWindow` /
  `startProbe`）一起收进新增的 `cnbCall()`。**刻意不用**同一份模块里的 `cnbJson()`：
  它把「ENOENT / 响应里没有 `{` / 解析失败」三种折叠成同一个 `null`
  （`ship-exec.mjs:131 / :134 / :143`），而本件要的恰恰是分清这三种——每种下一动作不同；
  用它修等于把崩溃换成静默。取不到的那句原因经 #2675 立起来的 `formatReadingRow()`
  念在结论同一行上。

  写动作那一侧保持响亮（`startProbe` 仍抛，但抛的是「cnb 起不来：ENOENT」而不是栈），
  且退出码 0 依旧不被读成「发出去了」——`sn` 仍独立回读（ISSUE #2436 那条纪律一字未改）。

  凭据（四条都跑了）：
  ① 新用例 `tests/ci-probe-cnb-runner.test.ts` **7 条** + `tests/ci-probe-note-readout.test.ts`
  **4 条** = 11 条全绿；
  ② **变异实测**：把 `cnbCall` 里 `r.error` 那一支压成 `{failure:"",text:""}` 之后
  **4 条转红 / 3 条照常绿**，还原后 11 条复绿。第一版用例只注 `readBuild` 的取数出口时，
  同一个变异**照旧全绿**（它绕过了映射发生的那一层），所以出口开在 `cnbCall` 的第二个参数上——
  判据必须打在中点上，否则等于没有判据；
  ③ 真机复跑同一命令：`EXIT=0`，打出
  `[probe] cnb-mrl-1k63djhsi status=success create=2026-10-29T08:49:42.000Z end=2026-10-29T09:07:43.059Z title=…`；
  ④ `pnpm exec eslint` 对三份文件零输出；脚本档 tsc 复算仍是 **170 处 / 15 份**（本笔零新格，
  没有借 `--update` 登记任何东西）。
