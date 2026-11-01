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
const { spawnSync } = require("node:child_process");

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
 * 一个仓库根目录下**当前真实存在**的顶层目录名（按字母序）与根级文件名。
 *
 * 「根清单由仓库现算」这件事对两种判据都是同一件：一种按**目录**定面
 * （`--recursive` 一类），一种按**扩展名**定面（于是根级单文件也得算进来）。
 * 各判据各写一遍 `readdir` 的漂法很脏 —— 有人给其中一份加了
 * `!name.startsWith(".")`、另一份没加，两边的「面上有没有文件」从此不是同一句话。
 *
 * 三条口径：
 *   · **不递归**：只回答顶层 —— 调用方要的是「前缀根」，深一层由它自己展开；
 *   · **跳过依赖与隐藏目录**（`node_modules` / `.git` / `.workbuddy` 一类）：它们里
 *     不会有判据要看的站点，列进来只是让读数变长；
 *   · **根级文件也返回**：调用方要的是「哪些路径算在面上」，`.md` / `package.json`
 *     这些就住在根上，只返回目录会让它们落在面外（`isUnderAny()` 的 `rel === root`
 *     匹配不到根级文件）。
 *
 * @param {string} root 仓库根（绝对路径）
 * @returns {string[]} 顶层目录名（不带尾斜杠）与根级文件名，按名称排序
 */
function discernRoots(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .filter((e) => !(e.isDirectory() && DEFAULT_SKIP_DIRS.has(e.name)))
    .map((e) => e.name)
    .sort();
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
    if (error?.code === "ENOENT") {
      return null;
    }
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
    if (error?.code === "ENOENT") {
      return null;
    }
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
    if (error?.code === "ENOENT") {
      return null;
    }
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
  if (entries === null) {
    return out;
  }

  for (const e of entries) {
    if (skipDirs.has(e.name)) {
      continue;
    }
    if (skipHiddenDirs && e.isDirectory() && e.name.startsWith(".")) {
      continue;
    }
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkInto(abs, out);
    } else if (fileRe.test(e.name)) {
      out.push(abs);
    }
  }
  return out;

  /** 递归那一层：每支自己判「列不到就跳过」。 */
  function walkInto(current, sink) {
    const list = readdirForScan(current);
    if (list === null) {
      return;
    }
    for (const e of list) {
      if (skipDirs.has(e.name)) {
        continue;
      }
      if (skipHiddenDirs && e.isDirectory() && e.name.startsWith(".")) {
        continue;
      }
      const abs = path.join(current, e.name);
      if (e.isDirectory()) {
        walkInto(abs, sink);
      } else if (fileRe.test(e.name)) {
        sink.push(abs);
      }
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
  if (!(count > 0)) {
    return "";
  }
  return `\n  ⚠️ 另有 ${count} 个条目在扫描期间消失（工作区并发变更），本轮未读。`;
}

/**
 * 暂存改动清单（仓库根相对 POSIX 路径）。
 *
 * **为什么收在这里**：`--staged` 那一族的门禁（「只碰了它的输入面才做全量工作」）
 * 实测有 9 处各自手写同一段 `git diff --cached --name-only` + 按行切 + 反斜杠归一
 * （`check-docs-api.cjs` / `check-format.cjs` / `check-ui-primitives.cjs` /
 * `check-deps-freshness.mjs` / `freshness-gate.mjs` / `shell-gate.mjs` /
 * `storybook-check.mjs` / `known-failed-selftest-gate.mjs` / `affected-tests.mjs`）——
 * 与 `walk()` 当年被收进这里同一个理由（§12.12 的孪生对、§12.18 的「写之前先查」）。
 *
 * **拿不到返回 `null`，不返回空数组**：空数组的含义是「确实没有暂存改动」，
 * 而「git 跑不起来 / 不在仓库里」是**判据没跑成**。两者在调用点必须走不同的门 ——
 * 把后者读成前者，就是让「条件触发」静默退化成「永远不触发」（§13.5.12 那一族）。
 *
 * @param {string} [root] 仓库根，默认 `process.cwd()`
 * @returns {string[]|null} 相对仓库根、正斜杠的路径；git 失败时 `null`
 */
function readStagedPaths(root = process.cwd()) {
  /* `-c core.quotePath=false`：路径要**原样**（ISSUE #2272，机制见
   * `scripts/changed-scope.mjs` 的文件头「口径 ④」）。git 默认（`core.quotePath=true`）
   * 把含非 ASCII 字符的路径按 C 风格转义并**加引号** —— 本仓有 38 份文件名带非 ASCII 的
   * 文件（全在 `docs/` 下）⇒ 转义过的路径**对不上扫描根前缀** ⇒ `skipUnlessStagedTouches()`
   * 会**跳过整条判据**：判据在场却没跑，而机器之间还不一样（本机全局配了
   * `core.quotepath=false`，CI runner 是 git 默认值）。 */
  const res = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    return null;
  }
  return (res.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((f) => f.split("\\").join("/"));
}

/**
 * 给定路径是否落在任一目录根下（`dir === rel` 或 `rel` 以 `dir + "/"` 开头）。
 *
 * **根清单由调用方传既有配置**（`SCAN_DIRS` / `INPUT_RES` 那一类），这里不另存一份 ——
 * 抄一份清单就会与它漂移，而漂移的形态是静默的：抄的那份多收一个目录，
 * 那类文件的违规从此没人查（§12.12 / §12.18）。
 *
 * @param {string} rel 仓库根相对 POSIX 路径
 * @param {string[]} roots 目录根清单（同样是相对仓库根的 POSIX 路径）
 * @returns {boolean}
 */
function isUnderAny(rel, roots) {
  return roots.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * 条件触发的**短路器**：`--staged` 那一族门禁的「未命中输入面即跳过」只有这一份实现。
 *
 * 为什么收在共享件里（而不是每份判据各写一遍）：这套流程有四件事必须**一起**做对，
 * 各写一遍的形态是「四件事里漏一件」——而每一件的漏法都是静默的：
 *   ① 读暂存清单，**读不到（`null`）是判据没跑成，不许读成「没有改动」** ⇒ 退出码 2；
 *   ② 用**调用方给的根清单**判命中（不在这里另存一份，否则与配置漂移）；
 *   ③ 跳过时**打印理由**（与「扫过之后没问题」在输出上可分，§11.23）；
 *   ④ 命中时**什么都不做**，把控制权交回调用方去扫全库。
 *
 * 调用方负责的两件事：不要在 `--report` / `--update` 档调它（那是人的动作、照旧全库），
 * 以及调用之后自己判退出 —— 这里只处理「跳过」那一支（`process.exit(0)`），
 * 命中时正常返回。
 *
 * @param {object} options
 * @param {string[]} options.roots 目录根清单（相对仓库根的 POSIX 路径）
 * @param {string} options.tag 输出前缀，如 `"[ui-primitives]"`
 * @param {string} [options.root] 仓库根，默认 `process.cwd()`
 * @param {string} [options.what] 「扫描面」的名字，用于跳过话术
 * @returns {boolean} 是否被跳过（`true` 表示进程已退出，调用方不必再做事）
 */
function skipUnlessStagedTouches({ roots, tag, root = process.cwd(), what = "扫描面" }) {
  const files = readStagedPaths(root);
  if (files === null) {
    console.error(
      `${tag} --staged 模式读不到暂存清单（git diff --cached 失败）——\n` +
        `${tag}   按 fail-closed 判定为「判据没跑成」，以 exit 2 结束` +
        `（不冒充「未触及${what}」）。`,
    );
    process.exit(2);
  }
  if (files.some((f) => isUnderAny(f, roots))) {
    return false;
  }
  console.log(
    `${tag} ✓ 本次提交未触及${what}（${files.length} 个暂存文件中 0 个落在 ${roots.length} 条根内），跳过。`,
  );
  process.exit(0);
}

module.exports = {
  DEFAULT_SKIP_DIRS,
  dirExists,
  discernRoots,
  isUnderAny,
  readBytesForScan,
  readForScan,
  readStagedPaths,
  readdirForScan,
  skipUnlessStagedTouches,
  walkForScan,
  vanishedNote,
};
