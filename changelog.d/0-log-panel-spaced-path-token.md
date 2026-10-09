## Fixed

修复日志面板把**带空格的路径**认成半截的问题：启动器回显的命令行里 `C:\Program Files\PowerShell\7\pwsh.EXE` / `D:\Program Files\nodejs\pnpm.ps1` 这类路径，画出来的紫字只有 `C:\Program`，点它也只会得到「找不到可在文件管理器里打开的路径」。

根因是同一个问题有两个答案：可点那一层用 `findLogPathTokens`（吃空格），上色那一层（`log-row-style` 的 `TOKEN_RE`）自带一份 `[^\s]*` 的路径正则（不吃空格）；而上色层切出的片段正是可点层做识别的范围，于是切在空格上就等于认不出。

`log-row-style` 的路径区间改用 `findLogPathTokens`，切点与样式合并成同一份区间表（`styledSpans`），路径区间优先占位、其余词法 token 落在路径内让位。上色与可点从此同源，带空格的路径整条上色、整条可点。带 ANSI SGR 的行仍按颜色切分（尊重子进程配色，代价是该情形下路径可能只点得到前半截）。
