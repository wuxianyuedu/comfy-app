## Fixed

「pnpm 不可用」这一刻的**读数**补齐了：此前判据只写一句「PATH 上没有可用的 pnpm」，
而这句话在本仓同时对三种成因成立 —— 真没装、环境变量表里的键名不是 `PATH`
（`{ ...process.env }` 的复制品里 Windows 常写作 `Path`，判据会扫一个空串）、
PATH 那一串按错的分隔符切。三者的下一动作完全不同（装 / 改键名 / 改切分）。

- 工具链自证（`scripts/ci-toolchain-selfcheck.mjs`）：取证新增 `PATH 原文` 一行；
  「读 PATH」与「切 PATH」收成 `pnpmPathValue()` / `pnpmPathEntries()` 各一份，
  `findPnpm()` 与 `pnpmForensics()` 都从这两处取 —— 判据与取证各读一遍，就会出现
  「判据读的是 `Path`、取证打的却是空的 `PATH`」那种读不出根因的日志。
- 启动器补装（`scripts/launcher-core/downstream.mjs`）：探不到 pnpm 的出口不再只有
  一句结论，随附本进程读到的 `PATH` 原文、切分后的条目数与前若干条、以及近似键提示。
- `pnpmInvocation()` 的结论新增 `pathRaw` / `pathEntries` / `onDisk` 三条（非空时），
  调用方不必再自己读一遍 `env` 并「按它以为的方式」重新解析。
