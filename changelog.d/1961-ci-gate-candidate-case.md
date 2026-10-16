## Fixed

- **`dev-launcher-toolchain-gate` 里那条断言把「跑判据那台宿主的样子」写成了恒真性质**
  （ISSUE #1961，平台侧第十一跑的第二个失败）：用例断言
  `pnpmInvocation().candidate === <dir>/pnpm.CMD`，而它在 **Windows 上红、POSIX 上绿**
  —— 因为 `executableExts()` 把 `.PS1` 改成**无条件进候选**之后，顺序成了
  `"" → .EXE → .PS1 → .CMD`，而 **Windows 的查找不区分大小写**：目录里那个
  `pnpm.ps1` 会被 `pnpm.PS1` 这个候选命中，于是轮不到 `.CMD`
  （`.CMD` 只在 `.ps1` 不在时才被选中、再由它走同胞回退）。

  两条路**最终落在同一处**（经 PowerShell 宿主起），差别只是「先命中的是哪一个文件」
  —— 那也是这条用例真正要判的东西。改成断言 `candidate` 是该目录里**真有的形态之一**，
  并且 `viaHost === true`；下面那两条 `command ⇄ commandInvocation` 的等式一字未动，
  它们钉的正是「无论先命中哪个文件，起法必须是宿主那一套」。

  复算：把 `pnpm.PS1` 造进夹具目录（等于在 POSIX 上复刻 Windows 的大小写不敏感），
  修复前这条当场红、修复后绿；`command` / `viaHost` 两侧读数不变。
