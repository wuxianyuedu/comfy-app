#!/usr/bin/env node
// @ts-nocheck -- 门禁扫描面的共用读取与枚举（被 scripts/check-*.cjs 调用，自己不判成败）
/**
 * **所有会枚举 `tests/` 的门禁判据共用这一份读取**，别各自再写一遍
 * `walk()` + 裸 `fs.readFileSync(abs)`。
 *
 * 为什么这是一层地基而不是「每份判据自己兜一下」：`tests/global-setup-cleanup.test.ts`
 * 与几份并发用例会在 `tests/` 下临时造探针文件（`.setup-cleanup-probe-*.test.tsx`、
 * `.it-each-probe-*` 之类）再删。同一工作树里两个 vitest 在跑时，门禁读的是**工作树**，
 * 于是撞上两种窗口 —— 两种都是同一个竞态，只补一种等于把门禁的一半赌在时序上：
 *
 *   ① **列到名字、读时已没**：`readdir` 已经返回了这个条目，`readFileSync` 时它没了。
 *      ⇒ `readForScan()` 返回 `null`（见那条）。
 *   ② **枚举当场消失**：条目在「两次 `readdir` 调用之间」被删，`readdirSync` 自己抛
 *      `ENOENT`。这不是「多列到一个名字」，是枚举这一步崩掉。
 *      ⇒ `readdirForScan()` 返回 `null`、`walkForScan()` 把这一支降级为空。
 *
 * 后果形态是 D 组带着一个 Node 栈崩掉，**报错里没有一个字指向本次改动** ——
 * 撞过的人只会以为是自己的代码写坏了（§13.6.2 那条「报错指向的文件你根本没碰过」）。
 *
 * **两条口径不许松**：
 *
 *   · **只有 `ENOENT` 降级**。权限错、路径是目录、编码问题照原样冒出去 ——
 *     把它们一起吞掉，就把「判据读不到扫描面」变成了静默放行，
 *     那比崩掉更坏（§13.5.12 立的就是这一族：判据在场 ≠ 判据在跑）。
 *   · **消失数必须进结论行**（`vanishedNote()`）。静默跳过等于让判据在它其实
 *     没读过的文件上假装绿；读数写出来，下一个人才能判断「这一轮到底覆盖了什么」。
 */
const fs = require("node:fs");
const path = require("node:path");

/** 默认不进去的目录：依赖与产物。要更多豁免由调用方传 `skipDirs`。 */
const DEFAULT_SKIP_DIRS = new Set(["node_modules"]);

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
 * 「这一轮有几份文件没被读过」的结论行。没有消失就返回空串，调用方直接拼。
 *
 * @param {number} count 消失的文件数
 * @returns {string}
 */
function vanishedNote(count) {
  if (!(count > 0)) return "";
  return `\n  ⚠️ 另有 ${count} 份文件在扫描期间消失（并发用例的临时探针），本轮未读。`;
}

module.exports = {
  DEFAULT_SKIP_DIRS,
  readForScan,
  readdirForScan,
  walkForScan,
  vanishedNote,
};
