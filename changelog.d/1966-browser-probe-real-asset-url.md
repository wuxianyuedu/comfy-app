## Fixed

- **平台侧流水线在「环境前提」第一步自己误红，整条构建 41 秒收场、后面 30 步全 skipped**
  （ISSUE #1966，规范 §13.5.3.9）。

  现场：`cnb-3c1-1k51dq17k` 的 `cnb/pull_request/pipeline-1(质量门禁)` 在 `00:41` 报
  `error`，读数逐字是「浏览器落点是空的，而**一个下载根都到不了**」—— 而 `.cnb.yml` 的
  `浏览器安装` stage 上配着的那个根（`https://cdn.npmmirror.com/binaries/playwright`）
  **好着**。于是这条判据把整条流水线拦在第一步：它本来是为了「别等三十分钟才发现装不上」，
  结果变成了「连三十秒都跑不过去」。

  根因是这格探测拿**裸根**去发 HEAD，而根与真资源是两个不同的地址。同一时刻实测：

  | 地址 | 裸根 | 真资源（`builds/cft/<版本>/<档>/<包>`） |
  | --- | --- | --- |
  | `https://cdn.npmmirror.com/binaries/playwright`（配置里那个） | 404 | 200 |
  | `https://cdn.playwright.dev` | 400 | 307 |

  「这一趟装得成吗」只有**真资源**答得了 —— 判据量的地址与它要说明的那件事必须是同一个。

  - `scripts/ci-toolchain-browser.mjs`：新增 `playwrightProbeUrl()`，可达性一律拼上本档
    真要下的那件包的路径再量；版本号与平台档**现读** `playwright-core` 的 `browsers.json`
    （读不到才退缺省 —— 写死会让判据在上游升版后**永远绿**，比红更坏）；
    三态从 `{url, verdict, ok}` 变为 `{url, root, verdict, ok}`（`root` = 配置面，
    `url` = 实测面）。同批修掉第二个坑：pnpm 的严格布局下 `playwright-core` **不在
    `node_modules/` 根**，`browsers.json` 落在 `.pnpm/playwright-core@<版本>/` 下面，
    解析改走「可能位置表」。
  - `scripts/ci-env-probe.mjs`：读数与失败话术点 `root`（答「改哪一行」）。
  - `tests/ci-env-probe.test.ts` / `tests/ci-toolchain-selfcheck.test.ts`：注入面补
    `probeUrlOf`；新增回归判据「注入裸根 404 / 真资源 200，断言打到的是真资源且判通」。
  - **顺带按职责拆出一份新文件** `scripts/ci-toolchain-browser-reach.mjs`：探测那一层
    （候选根表 / 真资源 URL 拼接 / 三态与打印 / `httpHeadStatus`）独立成文件 ——
    上面的修法让 `ci-toolchain-browser.mjs` 从 720 行涨到 911 行，越过 §12.6 R5 的
    900 行**硬闸**（存量已清零、无基线可登记），而这一段本来就与「装 / 复验 / 落点解析」
    是两件事、消费者也不同（`环境前提` 只用它）。旧模块转出同一批名字，调用点不必改。
    同批清掉 `ci-toolchain-browser.mjs` 里**一段悬空的重复 JSDoc**（`playwrightInstallHints`
    的头注被复制了一份、挂在候选根表之上，那份不只是重复、还让 900 行的判据当场红）。
  - 规范 §13.5.3.9 补一小节记下这个误报形态与两条根因；`docs/generated` 同步。
