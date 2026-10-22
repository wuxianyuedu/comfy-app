/**
 * standalone-link-repair.mjs — 把 standalone 产物里「穿不过去」的符号链接按原链接文本重建
 * ===========================================================================
 *
 * 背景（审查台账 R8-01）：`next build` 的 standalone 产物里，`node_modules` 这一层是
 * **符号链接**，实测在同一份产物、同一台机器上有一部分**不可跟随** —— `lstat` 说它是链接、
 * `readlink` 拿得到目标文本、目标目录确实存在，但 `fs.stat()` 报 `EPERM`。于是
 * `server.js` 起不来，表现是 `Cannot find package 'promise-limit'`，而那个包**就在产物里**。
 *
 * 三条被否证过的解释，写在这里是为了下一个人不再去查同一圈：
 *   · 不是产物缺件 —— 不可跟随的那批链接，目标全部 `existsSync === true`；
 *   · 不是长路径 —— 注册表 `LongPathsEnabled=1`，而最长的一条路径只有 145 个字符；
 *   · 不是目标形状 —— `<…>/styled-jsx…/react` 与 `<…>/next…/react` 的**目标路径逐字相同**，
 *     前者可跟随、后者 `EPERM`。
 * 差别只在**链接自身**：`next build` 建它们的那条路径（Rust 侧）写出的 reparse 数据，
 * Node 的 `stat` 走不通；而同一个目标文本用 `fs.symlinkSync` 就地重建，立刻可跟随
 * （本机实测：全层 68 条链接里 16 条不可跟随，重建后 16/16 可跟随，冒烟从红转绿）。
 *
 * 为什么修在产物层而不是改 `next build`：这不是配置键能管到的东西 —— 与 AGENTS 硬规则
 * 17/18 同一条经验，产物层的缺陷只能在产物层判与修。「重建一遍链接」保留**原链接文本**，
 * 不改产物内容、不影响体积账，也不把开发机的绝对路径烘进包里（所以不用 `junction`：
 * 它存的是绝对目标，产物一搬走就断）。
 *
 * 桌面链不受这条影响：`build-desktop.mjs` 的 §载荷实体化 会把 `.pnpm` 摊平成真实目录，
 * 出厂件里根本没有这些链接。这一层修的是 **web/standalone 形态真正会跑的那份产物**。
 *
 * 「还是穿不过去」时判 1 而不是悄悄放过：重建之后仍不可跟随只有两种可能 —— 目标真的不在
 * （那就是缺件，本脚本点名它，而不是让下一个人从 `Cannot find package` 去猜），或者这台
 * 机器不允许建符号链接（Windows 要开发者模式/权限）。两种都是结论，不是可跳过的噪声。
 * 因此重建的动手顺序是「先在临时名字上建 → 验可跟随 → 删旧的 → 换上」：临时名字建不起来
 * （权限那一种）时，**原来那条链接还在**，这一步不会把产物改得比修之前更坏。
 *
 * ### 第三种形态：非本平台的变体死链（2026-10-22 补）
 *
 * 上面那两种之外还有一种，**在 win32 上是必然出现的**，原先被当成缺件拦下：
 * pnpm 会给 optionalDependencies 的**每一个平台变体**都建一条链接，但只安装本平台那一份。
 * 于是产物里躺着指向 `@libsql/darwin-arm64` / `@libsql/linux-arm-gnueabihf` 这类
 * **别的平台**的链接，而那些目标在 win32 上根本不存在 —— 「目标不存在」是必然的，
 * 不是缺件：运行期用的是本平台那份（`@libsql/win32-x64-msvc`，目标确实在）。
 *
 * 判据：**同包的其它变体已安装** ⇒ 这条是「非本平台变体死链」，**不阻断**，但要报告；
 * 同包一个变体都没装 ⇒ 那才是真缺件，仍然阻断。
 * 判法不认平台名单：看 `.pnpm` 下有没有同包（`<name>` / `@scope`）的**其它**变体目录，
 * 且那份的实体在（`siblingVariantInstalled()`）。
 *
 * 为什么这类死链无害：运行期 require 的是本平台那份（native binding 按平台条件加载），
 * 那条死链永远不会被 require 到 —— 它只是产物里的一条指向空处的路标。
 * 真正「产物能不能起来」由链上的冒烟（`smoke-executor-host-standalone.mjs`）判。
 *
 * 用法：node scripts/standalone-link-repair.mjs   （`pnpm build` 链上的一步）
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 一条链接的可跟随性：`stat` 走得通就是 `follow`。
 *
 * 单列成一个问句，是因为**判据与修法是同一个问句**；它同时是用例注入假象的接缝
 * （见 `repairUnfollowableLinks` 的 `deps`）。
 *
 * @param {string} abs 链接的绝对路径
 * @returns {"follow" | "broken"}
 */
export function linkFollowability(abs) {
  try {
    statSync(abs);
    return "follow";
  } catch {
    return "broken";
  }
}

/**
 * 深度优先列出目录里的符号链接，**不穿链接**（口径与
 * `standalone-private-inputs.mjs` 的剔除侧、`check-standalone-contents.cjs` 的
 * `followLinks=false` 一致：穿链接会把开发机的依赖树当成产物内容）。
 *
 * @param {string} dir 起始目录
 * @param {string} [prefix] 相对起始目录的路径前缀
 * @returns {Array<{abs: string, rel: string}>} 链接条目
 */
export function listLinks(dir, prefix = "") {
  /** @type {Array<{abs: string, rel: string}>} */
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out; // 读不到的目录不是故障（断链 / 权限），跳过
  }
  for (const name of names) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push({ abs, rel });
      continue; // 只登记链接本身，不进它背后
    }
    if (st.isDirectory()) out.push(...listLinks(abs, rel));
  }
  return out;
}

/**
 * 按原链接文本重建一条链接（先建临时名、验可跟随、再换掉旧的）。
 *
 * @param {string} abs 链接路径
 * @param {string} linkText 原链接文本（相对就保持相对，产物整体搬走照样可用）
 * @returns {{ok: boolean, error: string}} `ok=false` 时**旧链接没被删过**
 */
export function rebuildLinkInPlace(abs, linkText) {
  const tmp = `${abs}.link-repair`;
  try {
    rmSync(tmp, { force: true });
    symlinkSync(linkText, tmp, "dir");
    if (linkFollowability(tmp) !== "follow") {
      rmSync(tmp, { force: true });
      return { ok: false, error: "新建的链接仍不可跟随" };
    }
    rmSync(abs);
    renameSync(tmp, abs);
    return { ok: true, error: "" };
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* 临时名都没建起来，没什么要收 */
    }
    return { ok: false, error: describeError(e) };
  }
}

/**
 * 一条没修好的链接的全部现场，供报告点名。
 *
 * @typedef {{
 *   rel: string,
 *   linkText: string,
 *   target: string,
 *   targetExists: boolean,
 *   error: string,
 *   variantDead: boolean,
 * }} BrokenLink
 */

/**
 * 这条死链是不是「非本平台的变体」—— 即**同包的其它变体已安装**，只有这一份没装。
 *
 * 判法不认平台名单（不写死 `darwin-*` / `linux-*` 这类词表）：从链接文本里取出
 * `.pnpm/<X>/node_modules/<rest>`，`X` 形如 `@libsql+darwin-arm64@0.5.29` 或
 * `foo+bar@1.0.0`（**含 `+`** 才是变体形态；`libsql@0.5.29` 是包本体、peer 变体用 `_` 分隔，
 * 两者都不走这条路），`X` 的 `+` 之前那截是**包名**（`@libsql`）。
 * 然后在 `.pnpm` 下找同包的**其它**变体目录，看那份的实体在不在。
 *
 * @param {string} nodeModules 载荷的 `node_modules` 目录
 * @param {string} linkText 链接文本
 * @returns {boolean} 同包有别的变体已安装 ⇒ `true`
 */
export function siblingVariantInstalled(nodeModules, linkText) {
  /* 取 `…/<X>/node_modules/<rest>` 里的 `X`。
   * ⚠️ **不能要求文本里有 `.pnpm`**：pnpm 写出来的链接文本是**相对**的
   * （`..\..\..\@libsql+darwin-arm64@0.5.29\node_modules\@libsql\darwin-arm64`），
   * `.pnpm` 那层在**解析后的绝对路径**里、不在文本里 —— 照着文本找 `.pnpm`
   * 一条都匹配不到，于是每条变体死链都被当成缺件（实测：判据改完仍 exit 1）。 */
  const m = /(?:^|[\\/])([^\\/]+)[\\/]node_modules[\\/](.+)$/.exec(linkText);
  if (!m) return false;
  const x = m[1] ?? "";
  const plus = x.lastIndexOf("+");
  if (plus <= 0) return false;
  const base = x.slice(0, plus);
  const rest = (m[2] ?? "").split(/[\\/]/).filter(Boolean);
  if (rest.length === 0) return false;
  const pnpmDir = join(nodeModules, ".pnpm");
  let names;
  try {
    names = readdirSync(pnpmDir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.startsWith(base + "+")) continue;
    /* 目录名形如 `<base>+<其它变体>@<ver>` —— 实体路径里用的是**那一支的**变体名，
     * 不是这条死链自己的（`rest` 的末段是死链指向的那个变体，用它去找就永远找不到）。 */
    const variant = name.slice(base.length + 1).replace(/@[^@]*$/, "");
    if (variant === "") continue;
    const candidate = join(
      pnpmDir,
      name,
      "node_modules",
      ...rest.slice(0, -1),
      variant,
    );
    try {
      if (statSync(candidate).isDirectory()) return true;
    } catch {
      /* 这份变体也没装实 —— 找下一份 */
    }
  }
  return false;
}

/**
 * 这一步实际用的系统调用，可整体替换（见 `repairUnfollowableLinks` 的 `deps`）。
 *
 * @typedef {{
 *   list?: (dir: string) => Array<{abs: string, rel: string}>,
 *   readText?: (abs: string) => string,
 *   follow?: (abs: string) => "follow" | "broken",
 *   rebuild?: (abs: string, linkText: string) => {ok: boolean, error: string},
 *   exists?: (p: string) => boolean,
 *   dirExists?: (p: string) => boolean,
 *   sibling?: (nodeModules: string, linkText: string) => boolean,
 * }} LinkDeps
 */

/**
 * 重建目录树里所有不可跟随的符号链接。
 *
 * 可跟随的一个都不碰：重建会把链接自身的 mtime 换掉，而 mtime 是壳产物时效判据的输入
 * （`shell-gate.mjs` 复用 `dev-launcher.mjs` 的 `shellStaleWarning()`），不该被这一步扰动。
 *
 * **为什么留 `deps` 这个注入口**：本仓的夹具能造出「指向不存在目标的链接」，但造不出
 * 「目标在场而 `stat` 走不通」这一种 —— 那是 `next build` 的 Rust 侧写出的 reparse 数据，
 * 真机取证已经做过（文件头那几个数）。把「读链接文本 / 判可跟随 / 重建」三件事做成可注入的
 * 边界，决策本身（谁该被修、按什么文本修、修不好怎么报）就能在任何平台上被钉住，
 * 而系统调用那一层由 `pnpm build` 链上的冒烟做真机执行者。
 *
 * @param {string} dir 要修的目录（通常是 `<载荷根>/node_modules`）
 * @param {LinkDeps} [deps]
 * @returns {{scanned: number, repaired: number, broken: BrokenLink[]}}
 */
export function repairUnfollowableLinks(dir, deps = {}) {
  const list = deps.list ?? listLinks;
  const readText = deps.readText ?? ((abs) => readlinkSync(abs));
  const follow = deps.follow ?? linkFollowability;
  const rebuild = deps.rebuild ?? rebuildLinkInPlace;
  const exists = deps.exists ?? existsSync;
  const sibling = deps.sibling ?? siblingVariantInstalled;

  const links = list(dir);
  /** @type {BrokenLink[]} */
  const broken = [];
  let repaired = 0;
  for (const { abs, rel } of links) {
    if (follow(abs) === "follow") continue;
    let linkText;
    try {
      linkText = readText(abs);
    } catch (e) {
      broken.push({
        rel,
        linkText: "",
        target: "",
        targetExists: false,
        error: `readlink 失败：${describeError(e)}`,
        variantDead: false,
      });
      continue;
    }
    const { ok, error } = rebuild(abs, linkText);
    if (ok && follow(abs) === "follow") {
      repaired++;
      continue;
    }
    const target = resolve(dirname(abs), linkText);
    const targetExists = exists(target);
    broken.push({
      rel,
      linkText,
      target,
      targetExists,
      error: ok ? "重建后 stat 仍失败" : error,
      /* 目标不在 + 同包其它变体已安装 ⇒ 非本平台变体死链（不阻断，见文件头第三种形态）。 */
      variantDead: !targetExists && sibling(dir, linkText),
    });
  }
  return { scanned: links.length, repaired, broken };
}

/**
 * @param {unknown} e
 * @returns {string}
 */
function describeError(e) {
  const err = /** @type {{code?: string, message?: string}} */ (e ?? {});
  return `${err.code ?? "ERR"}${err.message ? ` (${String(err.message).split("\n")[0]})` : ""}`;
}

/**
 * 构建链上那一跑的完整判定（`main` 与用例共用，退出码不藏在打印里）。
 *
 * 报告分两档：**真缺件**（阻断）与**非本平台变体死链**（不阻断，但要点名）。
 * 两档分开的原因是它们的处置完全不同 —— 前者要补依赖，后者什么都不用做。
 *
 * @param {string} nodeModules 载荷的 `node_modules` 目录
 * @param {LinkDeps} [deps]
 * @returns {{ran: boolean, scanned: number, repaired: number, broken: BrokenLink[],
 *            blocking: BrokenLink[], lines: string[]}}
 */
export function runLinkRepair(nodeModules, deps = {}) {
  /* ⚠️ 「产物目录在不在」与「某条链接的目标在不在」是**两个**判据，不能共用一个注入口：
   * 共用时，「目标不在」会顺带把产物目录也判成不存在 —— 于是这一步直接跳过，
   * 读数上看起来像「没发现问题」，而真实情况是产物根本没被检查。 */
  const dirExists = deps.dirExists ?? existsSync;
  if (!dirExists(nodeModules)) {
    // 与同链上的 `standalone-private-inputs.mjs` 同一口径：产物不在不是这一步的故障。
    return {
      ran: false,
      scanned: 0,
      repaired: 0,
      broken: [],
      blocking: [],
      lines: ["[standalone-links] 未找到 .next/standalone/node_modules，跳过"],
    };
  }
  const { scanned, repaired, broken } = repairUnfollowableLinks(
    nodeModules,
    deps,
  );
  const blocking = broken.filter((b) => !b.variantDead);
  const variantDead = broken.filter((b) => b.variantDead);
  const lines = [
    `[standalone-links] 扫描 ${scanned} 条符号链接` +
      (repaired > 0 ? `，重建其中不可跟随的 ${repaired} 条` : "，全部可跟随"),
  ];
  if (variantDead.length > 0) {
    lines.push(
      `[standalone-links] ⚠ ${variantDead.length} 条是非本平台变体死链` +
        "（目标不存在，但同包的其它变体已安装 —— 运行期用的是本平台那份，不需要处理）",
    );
    for (const b of variantDead.slice(0, 10)) {
      lines.push(
        `    ${b.rel}：链接文本=${JSON.stringify(b.linkText)} 目标存在=NO ${b.error}`,
      );
    }
    if (variantDead.length > 10)
      lines.push(`    …其余 ${variantDead.length - 10} 条同类`);
  }
  if (blocking.length > 0) {
    lines.push(
      `[standalone-links] ✗ 重建后仍有 ${blocking.length} 条穿不过去（拦下：` +
        "继续往下跑的话 server.js 会报「Cannot find package」，而包常常就在产物里）",
    );
    for (const b of blocking.slice(0, 10)) {
      lines.push(
        `    ${b.rel}：链接文本=${JSON.stringify(b.linkText)} ` +
          `目标存在=${b.targetExists ? "YES" : "NO"} ${b.error}`,
      );
    }
    if (blocking.length > 10)
      lines.push(`    …其余 ${blocking.length - 10} 条同类`);
  }
  return { ran: true, scanned, repaired, broken, blocking, lines };
}

/** 作为脚本直接执行：修 `.next/standalone/node_modules`。 */
function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = runLinkRepair(
    join(root, ".next", "standalone", "node_modules"),
  );
  for (const line of result.lines) {
    if (line.startsWith("[standalone-links] ✗")) console.error(line);
    else console.log(line);
  }
  return result.blocking.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main());
