## Fixed

- `tools/start/take-screenshot.ps1` 文件头是**双 BOM**，`#Requires` 前多出一个 U+FEFF，原生 PowerShell 5.1 解析直接失败（`quality-gate-ps-precheck` 当场红）。去掉多余的一个 BOM（#3974）。
