## Fixed

- **本地 Windows 全量 vitest 有 5 条与环境相关的既有失败**：① Build-Guard 三条用例——PS 5.1 对重定向输出按系统 ANSI 代码页（zh-CN 为 GBK）编码中文，测试按 UTF-8 收到乱码，断言中文文案必挂，现在 spawn 的会话内先强制 UTF-8 输出；② capture-streams 转录路径用例——mock 的日志目录是 POSIX 风格字符串而实现用 `path.join`（Windows 拼反斜杠），前缀比对假失败，改用 `os.tmpdir()` 真实目录同源构造；③ lifecycle taskkill 用例——`child_process` 从未被 mock（`is not a spy`），且探针 mock 停在旧的 `resolveComfyBase` 上（实现已改走 `probeComfyBase`，探测恒为 null），分别补上 mock 与对准探针后，杀整树断言在 win32 真正生效。
