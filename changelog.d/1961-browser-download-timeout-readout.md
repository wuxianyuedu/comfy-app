## Fixed

- **`浏览器安装` 那一跑真正红在「下载没量完」，而这一步的读数此前分不出这一点**
  （ISSUE #1961）。

  读数（`cnb-rkr-1k510rsgg` 的 `浏览器安装` stage）：

  ```
  Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243)
  Failed to install browsers
  Error: Request to https://cdn.playwright.dev/…/win64/chrome-win64.zip timed out after 30000ms
  ```

  这一跑停在这里（退出码被守卫吞掉那一件由同批的姐妹提交收掉），于是 E2E 照旧报
  浏览器缺件 —— 而**为什么没装上**在整条构建日志里一个字都读不到。更早那版话术只说
  「常见成因：网络到 CDN 不通、或磁盘满」，而这两个成因的处置**相反**：

  - 「不通」要换镜像 —— `PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>`；
  - 「没量完」要放宽多久算超时 —— `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`。

  而这一跑的形态是后者：`timed out after 30000ms` 里的 30s 是 Playwright 的默认
  **套接字**超时（`NET_DEFAULT_TIMEOUT`），而这一件包是 180 MiB（`chromium` 与
  `chromium-headless-shell` 两件加起来更大）—— 慢链路上它被按时掐断，与
  「这个地址不通」长得一模一样。

  三件同批：

  1. `playwrightInstallHints()`（`scripts/ci-toolchain-browser.mjs`）—— 只有真撞上
     「下载失败」字样时才打，逐条列出**试过哪个地址、各自怎么败的**，并给出上面那两个
     出口（都是 Playwright 自己的键，本仓不发明第二套）。别的失败形态（pnpm 不可用、
     盘满）不给这两条建议：凑上去只会让人往错的方向看。
  2. `浏览器安装` 那一步显式给 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"`
     —— 只关「多久放弃」，**不改任何判据**（判据仍是「装完东西落没落地」）。
  3. 判据两处：`tests/ci-toolchain-selfcheck.test.ts`（读数的两个方向 —— 下载失败时
     地址与两个出口都在、别的形态不给建议）与 `tests/no-platform-ci-config.test.ts`
     （那一步必须带这个键 —— `env` 的写法错了不会有任何解析期报错，只会在下一次下载
     时以同一个形态再红一次）。

  两处都在本机反向复算过：把 `playwrightInstallHints` 的判定摘掉，第一条当场红；
  从 `.cnb.yml` 摘掉那个键，第二条当场点名。
