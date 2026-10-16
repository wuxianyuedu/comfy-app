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
 *   · Playwright 自己的三个内置 CDN 根（`PLAYWRIGHT_CDN_MIRRORS`，它自己按序试）；
 *   · 常见的 npm 二进制镜像里放 Playwright 的那两段路径。
 *
 * ## ⚠️ 它们是**根**（base），不是可以直接 HEAD 的地址
 *
 * 这一条是本表最容易读错的地方，也是 `环境前提` 那一步误报的唯一根因（ISSUE #1966）。
 * 这几行从来就是「下载根」——`runPlaywrightInstall()` 把它们当 `PLAYWRIGHT_DOWNLOAD_HOST`
 * 传给 Playwright，而 Playwright 会在后面**再接上 `builds/cft/<版本>/<平台>/<包>` 那段路径**。
 * 裸着去 HEAD 它们问「通不通」是另一次探测，答的也不是同一个问题：
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
  "https://cdn.playwright.dev/dbazure/download/playwright",
  "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
  "https://cdn.playwright.dev",
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
 *   `probe` 是注入面（默认 {@link httpHeadStatus}），判据里换掉它就不出网。
 *   `probeUrlOf` 是「根 → 真资源 URL」那一步的注入面（见
 *   {@link playwrightReachabilityVerdicts}：量的是真资源不是裸根）。
 * @returns {string[]}
 */
export function playwrightReachability({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpHeadStatus,
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
 *   `probe` 是注入面（默认 {@link httpHeadStatus}），判据里换掉它就不出网。
 *   `probeUrlOf` 是「根 → 真资源 URL」那一步的注入面（用例据此不必依赖真
 *   `browsers.json` 的读数）。
 * @returns {Array<{url: string, root: string, verdict: string, ok: boolean}>}
 */
export function playwrightReachabilityVerdicts({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpHeadStatus,
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
 * 对一个 URL 发一次 HEAD，回一句可读的结论（不回抛 —— 失败是一种读数）。
 *
 * 走 `spawnSync` 起一个短命 node 子进程，而不是在本进程里用回调：**这一步是在失败
 * 分支里同步跑的**（`playwrightOnly` 的退出码要立刻返回）。子进程里只碰 `node:https`
 * —— 本文件「只 import `node:*`」的同一条约束（见文件头）。
 *
 * 「超时」与「`ENOTFOUND`」刻意分开：前者是「连上了但不说话」（链路慢 / 被拦），
 * 后者是「域名都解析不了」（DNS 被切）。处置不同，日志里不能糊成一句「不通」。
 *
 * @param {string} url
 * @param {{timeoutMs?: number}} [options]
 * @returns {string}
 */
export function httpHeadStatus(url, { timeoutMs = 8000 } = {}) {
  const script = `
    const { request } = require("node:https");
    const req = request(${JSON.stringify(url)}, { method: "HEAD", timeout: ${timeoutMs} }, (res) => {
      res.resume();
      process.stdout.write("HTTP " + (res.statusCode ?? "?"));
      process.exit(0);
    });
    req.on("timeout", () => { req.destroy(); process.stdout.write("超时（${timeoutMs}ms 内没有响应）"); process.exit(0); });
    req.on("error", (e) => { process.stdout.write((e.code ?? "ERROR") + "：" + e.message); process.exit(0); });
    req.end();
  `;
  const r = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs + 4000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return out || "（子进程没有输出）";
}

/**
 * 一个探测结论的**三态**：到得了（`ok`）/ 没量完（`timeout`）/ 到不了（`worse`）。
 *
 * 这一层是「选哪个根」的判据本体，与 {@link isReachableVerdict} 是**两个问题**：
 * 后者答「装得成吗」（放行那条判据），本函数答「这几个里先试哪个」。
 * 两者的**红法不一样**：
 *
 *   · `ok: false` 三种形态都不放行 —— 那是 `环境前提` 那条判据的事；
 *   · 而在「都不到 2xx」的机器上，`timeout` 是**唯一值得再试一次**的那一种：
 *     `超时（8000ms 内没有响应）` 的意思是「连上了但不说话」（大包在慢链路上正常），
 *     而 `ENOTFOUND` / 4xx 是「这条链路不通」，再试一次不会变。
 *
 * ## 现场（`cnb-t3f-1k51ho0k2`，本格的第六次红）
 *
 * 探测量到 `cdn.playwright.dev` → `HTTP 307`、npmmirror → `HTTP 200`，
 * 百毫秒级；而**装**那一步在同一个根上拿到 `timed out after 120000ms`
 * （Playwright 走的是 GET 拉包，120 MiB）。同一台机器、同一分钟、两个相反结论
 * —— 差别在「一次 HEAD」与「拉完整个包」不是同一次测量。
 *
 * 所以 `HTTP 2xx` 只是**首选**，不是**唯一**：2xx 排在前面（它就是「这一趟量得完」
 * 的那一档），4xx 与超时按原序跟在后面。这不是「放宽判据」—— 放行那条判据仍是
 * 「装完能起才放行」，这里只决定**先试哪个根**。
 *
 * @param {string} verdict {@link httpHeadStatus} 那一句
 * @returns {"ok" | "timeout" | "worse"}
 */
export function probeGrade(verdict) {
  const text = String(verdict ?? "").trim();
  if (/^超时/.test(text)) return "timeout";
  const m = /^HTTP\s+(\d{3})\b/.exec(text);
  if (!m) return "worse";
  const code = Number(m[1]);
  /* 3xx 也算「量得完」：`cdn.playwright.dev` 那一族回的就是 307（它自己再跟一跳）。
   * 与 {@link isReachableVerdict} 同一条口径 —— 两处判「什么算到得了」必须一致。 */
  return code >= 200 && code < 400 ? "ok" : "worse";
}

/**
 * 从实测读数里挑出**这一趟该用哪个下载根**（挑不出回 `candidates[0]`，宿主默认）。
 *
 * ## 它修的那一格：一条探测读数与一次装之间从来没有过执行者
 *
 * `环境前提` 早就在量「这台机器到得了哪个下载根」，`.cnb.yml` 也早就配了一个根
 * —— 而**这两者之间没有任何东西把它们连起来**：探测发现配着的那个根不通时，
 * 结论只落在一行会随日志滚过去的读数里，装那一步照旧去试那个根，然后红。
 *
 * 实测形态（`cnb-gt1-1k513ill4` / `cnb-g9d-1k515kvrq` / `cnb-t3f-1k51ho0k2`）：
 * 同一句 `timed out after 120000ms`、同一个根，连着三次。
 *
 * ## 与 `playwrightDownloadRoots()` 的分工（**「给上了就只用它」没有被推翻**）
 *
 * 那条判据说的是「外面给了一个根时**别再陪 Playwright 挨个试它那一族内置镜像**」
 * —— 它反对的是**盲目重试同族**（实测 5 次全落在同一个域名上、`retryCount = 5`
 * 的回退等于没有）。本函数做的是另一件事：**先量一次，再决定先试哪个**。
 * 量出来的结论要能被 `点名的那个根不通 ⇒ 试一个量得到的根` 用掉，
 * 否则这条判据就成了「配错一行要改配置 + 重推」。
 *
 * 因此两支的判据仍然分得开，都判：
 *
 *   · 没过量 ⇒ 只起一次、只试 `roots[0]`（老判据，`playwrightDownloadRoots` 那组用例守着）；
 *   · 量过、且 `roots[0]` 到得了 ⇒ 也**只试它**（别去试那些不通的）；
 *   · 量过、且 `roots[0]` 不通 ⇒ 把量得到的排前面，原序兜底。
 *
 * ## 为什么排在前面的是**候选表**而不是「探测到的那个」
 *
 * 因为探测在**另一个进程**里（`环境前提` stage 的 env 看不到 `浏览器安装` stage 的
 * `env`，反向也一样）。要落地就得把结论写进 env 或落盘一份 —— 前者要改配置
 * （「配错一行要改配置重推」正是要治的那件事）、后者多一份会过期的状态。
 * 所以在装这一步**现量一次**：几秒、无副作用，且用的就是与 `环境前提` 同一份探测
 * （§12.18：打印与判据共用同一次结论，不造第二轮子）。
 *
 * @param {{roots?: Array<string | undefined>, candidates?: string[],
 *          probe?: (url: string) => string,
 *          probeUrlOf?: (root: string) => string}} [options]
 * @returns {{roots: Array<string | undefined>, verdicts: Array<{root: string, verdict: string, grade: string}>, probed: boolean, switched: boolean}}
 */
export function pickPlaywrightRoots({
  roots = [undefined],
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = undefined,
  probeUrlOf = playwrightProbeUrl,
} = {}) {
  const preferred = roots[0];
  /* **没给探测面就什么都不量**（这一支是有意的，不是省事）。
   *
   * 探测是要**出网**的（每个候选一次 HEAD）—— 而本函数是装浏览器那一步的缺省路径。
   * 让缺省路径在“没接线”时静默去量真 CDN，等于给判据留一个「跑一次用例就发几次
   * 外网请求」的副作用（本仓反复记的那一格：判据不该依赖跑它的那台机器的网络）。
   * 所以量不量这件事由**调用方是否传它自己的探针**决定：
   *
   *   · 调用方传了 ⇒ 用它的（盘上的实现是 `httpHeadStatus`），且只量它会用的根；
   *   · 没传 ⇒ 一个字都不量，回落到老行为（只试 `roots[0]`）。
   *
   * 判据里因此可以「换掉它就不出网」，而平台侧那条路一定传（见
   * `runPlaywrightInstall` 的 `probe` 缺省）。 */
  if (typeof probe !== "function") {
    return { roots, verdicts: [], probed: false, switched: false };
  }
  /* 外部给的根要参与探测，但**不塞进候选表** —— 候选表是「除了它还能试哪儿」，
   * 而 `undefined` 那一档是「什么都不给，走 Playwright 自己的内置族」，
   * 它没有地址可量（那一族由 Playwright 自己挨个试）。 */
  const extra = preferred ? [preferred] : [];
  const list = [...new Set([...extra, ...candidates])];
  const verdicts = list.map((root) => {
    let verdict;
    try {
      verdict = probe(probeUrlOf(root));
    } catch (error) {
      verdict = `探测本身出错：${/** @type {Error} */ (error).message}`;
    }
    return { root, verdict, grade: probeGrade(verdict) };
  });
  /* 稳定排序：2xx 那一档在前，其余**保持原序**（`Array#sort` 在 V8 上稳定，
   * 而这里的 `ok` 权重只有两档 —— 不去造一个会让读数顺序漂的复杂排序）。 */
  const ok = verdicts.filter((v) => v.grade === "ok").map((v) => v.root);
  const rest = list.filter((root) => !ok.includes(root));
  const ordered = [...ok, ...rest];
  const first = ordered[0];
  return {
    roots: ordered.length > 0 ? ordered : roots,
    verdicts,
    probed: true,
    switched: Boolean(preferred && first !== preferred),
  };
}
