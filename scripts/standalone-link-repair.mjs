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
 * }} BrokenLink
 */

/**
 * 这一步实际用的系统调用，可整体替换（见 `repairUnfollowableLinks` 的 `deps`）。
 *
 * @typedef {{
 *   list?: (dir: string) => Array<{abs: string, rel: string}>,
 *   readText?: (abs: string) => string,
 *   follow?: (abs: string) => "follow" | "broken",
 *   rebuild?: (abs: string, linkText: string) => {ok: boolean, error: string},
 *   exists?: (p: string) => boolean,
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
      });
      continue;
    }
    const { ok, error } = rebuild(abs, linkText);
    if (ok && follow(abs) === "follow") {
      repaired++;
      continue;
    }
    const target = resolve(dirname(abs), linkText);
    broken.push({
      rel,
      linkText,
      target,
      targetExists: exists(target),
      error: ok ? "重建后 stat 仍失败" : error,
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
 * @param {string} nodeModules 载荷的 `node_modules` 目录
 * @param {LinkDeps} [deps]
 * @returns {{ran: boolean, scanned: number, repaired: number, broken: BrokenLink[], lines: string[]}}
 */
export function runLinkRepair(nodeModules, deps = {}) {
  const exists = deps.exists ?? existsSync;
  if (!exists(nodeModules)) {
    // 与同链上的 `standalone-private-inputs.mjs` 同一口径：产物不在不是这一步的故障。
    return {
      ran: false,
      scanned: 0,
      repaired: 0,
      broken: [],
      lines: ["[standalone-links] 未找到 .next/standalone/node_modules，跳过"],
    };
  }
  const { scanned, repaired, broken } = repairUnfollowableLinks(
    nodeModules,
    deps,
  );
  const lines = [
    `[standalone-links] 扫描 ${scanned} 条符号链接` +
      (repaired > 0 ? `，重建其中不可跟随的 ${repaired} 条` : "，全部可跟随"),
  ];
  if (broken.length > 0) {
    lines.push(
      `[standalone-links] ✗ 重建后仍有 ${broken.length} 条穿不过去（拦下：` +
        "继续往下跑的话 server.js 会报「Cannot find package」，而包常常就在产物里）",
    );
    for (const b of broken.slice(0, 10)) {
      lines.push(
        `    ${b.rel}：链接文本=${JSON.stringify(b.linkText)} ` +
          `目标存在=${b.targetExists ? "YES" : "NO"} ${b.error}`,
      );
    }
    if (broken.length > 10)
      lines.push(`    …其余 ${broken.length - 10} 条同类`);
  }
  return { ran: true, scanned, repaired, broken, lines };
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
  return result.broken.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main());
