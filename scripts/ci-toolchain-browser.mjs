/**
 * 「Playwright 的浏览器在不在」那一层 —— 给「E2E 之前」那一步用（ISSUE #1961）。
 *
 * ## 它为什么是一份独立文件（而不是留在 `ci-toolchain-selfcheck.mjs` 里）
 *
 * 按**职责**拆，与拆分 `ci-toolchain-python.mjs` 是同一个动作、同一条理由（§12.6 R5
 * 的 900 行硬闸，这一层没有基线可登记，出路只有拆）：
 *
 *   · 本文件回答「Playwright 要用的浏览器在不在、弄不到时怎么弄到手」；
 *   · `ci-toolchain-selfcheck.mjs` 回答「这台机器够不够跑门禁链」（四件工具链的
 *     判据与话术）与整机的编排打印。
 *
 * 与 `ci-toolchain-python.mjs` 的约束逐字相同：**只 import `node:*`，不 import 任何
 * 仓库内模块** —— 这是流水线首部的一步，要能在「Node 模块链还没被证明可用」的机器上
 * 给出可读输出（模块加载崩掉时报错会落在一句 `Cannot find module` 上，而那时真正要
 * 回答的「这台机器上有什么」一个都没答）。唯一的外部依赖是调用方注入进来的两个缝
 * （`findPnpm` / `run`），它们由 `ci-toolchain-selfcheck.mjs` 传进来 —— 那边本来就
 * 有「怎么探 pnpm」那份判据（§12.18：不造第二轮子）。
 *
 * ## 它修的那一格（自托管节点的首次真跑）
 *
 * `E2E 关键流程` 是这条流水线上**从来没有跑过**的一档（前几跑都断在 `单元测试` 或
 * `生产构建`）。它一跑到就红在浏览器缺件上：自托管节点是**裸宿主机**，没有
 * `docker.image` 那种「镜像里预装好浏览器」的兜底，而 `pnpm install` 不会拉
 * Playwright 的浏览器二进制（那是 `playwright install` 的事）。
 *
 * 那台机器上的读数（`cnb-0rd-1k50unpnn`）：
 *
 *     期望的路径：…\ms-playwright\chromium_headless_shell-1243\…\chrome-headless-shell.exe
 *
 * ## 为什么是「装」而不是「判红让人去装」
 *
 * 与 Python 那一步的分工不同：解释器可能在盘上、只是这个执行账号的 PATH 看不见它
 * （那一格要人改 PATH，所以 `--python-only` 探到就退 0、探不到才红并给出取证）；
 * 而浏览器二进制**只可能来自这一条命令**，机器上不存在「装了但探不到」的分支。
 * 所以这里直接装 —— 装完再探一次才算数（与 `installPython` 的复验同一条口径：
 * 安装器退 0 不等于东西真在）。
 *
 * 幂等：`playwright install` 对已存在的版本是 no-op（实测秒级返回）。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * 只答「Playwright 要用的浏览器在不在」并据此退码 —— 给「E2E 之前」那一步用。
 *
 * ## 注入面（本文件不 import 仓库内任何东西，见文件头）
 *
 *   · `find`  —— 「pnpm 在哪、怎么起」那份判据（`.cnb.yml` 那条流水线上传的是
 *                `ci-toolchain-selfcheck.mjs` 的 `findPnpm()`）。**必传**。
 *   · `exec`  —— 起一次进程（同上，传它的 `run()`）。**必传**。
 *   · `log` / `logError` / `section` —— 打印三件，缺省即 `console.*` / 空分节。
 *
 * `find` / `exec` 走 `required()` 而不是给个缺省实现：这一层的**全部**结论都建在
 * 它们之上，一个静默的假实现会把它变成「永远报绿」——那正是本文件存在的意义反面。
 *
 * @param {{
 *   find?: () => {ok: boolean, command: string, prefixArgs: string[], args: string[], out: string},
 *   exec?: (cmd: string, args: string[], downloadHost?: string) => {ok: boolean, out: string},
 *   env?: Record<string, string | undefined>,
 *   probe?: (url: string) => string,
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   section?: (title: string) => void,
 * }} [ports]
 *   `exec` 的第三个参数是**这一次要用的下载根**（`PLAYWRIGHT_DOWNLOAD_HOST`），
 *   只有装浏览器那一步会带 —— 调用方要把它转交到子进程的 env 上。
 *   `probe` 只在失败分支里用（`playwrightReachability`），判据里换掉它就不出网。
 * @returns {number} 退出码
 */
export function playwrightOnly({
  find = required("find"),
  exec = required("exec"),
  env = process.env,
  probe = httpHeadStatus,
  log = console.log,
  logError = console.error,
  section = noopSection,
} = {}) {
  section("playwright");
  /* **先按落点判一次，装过的就不装**（ISSUE #1961 第三跑）。
   *
   * 这不是省时间，是**让这一格在「网络不通」时仍然是绿的**：自托管节点是台长期存在的
   * 机器，浏览器一旦落地就一直在那儿，而下一次跑并不需要重新下载。原先是无条件
   * `playwright install` —— 于是链路一抖，一条**本来什么都不缺**的流水线也会红在
   * 这里（`cnb-gt1-1k513ill4`：1732s 的门禁全绿，最后红在这一步的下载上）。
   *
   * 判据仍然是「东西落地了」（与下面那条复验同一份实现），所以这一支不会把
   * 「装了一半」放过去 —— 它只在**那一件齐了**时才提前返回。 */
  const already = browserExecutableExists({ env });
  if (already.ok) {
    log(`已装，跳过下载：${already.out}`);
    return 0;
  }
  /* **只装这一档真正要的那一件**（`BROWSER_PACKAGES`，见它的头注）：本仓只有
   * **一个** headless project，真被启动的是 `chromium-headless-shell`，而
   * `chromium` 那一件是 `chrome-win64.zip` **205 MB** —— 实测这台节点把前者拉到
   * 120s 超时收场（同一镜像上 120 MB 那件是好的）。少装它**不改判据**（复验找的
   * 本来就是 headless shell），而它是「多下一件以防万一」变成红的唯一原因。 */
  if (env.PLAYWRIGHT_DOWNLOAD_HOST) {
    log(`下载根由 PLAYWRIGHT_DOWNLOAD_HOST 指定：${env.PLAYWRIGHT_DOWNLOAD_HOST}`);
  }
  const install = runPlaywrightInstall({ find, exec, env });
  log(install.out || "(playwright install 没有输出)");
  if (!install.ok) {
    logError(
      "\n浏览器装不上（`playwright install` 退非零）。它的出口与 Python 不同 ——" +
        "浏览器二进制只可能来自这一条命令，机器上没有「装了但探不到」的分支，" +
        "所以这里不是「取证给人看」，是这一步真的没做成功。",
    );
    /* 失败话术后面跟**读数**，而不是又一句「常见成因：网络不通或磁盘满」——
     * 那两种成因的处置完全相反（一个是放宽多久算超时、一个是清盘），
     * 而日志里此前一个字都分不开它们。见 `playwrightInstallHints()`。 */
    for (const line of playwrightInstallHints(install.out)) log(line);
    /* 失败之后**当场量一次**「这台机器到底出得去哪些域名」。
     *
     * 这是本格最贵的一次教训（ISSUE #1961 第四跑）：镜像那一行是**在别处**量出来能用的
     * （`cdn.npmmirror.com` 回 200、15s 收到 99 MiB），而它在**这台节点**上照旧
     * `timed out after 120000ms` —— 于是「换个镜像」这个动作**看起来做了、实际没解决**，
     * 下一次红的形态与前一次逐字相同，只换了个域名。
     *
     * 所以缺的不是「再猜一个镜像」，是**一条关于这台机器的事实**：它出得去哪些域名。
     * 那一条只能在这儿量 —— 探测很便宜（每个地址一次 HEAD），而它把「下一动作」
     * 从猜测变成读数。 */
    for (const line of playwrightReachability({
      probe,
      updateHost: env.PLAYWRIGHT_DOWNLOAD_HOST,
    })) {
      log(line);
    }
    return 1;
  }
  /* **装完必须复验**（与 `installAndReverify` 的「装完回到 `findPython()` 再探一遍」
   * 同一条口径）：`playwright install` 退 0 **不等于**二进制落地了。理由与判据见下。 */
  const present = browserExecutableExists({ env });
  if (!present.ok) {
    logError(
      "\n`playwright install` 报了成功，但**那一件二进制不在盘上**。" +
        "退 0 与「东西落地了」是两件事（下载被截断、落点不可写、CDN 回了一份错误页" +
        "——最后那种恰好退 0），只有按落点看一眼才发现得了。",
    );
    logError(`  复验读数：${present.out}`);
    logError(
      "  下一动作：确认这次执行账号的落点根与上面那一步用的是同一个" +
        "（`PLAYWRIGHT_BROWSERS_PATH` 未设时按账号 profile 推断，" +
        "而 Runner 用的可能是另一份 profile —— 与 Python 那格「装了但账号看不见」同一个病）。",
    );
    return 1;
  }
  log(`复验：${present.out}`);
  return 0;
}

/**
 * 没接线就当场说清楚 —— 比让调用方拿到一个 `undefined is not a function` 强。
 *
 * @param {string} what
 * @returns {never}
 */
function required(what) {
  throw new Error(
    `ci-toolchain-browser：缺 ${what} 注入面（由调用方传入，见文件头）`,
  );
}

/** 默认什么都不打的分节 —— 调用方不关心分节时就别硬塞一行。 */
function noopSection() {}

/**
 * 装浏览器失败时那几条**读数**（而不是又一句「网络不通或磁盘满」）。
 *
 * ## 现场（`cnb-rkr-1k510rsgg` 的 `浏览器安装` stage）
 *
 * 下载卡在这一句上：
 *
 *     （原文）Error: Request to https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/
 *     （原文）chrome-win64.zip timed out after 30000ms
 *
 * 那时这一步还退 0（退出码被守卫吞掉，见本笔的姐妹修法），所以「为什么没装上」
 * 在整条构建日志里一个字都读不到 —— 而 E2E 会照旧报缺件，两个读数互相矛盾。
 *
 * ## 为什么这两个成因必须分开
 *
 * `timed out after 30000ms` 里的 30s 是 Playwright 的默认**套接字**超时
 * （`NET_DEFAULT_TIMEOUT`），而包是 180 MiB —— 在慢链路上它不是「这个地址不通」
 * 的结论，是「这一次没量完」。两者的处置相反：
 *
 *   · 换镜像：`PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>`；
 *   · 放宽多久算超时：`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000`。
 *
 * 两个都是 Playwright 自己的环境变量，本仓不发明第二套（§12.18）。
 * 只有真撞上「下载失败」字样时才打 —— 别的失败形态（pnpm 不可用、盘满）不需要
 * 这两条建议，凑上去只会让人往错的方向看。
 *
 * @param {string} out `playwright install` 的输出
 * @returns {string[]}
 */
/**
 * 候选下载根 —— **只用来探测**（不参与「装」那一步的选择）。
 *
 * 这几个不是「本仓推荐的镜像」，是「值得先量一下的几个地址」：
 *
 *   · Playwright 的三个内置 CDN（它自己会试的那几个）；
 *   · 常见的 npm 二进制镜像里放 Playwright 的那两段路径。
 *
 * 探测结论只打印、不阻断，也**不**自动改 `PLAYWRIGHT_DOWNLOAD_HOST` ——
 * 「哪个地址能通」是这台机器的事实，写死的值是给别人那台机器用的
 * （第四次红就是这么来的：镜像在别处量得通，在这台节点上照旧超时）。
 *
 * @returns {string[]}
 */
export const PLAYWRIGHT_HOST_CANDIDATES = [
  "https://cdn.playwright.dev",
  "https://playwright.download.prss.microsoft.com",
  "https://registry.npmmirror.com/-/binary/playwright",
  "https://cdn.npmmirror.com/binaries/playwright",
];

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
 *          updateHost?: string | undefined}} [options]
 *   `probe` 是注入面（默认 {@link httpHeadStatus}），判据里换掉它就不出网。
 * @returns {string[]}
 */
export function playwrightReachability({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpHeadStatus,
  updateHost = undefined,
} = {}) {
  const lines = ["---- 这台机器出得去哪些下载域（现场实测，供定位）----"];
  if (updateHost) lines.push(`  当前 PLAYWRIGHT_DOWNLOAD_HOST: ${updateHost}`);
  for (const r of playwrightReachabilityVerdicts({ candidates, probe })) {
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
 * @param {{candidates?: string[], probe?: (url: string) => string}} [options]
 *   `probe` 是注入面（默认 {@link httpHeadStatus}），判据里换掉它就不出网。
 * @returns {Array<{url: string, verdict: string, ok: boolean}>}
 */
export function playwrightReachabilityVerdicts({
  candidates = PLAYWRIGHT_HOST_CANDIDATES,
  probe = httpHeadStatus,
} = {}) {
  return candidates.map((url) => {
    let verdict;
    try {
      verdict = probe(url);
    } catch (error) {
      verdict = `探测本身出错：${/** @type {Error} */ (error).message}`;
    }
    return { url, verdict, ok: isReachableVerdict(verdict) };
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
 * 装浏览器失败时那几条**读数**（而不是又一句「网络不通或磁盘满」）。
 *
 * ## 现场（`cnb-rkr-1k510rsgg` 的 `浏览器安装` stage）
 *
 * 下载卡在这一句上：
 *
 *     （原文）Error: Request to https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/
 *     （原文）chrome-win64.zip timed out after 30000ms
 *
 * 那时这一步还退 0（退出码被守卫吞掉，见本笔的姐妹修法），所以「为什么没装上」
 * 在整条构建日志里一个字都读不到 —— 而 E2E 会照旧报缺件，两个读数互相矛盾。
 *
 * ## 为什么这两个成因必须分开
 *
 * `timed out after 30000ms` 里的 30s 是 Playwright 的默认**套接字**超时
 * （`NET_DEFAULT_TIMEOUT`），而包是 180 MiB —— 在慢链路上它不是「这个地址不通」
 * 的结论，是「这一次没量完」。两者的处置相反：
 *
 *   · 换镜像：`PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>`；
 *   · 放宽多久算超时：`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000`。
 *
 * 两个都是 Playwright 自己的环境变量，本仓不发明第二套（§12.18）。
 * 只有真撞上「下载失败」字样时才打 —— 别的失败形态（pnpm 不可用、盘满）不需要
 * 这两条建议，凑上去只会让人往错的方向看。
 *
 * ⚠️ 到第四跑之后这两条建议只是**兜底的**：真要说下一步，看的是
 * {@link playwrightReachability} 那份现场实测 —— 「哪个根到得了」只有从这台机器上
 * 量出来才算数（`cdn.npmmirror.com` 在别处量得到、在这台节点上照旧超时）。
 *
 * @param {string} out `playwright install` 的输出
 * @returns {string[]}
 */
export function playwrightInstallHints(out) {
  const text = out ?? "";
  if (!/Failed to download|Download failure|timed out after/.test(text)) return [];
  const urls = [
    ...new Set([...text.matchAll(/Request to (\S+?) timed out/g)].map((m) => m[1])),
  ];
  const headers = [...new Set([...text.matchAll(/Downloading ([^\n]+?) from (\S+)/g)].map((m) => m[2]))];
  /* 「同一族域名被反复试」这一档要单独说出来 —— 现场那一次正是它：5 条
   * `Downloading … from cdn.playwright.dev` 之后 `Download failure, code=1`。
   * 只说「超时」会把人引到「再放宽一点」那条错路上：**Playwright 的三个内置镜像
   * 全是同一族**，换域名没用、加时间也没用（5 × 120s 试完照样不通），
   * 缺的是一条能通的根。 */
  const sameFamily =
    headers.length > 0 &&
    headers.every((h) => {
      /* `h` 来自正则捕获组，TS 只保证是 `string | undefined` —— 抠不到时
       * 直接不认这一档（与下面那支 catch 同一条：猜错方向比不猜更贵）。 */
      if (!h) return false;
      try {
        return /(^|\.)(playwright\.dev|prss\.microsoft\.com)$/.test(
          new URL(h).hostname,
        );
      } catch {
        /* 摘出来的不是一个能解析的 URL（Playwright 换了话术 / 输出被截断）⇒
         * 不认这一档，退到下面那两条通用出口。**猜错方向比不猜更贵**。 */
        return false;
      }
    });
  return [
    "---- 下载现场（供定位，非报错）----",
    ...(urls.length > 0
      ? urls.map((u) => `  超时的地址: ${u}`)
      : ["  （没有摘到 'Request to … timed out' 那一行，见上面的原文）"]),
    ...(sameFamily
      ? [
          `  试过的根全是 ` +
            `cdn.playwright.dev / playwright.download.prss.microsoft.com 这一族` +
            `（Playwright 的 ${headers.length} 个内置镜像**同族**）——`,
          "  这一族一起不通时，它自己的重试等于没有回退（实测 5 次全落在同一个域名族上）。",
          "  这一档的出路是**从外面给一个能通的镜像根**，而不是再放宽多久算超时：",
          "    · PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>（配到 stage 的 env 上，本仓会优先用它）",
        ]
      : [
          "  30s 是 Playwright 的默认**套接字**超时（`NET_DEFAULT_TIMEOUT`），",
          "  不是「这个地址不通」的结论：大包在慢链路上会被它按时掐断。",
          "  两条出口（都是 Playwright 自己的环境变量，本仓不发明第二套）：",
          "    · 换镜像：PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>（配到 stage 的 env 上）",
          "    · 放宽：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000",
        ]),
    "  两条都只关「多久放弃 / 走哪条链路」，不改「装完能起才放行」那条判据。",
    "------------------------------------",
  ];
}

/**
 * **装完复验**：按落点找这一档真正会用到的那一件（headless shell）在不在。
 *
 * ## 为什么「退 0」不够
 *
 * `playwright install` 是一条**下载**命令，而下载有三种「退 0 但东西没落地」的形态：
 * 传输被截断、落点不可写（权限 / 只读盘）、CDN 回了一份错误页（HTTP 200 的 HTML，
 * Playwright 不解析它，于是既没报错也没装上）。后两种在自托管节点上尤其现实
 * —— 那是台长期存在的机器，盘满与代理拦都不是稀奇事。
 *
 * 这条判据是**活的**（真去落点看一眼），不是「命令跑了就算」—— 与
 * `installAndReverify()` 的「装完必须回到 `findPython()` 再探一遍」逐字同一条口径：
 * **装与判是两件事**，只有判那一步能发现「命令跑完了、东西没在」。
 *
 * ## 为什么按**形状**找，而不写死 revision 号
 *
 * 落点目录形如 `chromium_headless_shell-1243`，那个号随 Playwright 版本漂
 * （本仓 `^1.63.0`，`browsers.json` 一升级它就变）—— 写死等于给下一次升级埋一条
 * 「静默判缺件」的判据。所以只认前缀 `chromium_headless_shell-` + 文件名。
 *
 * ## 为什么不去 `import("@playwright/test")` 起一次真浏览器
 *
 * 本步在流水线上排在 `Install dependencies` **之后**，但那不是这里能赖的前提
 * （顺序会变）。而这一条只回答「文件落没落地」——「能不能真起来」那一层由
 * `e2e/support/preflight-browser.mjs`（`e2e-run.mjs` 起 Playwright 之前那一探，
 * 判据是**真 launch**）与这份文件的用例（`tests/ci-toolchain-selfcheck.test.ts`
 * 的「装完必须复验」那一组）守着，不在这里重判。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>,
 *          list?: (dir: string) => string[]}} [options]
 *   `list` 是注入面（默认 `readdirSync`），让两个方向都能被真跑一次。
 * @returns {{ok: boolean, out: string}}
 */
export function browserExecutableExists({
  platform = process.platform,
  env = process.env,
  list = (dir) => readdirSync(dir),
} = {}) {
  const root = playwrightBrowsersRoot({ platform, env });
  let entries;
  try {
    entries = list(root);
  } catch {
    return {
      ok: false,
      out: `落点根读不到：${root}（PLAYWRIGHT_BROWSERS_PATH=${
        env.PLAYWRIGHT_BROWSERS_PATH ?? "(未设)"
      }）`,
    };
  }
  const dir = entries.find((e) => e.startsWith("chromium_headless_shell-"));
  if (!dir) {
    return {
      ok: false,
      out: `${root} 下没有 chromium_headless_shell-*（现有：${
        entries.join(", ") || "空目录"
      }）`,
    };
  }
  const exe =
    platform === "win32"
      ? "chrome-headless-shell.exe"
      : "chrome-headless-shell";
  /* 拼路径按**目标平台**的分隔符（同 `playwrightBrowsersRoot` 那条口径）。 */
  const p = platform === "win32" ? path.win32 : path.posix;
  const under = p.join(root, dir);
  const found = findFileUnder(under, exe, 3, p.join);
  return found
    ? { ok: true, out: found }
    : { ok: false, out: `${under} 下找不到 ${exe}` };
}

/**
 * Playwright 的**浏览器落点根**（按平台推，`PLAYWRIGHT_BROWSERS_PATH` 优先）。
 *
 * 三个平台的默认值与上游 `registry/index.ts` 一致：Windows 走 `%LOCALAPPDATA%`
 * 下的 `ms-playwright`，macOS 走 `~/Library/Caches/ms-playwright`，其余走
 * `~/.cache/ms-playwright`。**不写死某一台机器的盘符** —— 自托管那台机把用户数据
 * 放在 `D:` 盘（`ci-toolchain-python.mjs` 的 `pathDrives()` 记过这一格），
 * 而 `%LOCALAPPDATA%` 正好跟着走。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {string}
 */
export function playwrightBrowsersRoot({
  platform = process.platform,
  env = process.env,
} = {}) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override) return override;
  /* **按目标平台取分隔符**，不用宿主的 `path`（`node:path` 是宿主那一份）。
   *
   * 判据是可注入的 `platform`，所以本函数会**在一种平台上判另一种平台**（单测正是
   * 这么用的）。用宿主 `path.join` 时：在 Linux 上判 `win32` 会得到
   * `D:/Users/ci/ms-playwright`（应为反斜杠），在 Windows 上判 `darwin` 会得到
   * `\h\Library\Caches\ms-playwright`（应为正斜杠）—— 平台侧实测报的正是后一种，
   * 断言原文是「`expected` 一个反斜杠路径、`to be` 一个正斜杠路径」那句。
   *
   * 这与 `executable-resolve.ts` 那句「大小写不敏感只按目标平台」是同一条口径，
   * 也与 `ci-toolchain-python.mjs` 的 `pathDrives` 记过的「按目标平台的分隔符切 PATH，
   * 不按宿主的」同源。 */
  const p = platform === "win32" ? path.win32 : path.posix;
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (platform === "win32") {
    const local =
      env.LOCALAPPDATA ?? (home ? p.join(home, "AppData", "Local") : "");
    return local ? p.join(local, "ms-playwright") : "ms-playwright";
  }
  if (platform === "darwin") {
    return home
      ? p.join(home, "Library", "Caches", "ms-playwright")
      : "ms-playwright";
  }
  return home ? p.join(home, ".cache", "ms-playwright") : "ms-playwright";
}

/**
 * 在 `dir` 下按**深度上限**找一个文件名（**不穿符号链接**，越界即停）。
 *
 * @param {string} dir
 * @param {string} name
 * @param {number} depth
 * @returns {string | null}
 */
function findFileUnder(dir, name, depth, join = path.join) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) {
      const hit = findFileUnder(full, name, depth - 1, join);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 这一步要装的那几件 —— **只有 headless shell**，不是 `playwright install` 的默认一套。
 *
 * ## 为什么不是 `chromium chromium-headless-shell` 两件都下（实测换来的）
 *
 * `@playwright/test` 的 `browsers.json` 里 `chromium` 与 `chromium-headless-shell`
 * 是**两个条目**，headless 档用的是后者。此前照「两件都点名」写，理由是「只装前者会
 * 看着像装过了」—— 那个担心是对的，但**反过来多下前者是纯浪费，而且它会真出事**：
 *
 *   · 本仓 `playwright.config.ts` 只有**一个** project（`chromium` + 设备档
 *     `Desktop Chrome`），CI 上恒 headless，所以真被启动的是 headless shell；
 *   · `chromium` 那一件是 `chrome-win64.zip` **205 MB**，headless shell 是 **120 MB**；
 *   · 实测（`cnb-g9d-1k515kvrq`）：这台节点把 205 MB 那件拉到 **120s 超时**收场
 *     —— 而同一镜像上 120 MB 那件是好的。
 *
 * 于是「多下一件以防万一」变成了**这一步红、后面 `E2E 关键流程` 一步都跑不到**的唯一原因。
 * 判据仍是「装完复验」（按落点找 headless shell），所以少装那一件**不改判据**；
 * 真要 headed 浏览器的路径不在本档（`preflight-browser.mjs` 的出口命令里仍两件都写，
 * 那是**给人**的手工出口，不是流水线这一步）。
 *
 * ⚠️ 换这一串要跟着看的：`browserExecutableExists()` 判的那一件必须仍在里面，
 * 否则「装上」与「判过」会指向两件不同的东西（判据会一直红，而东西其实装了）。
 */
export const BROWSER_PACKAGES = ["chromium-headless-shell"];

/**
 * 装这一步要用的那几件浏览器（见 `BROWSER_PACKAGES`）。
 *
 * 走 `findPnpm()` 的宿主形态而不是裸起 `pnpm`（同 `main()` 里那条理由：Windows 上
 * 裸名字交给 CreateProcess 时 corepack 的三个形态一个都用不上），命令行与
 * `e2e/support/preflight-browser.mjs` 的 `BROWSER_INSTALL_HINT` 逐字同源。
 *
 * ⚠️ 拼的是 `prefixArgs`（宿主前缀）而**不是** `args`：`args` 里带着探针参数 `-v`，
 * 拿它拼出来的是 `pnpm -v exec playwright install …` —— 实测那只会打印版本并
 * **退 0**，于是这一步「成功」而浏览器一个都没装（E2E 照旧报缺件，而日志里这条
 * stage 是绿的，比直接红更难查）。`prefixArgs` 就是为这件事单独留的。
 *
 * @param {{
 *   find?: () => {ok: boolean, command: string, prefixArgs: string[], args: string[], out: string},
 *   exec?: (cmd: string, args: string[], downloadHost?: string) => {ok: boolean, out: string},
 *   env?: Record<string, string | undefined>,
 * }} [ports]
 *   三个接缝（**必传**，见 `playwrightOnly` 的说明）：`find` 给 pnpm 形态、`exec`
 *   起进程（第三个参数是这一次要用的下载根）、`env` 决定试哪个根
 *   （见 `playwrightHostsToTry`）。判据里注入它们，结论才不取决于跑判据那台机器上
 *   有没有 pnpm、也不真去下 100MB 浏览器。
 * @returns {{ok: boolean, out: string, command?: string, args?: string[], host?: string}}
 */
export function runPlaywrightInstall({
  find = required("find"),
  exec = required("exec"),
  env = process.env,
} = {}) {
  const pnpm = find();
  if (!pnpm.ok) {
    return {
      ok: false,
      out:
        "pnpm 不可用，装不了浏览器 —— 先让上面「工具链自证」那一步过。" +
        `（探到的原因：${pnpm.out || "无输出"}）`,
    };
  }
  const args = [
    ...pnpm.prefixArgs,
    "exec",
    "playwright",
    "install",
    ...BROWSER_PACKAGES,
  ];
  /* 试哪几个根由 `playwrightDownloadRoots()` 说了算 —— 设了外面给的那个就**只用它**，
   * 没设就回落到 Playwright 的内置族（那一族的三档由它自己挨个试）。
   * Playwright 的三个内置镜像**全是 `*.playwright.dev` / `*.microsoft.com`**，
   * 一台出不了这两个域的网络里三个一起不通 —— 换哪个都一样，所以「不通」这一档的
   * 出路只有**外面给一个能通的镜像根**，而那不是它能自己推出来的事。 */
  let out = "";
  for (const host of playwrightDownloadRoots(env)) {
    const r = exec(pnpm.command, args, host);
    out += `${r.out ?? ""}\n`;
    if (r.ok) return { ok: true, out, command: pnpm.command, args, host };
  }
  return { ok: false, out, command: pnpm.command, args };
}

/**
 * 装浏览器时**一个下载根都不额外给** —— 走 Playwright 的内置镜像族。
 *
 * ⚠️ **这不是「只有一个根」的意思**：Playwright 自己的 `PLAYWRIGHT_CDN_MIRRORS`
 * 有三档，全在 `cdn.playwright.dev` / `playwright.download.prss.microsoft.com`
 * 这一族里，它自己会挨个试（`retryCount = 5`）。本函数返回一条空宿主，
 * 就是「这一趟不覆盖它」——**本仓不替它挑一个第三方镜像写进代码**，
 * 那等于把「哪面墙怎么过」写死在仓里，换台机器就静默失效。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<string | undefined>}
 */
export function playwrightHostsToTry(env) {
  const configured = env.PLAYWRIGHT_DOWNLOAD_HOST;
  return configured ? [configured] : [undefined];
}

/**
 * 装浏览器时**真去试的**那些下载根 —— 这一趟要起几次进程，由它说了算。
 *
 * ## 它与 `playwrightHostsToTry()` 为什么分成两个问题
 *
 * 原先只有一个函数，于是「外面给的那个 + 内置那族」被表达成了「按序试两个根」。
 * 而**这一族是同一个东西的两个名字**，逐次去试它不是「多一条出路」，是：
 *
 *   · 把**同一次不通**再花同样的时间重试一遍（镜像站不常见 4xx 时尤其亏：
 *     Playwright 自己的 `retryCount = 5` 在一个根上已经试够了）；
 *   · 让**读数撒谎** —— `playwrightInstallHints()` 分「同族被反复试」与「慢链路上
 *     没量完」两档，靠的是试过的根里有没有非 Playwright 族的。带上第三个根之后，
 *     实测那一档**再也不成立**（`cnb-g9d-1k515kvrq` 的真实形态被读成后者，
 *     而它要的下一动作恰恰相反）。
 *
 * ## 现场（`cnb-g9d-1k515kvrq`，本仓这一档的第四次红）
 *
 * 日志的形态逐字是这两行（原文见平台那次构建的 `浏览器安装` stage）：
 *
 *   1. 第一行：下载根由 `PLAYWRIGHT_DOWNLOAD_HOST` 指定，
 *      值就是 `.cnb.yml` 里那个 npmmirror 的根；
 *   2. 之后是**两条**「正在从 <同一个根> 下载 chromium 的 win64 zip」——
 *      同一段 URL 逐字重复；收尾是「装浏览器失败」+ 那件包
 *      `timed out after 120000ms`。
 *
 * 也就是说：**同一个根被拆成了两条**，而下一句「30s 是默认套接字超时」
 * 与逐次 120s 的实测直接矛盾 —— 人照它去改超时，而真正发生的事（这条链路对这一族
 * 就是不通）一个字都没读到。
 *
 * ## 「给上了就只用它」是一条判据，不是一句注释
 *
 * `PLAYWRIGHT_DOWNLOAD_HOST` 写进 `.cnb.yml` 的语义是「人已经知道该走哪儿」
 * （见 `tests/ci-toolchain-selfcheck.test.ts` 的「下载根由外面给」那组）。
 * 给上了还去试它替不掉的那一族，等于把那条判据降级成「多试一个根」。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<string | undefined>}
 */
export function playwrightDownloadRoots(env) {
  const configured = env.PLAYWRIGHT_DOWNLOAD_HOST;
  return configured ? [configured] : [undefined];
}
