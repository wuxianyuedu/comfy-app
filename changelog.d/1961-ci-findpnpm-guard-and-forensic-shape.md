## Fixed

- **`ci-toolchain-selfcheck.mjs` 写死了 pnpm 的可执行名，撞上「不许写死」那条全仓判据**
  （ISSUE #1961，平台侧第十一跑）：新加的 `pnpmForensics()` 为了**报告**形态，把
  `pnpm` / `pnpm.exe` / `pnpm.ps1` / `pnpm.cmd` / `pnpm.bat` 逐个列了出来 ——
  而 `tests/dev-launcher-toolchain-gate.test.ts` 有一条全仓判据按**文本**扫
  `scripts/**`：出现 pnpm 的可执行名即违规（那正是「Windows 上选中 Node 起不来的
  批处理形态」这条缺陷的形状，判据剥行注释但不剥块注释，所以注释里写也一样算）。
  平台侧实测：`单元测试` 9451 passed | **2 failed**，两条都落在这里。

  修法是让两处**共用同一份后缀表**（`pnpmCandidateExts(platform)`）：它表达的是
  **候选面**（哪些形态可能在盘上）而不是「选谁去起」，所以只写后缀、不写整名 ——
  既是同一份事实，也不再触发那条按文本扫的判据。`findPnpm()` 与 `pnpmForensics()`
  从此共用它（原本各写一份，本来就该是一处）。

  同批修一处**自伤**：插入新函数时把 `findPnpm()` 的 JSDoc 从它身上切开了，
  于是它的 `env?: Record<string, string | undefined>` 类型注解失效、回退成
  `ProcessEnv`，`tests/ci-toolchain-selfcheck.test.ts` 里 7 条用例当场 `TS2741`
  （「Property 'NODE_ENV' is missing」）。新函数因此移到 `findPnpm()` **之后**。
