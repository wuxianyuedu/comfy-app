/**
 * 「这个下载根**到不到得了**」那一层 —— 给 `浏览器安装` 的失败取证与
 * `环境前提` 的前置判定用（ISSUE #1961 / #1966）。
 *
 * ## 它为什么是一份独立文件（而不是留在 `ci-toolchain-browser.mjs` 里）
 *
 * 按**职责**拆，与拆分 `ci-toolchain-python.mjs` / `ci-toolchain-browser.mjs` 是同一个
 * 动作、同一条理由（§12.6 R5 的 900 行硬闸，这一层没有基线可登记，出路只有拆）：
 *
 *   · 本文件回答「这台机器**出得去哪个下载根**」——即「探测」这件事本身，
 *     含探测用什么地址、怎么算通、怎么拼真资源 URL；
 *   · `ci-toolchain-browser.mjs` 回答「Playwright 要用的浏览器在不在、弄不到时
 *     怎么弄到手」（装、复验、落点解析、失败话术）。
 *
 * 两边的**消费者**因此也分得开：`环境前提`（`.mjs`，装依赖之前）只用本文件；
 * `浏览器安装` 用前者、在失败分支里 import 本文件的那几条读数。
 *
 * ## 与兄弟约束逐字相同：只 import `node:*`，不 import 仓库内任何模块
 *
 * 这是流水线首部的一步，要能在「Node 模块链还没被证明可用」的机器上给出可读输出
 * —— 模块加载崩掉时报错会落在一句 `Cannot find module` 上，而那时真正要回答的
 * 「这台机器上有什么」一个都没答。
 *
 * ## 这一层为什么容易写错（它真的错过一次）
 *
 * 这里的每一个候选都是**下载根**，而根与「真资源」是两个不同的地址：根对
 * `cdn.playwright.dev` / `cdn.npmmirror.com/binaries/playwright` 都回 4xx，
 * 而真资源（`builds/cft/<版本>/<档>/<包>`）在 2xx/3xx。拿裸根 HEAD 去判
 * 「通不通」，得到的是一句**反过来的话** —— 现场就是它：`环境前提` 在 41 秒处
 * 当场红说「一个下载根都到不了」，而配置里那个根好着（ISSUE #1966）。
 * 所以本文件的探测一律经 {@link playwrightProbeUrl} 拼上真资源路径再量。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 候选下载**根** —— **只用来探测**（不参与「装」那一步的选择）。
 *
 * 这几个不是「本仓推荐的镜像」，是「值得先量一下的几个地址」：
 *
 *   · Playwright 对**本档这一件**真正会用的那一个镜像（`cftUrl()` 的 `mirrors`，
 *     只有一条 —— 与那张三档的 `PLAYWRIGHT_CDN_MIRRORS` 不是一回事，见下）；
 *   · 常见的 npm 二进制镜像里放 Playwright 的那两段路径。
 *
 * ## ⚠️ 它们是**根**（base），不是可以直接探测的地址
 *
 * 这一条是本表最容易读错的地方，也是 `环境前提` 那一步误报的唯一根因（ISSUE #1966）。
 * 这几行从来就是「下载根」——`runPlaywrightInstall()` 把它们当 `PLAYWRIGHT_DOWNLOAD_HOST`
 * 传给 Playwright，而 Playwright 会在后面**再接上 `builds/cft/<版本>/<平台>/<包>` 那段路径**。
 * 裸着拿它们去问「通不通」是另一次探测，答的也不是同一个问题：
 *
 * 实测（本机，同一时刻）：
 *
 *     https://cdn.npmmirror.com/binaries/playwright                       → HTTP 404
 *     https://cdn.npmmirror.com/binaries/playwright/builds/cft/…/…zip     → HTTP 200
 *     https://cdn.playwright.dev                                          → HTTP 400
 *     https://cdn.playwright.dev/builds/cft/…/…zip                        → HTTP 307
 *
 * 也就是说：**裸根对这两个地址都是 4xx，而真资源都在**。拿裸根的结论去判
 * 「这一趟装得成吗」，得到的是一句反过来的话（`cnb-3c1-1k51dq17k`：
 * 「一个下载根都到不了」当场红，而 `.cnb.yml` 里配的那个根其实好着）。
 * 所以探测一律经 {@link playwrightProbeUrl} 拼上**真资源路径**再量
 * —— 判据与它要说明的那件事（装不装得成）这时才指的是同一个东西。
 *
 * @returns {string[]}
 */
export const PLAYWRIGHT_HOST_CANDIDATES = [
  /* Playwright 对**本档这一件**（Chromium 的 CfT 包）真正会用的那个镜像。
   *
   * 这一行是拿上游源码核出来的，不是抄那张「内置镜像」表抄来的：
   * `cftUrl()`（`playwright-core/lib/coreBundle.js`）对 `chromium` /
   * `chromium-headless-shell` 返回的是 `{ mirrors: ["https://cdn.playwright.dev"] }`
   * —— CfT 包**只有这一个**内置镜像，与那张 `PLAYWRIGHT_CDN_MIRRORS` 三档是**两回事**
   * （那三档服务的是老的 `builds/chromium/<revision>/…` 路径形状）。
   *
   * ⚠️ 正因为是两回事，原来表里那两条 `…/dbazure/download/playwright` 在这里是
   * **结构性错的**：给它们接上 `builds/cft/<版本>/<档>/<包>`，`cdn.playwright.dev`
   * 那条会 307 跳到 `playwright.download.prss.microsoft.com/dbazure/download/playwright/…`
   * 然后 **400**，另一条直接 400。实测（本机，两条都跟着跳）：
   *
   *     https://cdn.playwright.dev/dbazure/download/playwright/builds/cft/…/…zip
   *       → 307 → https://playwright.download.prss.microsoft.com/dbazure/download/playwright/… → 400
   *     https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/cft/…/…zip
   *       → 400
   *
   * 也就是说这两条**永远不可能供上这一件**。留在表里只有一个后果：读数里多两条
   * 恒假的「到不了」，而人照它去「换一个能通的根」会换到一个保证 400 的地址
   * （现场 `cnb-oqf-1k51ifhis` 那两条逐字就是 400）。 */
  "https://cdn.playwright.dev",
  /* 常见 npm 镜像里放 Playwright 二进制的那两段路径（第三方，**不替它选**，
   * 只量一下「能不能到」）。 */
  "https://registry.npmmirror.com/-/binary/playwright",
  "https://cdn.npmmirror.com/binaries/playwright",
];

/**
 * 本档要下的那一件在 CDN 上的**子路径**（`浏览器安装` 真正会取的 URL 的尾巴）。
 *
 * 从上游抄的是**形状**不是值：`playwright-core/lib/coreBundle.js` 的
 * `cftUrl(suffix)` 拼的是 `builds/cft/${browserVersion}/${suffix}`，而
 * `chromium-headless-shell` 的 win64 档是 `win64/chrome-headless-shell-win64.zip`
 * （`browsers.json` 里 `browserVersion` 现在是 `153.0.8010.12`、`revision` 是 `1243`）。
 *
 * 两边都**不写死在判据里**：
 *
 *   · 版本号与包名从 `playwright-core` 的 `browsers.json` **现读**（`pnpm` 装完之后
 *     它就在盘上）；读不到才退回这里的一档缺省；
 *   · 平台档由 `process.platform` 推。
 *
 * 理由是这条判据的**目的**：它要回答「这一趟装得成吗」，而「这一趟」用的就是仓里
 * 锁着的那一版 Playwright —— 把版本写死等于让判据与它判的东西各走各的
 * （上游一升，判据还在量一个已经不存在的 URL，形态是**永远绿**：比红更坏）。
 */

/** 上游 `browsers.json` 的版本号读不到时用的那一档（**缺省**，不是判据）。 */
export const PLAYWRIGHT_FALLBACK_BROWSER_VERSION = "153.0.8010.12";

/**
 * 那一份 `browsers.json` **可能落在哪几个位置**（按本仓实际布局，最近的在前）。
 *
 * 本仓装的是 `@playwright/test`，而 `browsers.json` 在它依赖的 `playwright-core` 里
 * —— pnpm 的严格布局下**它不会 hoist 到 `node_modules/` 根**，所以「按根目录
 * `node_modules/playwright-core` 找」这条路在本仓**恒找不到**（实测：
 * `createRequire().resolve("playwright-core/browsers.json")` 在仓库根回
 * `MODULE_NOT_FOUND`）。三个位置依次试：
 *
 *   1. `node_modules/playwright-core/`            —— npm / yarn 那类 hoist 布局；
 *   2. `node_modules/@playwright/test/node_modules/playwright-core/` —— 嵌套布局；
 *   3. `node_modules/.pnpm/playwright-core@<版本>/node_modules/playwright-core/`
 *      —— **pnpm 的实际布局**，版本段现扫目录（不写死版本号：它是这条判据要避免的
 *      那件事本身）。
 *
 * @param {string} base 仓库根
 * @returns {string[]}
 */
function playwrightBrowserJsonCandidates(base) {
  const nm = path.join(base, "node_modules");
  const out = [
    path.join(nm, "playwright-core", "browsers.json"),
    path.join(
      nm,
      "@playwright",
      "test",
      "node_modules",
      "playwright-core",
      "browsers.json",
    ),
    /* pnpm 的 `.pnpm/node_modules/` 那层软链也要试：实测本机从它下面**解析得到**
     * `playwright-core`（见 `.pnpm/node_modules/playwright-core`）。 */
    path.join(nm, ".pnpm", "node_modules", "playwright-core", "browsers.json"),
  ];
  try {
    for (const entry of readdirSync(path.join(nm, ".pnpm"))) {
      if (!entry.startsWith("playwright-core@")) continue;
      out.push(
        path.join(
          nm,
          ".pnpm",
          entry,
          "node_modules",
          "playwright-core",
          "browsers.json",
        ),
      );
    }
  } catch {
    /* 没装依赖时 `.pnpm` 根本不在 —— 那不是错误，下面会退回缺省。 */
  }
  return out;
}

/**
 * `playwright-core` 里那一份 `browsers.json` 的读数（读不到回 `null`）。
 *
 * 这一步跑在流水线**首部**（`环境前提` 在 `Install dependencies` 之前），
 * 那时依赖**还没装**、必然读不到。所以调用方必须能吃 `null`（退回缺省），
 * 而不是把它当错误：这条判据在装依赖前后的两种机器上都得出得了结论。
 *
 * 因此**不用** `createRequire` / `import()` 去解析（那会真去装 / 真去加载依赖），
 * 只做几次 `readFileSync` —— 本文件「只 import `node:*`」那条约束的另一形态。
 *
 * @param {{root?: string}} [options]
 * @returns {{version: string, target: string} | null}
 */
export function readPlaywrightBrowserTarget({ root = undefined } = {}) {
  const base =
    root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  /** @type {string | null} */
  let text = null;
  for (const candidate of playwrightBrowserJsonCandidates(base)) {
    try {
      text = readFileSync(candidate, "utf8");
      break;
    } catch {
      /* 这个位置上没有，试下一个。 */
    }
  }
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    const entry = (parsed?.browsers ?? []).find(
      (/** @type {{name?: string, browserVersion?: string}} */ b) =>
        b?.name === "chromium-headless-shell",
    );
    if (!entry?.browserVersion) return null;
    return {
      version: String(entry.browserVersion),
      target: platformTargetSuffix(),
    };
  } catch {
    return null;
  }
}

/**
 * 本平台在 CDN 路径里的档位段（`win64` / `linux64` / `mac-arm64` …）。
 *
 * 取值与 `browsers.json` 的 `downloadURLs` 键逐字对应；认不出的平台回 `win64`
 * —— 本档的**判据场合**是那条自托管 Windows 流水线，而这里多一层「认不出就猜」
 * 只会让判据说一句它不知道的话（真要多平台得按 `readDescriptors` 那套抄，
 * 那不值得为一条**探测读数**铺开）。
 *
 * @returns {string}
 */
function platformTargetSuffix() {
  if (process.platform === "win32") return "win64";
  if (process.platform === "darwin")
    return process.arch === "arm64" ? "mac-arm64" : "mac-x64";
  return process.arch === "arm64" ? "linux-arm64" : "linux64";
}

/**
 * 「这一趟真要下的那件包」在某个下载根下拼出来的 URL。
 *
 * 条形状与上游 `cftUrl()` 逐字一致（见 {@link PLAYWRIGHT_HOST_CANDIDATES} 的头注）：
 *
 *     <根>/builds/cft/<browserVersion>/<目标档>/chrome-headless-shell-<目标档>.zip
 *
 * 根已经带了路径段（`…/dbazure/download/playwright`、`…/binaries/playwright`）时
 * 直接接在后面；裸根（`https://cdn.playwright.dev`）同理。拼之前把根尾部的 `/`
 * 剥掉，免得拼出 `//builds`（有些 CDN 对双斜杠直接 404，那会变成一个假的不通）。
 *
 * @param {string} root 下载根（`PLAYWRIGHT_HOST_CANDIDATES` 的一项，或 env 给的那个）
 * @param {{version?: string, target?: string}} [overrides] 主要给用例注入
 * @returns {string}
 */
export function playwrightProbeUrl(root, overrides = {}) {
  const target = readPlaywrightBrowserTarget();
  const version =
    overrides.version ?? target?.version ?? PLAYWRIGHT_FALLBACK_BROWSER_VERSION;
  const suffix = overrides.target ?? target?.target ?? platformTargetSuffix();
  const base = String(root ?? "").replace(/\/+$/, "");
  return `${base}/builds/cft/${version}/${suffix}/chrome-headless-shell-${suffix}.zip`;
}

/**
 * 逐个量「这台机器出不出得去」并打成读数 —— **只打印、不阻断**。
 *
 * 与 `pythonForensics` / `pnpmForensics` 同一条口径：失败时给的不是又一句
 * 「网络不通」，而是**这份现场**。它回答的是这一格真正缺的那条事实 ——
 * 「哪条链路走不通」，而那正是「再猜一个镜像」永远回答不了的。
 *
 * 三条边界：
 *
 *   · **它是读数、不是判据** —— 探测要几秒且依赖外网，真正的判据仍是
 *     「装完能起才放行」那一条；
 *   · **它不改配置** —— `PLAYWRIGHT_DOWNLOAD_HOST` 是这台机器的事实
 *     （镜像站在 `.cnb.yml`）。自动改写 = 把一次探测结论冒充成长期决定；
 *   · **它逐个串行、不并发** —— 这几个域在同一张网上，并发只会让慢的那条把
 *     快的一起拖到同一个超时上，读数反而分不开。
 *
 * @param {{candidates?: string[], probe?: (url: string) => string,
 *          probeUrlOf?: (root: string) => string,
 *          updateHost?: string | undefined}} [options]
 *   `probe` 是注入面（默认 {@link httpDownloadProbe}），判据里换掉它就不出网。
 *   `probeUrlOf` 是「根 → 真资源 URL」那一步的注入面（见
 *   {@link playwrightReachabilityVerdicts}：量的是真资源不是裸根）。
 * @returns {string[]}
 */
export function playwrightReachability({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpDownloadProbe,
  probeUrlOf = playwrightProbeUrl,
  updateHost = undefined,
} = {}) {
  const lines = [
    "---- 这台机器出得去哪些下载域（现场实测，供定位）----",
    /* 量的是**真资源**（见 `playwrightReachabilityVerdicts` 的头注）：裸根的 4xx
     * 不说明任何事，所以这里先把「这一趟真要去取的那个包」说清楚，读数才有意义。 */
    "  下面量的是**这一趟真要下那件包**（不是 CDN 根 —— 根对这几个地址都回 4xx，",
    "  而包在 2xx/3xx；拿裸根判会得到一句反过来的话，ISSUE #1966）：",
  ];
  if (updateHost) lines.push(`  当前 PLAYWRIGHT_DOWNLOAD_HOST: ${updateHost}`);
  for (const r of playwrightReachabilityVerdicts({
    candidates,
    probe,
    probeUrlOf,
  })) {
    lines.push(`  ${r.url} → ${r.verdict}`);
  }
  lines.push(
    "  （判读：全都超时 ⇒ 这台机器出不去这一类 CDN，换镜像也不会变；",
    "    只有某一个通 ⇒ 把它配到 PLAYWRIGHT_DOWNLOAD_HOST 上；",
    "    这一行**不改**配置，它只回答「到得了哪」）",
  );
  lines.push("------------------------------------");
  return lines;
}

/**
 * 上面那份读数的**机器可读形态** —— 逐个候选一个 `{url, verdict, ok}` 三态。
 *
 * ## 为什么它必须与打印那一份同源
 *
 * 「环境前提」那一步要在**装依赖之前**回答「浏览器这一格这回装得成吗」，
 * 而它只能靠**判**（不是打印）来做结论。于是同一个探测会有两个消费者：
 * 一个要人读的字符串、一个要机器判的三态。
 *
 * 这两种消费者各写一份探测定理上没错、工程上是本仓栽过的那一跤
 * （§12.12：跨文件复制实现 ≥75% 重合即孪生）：**两次探测的结论会漂**，
 * 而漂的那一天恰好是它们该互相印证的那一天。所以把「怎么算通」收在这一处，
 * 上面那份打印从它派生 —— 打印与判据共用同一次结论。
 *
 * ## `ok` 的判据
 *
 * 只认 `HTTP <code>` 且**码在 2xx/3xx**（回 200/302 都算这条链路到得了）。
 * 刻意**不**认「超时」与 `ENOTFOUND` —— 那两者在打印里刻意分开
 * （「连上了但不说话」vs「域名都解析不了」），但在**判**这一层它们同属
 * 「这一次到不了」，把它们混进 `ok` 只会让判据骗人。
 *
 * ## 量的是**真资源**，不是裸根（ISSUE #1966）
 *
 * 传进来的每一个候选都是**下载根**，而根本身对这两个地址都回 4xx
 * （`cdn.npmmirror.com/binaries/playwright` → 404、`cdn.playwright.dev` → 400），
 * 真资源却都在 2xx/3xx。拿裸根判「通不通」，得到的是一句反过来的话 ——
 * 现场就是它：`环境前提` 当场红说「一个下载根都到不了」，而配着的那个根好着，
 * 于是整条流水线在 41 秒处停住、后面 30 步全 skipped。
 *
 * 所以这里经 {@link playwrightProbeUrl} 拼上**本档真要下的那件包**的路径再量。
 * 三态里的 `url` 因此是**真资源 URL**（人读的那一份也照它打）——
 * 判据与它要说明的那件事（这一趟装得成吗）这时才指的是同一个东西。
 *
 * @param {{candidates?: string[], probe?: (url: string) => string,
 *          probeUrlOf?: (root: string) => string}} [options]
 *   `probe` 是注入面（默认 {@link httpDownloadProbe}），判据里换掉它就不出网。
 *   `probeUrlOf` 是「根 → 真资源 URL」那一步的注入面（用例据此不必依赖真
 *   `browsers.json` 的读数）。
 * @returns {Array<{url: string, root: string, verdict: string, ok: boolean}>}
 */
export function playwrightReachabilityVerdicts({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpDownloadProbe,
  probeUrlOf = playwrightProbeUrl,
} = {}) {
  return candidates.map((root) => {
    const url = probeUrlOf(root);
    let verdict;
    try {
      verdict = probe(url);
    } catch (error) {
      verdict = `探测本身出错：${/** @type {Error} */ (error).message}`;
    }
    return { url, root, verdict, ok: isReachableVerdict(verdict) };
  });
}

/**
 * 「这次的探测结论算不算到得了」—— {@link playwrightReachabilityVerdicts} 的判据本体。
 *
 * @param {string} verdict
 * @returns {boolean}
 */
export function isReachableVerdict(verdict) {
  const m = /^HTTP\s+(\d{3})\b/.exec(String(verdict ?? "").trim());
  if (!m) return false;
  const code = Number(m[1]);
  return code >= 200 && code < 400;
}

/**
 * 对**真资源**发一次带 `Range` 的 GET，回一句可读的结论（不回抛 —— 失败是一种读数）。
 *
 * ## 为什么不是 HEAD（这一步错过一次，代价是整条流水线）
 *
 * 这一层此前是 `httpHeadStatus()` —— 发一个 HEAD，看状态码。而 HEAD 答的是
 * 「这个 URL **允不允许**被取」，不是「**取得下来吗**」。两者的分岔在一次现场里
 * 正好落到反面（`cnb-ald-1k51g8dt9`）：
 *
 *     （HEAD 读数）https://cdn.npmmirror.com/binaries/playwright/builds/cft/…/chrome-headless-shell-win64.zip → HTTP 200
 *     （真实下载）Downloading … from 同一个 URL …… 然后 timed out after 120000ms（**0 字节**）
 *
 * 于是 `环境前提` 报绿（「下载根有 5/5 条到得了」），把 30 分钟后的
 * `浏览器安装` 失败**原样放行** —— 而「别等几十分钟才发现」恰恰是那一步存在的全部理由。
 * 一台能做 TLS 握手、能回小响应头、却在**大 body 上停住**的链路（代理 / 深度包检测 /
 * MTU 黑洞）在 HEAD 面前与好链路逐字同形，所以判据必须**真的把字节取回来**。
 *
 * ## 判据的形状
 *
 *   · `GET` + `Range: bytes=0-<chunkBytes-1>` —— 只取开头一段，够证明「字节流得过」；
 *   · `Accept-Encoding: identity` —— 别让 gzip 把「多少字节算到」搅浑；
 *   · **跟随最多 3 次 3xx**（与 Playwright 自己的 `httpRequest` 同口径）：候选根里
 *     `registry.npmmirror.com/-/binary/playwright` 就回 302，裸看不跟随会把它读成
 *     「HTTP 302，没量到东西」；
 *   · **收到第一批字节就收手**（`res.destroy()`）：这一步是**判通不通**，不是下载
 *     —— 早停让它几秒内出结论，也让它与「真下载」量的是同一件事（字节到底流不流）；
 *   · **按 URL 的协议挑模块**：候选根全是 https，但这一层不该只认一种（用例正是拿
 *     本地 http 服务判它的四种现场）。
 *
 * ## 「超时」这一档要分得开两种
 *
 *   · `超时（连上了但 0 字节，Nms 内没有响应）` —— 现场那一档：TCP / TLS 都成了，
 *     响应头也可能来了，**body 一个字节都没有**。处置在宿主机 / 网络侧；
 *   · `超时（Nms 内没有响应）` —— 连都没连上 / 响应头都没来。
 *
 * 两种在 `ok` 那一层同属「这一次到不了」（{@link isReachableVerdict}），但打印里
 * 必须分开 —— 处置不同，糊成一句「不通」等于把下一动作留给人猜。
 *
 * 走 `spawnSync` 起一个短命 node 子进程，而不是在本进程里用回调：**这一步是在失败
 * 分支里同步跑的**（`playwrightOnly` 的退出码要立刻返回）。子进程里只碰 `node:http(s)`
 * —— 本文件「只 import `node:*`」的同一条约束（见文件头）。
 *
 * 子进程的输入走 `process.argv`（URL、超时、分片大小、重定向上限四件），不拼进
 * `-e` 的源码里：拼串会把引号与转义交给运气，而这里比原先多了一个 `Range` 头与
 * 一个重定向计数，风险随参数一起长。
 *
 * @param {string} url
 * @param {{timeoutMs?: number, chunkBytes?: number, maxRedirects?: number}} [options]
 * @returns {string}
 */
export function httpDownloadProbe(
  url,
  { timeoutMs = 8000, chunkBytes = 65536, maxRedirects = 3 } = {},
) {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      DOWNLOAD_PROBE_SCRIPT,
      url,
      String(timeoutMs),
      String(chunkBytes),
      String(maxRedirects),
    ],
    { encoding: "utf8", windowsHide: true, timeout: timeoutMs + 4000 },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return out || "（子进程没有输出）";
}

/**
 * {@link httpDownloadProbe} 在子进程里跑的载荷 —— 独立成常量（不是拼进函数体的
 * 字符串）只有一个理由：它太长，留在函数里会把「做什么」压过「怎么做」，
 * 而它读起来本来就是一段自足的小程序。
 *
 * 四件输入按 argv 顺序读：`[1]` URL、`[2]` 超时、`[3]` 分片大小、`[4]` 重定向上限。
 */
const DOWNLOAD_PROBE_SCRIPT = `
  const { request } = require("node:https");
  const { request: httpRequest } = require("node:http");
  const url = process.argv[1];
  const timeoutMs = Number(process.argv[2]);
  const chunkBytes = Number(process.argv[3]);
  const maxRedirects = Number(process.argv[4]);
  // 「连上了吗」与「字节到了吗」是两件事，超时那一档要靠它们分开。
  let connected = false;
  let gotBytes = false;
  let settled = false;
  const done = (text) => {
    if (settled) return;
    settled = true;
    process.stdout.write(text);
    process.exit(0);
  };
  const attempt = (target, redirectsLeft) => {
    // 按 URL 的协议挑模块（候选根全是 https，但这一层不该只认一种 ——
    // 用例正是拿本地 http 服务判它的四种现场）。
    const send = target.startsWith("http:") ? httpRequest : request;
    const req = send(
      target,
      {
        method: "GET",
        headers: {
          Range: "bytes=0-" + (chunkBytes - 1),
          "Accept-Encoding": "identity",
        },
        timeout: timeoutMs,
      },
      (res) => {
        connected = true;
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          attempt(new URL(res.headers.location, target).toString(), redirectsLeft - 1);
          return;
        }
        if (code >= 400) {
          res.resume();
          done("HTTP " + code);
          return;
        }
        res.on("data", (chunk) => {
          gotBytes = true;
          const seen = chunk.length;
          // 收到第一批字节就够了 —— 这一步判的是「字节流得过」，不是下载。
          res.destroy();
          req.destroy();
          done("HTTP " + code + "（实收 " + seen + " 字节）");
        });
        res.on("end", () => {
          done("HTTP " + code + "（**没量到 body**）");
        });
        res.on("error", () => {
          done("HTTP " + code + "（已收到字节后就断了）");
        });
      },
    );
    req.on("socket", (socket) => {
      if (socket.connecting === false) connected = true;
      else socket.on("connect", () => { connected = true; });
    });
    req.on("timeout", () => {
      req.destroy();
      done(
        "超时（" +
          (gotBytes
            ? "已收到字节但没量完，"
            : connected
              ? "连上了但 0 字节，"
              : "") +
          timeoutMs +
          "ms 内没有响应）",
      );
    });
    req.on("error", (e) => {
      if (gotBytes) return done("HTTP（已收到字节后就断了）");
      done((e.code ?? "ERROR") + "：" + e.message);
    });
    req.end();
  };
  attempt(url, maxRedirects);
`;
