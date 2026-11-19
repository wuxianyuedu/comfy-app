## Fixed

- **netstat 快照那条用例的 POSIX 分支断言在 Windows / macOS 上不再恒红**
  （ISSUE #3522）：`tests/launcher-procs-netstat-snapshot.test.ts` 的「POSIX 分支不受影响」
  那条把「有 `/proc`」当前提写死了（断言 `resolves.toBeInstanceOf(Array)`），而 POSIX 分支的
  **输入是文件系统、不是平台名** —— Linux 有 `/proc`，**Windows 与 macOS 都没有**。
  于是没有 `/proc` 的机器上它按本仓三态口径（「没量到 ≠ 量到空」）抛
  `ProbeUnavailableError`，那条断言必红（`base-check` 判 **baseline-red**：
  `origin/master` 上同样命中）。
  改成**按本机的真实输入面分两支断言**：有 `/proc` ⇒ 给出数组；没有 ⇒ 抛第三态 ——
  **两支都是契约的一部分**，而「不碰 netstat」这一条在两支上都成立。
  判据侧（`scripts/launcher-core/procs.mjs` 的 `listeningPidsPosix`）一个字没改：
  读不到探测输入就抛、而不是静默返回空数组，正是它自己的设计意图
  （空数组会被 `inspectPort` 念成「端口空闲」、被 `runningAppInstances` 念成「没有实例在跑」，
  两者都是 fail-open）。
