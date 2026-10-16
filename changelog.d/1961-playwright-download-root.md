## Fixed

- **「浏览器安装」这一格第三次红：这次不是配置写错，也不是判据缺失 —— 是它自己的
  三个内置镜像**同族**（ISSUE #1961）。** 现场 `cnb-gt1-1k513ill4`：1732s 的门禁全绿，
  最后红在这一步的下载上，而机器上**什么都不缺**（浏览器早就在盘上）。日志逐字是
  5 条 `Downloading Chrome for Testing … from cdn.playwright.dev` 之后
  `Download failure, code=1` —— Playwright 的 `retryCount = 5` 是**换镜像重试**，
  而它的三档镜像全是 `cdn.playwright.dev` / `playwright.download.prss.microsoft.com`
  这一族：这一族一起不通时，那次「回退」在同一张网里等于没有。

  三处同批：

  **① 装过的就不下。** 原先无条件 `playwright install`，于是链路一抖，
  一条本来什么都不缺的流水线也会红在这里。现在开跑前先按落点判一次
  （与那条复验**同一份实现**），两件都齐就直接跳过 —— 判据仍是「东西落地了」，
  所以「只装了完整 chromium」这一档不会被放过去（headless 档用的是
  `chromium_headless_shell`，两者是 `browsers.json` 里的两个条目）。

  **② 下载根由外面给，不由本仓猜。** `runPlaywrightInstall()` 现在认
  `PLAYWRIGHT_DOWNLOAD_HOST`（Playwright 自己的键，本仓不发明第二套）：设了就**只用它**，
  不再陪它挨个试那三档不通的镜像（具体那个镜像站在 `.cnb.yml` 里，与上一笔同源）。
  **源码里不写死任何镜像** —— 那等于把「哪面墙怎么过」塞进逻辑层，换台机器就静默失效，
  而这一步判据是「装完能起才放行」，它会绿着把错的东西放过去。

  **③ 失败读数要认得出「同一族被反复试」。** `playwrightInstallHints()` 现在按试过的根
  分两档：全都是那一族时，出口说的是「**给一个能通的根**」——而不是把人引到
  「超时再改大一点」那条错路上（`5 × 120s` 已经试完了，加时间不解决）。别的失败形态
  （pnpm 不可用、盘满）照旧不给这两条建议。

## Added

- **上面三处各有判据**（`tests/ci-toolchain-selfcheck.test.ts` /
  `tests/no-platform-ci-config.test.ts`）：装过的**一次下载都不发起**（`exec` 真被调过即红）、
  只装一半**不许跳过**、设了根就**只用它**、`runPlaywrightInstall` 拼的命令行里
  **不许有探针参数 `-v`**（那是 `findPnpm().args` 的形态，拼进去只会打印版本并退 0），
  以及 `.cnb.yml` 那一步必须带这两个键（`env` 键名写错不会有任何解析期报错，
  只会在下一次下载时以同一个形态再红一遍）。
