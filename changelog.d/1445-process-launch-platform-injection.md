## Fixed

- **`process-launch` 的 Windows 中介形态在 POSIX 宿主上零执行者，且那五条断言恒红**（ISSUE #1445 的第 0 件）。用例原先用 `Object.defineProperty(process, "platform", { value: "linux" })` 把宿主平台改成 POSIX 去跑那半边，`afterEach` 再按 `originalPlatform` 还原 —— 但那个 `originalPlatform` 在 POSIX 上取到的**本来就是 `linux`**，于是「Windows 中介形态」那一组的五条用例在 Linux/CI 上从来没有走到被测分支：实测 `spawn` 收到的是 POSIX 形态（`{detached:true, stdio:["ignore","ignore","ignore"]}`），而断言写的是 `powershell.exe` / 壳 CLI，五条全红。也就是说这一层「Windows 上到底能不能保住活」的判据在 CI 上等于不存在。
  - 修法 = 给 `spawnManaged` 加一个**入参** `platform?: NodeJS.Platform`（缺省 `process.platform`）作为 keepAlive 两条分支的判据，用例改成注入：两端机器判的是同一份输入，两个分支在任何宿主上都有执行者。注入的是**判据的输入**，不是把假信号发给真进程 —— 与 `executable-resolve.test.ts` 的 `posixHost()` 同一手法（那里已经写明改宿主平台这条路走不通）。
  - 变异核过：把判据退回 `process.platform` → 那五条当场红，其余 31 条全绿。
- 顺带把 `~/lib/process/**` 的覆盖率从「靠平台绑定撑着」的形态里拉回来：`process-launch.ts` 现在四维 100 / 98.21 / 100 / 100（此前 Windows 那一整段在 Linux 上按未覆盖记）。
