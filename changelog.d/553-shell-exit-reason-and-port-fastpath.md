## Fixed

- **双击启动仍报「启动失败」，而 `dev-launcher-stderr.log` 里只有壳的四行启动期 INFO**（ISSUE #553 后续）：壳侧的收尾证据此前只剩一个出口（`launch abandoned`），而这次连它也没有——壳活到托盘/watchdog 就绪后被强行收走（新实例的单实例检查 / 任务管理器结束 / 崩溃到写不出日志），三种成因在日志里长得完全一样，启动器的提示只能确认「壳一条收尾日志都没写」，仍然回答不了「谁结束了这次启动」。现在壳把另外两条事实也写进 stderr（都会随 python 启动器的重定向进 `log/launcher/dev-launcher-stderr.log`）：① `RunEvent::ExitRequested` 收到**非 0 退出码**时写 `exiting with non-zero code <N>`（壳主动以异常码收尾：被别的实例顶掉前的收尾、启动期崩溃）；② 单实例早退（`another instance of this checkout is running`）补一句「本次没有开窗口、已有实例被唤到前台」。`scripts/dev-launcher.ps1` 的 `Get-DownstreamExitKind` 据此补出第四分支 `shell-self-exited`，提示只陈述壳写下的判据并给出核对方式（若日志里还有 `another instance…`，说明这次双击只是把已在运行的窗口唤到前台，属设计内行为），不再替用户下「是你自己关的」这种结论；`shell-terminated` 分支保留「连一条收尾日志都没有 = 壳被强行收走，这次双击等于从未启动」的排他结论。回归测试见 `tests/dev-launcher-downstream-exit.test.ts`（含「壳侧正标记必须真实存在」的反向断言）。

## Changed

- **设置页打开后要等十几秒才显示「运行中」**（ISSUE #553 后续）：进程级快照的判据链在「实例就在配置/默认端口上」这个最常见形态下，仍要付 2~4 次 `Win32_Process` 全表枚举（本机每次 ~2.5s、超时上限 10s）。`comfyui/status.ts` 在判据链**之前**先探一次配置端口：有人应答即直接判「在跑」（`source=port`，`didQueryProcTable=true`）并跳过全部进程表查询——只认 localhost 的实例在运行时，监听端口已经把这个事实答出来了，再枚举一遍只是把同一句「在跑」等上几秒。端口上没人应答才照跑完整条判据链（外部实例的端口偏移不受影响）。回归测试见 `src/lib/comfyui/status.test.ts` 的「配置端口已应答 → 直接判在跑」一组。
