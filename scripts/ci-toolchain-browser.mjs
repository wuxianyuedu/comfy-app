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
 * ## 它修的那一格（ISSUE #1961，自托管节点的首次真跑）
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
 *
 * @returns {number}
 */
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
 *   exec?: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   section?: (title: string) => void,
 * }} [ports]
 * @returns {number} 退出码
 */
export function playwrightOnly({ find = required("find"), exec = required("exec"), log = console.log, logError = console.error, section = noopSection } = {}) {
  section("playwright");
  /* 两件都要装：`chromium` 与 `chromium-headless-shell` 是 `browsers.json` 里的
   * **两个条目**，而 headless 档用的是后者 —— 只装前者时 `executablePath()` 会给出
   * 前者、看着像「装过了」，真起浏览器就报 `Executable doesn't exist`
   * （`e2e/support/preflight-browser.mjs` 的头注写着这条）。 */
  const install = runPlaywrightInstall({ find, exec });
  log(install.out || "(playwright install 没有输出)");
  if (!install.ok) {
    logError(
      "\n浏览器装不上（`playwright install` 退非零）。它的出口与 Python 不同 ——" +
        "浏览器二进制只可能来自这一条命令，机器上没有「装了但探不到」的分支，" +
        "所以这里不是「取证给人看」，是这一步真的没做成功。" +
        "常见成因：网络到 CDN 不通、或磁盘满。",
    );
    return 1;
  }
  /* **装完必须复验**（与 `installAndReverify` 的「装完回到 `findPython()` 再探一遍」
   * 同一条口径）：`playwright install` 退 0 **不等于**二进制落地了。理由与判据见下。 */
  const present = browserExecutableExists();
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
  throw new Error(`ci-toolchain-browser：缺 ${what} 注入面（由调用方传入，见文件头）`);
}

/** 默认什么都不打的分节 —— 调用方不关心分节时就别硬塞一行。 */
function noopSection() {}

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
 * 判据是**真 launch**）与 `tests/ci-browser-selfcheck.test.ts` 守着，不在这里重判。
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
    platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const found = findFileUnder(path.join(root, dir), exe, 3);
  return found
    ? { ok: true, out: found }
    : { ok: false, out: `${path.join(root, dir)} 下找不到 ${exe}` };
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
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (platform === "win32") {
    const local =
      env.LOCALAPPDATA ?? (home ? path.join(home, "AppData", "Local") : "");
    return local ? path.join(local, "ms-playwright") : "ms-playwright";
  }
  if (platform === "darwin") {
    return home
      ? path.join(home, "Library", "Caches", "ms-playwright")
      : "ms-playwright";
  }
  return home ? path.join(home, ".cache", "ms-playwright") : "ms-playwright";
}

/**
 * 在 `dir` 下按**深度上限**找一个文件名（**不穿符号链接**，越界即停）。
 *
 * @param {string} dir
 * @param {string} name
 * @param {number} depth
 * @returns {string | null}
 */
function findFileUnder(dir, name, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) {
      const hit = findFileUnder(full, name, depth - 1);
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
 *   exec?: (cmd: string, args: string[]) => {ok: boolean, out: string},
 * }} [ports]
 *   两个接缝（**必传**，见 `playwrightOnly` 的说明）：`find` 给 pnpm 形态、`exec`
 *   起进程。判据里注入它们，结论才不取决于跑判据那台机器上有没有 pnpm、
 *   也不真去下 100MB 浏览器。
 * @returns {{ok: boolean, out: string, command?: string, args?: string[]}}
 */
export function runPlaywrightInstall({ find = required("find"), exec = required("exec") } = {}) {
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
  const r = exec(pnpm.command, args);
  return { ok: r.ok, out: r.out, command: pnpm.command, args };
}

