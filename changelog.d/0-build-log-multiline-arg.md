## Fixed

修复构建脚本末尾报错：`Log` 增加可选 `-ForegroundColor` 参数后，多行拼接的 `Log "a" "b"` 调用会把第二个字符串误当成 `ForegroundColor` 的值，导致 `build-tauri-release.ps1` 结尾提示行抛出「无法将值转换为 System.ConsoleColor」。

`Log` 的 `$Msg` 保持单字符串，多行场景由调用方用 `+` 拼成单个字符串传入；`-ForegroundColor` 只能命名传入，避免第二个位置参数被误当成颜色值。同时统一了 `>>> ` 命令回显的黄色配色。
