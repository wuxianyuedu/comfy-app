## Fixed

- **`工具链自证` 把一台装好了 pnpm 的机器判成「缺 pnpm」并退 1**（ISSUE #1961）：
  `file://` 守卫修好之后那一步**第一次真的跑起来**，当场报

  ```
  == pnpm ==
  (pnpm 不可用)
  工具链自证未通过：pnpm 不可用 —— 本仓门禁全走 pnpm
  ```

  而**同一次构建**里 `Install dependencies` 跑 `pnpm install --frozen-lockfile`
  成功（`Done in 35.9s using pnpm v12.4.1`）—— pnpm 在这台机上是可用的，差别只在
  **谁去解析这个名字**：Node 的 `spawn` 不认 PATHEXT，而 `pnpm` 在 Windows 上是
  `pnpm.cmd`（本仓 `src/lib/process/executable-resolve.ts` 整份模块就是为这一格存在的）。

  修法：两份脚本各自的 `run()` 在「非零 / 报错」之后加一条**只在 `win32` 上**走的
  退路 —— `shell: true`，让 cmd.exe 按它自己的 PATHEXT 规则解析这个名字。这一步
  **刻意不 import 那份实现**（它必须在「Node 模块链还没被证明可用」的机器上也能给出
  可读输出），所以用 cmd.exe 这条自足的路。POSIX 不走：那边裸名字本来就解析得了
  （内核认执行位），多一层 `/bin/sh` 只会让参数过一遍引号解析。

  少了这条退路，「缺件必须在**最便宜**的位置报出来」那一步会把一台好的机器拦在
  第一个 stage，后面 30 步全 skipped。

  判据按**结构**判（`tests/ci-toolchain-selfcheck.test.ts`）：两份脚本的 `run()` 都必须
  有这条退路，且必须限定在 `win32` 上 —— 本机（POSIX）构造不出「`pnpm` 只有 `.cmd`
  形态」的世界，能判的只有形状。反向复算：把 `shell: true` 去掉，判据当场点名。
