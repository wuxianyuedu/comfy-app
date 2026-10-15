## Fixed

- **那条「选中了哪个形态」的断言仍是大小写敏感的**（ISSUE #1961，接
  `1961-ci-gate-candidate-case.md`）：上一条把它从「写死 `pnpm.CMD`」改成
  「`toContain([pnpm.CMD, pnpm.ps1])`」，方向对，但**比较本身还是大小写敏感的** ——
  而 `whichCommand()` 交出来的是拿 `PATHEXT` 的写法**拼**出来的候选（`.PS1`），
  只在 Windows 上才由 `onDiskName()` 回写成盘上的实际写法。

  于是「盘上那个文件叫什么」又一次决定结论：盘上是 `pnpm.PS1` 时
  `candidate` 就是 `…/pnpm.PS1`，那条 `toContain` 两种拼法都不命中 ——
  正是上一条刚修掉的形状（把「跑判据那台宿主的样子」写成恒真性质）换了个入口。

  改成两侧 `toLowerCase()` 再比。复算：盘上摆 `pnpm.PS1`（POSIX 上这是把
  Windows「候选按 `PATHEXT` 拼、与盘上名字大小写不一致」复刻出来的唯一办法）——
  修复前当场不命中、修复后成立，而 `viaHost` / `command` 两侧读数一字不变。
