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
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   section?: (title: string) => void,
 * }} [ports]
 *   `exec` 的第三个参数是**这一次要用的下载根**（`PLAYWRIGHT_DOWNLOAD_HOST`），
 *   只有装浏览器那一步会带 —— 调用方要把它转交到子进程的 env 上。
 * @returns {number} 退出码
 */
export function playwrightOnly({
  find = required("find"),
  exec = required("exec"),
  env = process.env,
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
   * 「装了一半」放过去 —— 它只在**两件都齐**时才提前返回。 */
  const already = browserExecutableExists({ env });
  if (already.ok) {
    log(`已装，跳过下载：${already.out}`);
    return 0;
  }
  /* 两件都要装：`chromium` 与 `chromium-headless-shell` 是 `browsers.json` 里的
   * **两个条目**，而 headless 档用的是后者 —— 只装前者时 `executablePath()` 会给出
   * 前者、看着像「装过了」，真起浏览器就报 `Executable doesn't exist`
   * （`e2e/support/preflight-browser.mjs` 的头注写着这条）。 */
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
 * 装 Playwright 的两件浏览器（`chromium` + `chromium-headless-shell`）。
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
    "chromium",
    "chromium-headless-shell",
  ];
  /* 逐个宿主试过去（`playwrightHostsToTry()`）：Playwright 自己的三个内置镜像
   * **全是 `*.playwright.dev` / `*.microsoft.com`**，一台出不了这两个域的网络里
   * 三个一起不通 —— 换哪个都一样。所以「不通」这一档的出路只有**外面给一个能通的
   * 镜像根**，而那不是它能自己推出来的事（见 `playwrightHostsToTry` 的头注）。 */
  let out = "";
  for (const host of playwrightHostsToTry(env)) {
    const r = exec(pnpm.command, args, host);
    out += `${r.out ?? ""}\n`;
    if (r.ok) return { ok: true, out, command: pnpm.command, args, host };
  }
  return { ok: false, out, command: pnpm.command, args };
}

/**
 * 装浏览器时按序要试的**镜像根** —— 头一个是 `PLAYWRIGHT_DOWNLOAD_HOST`（若设了）。
 *
 * ## 为什么必须有一条「外面给的镜像」这条路
 *
 * Playwright 自己有一份 `PLAYWRIGHT_CDN_MIRRORS`（三档），而三档**都是
 * `cdn.playwright.dev` 与 `playwright.download.prss.microsoft.com`** 的排列。
 * 在这台自托管节点上实测（`cnb-gt1-1k513ill4`）：`Downloading Chrome for Testing …`
 * 逐字打了 **5 次**、每次都是 `cdn.playwright.dev`（Playwright 的重试是
 * `retryCount = 5`，换镜像但不换域名族），然后 `Download failure, code=1`。
 * 也就是说**它自己的回退在同一张网里等于没有**：三个域名要么一起通、要么一起不通。
 *
 * 所以「不通」这一档唯一的出路是外面给一个能通的根 —— `PLAYWRIGHT_DOWNLOAD_HOST`
 * 正是 Playwright 留给这件事的键（本仓不发明第二套，§12.18）。设了就用它，
 * 而且**只用它**：那说明人已经知道该走哪儿，不必再陪 Playwright 挨个试一遍不通的。
 *
 * 没设时返回一条空宿主 = 走 Playwright 的默认行为（内置那三档），
 * **不替它挑一个第三方镜像写进代码** —— 那等于把「哪面墙怎么过」写死在仓里，
 * 换台机器就静默失效，而这里判据是「装完能起才放行」，它会绿着把错的东西放过去。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<string | undefined>}
 */
export function playwrightHostsToTry(env) {
  const configured = env.PLAYWRIGHT_DOWNLOAD_HOST;
  return configured ? [configured] : [undefined];
}
