## Fixed

`run-affected-tests.mjs` 的 `--dry-run` 曾排在 `resolveVitestEntry()` 之后，于是「不起 vitest 的读数档」反而成了唯一必须装好依赖的一档 —— 干净检出 / 只读沙箱上 `--dry-run` 与 `--full --dry-run` 直接崩在「解析不到 vitest 入口」。两处 return 提到解析之前，并补一条**源码顺序**判据（进程级版本在 vitest 里恒绿，已反证过）。
