#!/usr/bin/env node
// @ts-nocheck -- 门禁扫描面的共用读取与枚举（被 scripts/check-*.cjs 调用，自己不判成败）
/**
 * **所有会枚举工作区的门禁判据共用这一份读取**，别各自再写一遍
 * `walk()` + 裸 `fs.readFileSync(abs)`。
 *
 * 为什么这是一层地基而不是「每份判据自己兜一下」：门禁脚本读的是**工作树**，
 * 而工作树在扫描期间不是静止的 —— 两个来源都会在遍历途中删目录：
 *
 *   · `tests/global-setup-cleanup.test.ts` 与几份并发用例会在 `tests/` 下临时造
 *     探针文件（`.setup-cleanup-probe-*.test.tsx`、`.it-each-probe-*` 之类）再删；
 *   · **工作区根上会有活跃的临时目录**（编辑器 / 测试运行器 / 另一个代理工作区留下的
 *     `_tmp_*`、`.workbuddy/` 一类），清理它们的进程与本脚本毫无关系。
 *
 * 两条路撞上的是同一个竞态，只补一种等于把门禁的一半赌在时序上：
 *
 *   ① **列到名字、读时已没**：`readdir` 已经返回了这个条目，`readFileSync` 时它没了。
 *      ⇒ `readForScan()` 返回 `null`（见那条）。
 *   ② **枚举当场消失**：条目在「两次 `readdir` 调用之间」被删，`readdirSync` 自己抛
 *      `ENOENT`。这不是「多列到一个名字」，是枚举这一步崩掉。
 *      ⇒ `readdirForScan()` 返回 `null`、`walkForScan()` 把这一支降级为空。
 *
 * 后果形态是门禁带着一个 Node 栈崩掉（`ENOENT: no such file or directory, scandir '…'`），
 * **报错里没有一个字指向本次改动** —— 撞过的人只会以为是自己的代码写坏了
 * （§13.6.2 那条「报错指向的文件你根本没碰过」）。判据的真实语义（有违规 / 没有）
 * 与判据的执行故障（环境竞争）被压成同一个退出码，而这两件事的下一个动作相反。
 *
 * **两条口径不许松**：
 *
 *   · **只有 `ENOENT` 降级**。权限错、路径是目录、编码问题照原样冒出去 ——
 *     把它们一起吞掉，就把「判据读不到扫描面」变成了静默放行，
 *     那比崩掉更坏（§13.5.12 立的就是这一族：判据在场 ≠ 判据在跑）。
 *   · **消失数必须进结论行**（`vanishedNote()`）。静默跳过等于让判据在它其实
 *     没读过的文件上假装绿；读数写出来，下一个人才能判断「这一轮到底覆盖了什么」。
 *
 * **「条目消失」与「根不存在」是两回事**（这一条是本节最容易写反的地方）：上面降级的
 * 全是**条目级**消失 —— 那个条目已经不在了，它不可能承载任何违规，「跳过」与「工作区
 * 静止时遍历到它」等价。但**扫描根自己不存在**是另一回事：那是仓库被切了一半 / 跑错
 * 工作目录，跳过它会让判据在「其实一份输入都没读」的情况下报绿。所以根的存在性由调用方
 * 的 `dirExists()` 显式判（判失败即退出，语义见那条）。
 */
const fs = require("node:fs");
const path = require("node:path");

/** 默认不进去的目录：依赖与产物。要更多豁免由调用方传 `skipDirs`。 */
const DEFAULT_SKIP_DIRS = new Set(["node_modules"]);

/**
 * 判「扫描根在不在」—— **入口级**事实，与条目级消失分开。
 *
 * 调用方在开始遍历之前对每个根调一次；返回的布尔由调用方合成判据失败（本件不自己
 * `process.exit`，它不判成败）。语义与既有的 `if (!fs.existsSync(LIB)) return;` 同类：
 *
 *   · **在** ⇒ 正常遍历（遍历途中条目消失由 `walkForScan()` 降级）。
 *   · **不在** ⇒ 真故障。静默跳过等于让判据在「一份输入都没读」时报绿 ——
 *     那是 §13.5.12 那一族里最坏的一种（读不到输入被读成没有问题）。
 *
 * 为什么不在这里直接抛：不同判据对「根缺失」的出口不同（有的判失败、有的走
 * `base-check` 的 `inconclusive`），把出口留给调用方，这里只回答「在不在」。
 *
 * @param {string} dir 绝对路径
 * @returns {boolean}
 */
function dirExists(dir) {
  return fs.existsSync(dir);
}

/**
 * 读一份扫描面上的文件；它在「列目录 → 读内容」之间消失时返回 `null`。
 *
 * @param {string} abs 绝对路径
 * @returns {string | null} 文件正文；`null` = 这一轮没读到（调用方必须计数）
 */
function readForScan(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (error) {
    /* 消失不是判据要判的形态：一个已经不存在的文件里没有站点可言。 */
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * 读一份扫描面上的文件的**原始字节**；它在「列目录 → 读内容」之间消失时返回 `null`。
 *
 * 与 `readForScan()` 同一件事、只是不解码：有的判据要的是字节本身（BOM 判据看前三个
 * 字节、控制字符判据要按码位扫），走 `utf8` 会把这两件事都做坏。
 *
 * @param {string} abs 绝对路径
 * @returns {Buffer | null} 文件字节；`null` = 这一轮没读到（调用方必须计数）
 */
function readBytesForScan(abs) {
  try {
    return fs.readFileSync(abs);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * 列一个目录；它当场消失时返回 `null`（调用方把这一支降级为空）。
 *
 * 用 `withFileTypes` 而不是「先列名字再 `statSync`」：后者多一次 syscall，
 * 于是同一个竞态多出第三种窗口 —— 条目在 `readdir` 与 `statSync` 之间被删时
 * `statSync` 抛 `ENOENT`，而那通常写在 `try` 之外。
 *
 * @param {string} dir 绝对路径
 * @returns {import("node:fs").Dirent[] | null} `null` = 目录这一轮列不到
 */
function readdirForScan(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * 递归列出一个目录树下命中 `fileRe` 的文件（绝对路径）。
 *
 * 目录不存在 / 建树途中消失 ⇒ 那一支为空；文件读不到不在这里发生（这里只列名字），
 * 消失的文件由调用方交给 `readForScan()` 计数。
 *
 * @param {string} dir 绝对路径
 * @param {RegExp} fileRe 文件名过滤器
 * @param {{ skipDirs?: Set<string>, skipHiddenDirs?: boolean }} [opts]
 *   `skipHiddenDirs` 只给「本来就不进点开头目录」的调用方（如注释语言棘轮）——
 *   默认不跳过，否则扫描面会在没人察觉的情况下收窄。
 *   ⚠️ **它只管目录，不管点开头的文件**：并发探针的名字就是 `.setup-cleanup-probe-*.test.tsx`
 *   这类**点开头、但确实命中 `fileRe`** 的条目 —— 把它们一起跳掉，等于让判据在
 *   「正在被并发跑」的那一刻恰好不再检查它们，那正是本层要治的问题本身。
 * @returns {string[]}
 */
function walkForScan(dir, fileRe, opts = {}) {
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const skipHiddenDirs = opts.skipHiddenDirs === true;
  const out = [];

  const entries = readdirForScan(dir);
  if (entries === null) return out;

  for (const e of entries) {
    if (skipDirs.has(e.name)) continue;
    if (skipHiddenDirs && e.isDirectory() && e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkInto(abs, out);
    else if (fileRe.test(e.name)) out.push(abs);
  }
  return out;

  /** 递归那一层：每支自己判「列不到就跳过」。 */
  function walkInto(current, sink) {
    const list = readdirForScan(current);
    if (list === null) return;
    for (const e of list) {
      if (skipDirs.has(e.name)) continue;
      if (skipHiddenDirs && e.isDirectory() && e.name.startsWith(".")) continue;
      const abs = path.join(current, e.name);
      if (e.isDirectory()) walkInto(abs, sink);
      else if (fileRe.test(e.name)) sink.push(abs);
    }
  }
}

/**
 * 「这一轮有几个条目没被读到」的结论行。没有消失就返回空串，调用方直接拼。
 *
 * 文案只说「工作区并发变更」、不点死「并发用例的探针」：消失者有两个来源
 * （`tests/` 下自造自删的探针，与工作区根上被别的进程清理的临时目录），
 * 逐一点名会让下一个人在另一个来源上读到一句对不上的话 ——
 * 这一行要给的是**读数**（几个），不是归因。
 *
 * @param {number} count 消失的文件数
 * @returns {string}
 */
function vanishedNote(count) {
  if (!(count > 0)) return "";
  return `\n  ⚠️ 另有 ${count} 个条目在扫描期间消失（工作区并发变更），本轮未读。`;
}

module.exports = {
  DEFAULT_SKIP_DIRS,
  dirExists,
  readBytesForScan,
  readForScan,
  readdirForScan,
  walkForScan,
  vanishedNote,
};
