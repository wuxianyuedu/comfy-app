## Fixed

- ComfyUI 保活模式退出监督：进程表查询超时（机器忙、ComfyUI 出图时 PowerShell 查询经常超时）曾被误判为「进程消失」。现改用 `findPidForMainPyDetailed` 区分「真的查不到」与「查询失败」，失败这一轮不再计入 miss、也不复位已见标记，避免误报保活进程莫名退出（lifecycle-exit.ts 的 watcher 与 lifecycle-launch.ts 的启动期判死）。
- 保活进程真正消失后，把其 stdout / stderr 重定向文件（`log/services/comfyui-keepalive-*.{out,err}.log`）末尾带进 runtime 日志与面板（`[exit][out]` / `[exit][err]`）。崩溃轨迹（Python traceback / OOM / CUDA 报错）现在直接可见，不必再手动翻文件。
- 保活「接管」场景补挂退出监督：应用重启后复用上一次会话拉起的保活实例时，那次拉起发生在上一个进程里，`launchKeepAliveMode` 不会给它装监督器，导致它之后真没了只剩状态轮询里的「未运行」。现在 `ensureComfyUiReady` 的「已在运行」快路径会补挂（`ensureKeepAliveWatchOnAdoption`），且幂等——状态轮询反复触发也不重挂，避免把「进程开头时间」重置成最后一次轮询的时刻。
