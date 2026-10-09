## Fixed

修掉两条**在 Windows 开发机上恒红**的固定清单用例 —— 它们在 pre-commit 的组 C（结构守护测试）里，**本机任何一次提交都会被拦下**（本次是把日志面板的路径修复落地时被它们挡出来的）。

- `tests/test-config-inheritance.test.ts`：`path.relative()` 在 Windows 上吐 `tests\setup.ts`，与期望的 `tests/setup.ts` 比不相等，于是「根 `test` 的共享项落到了两个 project 上」这条在非 Windows 上一刻都不成立。先归一化分隔符再比。
- `tests/pixel-run.test.ts`：「本机这一档齐备时前置判决放行」的前提是**齐备**，而 win32 档按 `PENDING_PLATFORMS` 登记为待重录（只能在 Windows 开发机上补录）。前置判决在待重录档**设计上**就给「登记为待重录 + 缺哪几张」的话术（口径见 `scripts/visual-baselines.mjs` 的 `isPlatformPending`），要求它返回 `null` 等于要求一台录不齐基线的机器给出「齐备」。改为按登记分支断言，两条分支上都在验「前置判决接的是真仓库」。
- `tests/form-field-wiring-gate.test.ts`：夹具用裸 `symlinkSync(..., "dir")` 把 `node_modules` 链进临时仓库，Windows 普通权限必 EPERM，14 条门禁用例一次都跑不起来（红的是「夹具搭不起来」，不是判据）。换仓库统一收口的 `symlinkDir`（win32 走 junction，见 `tests/helpers/symlink-dir.ts`）。
- `tests/daily-tracks.test.ts`：`dirtySince` 取证的临时仓库两次提交只差 1~2 秒，`git log --format=%cI` 秒级精度下被拆成不同时刻，断言 `src/` 与 `scripts/` 的「最早时刻」精确相等会随提交落地时钟抖动假红。两者本意都是「今天动过」，改为比到「日」，不被跨秒提交影响。

四条都不是放宽断言：各自的前提被显式写出来，前提不成立时断言的是**另一种正确读数**（或换成等价的稳定读数）。
