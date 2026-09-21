## Fixed

修复构建脚本末尾报错：`Log` 增加可选 `-ForegroundColor` 参数后，多行拼接的 `Log "a" "b"` 调用会把第二个字符串误当成 `ForegroundColor` 的值，导致 `build-tauri-release.ps1` 结尾提示行抛出「无法将值转换为 System.ConsoleColor」。

`Log` 的 `$Msg` 改为 `[string[]]` 并 `-join ""` 拼接，多行 `Log` 调用与普通单行调用行为不变；同时统一了 `>>> ` 命令回显的黄色配色。
