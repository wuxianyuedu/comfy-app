## Changed

- **build-all / 打包启动器前置检查报「产物目录被占用」时，占用者清单补上命令行 + 父 PID + 父进程名 + 可执行文件路径**：旧实现只列 `PID + 进程名 + 被映射的 dll`（如 `PID 66636 pnpm-native ← VCRUNTIME140.dll`），用户看不出「这孤儿是谁的子孙、该连带杀哪棵子树」，只能照 PID 盲杀（AGENTS 硬规则 3 反对单杀）。`tools/scripts/Build-Guard.ps1` 的 `Get-ProductDirHolder` 此前用 `Get-Process`（拿不到命令行 / 父 PID），改为额外经 `Get-CimInstance Win32_Process` 建 PID→CIM 索引，给每个命中进程补 `CommandLine` / `ParentProcessId` / 父进程名；补充信息抽成 `Write-HolderDetail` 一处，「清理失败出口」与「前置检查出口」两处共用，避免各抄一份漂移。含中文的 `.ps1` 保持 UTF-8 with BOM。回归护栏 `tests/build-guard-holder-detail.test.ts`。
