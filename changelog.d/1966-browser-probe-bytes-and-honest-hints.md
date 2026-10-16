## Fixed

- **「这台机器到得了哪个下载根」那一层用 HEAD 判，把一条取不下字节的链路判成了好链路**
  （ISSUE #1966 的续集，现场 `cnb-ald-1k51g8dt9`）。

  三行读数放在一起才看得出病：

  ```
  环境前提（第 4 步，5 秒处）     下载根探测：…/binaries/playwright → HTTP 200        ← 报绿放行
  浏览器安装（第 31 步）          Downloading … from 同一个 URL … timed out after 120000ms
  浏览器安装（失败话术）          30s 是 Playwright 的默认**套接字**超时
  浏览器安装（失败话术）          放宽：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000  ← 已经就是它
  ```

  HEAD 答的是「这个 URL **允不允许**被取」，不是「**取得下来吗**」；一台能做 TLS 握手、
  能回小响应头、却在**大 body 上停住**的链路（代理 / 深度包检测 / MTU 黑洞）在 HEAD
  面前与好链路逐字同形 —— 于是前置判定的绿是**假绿**，它要防的「晚红」被原样放行。

  `httpDownloadProbe()` 取代 `httpHeadStatus()`：发**带 `Range` 的 GET**、跟随 3xx、
  **收到第一批字节就收手**（它是判通不通，不是下载），读数里带上**实收字节数**；
  超时那一档还分「连上了但 0 字节」（现场那一档）与「压根没连上」——两者处置不同。

- **`环境前提` 的浏览器判据问错了对象：它答「某个根通不通」，而它存在的理由是
  「这一趟装得成吗」。** `PLAYWRIGHT_DOWNLOAD_HOST` 设在 `浏览器安装` 那一步的 `env`
  上、这个 stage 看不到它 —— 但**它读得到那份配置**，所以现在量的是**配置里那一个根**
  （`stageBlockIn()` / `stageEnvValue()`，`stageBlock()` 的文本副本，处置与
  `ps7OnlySyntaxIn` 逐字相同）。它取不回字节就**当场红**（5 秒，不是 30 分钟），
  并把下一动作点成「换 `.cnb.yml` 里那一行」。没配根时照旧铺开候选那一族。

- **失败话术把两件已经做过的事当成建议给了出来。** 现场那一跑 `.cnb.yml` **已经**配了
  `PLAYWRIGHT_DOWNLOAD_HOST`、**已经**把套接字超时放宽到 120000，而失败的那一趟用的
  **就是**那个根、超时**就是** 120000ms —— 旧话术照旧说「30s 是默认」并建议「放宽到
  120000」。现在 `playwrightInstallHints()` 收 `playwrightInstallHintFacts(env)`
  （生效的套接字超时 + 配着的根），按**已做的动作**分岔：做过的不再当建议给，
  只把没做过的给出去；生效的那个数**优先取输出里那句 `timed out after <N>ms`**
  （它比 env 更贴现场）。

- **候选表里那两条 `…/dbazure/download/playwright` 对本档这一件是结构性错的。**
  它们是拿 `PLAYWRIGHT_CDN_MIRRORS`（三档内置镜像）那张表抄来的，而那张表服务的是老的
  `builds/chromium/<revision>/…` 形状；本档要下的 `chromium-headless-shell` 走
  `cftUrl()`，它对这一件返回的 `mirrors` **只有 `https://cdn.playwright.dev` 一条**。
  给前两条接上 `builds/cft/…` 得到的地址永远供不上这一件（实测跟到最后是 400：
  `cdn.playwright.dev/dbazure/download/playwright/…` → 307 →
  `playwright.download.prss.microsoft.com/dbazure/download/playwright/…` → 400）。

  代价不只是两条噪音：**人照读数「换一个能通的根」会换到一个保证 400 的地址**
  （现场 `cnb-oqf-1k51ifhis` 那两条逐字就是 400）。候选表现在按 `cftUrl()` 的
  `mirrors` 那一条来，加上 npm 镜像那两段路径。

  ⚠️ **这笔也没有让那一格变绿**：它把「30 分钟后一句不成立的话」变成「5 秒钟一句指向
  下一动作的话」。那一格要绿只有一个条件 —— 这台节点能取回那 120 MiB（换一条到得了的根 /
  配代理 / 预先把 `chromium-headless-shell` 装进落点）。这是「不替人做那个决定」那条
  边界的代价，写在这里免得下一个人以为漏修了什么。

判据：`tests/ci-toolchain-selfcheck.test.ts`（探测的四种现场起**真 HTTP 服务**判 ——
服务在子进程里起，因为探测本身是 `spawnSync` 起的另一个进程，在沙箱 / CI 容器里够不到
父进程监听的 localhost；话术那一组判「120000 与现场对得上」「做过的动作不再被当建议」
「没做过就照旧给」）与 `tests/ci-env-probe.test.ts`（量的就是配置里那个根、它不通则当场红、
没配根时照旧铺开、两份 `stageBlock` 的对账）。
