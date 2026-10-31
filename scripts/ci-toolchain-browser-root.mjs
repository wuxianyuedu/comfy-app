/**
 * Playwright 浏览器**落点根**的推导 —— 全仓唯一出处。
 *
 * ## 为什么单独一个文件
 *
 * `scripts/ci-toolchain-browser.mjs` 已经 876 行，而 `scripts/**` 的 900 行是**硬闸**
 * （`scripts/check-infra-file-size.cjs`，无基线、无 `--update`）。而落点推导是这一族里
 * 最容易被复制的一份：装、复验、自取三处都要它。拆出来之后，「一处推导、多处引用」
 * 这件事由**模块边界**保证，而不是靠约定。
 *
 * ## 三档语义（别把它们读成一档）
 *
 * - **平台默认**（`platformDefaultBrowsersRoot`）：不含任何覆盖，按上游
 *   `registry/index.ts` 推 —— Windows 走 `%LOCALAPPDATA%\ms-playwright`、
 *   macOS 走 `~/Library/Caches/ms-playwright`、其余走 `~/.cache/ms-playwright`。
 * - **生效落点**（`playwrightBrowsersRoot`）：`PLAYWRIGHT_BROWSERS_PATH` 优先，
 *   否则平台默认。**装与判都只看它** —— 「装了却探不到」那条病的根就在这儿。
 * - **候选根**（`playwrightRootCandidates`）：生效落点 + 平台默认（两者不同时才有
 *   第二个）。第二个只用来**说一句真话**：生效落点扑空而平台默认下有 ⇒
 *   「装在别处，而运行时看不见它」。
 *
 * ## 为什么要「候选」这一档
 *
 * 落点一旦被**覆盖**（自托管节点把浏览器放到开发盘就是这一档），「装的那一处」与
 * 「运行时看的那一处」就都由这一个变量决定。变量写在**流水线级** env 里时两边一致；
 * 一旦它被挪进某一格的 `env:`，安装那一格看得到、E2E 那一格看不到 ⇒
 * **装好了，探不到** —— 而这两种情况在日志里原本逐字同形（本仓最贵的那类红）。
 *
 * 候选根这一档把那句话说出来：`browserExecutableExists()` 在生效落点扑空时会再问一次
 * 平台默认，答「装在 <平台默认>，而运行时只看 <生效落点>」。它**只改读数、不改判据**
 * —— 生效落点里没有就是没有（`ok` 仍然是假），变的只是那一句话说的是什么。
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * 平台默认落点根（**不含**任何覆盖）。
 *
 * 三个平台的默认值与上游 `registry/index.ts` 一致。**不写死某一台机器的盘符** ——
 * 自托管那台机把用户数据放在别的盘上（`ci-toolchain-python.mjs` 的 `pathDrives()`
 * 记过这一格），而 `%LOCALAPPDATA%` 正好跟着走。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {string}
 */
export function platformDefaultBrowsersRoot({
  platform = process.platform,
  env = process.env,
} = {}) {
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
    const local = env.LOCALAPPDATA ?? (home ? p.join(home, "AppData", "Local") : "");
    return local ? p.join(local, "ms-playwright") : "ms-playwright";
  }
  if (platform === "darwin") {
    return home ? p.join(home, "Library", "Caches", "ms-playwright") : "ms-playwright";
  }
  return home ? p.join(home, ".cache", "ms-playwright") : "ms-playwright";
}

/**
 * **生效落点根**：覆盖优先，否则平台默认。
 *
 * 装与判都只看这一个根 —— 所以它是「装得下」与「找得到」之间那道唯一接口。
 * 覆盖为什么优先于平台默认：自托管节点的服务账号有自己的 profile，
 * `%LOCALAPPDATA%` 落在系统盘上，而那台机的浏览器要与其余开发盘实体放在一起
 * （配置与读数见 `.cnb.yml` 流水线级 env 那一段）。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {string}
 */
export function playwrightBrowsersRoot({ platform = process.platform, env = process.env } = {}) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override) {
    return override;
  }
  return platformDefaultBrowsersRoot({ platform, env });
}

/**
 * 候选落点根：**生效落点** + 平台默认根（两者相同时第二个为 `null`）。
 *
 * 第二个存在的唯一理由是**诊断**：生效落点扑空时去问一句平台默认，
 * 好把「一件都没有」与「装在别处、这一跑看不见」分开说。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {{primary: string, fallback: string | null}}
 */
export function playwrightRootCandidates({ platform = process.platform, env = process.env } = {}) {
  const primary = playwrightBrowsersRoot({ platform, env });
  const fallback = platformDefaultBrowsersRoot({ platform, env });
  return { primary, fallback: fallback === primary ? null : fallback };
}

/**
 * 在 `dir` 下按**深度上限**找一个文件名（**不穿符号链接**，越界即停）。
 *
 * @param {string} dir
 * @param {string} name
 * @param {number} depth
 * @param {(dir: string, name: string) => string} join
 * @returns {string | null}
 */
function findFileUnder(dir, name, depth, join) {
  if (depth < 0) {
    return null;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) {
      continue;
    }
    const full = join(dir, e.name);
    if (e.isFile() && e.name === name) {
      return full;
    }
    if (e.isDirectory()) {
      const hit = findFileUnder(full, name, depth - 1, join);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

/**
 * 在**一个**落点根下找 headless shell 那一件：找得到给路径，找不到给一句读数。
 *
 * 拆成独立一份是为了让两个根的「找法」逐字相同 —— 两处各写一遍的话，漂了之后的表现是
 * 「生效落点那句说没有、默认根那句说有」，读的人无从判断哪句是真的（理由见本文件头
 * 「为什么要「候选」这一档」）。
 *
 * @param {{root: string, platform?: NodeJS.Platform, list?: (dir: string) => string[],
 *   envNote?: string}} io
 * @returns {{found: string | null, miss: string}}
 */
export function findBrowserExecutable({
  root,
  platform = process.platform,
  list = (dir) => readdirSync(dir),
  envNote = "(未设)",
}) {
  let entries;
  try {
    entries = list(root);
  } catch {
    return {
      found: null,
      miss: `落点根读不到：${root}（PLAYWRIGHT_BROWSERS_PATH=${envNote}）`,
    };
  }
  const dir = entries.find((e) => e.startsWith("chromium_headless_shell-"));
  if (!dir) {
    return {
      found: null,
      miss: `${root} 下没有 chromium_headless_shell-*（现有：${entries.join(", ") || "空目录"}）`,
    };
  }
  const exe = platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  /* 拼路径按**目标平台**的分隔符（同 `playwrightBrowsersRoot` 那条口径）。 */
  const p = platform === "win32" ? path.win32 : path.posix;
  const under = p.join(root, dir);
  const found = findFileUnder(under, exe, 3, p.join);
  return found ? { found, miss: "" } : { found: null, miss: `${under} 下找不到 ${exe}` };
}
