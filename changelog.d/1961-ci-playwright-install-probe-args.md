## Fixed

- **「浏览器安装」那一步会**绿着不干活** —— 拼命令行时把探针参数一起带上了**
  （ISSUE #1961，自托管节点首次真跑到 E2E 之后的第二格）。

  `findPnpm()` 交出来的 `args` 是「**探一趟** pnpm」的完整形态（宿主形态时是
  `[…] -File pnpm.ps1 -v`，直接命中时是 `["-v"]`）。装浏览器那一步照 `args` 拼，
  真跑的是：

  ```
  pnpm -v exec playwright install chromium chromium-headless-shell
  ```

  实测：那句**只打印版本号并退 0**（`12.11.2`），浏览器一个都没装。后果是这条 stage
  报**绿**、E2E 照旧报「浏览器二进制不在」—— 看日志的人会以为浏览器已经装好了，
  比让它直接红难查得多。

  修法：`findPnpm()` 另外交一份 `prefixArgs`（**去掉探针参数**的宿主前缀），
  真命令一律用它拼。这也是为什么探针形态与运行形态必须分开表达 ——
  「怎么探」与「怎么跑」在这一格上不是同一个命令。

  判据（`tests/ci-toolchain-selfcheck.test.ts`，`runPlaywrightInstall` 现在带两个接缝）：
  命令行里**不含** `-v`、宿主前缀一件不少（少了就变成「拿 `.ps1` 当可执行文件起」）、
  pnpm 不可用时不去起进程、两件浏览器（`chromium` + `chromium-headless-shell`）都在。
  反向复算：把 `prefixArgs` 换回 `args`，「不含 `-v`」那条当场红。
