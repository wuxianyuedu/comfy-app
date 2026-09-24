## Fixed

- Windows 保活拿不到 `COMFYAPP_SHELL_EXE`、退回 `powershell Start-Process` 中介时记一条警告。那条回退只能把目标变成孤儿、**逃不出壳的 Job Object**，壳一退出 job 关闭就会把这个「保活」进程连杀（等于保活失效）；它设计上是给「那时根本没有 job」的场景用的（如 `pnpm tauri dev`）。此前这一路是静默的，用户只会看到「关了应用 ComfyUI 也没了」却查不到原因。
