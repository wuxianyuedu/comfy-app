## Fixed

**pnpm 的形态判据多了第一优先：跑包真身的 JS 入口，不再只剩 `.ps1` 经 PowerShell 那一条路**（ISSUE #2562）。

- 现场：Windows 上 corepack 摆的三个垫片里 Node 一个都起不来 —— 无扩展名是 `#!/usr/bin/env node`
  （libuv 不解析 shebang）、`.cmd` 是批处理（Node 一律拒绝，`EINVAL`，**与 Node 版本无关**），
  于是「起得来」这一档永远挑到 `.ps1`，每条 `pnpm …` 付一次 node + 一次 PowerShell 冷启动（0.6~3s）；
  而一次启动里这条路径被调用 4~6 次（依赖同步、`check:all` 每一格、`ship` 每一跳、`base-check` 复算）；
- 而**包真身就摆在旁边**：corepack 的版本目录与 pnpm 自己的落地目录都带完整的
  `node_modules/pnpm/`，`spawn(process.execPath, [<入口>, …])` 就能起 —— `shell: false` 恒定、
  不需要宿主、**全平台同一条代码路径**（POSIX 上只是少起一层进程，行为零改动）；
- 入口**从包的 `bin` 字段读**（`pnpmJsEntry()`，不猜文件名）；`bin` 指向原生二进制时（pnpm 11+
  把 `pnpm` 写成 `{ "pnpm": "pnpm" }`，那个文件是 MZ / ELF）改用 Corepack 对 pnpm ≥ 11 写死的
  `bin/pnpm.mjs`；落点的两种形状都接（`<落点>/node_modules/pnpm/` 与落点自己就是包 ——
  后者正是 `corepack enable` 之后 PATH 上那一格的形状）；
- `viaHost` 的语义顺手收口成「**真正要 spawn 的文件是不是宿主**」而不是「它等不等于 `candidate`」：
  走 JS 入口时 `command` 是 `process.execPath`、`candidate` 是落点目录，旧式子会把它读成「经宿主」，
  而 `runPnpmSync` 里那道 PS 参数切分防线正是按这个布尔值决定要不要拦 `--x=…:…`（一个布尔值
  既当排障读数又当防线开关，判据错一次就两处一起错）；
- 自检（`pnpm check:toolchain` 的「选中的 pnpm / 执行形态」两行）与流水线第一步的工具链自证
  （`scripts/ci-toolchain-pnpm.mjs` 的 `findPnpm()`）跟同一条顺序。后者刻意不 import 仓库内模块，
  所以这是同一件事的两份实现 —— 一致性由 `tests/ci-toolchain-selfcheck.test.ts` 的一组对账用例钉着。
