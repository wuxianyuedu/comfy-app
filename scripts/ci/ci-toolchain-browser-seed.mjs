/**
 * 「自取那一件浏览器」的**编排层** —— 把「取哪个地址、落到哪个目录、要不要续传」
 * 这三件事接起来（ISSUE #1959 第七跑）。
 *
 * ## 它为什么单独一份文件
 *
 * 判据在 `ci-toolchain-browser-fetch.mjs`（分片 + 续传 + 自读 zip）、地址与版本号在
 * `ci-toolchain-browser-reach.mjs`（探测那一层），而**把两者接起来**这件事不属于其中
 * 任何一边：前者刻意「只 import `node:*`」，后者只回答「这台机器出得去哪个根」。
 * 编排放这里还有个硬理由：`ci-toolchain-browser.mjs` 是 900 行的硬闸（§12.6 R5）
 * 守着的文件，这一段接进去就超了 —— 而出口只有拆。
 *
 * ## 它与 `playwright install` 的分工
 *
 * 它是**尝试**，不是判据：成功就等于那一件装好了（并写好上游那份
 * `INSTALLATION_COMPLETE` 标记）；失败则一个字都不改，原样交给 Playwright 的老路。
 * 放行判据始终是 `browserExecutableExists()`（按落点看东西在不在）—— 这里不新增
 * 第二个判据。
 *
 * ## ⚠️ 「写好标记 ⇒ `playwright install` 是 no-op」这句**被实测订正过**
 *
 * `cnb-7oo-1k51r518b`（恢复那一格之后的第一跑）里自取**成功了** —— 119 MiB 的
 * headless shell 落到落点、`INSTALLATION_COMPLETE` 也写了，而 `playwright install`
 * 照旧要碰网：它不只装浏览器，还会顺手拉 **ffmpeg**（chromium 的依赖，~2.5 MB），
 * 那一件在同一条链路上 5 次 `timed out after 120000ms`、0 字节 ⇒ 整格红在一件
 * **已经装好的浏览器**旁边，读起来像「浏览器没装成」。
 *
 * 所以调用方在看到 `ok: true` 之后**再按落点复验一次**（同一个判据），通过就跳过
 * 老路 —— 本档真正要的是 headless shell（`browserExecutableExists()` 找的就是它），
 * 而 ffmpeg 只有录视频才用得上（本仓 `playwright.config.ts` 没开 `video`）。
 * 这条口径在 `.cnb.yml` 那一步的实现里只有一行，理由与读数都在这里与规范
 * §13.5.3.5 最后一节（那一处文件正卡在 900 行的硬闸上，写不下第二段注释）。
 *
 * ## 为什么需要它：Playwright 那条路**没有续传**
 *
 * 上游 `browserFetcher.ts` 每个 URL 重试 `retryCount = 5` 次，而每一次失败都
 * `unlink(zipPath)` + `removeFolders(browserDirectory)`，**从第 0 字节重来**。
 * 一条「能握手、能吐前几 KB、然后在大 body 上停住」的链路（自托管节点七跑以来的形态）
 * 因此永远到不了 114 MiB 的尽头，换多少个根都一样。
 */
import {
  PLAYWRIGHT_HOST_CANDIDATES,
  playwrightProbeUrl,
  readPlaywrightBrowserTarget,
} from "./ci-toolchain-browser-reach.mjs";
import {
  PLAYWRIGHT_FALLBACK_BROWSER_REVISION,
  browserDirName,
  fetchPlaywrightBrowser,
  playwrightExeName,
} from "./ci-toolchain-browser-fetch.mjs";

/**
 * 「自取那一件浏览器」这一步 —— 只在**它成功**时回报 `ok: true`，失败一律是「换条路」。
 *
 * ## 用哪个 URL / 哪个根
 *
 * 与装那一步**同一个根**：`env.PLAYWRIGHT_DOWNLOAD_HOST` 配着就用它，没配就按
 * `PLAYWRIGHT_HOST_CANDIDATES` 的**第一个**（现在是 `cdn.npmmirror.com/binaries/playwright`
 * —— 用户那一句「`playwright install` 很慢」要的就是「先试离得近的源」，见候选表的头注）。
 * 这里刻意**不**自己做一遍「先量再挑」的排序：那件事已经由 `pickPlaywrightRoots()`
 * 在装那一步做了，而两边各排一次序会漂（§12.18 那条「不造第二轮子」）。
 *
 * ## 为什么它失败不许把这一步判红
 *
 * 它是一条**尝试**。老路仍有机会成功（比如落点里其实已经有了、或 Playwright 那个根
 * 恰好是通的），所以调用方拿到 `ok: false` 时只打一行读数、照走原流程。
 *
 * @param {{
 *   seed?: typeof fetchPlaywrightBrowser,
 *   env: Record<string, string | undefined>,
 *   root: string,
 *   log?: (line: string) => void,
 * }} input
 * @returns {{ok: boolean, out: string}}
 */
export function seedBrowserOnOwn({ seed = fetchPlaywrightBrowser, env, root, log = () => {} }) {
  const target = readPlaywrightBrowserTarget();
  const dirName = browserDirName(target, PLAYWRIGHT_FALLBACK_BROWSER_REVISION);
  if (!dirName) {
    /* 读不到 `revision` ⇒ 不猜目录名（拿错一个号的后果是「装了一份没人会用的东西」，
     * 而它看起来与成功逐字同形）。 */
    return { ok: false, out: "读不到 browsers.json 里的 revision，不猜目录名" };
  }
  const chosenRoot = env.PLAYWRIGHT_DOWNLOAD_HOST ?? PLAYWRIGHT_HOST_CANDIDATES[0];
  if (!chosenRoot) {
    return { ok: false, out: "没有可用的下载根（候选表为空）" };
  }
  const url = playwrightProbeUrl(chosenRoot, {
    version: target?.version,
    target: target?.target,
  });
  log(`自取：从 ${chosenRoot} 分片取这一件（可续传，断了接着来）`);
  try {
    return seed({
      url,
      root,
      dirName,
      marker: "INSTALLATION_COMPLETE",
      exeName: playwrightExeName(),
    });
  } catch (error) {
    /* 这一步不该把整条流水线的收场从「Playwright 试过没有」变成「自取抛了」。 */
    return {
      ok: false,
      out: `自取本身出错：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
