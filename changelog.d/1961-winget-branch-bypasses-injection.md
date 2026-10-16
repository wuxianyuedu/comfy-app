## Fixed

- **`winget` 分支「按链接目录再找一遍」直呼模块实现，两层接缝都拦不住它**
  （`scripts/ci-toolchain-python.mjs`）。

  这一格在 `7d2133ea` 补齐**两层**查找接缝（`findExe` = 「这台机器上有没有」、
  `findExeUnder` = 「这个目录下有没有」）之后**仍然成立**：`viaWinget` 那条通道
  收到了注入的 `findExe`，却把「按 `%LOCALAPPDATA%\Microsoft\WinGet\Links` 再找一遍」
  那一档写成**模块级 `findExeUnder` 的直呼** —— 两个接缝各自堵住了自己的调用点，
  而这一处谁都不管。判据的结论于是又变回「跑判据那台机上碰巧有什么」。

  实测复现（不是推演）：造一个 winget 链接目录下**真有** `python.exe` 的形态，
  `findExe` 与 `findExeUnder` **都**注入 `() => null` 之后：

  ```
  两个接缝都注入 null 后，installed = true | path = …/WinGet/Links/python.exe
  ```

  修法是把 `findExeUnder` 接缝沿 `installPython → viaWinget → installViaWinget`
  透传下去，那一档改走注入面；配套在 `tests/ci-toolchain-selfcheck.test.ts`
  立一条判据（用**真文件**而不是 mock `fs` —— 这一格判的正是「还有没有人去问真 fs」）。
  反向复算：把它改回直呼模块实现，判据当场红成 `expected true to be false`
  （正是 CI 上的读数）。
