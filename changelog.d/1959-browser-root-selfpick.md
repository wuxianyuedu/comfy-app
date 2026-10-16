## Fixed

- **平台侧流水线的「浏览器安装」第六次红在同一形态上：配着的下载根这台节点到不了，
  而**日志里早就量到别的根是通的** —— 这两条之间从来没有执行者**（ISSUE #1959）。

  现场（`cnb-t3f-1k51ho0k2` 的 `浏览器安装` stage）逐字是两句、中间隔了四十秒：

  ```
  环境前提 ✓（它量到 cdn.npmmirror.com → HTTP 200、cdn.playwright.dev → HTTP 307）
  浏览器安装 ✗ timed out after 120000ms（同一个根、同一台机器、同一分钟）
  ```

  「哪个根到得了」这条读数早已有（前一笔刚把 `环境前提` 那一格修成量**真资源**），
  可它只落在一行会随日志滚过去的读数里：装那一步照旧从 `.cnb.yml` 配着的那个根开始，
  然后红 —— 同一句 `timed out after 120000ms` 连着红了三次
  （`cnb-gt1-1k513ill4` / `cnb-g9d-1k515kvrq` / `cnb-t3f-1k51ho0k2`）。

  - `scripts/ci-toolchain-browser-reach.mjs`：新增 `probeGrade()` 与
    `pickPlaywrightRoots()` —— 装之前**现量一次**每个候选根（与 `环境前提` 同一份探测），
    量得到的排前面；`HTTP 2xx/3xx` 是首选，`超时` 与 `4xx` 按原序兜底（**不删**：
    探测在另一个进程、量的是 HEAD，而装走的是 GET 拉 120 MiB，两者不是同一次测量）。
  - `scripts/ci-toolchain-browser.mjs`：`runPlaywrightInstall()` 从「按序试
    `playwrightDownloadRoots(env)`」改为「按量出来的顺序试」，并把探测读数与
    「配着的根没用上、改用哪个」打出来；`playwrightOnly()` 把 `probe` 一并接进挑根那一层
    （**必须接**：`pickPlaywrightRoots` 自己的 `probe` 缺省是「一个都不量」，
    接错线就是「新路看起来接好了、其实一次都没走」——本笔踩过一次，判据钉住了）。
  - **「给上了就只用它」没有被推翻**：那条反对的是盲目重试**同族内置镜像**
    （实测 5 次全落在同一个域名上、`retryCount = 5` 的回退等于没有）；这一笔试的根是
    **量出来的**。两个分支都判：配着的根量得到 ⇒ 仍然只起一次、只试它；
    量不到 ⇒ 量得到的那个接过去。
  - 没配根时**一个都不量**（那时 `roots` 只有 `undefined`，走 Playwright 自己的内置族），
    与改动前逐字相同 —— `pickPlaywrightRoots()` 的 `probe` 缺省是「不量」，
    这一支同时是判据「不出网」的依据：探测要用 `httpHeadStatus` 显式注入。
  - 规范 §13.5.3.10 补「堵上最后那条缝」一小节；`docs/generated/13-*` 同步重渲染。

  回归判据：`tests/ci-toolchain-selfcheck.test.ts` 的两个分支用例（量得到 ⇒ 只试它；
  量不到 ⇒ 换根，且换根这件事在读数里留痕），全部注入探测面、**不出网**。
