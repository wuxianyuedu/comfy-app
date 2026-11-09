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
import { readdirSync } from "node:fs";

/* 探测那一层（「这个根到不到得了」）按职责拆到了 `ci-toolchain-browser-reach.mjs`
 * —— 本文件 900 行的硬闸（§12.6 R5）不容许它继续长在这里，而那一段的**消费者**
 * （`环境前提`）本来就只用它。这里转出同一批名字，旧调用点不必跟着改。 */
import {
  httpDownloadProbe,
  pickPlaywrightRoots,
  playwrightReachability,
} from "./ci-toolchain-browser-reach.mjs";
/* 「自己把包拉下来」那一层（分片 + 续传），见它的文件头：它不是 `playwright install`
 * 的替代，是它**前面**的一次尝试 —— 它成功，那一步就变成 no-op。 */
import { fetchPlaywrightBrowser } from "./ci-toolchain-browser-fetch.mjs";
/* 「自取」那一步的**编排**（取哪个地址 / 落到哪个目录 / 要不要续传）单独一份
 * —— 理由见它的文件头（本文件是 900 行硬闸守着的，那一段接进来就超了）。 */
import { seedBrowserOnOwn } from "./ci-toolchain-browser-seed.mjs";
/* 「落点根」的推导（平台默认 / 生效落点 / 候选根）也单独一份 —— 理由见它的文件头：
 * 落点推导是这一族里最容易被复制的那一份（装、复验、自取三处都要它），拆出来之后
 * 「一处推导、多处引用」由模块边界保证，而不是靠约定。 */
import {
  findBrowserExecutable,
  playwrightBrowsersRoot,
  playwrightRootCandidates,
} from "./ci-toolchain-browser-root.mjs";

export {
  findBrowserExecutable,
  platformDefaultBrowsersRoot,
  playwrightBrowsersRoot,
  playwrightRootCandidates,
} from "./ci-toolchain-browser-root.mjs";

export {
  FETCH_CHUNK_BYTES,
  FETCH_CHUNK_TIMEOUT_MS,
  FETCH_MAX_CHUNKS,
  FETCH_MIN_CHUNK_BYTES,
  fetchPlaywrightBrowser,
  fetchUrlResumable,
} from "./ci-toolchain-browser-fetch.mjs";

export {
  PLAYWRIGHT_FALLBACK_BROWSER_VERSION,
  PLAYWRIGHT_HOST_CANDIDATES,
  httpDownloadProbe,
  isReachableVerdict,
  pickPlaywrightRoots,
  probeGrade,
  playwrightProbeUrl,
  playwrightReachability,
  playwrightReachabilityVerdicts,
  readPlaywrightBrowserTarget,
} from "./ci-toolchain-browser-reach.mjs";

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
 *   pickRoots?: typeof pickPlaywrightRoots,
 *   seed?: typeof fetchPlaywrightBrowser,
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   section?: (title: string) => void,
 * }} [ports]
 *   `exec` 的第三个参数是**这一次要用的下载根**（`PLAYWRIGHT_DOWNLOAD_HOST`），
 *   只有装浏览器那一步会带 —— 调用方要把它转交到子进程的 env 上。
 *   `probe` 有两个消费点（都在「量一次根」这条路上）：装之前 `pickRoots` 用它挑根、
 *   装失败之后 `playwrightReachability` 用它出取证读数。判据里换掉它就不出网。
 *   `pickRoots` 是「先量一次再决定试哪个根」那一层（见 {@link pickPlaywrightRoots}），
 *   同样给注入面。⚠️ 缺省时本函数自己把 `probe` 绑进去（见下面那行注释）——
 *   少了这一绑，「先量一次再挑根」那条路会**永远不走**而看起来一切正常。
 * @returns {number} 退出码
 */
export function playwrightOnly({
  find = required("find"),
  exec = required("exec"),
  env = process.env,
  probe = httpDownloadProbe,
  pickRoots = undefined,
  seed = fetchPlaywrightBrowser,
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
  /* ⚠️ `pickRoots` 缺省是**活的**：把 `probe` 绑进去（`pickPlaywrightRoots` 自己的
   * `probe` 缺省是「一个都不量」，那是给判据用的安静档 —— 见它的头注）。少了这一行，
   * 「先量一次再挑根」那条路**永远不会走**，而装这一步看起来一切正常。 */
  /* ── **先试一次「自己拉」**（ISSUE #1959 第七跑）──
   *
   * 上面那一支只在**那一件齐了**时提前返回；不齐时此前直接交给 `playwright install`，
   * 而它这条路上有一个结构性的短板：**它的重试没有续传**（`browserFetcher.ts` 每次
   * 失败都 `unlink(zipPath)` + `removeFolders(browserDirectory)`，从第 0 字节重来）。
   * 于是一条「能握上手、能吐前几 KB、然后在大 body 上停住」的链路 —— 那正是这台节点
   * 七跑以来的形态 —— 无论重试几次、换几个根，都到不了 114 MiB 的尽头。
   *
   * 所以在这里多给一条路：**分片取字节、每片一次独立请求、已落盘的不重下**
   * （`fetchUrlResumable()`）。它成功就等于把那一件装好了（还写好上游那份
   * `INSTALLATION_COMPLETE` 标记），`playwright install` 随即变成 no-op。
   * 它失败则一个字都不改，原样交给 Playwright 的老路 —— 放行判据仍是下面那条
   * 「装完复验」，不是这里多出来的第二个判据。
   *
   * ⚠️ **不许因为它失败就把这一步判红**：它是一次**尝试**，不是判据。老路仍然
   * 有机会成功（比如落点里其实已经有了、或 Playwright 那个根恰好是通的）。 */
  const seedRoot = playwrightBrowsersRoot({ env });
  const seeded = seedBrowserOnOwn({ seed, env, root: seedRoot, log });
  log(
    seeded.ok
      ? `自取成功：${seeded.out}`
      : `自取没成（交给 playwright install 的老路）：${seeded.out}`,
  );
  if (seeded.ok && browserExecutableExists({ env }).ok) {
    return 0;
  } // 见 seed 模块头注：老路会拉 ffmpeg

  const install = runPlaywrightInstall({
    find,
    exec,
    env,
    probe,
    pickRoots: pickRoots ?? ((ports = {}) => pickPlaywrightRoots({ probe, ...ports })),
  });
  /* 换根这件事要**留痕**：`env` 里配着的那个与真用上的那个不是同一个时，人必须
   * 在日志里看得到（否则下一次核对配置与日志时会以为配置被吃掉了）。 */
  if (install.probes?.length) {
    log("---- 下载根（装之前现场量的）----");
    for (const line of install.probes) {
      log(line);
    }
    log("---------------------------------");
  }
  if (install.host && env.PLAYWRIGHT_DOWNLOAD_HOST !== install.host) {
    log(
      `⚠️ 配着的根（${env.PLAYWRIGHT_DOWNLOAD_HOST ?? "(未设)"}）这一趟量不到，` +
        `改用 ${install.host} —— 这只是「先试哪个」，配置本身没被改。`,
    );
  }
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
    for (const line of playwrightInstallHints(install.out, playwrightInstallHintFacts(env))) {
      log(line);
    }
    /* 失败之后**当场量一次**「这台机器到底出得去哪些域名」。
     *
     * 这是本格最贵的一次教训（ISSUE #1961 第四跑）：镜像那一行是**在别处**量出来能用的
     * （`cdn.npmmirror.com` 回 200、15s 收到 99 MiB），而它在**这台节点**上照旧
     * `timed out after 120000ms` —— 于是「换个镜像」这个动作**看起来做了、实际没解决**，
     * 下一次红的形态与前一次逐字相同，只换了个域名。
     *
     * 所以缺的不是「再猜一个镜像」，是**一条关于这台机器的事实**：它出得去哪些域名。
     * 那一条只能在这儿量 —— 探测很便宜（每个地址**真取一小段字节**），而它把「下一动作」
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
 * 落点里那一版的目录名（`chromium_headless_shell-<revision>`）。
 *
 * ⚠️ **目录名里用的是 `revision`，不是 `browserVersion`**：前者是 `1243`、后者是
 * `153.0.8010.12`（CDN 路径里用的才是后者）。拿错一个号的后果不是「报错」，
 * 而是**两个方向都像成功**：包解到一个没人会看的目录，Playwright 随即
 * `Removing unused browser` 把整包重下一遍 —— 自取白做、日志里却各说各的成功。
 * 两个号都由 `readPlaywrightBrowserTarget()` 一处读出来（**不抄第二遍**）。
 *
 * 形状逐字照抄上游 `browserDirectoryToMarkerFilePath()` 那一半：
 * `name.replace(/-/g, "_") + "-" + revision`（`chromium-headless-shell` →
 * `chromium_headless_shell`）。
 *
 * @param {{revision: string} | null} target 读不到 `browsers.json` 时给 `null`
 * @param {string} [fallbackRevision] 缺省那一档（探测那条路同一个）
 * @returns {string}
 */

/**
 * 没接线就当场说清楚 —— 比让调用方拿到一个 `undefined is not a function` 强。
 *
 * @param {string} what
 * @returns {never}
 */
function required(what) {
  throw new Error(`ci-toolchain-browser：缺 ${what} 注入面（由调用方传入，见文件头）`);
}

/** 默认什么都不打的分节 —— 调用方不关心分节时就别硬塞一行。 */
function noopSection() {}

/**
 * Playwright 下载时的**缺省**套接字超时（`NET_DEFAULT_TIMEOUT`）。
 *
 * 抄它只为**读话术**：判断「放宽超时」那一条出口是不是已经走过了。真正的超时算法
 * 在 Playwright 里（`+(PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT || "0") ||
 * NET_DEFAULT_TIMEOUT`），本仓不重实现它 —— 这里只拿它当那条线的位置。
 */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

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
 *   · 放宽多久算超时：`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=<更大的数>`。
 *
 * 两个都是 Playwright 自己的环境变量，本仓不发明第二套（§12.18）。
 * 只有真撞上「下载失败」字样时才打 —— 别的失败形态（pnpm 不可用、盘满）不需要
 * 这两条建议，凑上去只会让人往错的方向看。
 *
 * ⚠️ 到第四跑之后这两条建议只是**兜底的**：真要说下一步，看的是
 * `playwrightReachability()` 那份现场实测 —— 「哪个根到得了」只有从这台机器上
 * 量出来才算数（`cdn.npmmirror.com` 在别处量得到、在这台节点上照旧超时）。
 *
 * ## ⚠️ 读数必须知道**哪些动作已经做过了**（ISSUE #1966 的续集）
 *
 * `out` 只是 Playwright 打的字，它答不出「这个出口是不是早就走过了」。于是这里
 * 曾对着**已经配好的** `.cnb.yml` 逐字建议「配 `PLAYWRIGHT_DOWNLOAD_HOST`」与
 * 「放宽到 `120000`」—— 而现场那一跑两个都配了、失败的**正是**那个根、
 * 超时**就是** 120000ms：
 *
 *     （现场 `cnb-ald-1k51g8dt9`）下载根由 PLAYWRIGHT_DOWNLOAD_HOST 指定：
 *     https://cdn.npmmirror.com/binaries/playwright ……
 *     Error: Request to <同一个 URL> timed out after 120000ms
 *     读数：30s 是默认套接字超时（**错的，这次是 120s**）
 *     读数：放宽：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000（**已经就是它**）
 *
 * 「读数指向下一动作」是这一格反复栽的那条（§13.5.3.5.1）：把人指回一个**做过的**
 * 动作，比不给建议更贵 —— 他会照着做一遍、形状逐字不变地再红一次。所以调用方把
 * 「这一次生效的值」传进来（{@link playwrightInstallHintFacts}），话术按**已做的
 * 动作**分岔：做过的点名为「已经做过了」，只剩没做过的那些才给出去。
 *
 * @param {string} out `playwright install` 的输出
 * @param {{timeoutMs?: number | null, host?: string | null}} [facts]
 *   见 {@link playwrightInstallHintFacts}。`timeoutMs` 是 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`
 *   解析出的**生效值**（`null` = 它没生效 / 解析不出，**不是**「等于缺省」），
 *   `host` 是配着的 `PLAYWRIGHT_DOWNLOAD_HOST`（`null` / 缺席 = 没配）。
 * @returns {string[]}
 */
export function playwrightInstallHints(out, facts = {}) {
  const text = out ?? "";
  if (!/Failed to download|Download failure|timed out after/.test(text)) {
    return [];
  }
  const observed = observedTimeoutMs(text) ?? facts.timeoutMs ?? null;
  const host = stringOrNull(facts.host);
  const urls = [
    ...new Set(
      [...text.matchAll(/Request to (?<url>\S+?) timed out/g)].map((m) => m.groups?.url ?? ""),
    ),
  ];
  /* `Downloading … from <url>` 里给的是**真资源 URL**（根 + `builds/cft/<版本>/<档>/<包>`），
   * 而配置面给的是**根** —— 拿前者去和 `PLAYWRIGHT_DOWNLOAD_HOST` 比逐字比对恒不相等
   * （这个形态真的错过一次：话术于是把「配了根、且正是它失败」读成了「还没配」）。 */
  const triedRoots = [
    ...new Set(
      [...text.matchAll(/Downloading (?:[^\n]+?) from (?<root>\S+)/g)]
        .map((m) => downloadRootOf(m.groups?.root ?? ""))
        .filter((h) => typeof h === "string"),
    ),
  ];
  /* 「试过的根全是 Playwright 内置那一族」——现场那次正是它：5 条
   * `Downloading … from cdn.playwright.dev` 之后 `Download failure, code=1`。
   * 判的是**试过的根**（摘不到时退回「配着的那个根」，再退回「没有」）。 */
  const triedForFamily = triedRoots.length > 0 ? triedRoots : host ? [host] : [];
  const sameFamily = triedForFamily.length > 0 && triedForFamily.every(isPlaywrightFamilyRoot);
  /* 配了一个根、而它正是被反复试的那一个 —— 这一档下「配一个根」这条出口已经是
   * 既成事实，话术不许再把它当建议给出去。 */
  const configuredRootFailed = host !== null && triedForFamily.includes(host);
  return [
    "---- 下载现场（供定位，非报错）----",
    ...(urls.length > 0
      ? urls.map((u) => `  超时的地址: ${u}`)
      : ["  （没有摘到 'Request to … timed out' 那一行，见上面的原文）"]),
    ...(observed === null
      ? [
          "  超时值没有从输出里摘到（Playwright 换了话术 / 输出被截断）——",
          "  别按缺省的 30s 去读这一跑：`.cnb.yml` 给过的值以它为准。",
        ]
      : [
          `  这一次生效的套接字超时是 ${observed}ms（Playwright 的 ` +
            "`NET_DEFAULT_TIMEOUT` 缺省 30000ms）——",
          "  它只关「多久放弃」，不是「这个地址不通」的结论：大包在慢链路上会被它按时掐断。",
        ]),
    ...hintActions({
      sameFamily,
      configuredRootFailed,
      host,
      triedRoots,
      timeoutRaised: observed !== null && observed > DEFAULT_DOWNLOAD_TIMEOUT_MS,
    }),
    "  所有出口都只关「走哪条链路 / 多久放弃」，不改「装完能起才放行」那条判据。",
    "------------------------------------",
  ];
}

/**
 * 「这一跑里已经做过的动作」—— {@link playwrightInstallHints} 的话术据此分岔。
 *
 * ## 两条出口各自判一次「做过了没有」
 *
 *   · **换镜像**（`PLAYWRIGHT_DOWNLOAD_HOST`）—— 已配上时不再建议配，改说「要换就换
 *     这一行」（现场 `cnb-ald-1k51g8dt9` 就是配着的那个根失败了）；
 *   · **放宽超时**（`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`）—— 已经高于缺省
 *     （`DEFAULT_DOWNLOAD_TIMEOUT_MS`）时不再建议放宽：那正是现场那一跑「照它做、
 *     形状逐字不变地再红一次」的来源（它建议 `=120000`，而当时**就是** 120000）。
 *
 * 两档都不做时（没配根、超时还是缺省）照旧给全 —— 那才是真的还没走过。
 *
 * ⚠️ `configuredRootFailed` 压过其余两档：配着的根就是失败的那一个时，「换镜像」这条
 * 已不是「配一个根」而是「换掉它」，而剩下的出路在宿主机 / 网络侧
 * （换根 / 代理 / 预装进落点）。
 *
 * @param {{sameFamily: boolean, configuredRootFailed: boolean, host: string | null,
 *          triedRoots: string[], timeoutRaised: boolean}} ctx
 * @returns {string[]}
 */
function hintActions({ sameFamily, configuredRootFailed, host, triedRoots, timeoutRaised }) {
  if (configuredRootFailed) {
    return [
      `  配着的下载根就是失败的那一个（${host}）—— 这一跑里那两条常用出口${
        timeoutRaised ? "**都已经做过了**" : "**已经做过一条**"
      }：`,
      "    · PLAYWRIGHT_DOWNLOAD_HOST **已经配了**（就是上面那一个）—— 要换只换这一行；",
      ...(timeoutRaised
        ? [
            "    · 放宽套接字超时（`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`）**也做过了**",
            "      （现场那一次就是放宽之后的读数），照它再做一遍不会有任何变化 ——",
            "      它只关「多久放弃」，不改「字节能不能流」这件事。",
          ]
        : [
            "    · 放宽套接字超时（`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`）**还没做过**",
            "      （上面那个数还是缺省档）—— 可以先试一档，但别指望它：它只关「多久放弃」，",
            "      不改「字节能不能流」这件事。",
          ]),
      "  这一档的成因是**连上了但 0 字节**（握手能成、大 body 停住，典型是代理 / MTU），",
      "  所以剩下的出路在宿主机 / 网络侧，不在仓库里（下一步只有人能做）：",
      "    · **换一个这台节点真能到的根** —— 用上面那份「下载根探测」里判通的那一个，",
      "      写到 `.cnb.yml` 的 `浏览器安装` stage 的 `PLAYWRIGHT_DOWNLOAD_HOST` 上；",
      "    · 或给这台节点配内网代理 / 放行镜像域；",
      "    · 或**预先把 chromium-headless-shell 装进落点** —— 装过一次之后这一格就",
      "      再也不碰网络（长期存在的机器上这是最省事的一条，",
      "      落点见 `playwrightBrowsersRoot()`）。",
    ];
  }
  if (sameFamily) {
    return [
      "  试过的根全是 " +
        "cdn.playwright.dev / playwright.download.prss.microsoft.com 这一族" +
        `（Playwright 的内置镜像**同族**，共试了 ${triedRoots.length} 条）——`,
      "  这一族一起不通时，它自己的重试等于没有回退（实测 5 次全落在同一个域名族上）。",
      "  这一档的出路是**从外面给一个能通的镜像根**，而不是再放宽多久算超时：",
      "    · PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>（配到 stage 的 env 上，本仓会优先用它）",
    ];
  }
  return [
    host
      ? `  下载根**已经配了**（${host}）；要换只换这一行，别去动超时那个数字。`
      : "  下载根 还没配 —— 这一档的出路是**从外面给一个能通的镜像根**。",
    "  两条出口（都是 Playwright 自己的环境变量，本仓不发明第二套）：",
    ...(host
      ? ["    · 换一个能到的根：改 `PLAYWRIGHT_DOWNLOAD_HOST`（`浏览器安装` stage 的 env）"]
      : ["    · 配镜像：PLAYWRIGHT_DOWNLOAD_HOST=<镜像根>（配到 stage 的 env 上）"]),
    ...(timeoutRaised
      ? [
          "    · 放宽超时**这一跑已经做过了**（上面那个数比缺省的 30000ms 大）——" +
            " 照它再做一遍不会有任何变化",
        ]
      : [
          "    · 放宽：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=<更大的数>（缺省 30000ms 是套接字超时）",
        ]),
  ];
}

/**
 * 「这次失败时，那几个相关的值各是多少」—— 从 env 里取，唯一一处。
 *
 * `timeoutMs` 只认**解析得出的正数**：与 Playwright 自己的算法逐字同口径
 * （`+(v || "0") || NET_DEFAULT_TIMEOUT`）—— 拿 `0` / 空 / 非数字当真值会让话术
 * 报一个 Playwright 根本没用的数，而话术里那个数字必须与现场对得上。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{timeoutMs: number | null, host: string | undefined}}
 */
export function playwrightInstallHintFacts(env = {}) {
  const raw = env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT;
  const parsed = Number(raw ?? "");
  return {
    timeoutMs: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    host: env.PLAYWRIGHT_DOWNLOAD_HOST,
  };
}

/**
 * 输出里那条 `timed out after <N>ms` 的 N —— 摘不到回 `null`。
 *
 * 它比 env 里的值**更权威**：它说的是这一跑**实际**用上的那个数（env 可能没传进
 * 子进程、也可能是 Playwright 自己的缺省），而话术里那个数字必须与现场对得上。
 *
 * @param {string} text
 * @returns {number | null}
 */
function observedTimeoutMs(text) {
  const m = /timed out after (?<ms>\d+)ms/.exec(text ?? "");
  if (!m) {
    return null;
  }
  const n = Number(m.groups?.ms);
  return Number.isFinite(n) ? n : null;
}

/**
 * 这个根是不是 Playwright **自己那一族**（三个内置 CDN 的域名）。
 *
 * 判它只有一个用途：把「缺的是一条能通的**镜像**根」与「这条镜像也到不了」分开 ——
 * 两档的下一动作完全不同（前者配一行，后者在宿主机侧）。
 *
 * @param {string} root
 * @returns {boolean}
 */
function isPlaywrightFamilyRoot(root) {
  try {
    return /(?:^|\.)(?:playwright\.dev|prss\.microsoft\.com)$/.test(new URL(root).hostname);
  } catch {
    /* 不是一个能解析的 URL（Playwright 换了话术 / 输出被截断）⇒ 不认这一档，
     * 退到通用出口。**猜错方向比不猜更贵**。 */
    return false;
  }
}

/**
 * 真资源 URL 里「根」那一段 —— 砍掉 `builds/` 起的尾巴。
 *
 * `https://h/a/builds/cft/1/win64/x.zip` → `https://h/a`。摘不出（换过形状 / 被截断）
 * 就原样回传：这一处只服务**话术**，错的方向比不猜更贵，所以宁可回一个比不中的值。
 *
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
function downloadRootOf(url) {
  if (typeof url !== "string") {
    return undefined;
  }
  const i = url.indexOf("/builds/");
  return i === -1 ? url : url.slice(0, i);
}

/**
 * 去空白后的字符串，空 / 非字符串回 `null`。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
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
 * ## 为什么要问**两个**根
 *
 * 生效落点扑空时再问一句平台默认 —— 这一问是为了把两件逐字同形的事分开：
 * 「一件都没有」与「装在别处、这一跑看不见它」。
 *
 * 落点被**覆盖**时（自托管节点把浏览器放到开发盘就是这一档），装的那一处与运行时
 * 看的那一处都由 `PLAYWRIGHT_BROWSERS_PATH` 决定 —— 它写在**流水线级** env 里时两边
 * 一致；一旦被挪进某一格的 `env:`，装的那一格看得到、跑 E2E 的那一格看不到 ⇒
 * **装好了，探不到**。而那两种红在日志里原本逐字同形（本仓最贵的那类红）。
 *
 * ⚠️ **判据本身一个字没改**：默认根里有、而生效落点里没有时，仍然判不过（`ok` 仍是假）
 * —— 运行时只看生效落点，判过它才是假的。这一问只改**读数说的是什么**。
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
  const { primary, fallback } = playwrightRootCandidates({ platform, env });
  const envNote = env.PLAYWRIGHT_BROWSERS_PATH ?? "(未设)";
  const at = findBrowserExecutable({ root: primary, platform, list, envNote });
  if (at.found) {
    return { ok: true, out: at.found };
  }
  /* **落点扑空时再问一句「是不是装在别处」** —— 为什么问、问完判据怎么不变，
   * 都在上面那段「为什么要问两个根」里；这里只留一句结论：
   * 默认根里有、而生效落点里没有 ⇒ **仍然判不过**（运行时只看生效落点），
   * 但读数会点名「装在 <默认根>，而运行时看不见它」。 */
  if (fallback) {
    const alt = findBrowserExecutable({
      root: fallback,
      platform,
      list,
      envNote,
    });
    if (alt.found) {
      return {
        ok: false,
        out:
          `生效落点 ${primary} 下没有那一件，而 ${fallback} 下有（${alt.found}）—— ` +
          `装了却探不到：运行时只看生效落点（PLAYWRIGHT_BROWSERS_PATH=${envNote}）`,
      };
    }
  }
  return { ok: false, out: at.miss };
}

/**
 * Playwright 的**浏览器落点根**（按平台推，`PLAYWRIGHT_BROWSERS_PATH` 优先）。
 *
 * ⚠️ **实现搬走了** —— 现在住在 `ci-toolchain-browser-root.mjs`，由本文件转出同一个名字
 * （旧调用点不必跟着改）。搬走的原因是本文件离 900 行硬闸只剩十几行，而落点推导与
 * 「在落点下找那一件」这两件事是这一族里最容易被复制的两份：拆成自己的模块之后，
 * 「一处推导、多处引用」由**模块边界**保证，而不是靠约定。
 */

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
 *   probe?: (url: string) => string,
 *   pickRoots?: typeof pickPlaywrightRoots,
 * }} [ports]
 *   三个接缝（**必传**，见 `playwrightOnly` 的说明）：`find` 给 pnpm 形态、`exec`
 *   起进程（第三个参数是这一次要用的下载根）、`env` 决定试哪个根
 *   （见 `playwrightHostsToTry`）。判据里注入它们，结论才不取决于跑判据那台机器上
 *   有没有 pnpm、也不真去下 100MB 浏览器。
 *   `pickRoots` 是「先量一次再决定试哪个根」那一层（见 {@link pickPlaywrightRoots}），
 *   同样给注入面：判据里换掉它就不出网、也不去量真 CDN。
 * @returns {{ok: boolean, out: string, command?: string, args?: string[], host?: string,
 *            probes?: string[]}}
 */
export function runPlaywrightInstall({
  find = required("find"),
  exec = required("exec"),
  env = process.env,
  probe = httpDownloadProbe,
  /* ⚠️ 缺省 `undefined`、由下面绑上 `probe`。直接把 `pickPlaywrightRoots` 本身放这里
   * 是**接错线的静默降级**：函数缺省参数只在「参数是 `undefined`」时才取值，所以传进来的
   * `probe` 永远不会到达挑根那一层，而 `pickPlaywrightRoots` 的 `probe` 缺省是
   * 「一个都不量」—— 于是这条新路看起来接好了、其实一次都没走（实测：
   * 判据里的假根被真出网的探测判成 ENOTFOUND，于是开始挨个试真 CDN）。 */
  pickRoots = undefined,
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
  const args = [...pnpm.prefixArgs, "exec", "playwright", "install", ...BROWSER_PACKAGES];
  /* 试哪几个根 —— **先量一次再决定**（`pickPlaywrightRoots()` 的头注写了它与
   * `playwrightDownloadRoots()` 那条「给上了就只用它」怎么并存）。
   *
   * 「外面给了根就只用它」反对的是**盲目重试同族**：Playwright 的三个内置镜像
   * 全是 `*.playwright.dev` / `*.microsoft.com`，一台出不了这一族的网络里换哪个都一样。
   * 而实测反复出的是另一种形态（`cnb-t3f-1k51ho0k2` 等三次）：配着的那个根**也不通**
   * —— 那时日志里早已量到「别的根 2xx」，可**没有任何执行者**把它接到这一步上，
   * 于是同一句 `timed out after 120000ms` 连着红了三次。
   *
   * 所以：量得到的排前面，量不到的按原序兜底。没给根时 `roots` 只有 `undefined`
   * 一项（走 Playwright 自己的内置族）—— 那时**不量**、也不多余地起进程，
   * 与改动前的行为逐字相同。
   *
   * 这不是「放宽判据」：放行那条判据仍是文件尾那一条「装完能起才放行」，
   * 这里只决定**先试哪个根**。 */
  /* **必须把 `probe` 一起交给挑根那一层**：`pickPlaywrightRoots` 自己的 `probe`
   * 缺省是「一个都不量」（那是给判据用的安静档），传 `probe` 进来才算真的量。
   * 它的返回值也不再是「一个个去试」——它排序后的第一个就是「先试哪个」。 */
  const resolvedPickRoots =
    pickRoots ?? ((ports = {}) => pickPlaywrightRoots({ ...ports, probe: ports.probe ?? probe }));
  const picked = env.PLAYWRIGHT_DOWNLOAD_HOST
    ? resolvedPickRoots({ roots: playwrightDownloadRoots(env), probe })
    : { roots: playwrightDownloadRoots(env), verdicts: [] };
  const probes = picked.verdicts.map((v) => `  ${v.root} → ${v.verdict}（${v.grade}）`);
  let out = "";
  for (const host of picked.roots) {
    const r = exec(pnpm.command, args, host);
    out += `${r.out ?? ""}\n`;
    if (r.ok) {
      return { ok: true, out, command: pnpm.command, args, host, probes };
    }
  }
  return { ok: false, out, command: pnpm.command, args, probes };
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
