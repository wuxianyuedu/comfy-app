#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：依赖构建脚本与 allowBuilds 对账（供 .githooks/pre-commit 的 D 组调用）
/**
 * 构建脚本批准台账守卫 —— 规范见 docs/standards/13-提交与-code-review.md §13.5.15。
 *
 * ── 立案现场 ──────────────────────────────────────────────────────
 *
 * AGENTS 硬规则 8 写着「新增含 postinstall 构建脚本的依赖：同步更新
 * `pnpm-workspace.yaml` 的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1」，
 * 而这条规则此前**一个执行者都没有**：`allowBuilds` 只在别处被当输入读
 * （`check-deps-freshness.mjs` 拿它判「远端只改了 allowBuilds 这一档」的新鲜度、
 * `check-type-assertion-executor.cjs` 在注释里解释为什么不引 `jsonc-parser`），
 * 没有任何一处判过「某个带构建脚本的依赖到底在不在名单里」。
 *
 * 这条判据值得存在的理由是**故障落点与改动点不同人**：
 *
 *   · 漏登记的那个人当时看不出来 —— 他自己的 `node_modules` 早装好了，
 *     `pnpm install` 在他机器上是增量、甚至直接 short-circuit；
 *   · 第一次复现是在**下一个人**（或另一台检出、另一个容器）跑
 *     `pnpm install --frozen-lockfile` 那一刻，非交互模式遇到未批准的构建脚本
 *     以 `ERR_PNPM_IGNORED_BUILDS` exit 1；
 *   · 表现是「这个仓库装不上依赖」，而按硬规则 26 的口径这会被读成
 *     「环境跑不了门禁」——一条登记疏漏被升级成一次全场排查。
 *
 * 同族先例：`check-app-version.cjs` 守的也是「同一个事实抄在多份清单里、
 * 漏改一处时当场看不出来」。那一处判「三处相等」，这一处判「名单覆盖齐全」。
 *
 * ── 判什么 ────────────────────────────────────────────────────────
 *
 *   ① `pnpm-workspace.yaml` 在，且其中有 `allowBuilds:` 块（块没了 = 名单这一档
 *      整体消失，正是本判据要拦的根状态）；
 *   ② `node_modules/.pnpm` 在（缺了判红，不静默放行 —— 见下面「为什么缺依赖是红」）；
 *   ③ 每一个**已安装且带 `preinstall` / `install` / `postinstall` 的包**，都必须在
 *      `allowBuilds` 里有一条显式条目 —— `true`（批准执行）与 `false`（显式拒绝）
 *      都算已登记，两者都是「有人回答过」。
 *
 * 三点都不是新增语义，而是照 pnpm 自己的判定口径抄的：它按**包名**（不按版本）
 * 批准，非交互模式对**未出现在名单里**的构建脚本直接失败而不是警告。
 *
 * ── 刻意不判的 ────────────────────────────────────────────────────
 *
 *   · **名单里多余的反向条目**（登记了、但当前没有构建脚本的包）。实测本仓 11 个条目里
 *     8 个属于这类，且其中一半是**故意**的：`better-sqlite3` 显式 `false` 的理由写在
 *     `pnpm-workspace.yaml` 里（v13 改成随包附带 prebuilds，仍带 `gypfile` 会触发一次
 *     必然失败的 `node-gyp rebuild`），`@prisma/*` 是给可选 peer 的覆盖留的位。
 *     反向判红会把这两种正当形态一起打成违规 —— 那是「误报一片」，不是收紧判据。
 *   · **该不该批准**（`true` 还是 `false`）：那是发布/构建判断，与硬规则 8 那句
 *     「同步更新名单」不是同一件事（§12.18：不再为此写一个启发式扫描器）。
 *   · **版本粒度**：pnpm 按名字批准，所以同名多版本共享一条条目是既定语义，不判。
 *
 * ── 为什么读 `node_modules` 而不是 lockfile 或 registry ────────────
 *
 *   · `pnpm-lock.yaml` 不带 `scripts` 字段（它记解析结果与完整性，不记生命周期），
 *     从它推「有没有 postinstall」要引第二份数据源；
 *   · 问 registry 要网络 —— 与本仓判定型入口的「零网络」口径相反
 *     （同 `check-deps-freshness.mjs` 那句「判据自身不做网络请求」）；
 *   · `node_modules/.pnpm/<条目>/node_modules/<包>/package.json` 是**已经装出来的事实**，
 *     与 pnpm 判定构建脚本时读的是同一份输入，不存在「判据与工具看不同来源」的缝。
 *
 * 代价：一次全量 `package.json` 读取（实测本仓 1379 个安装条目、亚秒级），
 * 且**只在本地钩子里跑** —— 它不需要 CI 兜底（流水线已随 ISSUE #623 删除，
 * 见 §13.5.12 那句「判据在场但没有执行者」正是本档要防的形态）。
 *
 * ── 为什么「缺依赖」是红而不是跳过 ────────────────────────────────
 *
 * 硬规则 26 已经定过调：`node_modules` 缺失只表示**还没装**，不表示「本机跑不了判据」。
 * 把「读不到扫描面」写成静默 `exit(0)`，判据会在「一份输入都没读」的情况下报绿 ——
 * 那比崩掉更坏（同 `gate-scan-read.cjs` 头部那句口径）。所以这里判红，
 * 并把出口直接写成那一条命令。
 *
 * ── 为什么是条件触发（`--staged`），而不是每次提交都扫 ──────────
 *
 * 一次全树扫描 4.5s，而**能让「带构建脚本的依赖」发生变化的输入只有三个文件** ——
 * `package.json`（直接依赖）、`pnpm-lock.yaml`（解析结果，传递依赖的新版本可能新带
 * 一个 postinstall）、`pnpm-workspace.yaml`（名单自己）。只改文档 / 只加碎片 /
 * 只动 `src/` 的那一类提交，扫多少遍结论都一样。
 *
 * 这与本仓既定的口径同源（ISSUE #1747：D 组里全库扫描的两步按输入面跳过；
 * §13.5.12 那条「无条件挂上昂贵的判据 ⇒ 所有人开始 `--no-verify` ⇒ 判据归零」）。
 * 跳过时**打印理由**（与「扫过之后没问题」在输出上可分，不伪造绿），读不到暂存清单
 * 走 `exit 2` 而不是冒充「未触及」—— 两件事都由共用短路器
 * `gate-scan-read.cjs` 的 `skipUnlessStagedTouches()` 一处实现，本脚本不另写一份。
 *
 * **为什么「只在依赖面判」不是把判据松掉**：带构建脚本的包只能从那三个文件进来，
 * 所以触发条件与违规的可能来源**是同一批文件**；而存量实测为 0（1377 个安装条目里
 * 只有 3 个带构建脚本、全部已登记），没有历史欠账被留在跳过档里。日后若依赖面
 * 之外冒出了新站点，把这三个文件之外的输入加进 `DEPENDENCY_FILES` 即可 —— 那份清单
 * 收在 `dependency-face.mjs` 一处，本脚本 import 它而不是抄第二份（§12.12）。
 *
 * 用法：
 *   node scripts/check-allow-builds.cjs            # 全量判（手动 / 合并前那一跳）
 *   node scripts/check-allow-builds.cjs --staged   # 只在本次提交动了依赖面时判
 * 退出码：0 = 名单覆盖齐全（或未触及依赖面而跳过）；1 = 有带构建脚本的依赖未登记，
 * 或扫描面读不到；2 = `--staged` 下读不到暂存清单（判据没跑成，不冒充跳过）。
 */
const path = require("node:path");
const {
  dirExists,
  readForScan,
  readdirForScan,
  skipUnlessStagedTouches,
  vanishedNote,
} = require("./gate-scan-read.cjs");
/* 「动了哪些文件算动了依赖面」只有那一处定义：`dependency-face.mjs` 的导出。
   为什么不在这里抄第二份三文件清单 —— 抄的那份不会跟着长，将来清单加第四项时本判据
   静默漏判（§12.12 说的「漂开的形态是静默的」）。为什么也不直接 import
   `check-deps-freshness.mjs`：那份判据的模块图带着 `lockfile/lock-diff.mjs`、
   `launcher-core/worktree.mjs` 一串下游，为一个常量拖进整条链，代价落在门禁自测的
   临时工作区上（少拷一个就是 `ERR_MODULE_NOT_FOUND`，读起来像被测判据坏了）。 */
const { DEPENDENCY_FILES } = require("./dependency-face.mjs");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_FILE = path.join(ROOT, "pnpm-workspace.yaml");
const PNPM_DIR = path.join(ROOT, "node_modules", ".pnpm");
/** pnpm 会为其执行（或据其拒绝）的生命周期脚本 —— 顺序照 pnpm 自己的调用序。 */
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"];

/* ── 名单：`pnpm-workspace.yaml` 的 allowBuilds 块 ─────────────────── */

/**
 * 解析 `allowBuilds:` 块的键集合。
 *
 * 为什么手写这二十行而不是引 `yaml` / `js-yaml`：本判据每次提交都跑，多一条依赖
 * 就要给 `allowBuilds` 自己记一笔（这正是它判的那件事），而块形态只有
 * 「`键: 值` 一行一条 + 整行注释」两种 —— 判据口径足够窄（同
 * `check-type-assertion-executor.cjs` 里 `blankJsonComments()` 的取舍理由）。
 * 只取**键集合**：`true` / `false` 都算已登记，本判据不判取值。
 *
 * @param {string} text 文件正文
 * @returns {{keys: Set<string>, blockFound: boolean}}
 */
function readAllowBuildsKeys(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^allowBuilds:\s*$/.test(l));
  if (start < 0) return { keys: new Set(), blockFound: false };

  const keys = new Set();
  for (const line of lines.slice(start + 1)) {
    // 块结束：遇到第一条「顶到行首」的非空行（下一个顶层键或注释）。
    if (/^\S/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const matched = /^"?([^":]+)"?\s*:/.exec(trimmed);
    if (matched) keys.add(matched[1].trim());
  }
  return { keys, blockFound: true };
}

/* ── 扫描面：已安装且带生命周期脚本的包 ──────────────────────────── */

/**
 * 列出 `node_modules/.pnpm` 下每个包**自己**的 `package.json` 位置。
 *
 * pnpm 的隔离布局里，`.pnpm/<name>@<ver>/node_modules/` 同时放着两样东西：
 * 这个包**本体**（真实目录）与它的依赖（指向别的条目的符号链接）。所以
 * `isSymbolicLink()` 的条目一律跳过 —— 顺着链接读会把同一个包按依赖边数
 * 重复读几十遍（实测会走到上万次读取），而判据要的是「装了哪些包」，不是「图有几条边」。
 *
 * @returns {{entries: Array<{name: string, absPath: string}>, vanished: number}}
 */
function collectInstalledPackages() {
  const entries = [];
  let vanished = 0;

  const storeDirs = readdirForScan(PNPM_DIR);
  if (storeDirs === null) return { entries, vanished: vanished + 1 };

  for (const storeDir of storeDirs) {
    if (!storeDir.isDirectory()) continue;
    const inner = readdirForScan(
      path.join(PNPM_DIR, storeDir.name, "node_modules"),
    );
    if (inner === null) {
      vanished += 1;
      continue;
    }
    for (const item of inner) {
      if (item.isSymbolicLink()) continue;
      const full = path.join(
        PNPM_DIR,
        storeDir.name,
        "node_modules",
        item.name,
      );
      if (!item.isDirectory()) continue;
      if (!item.name.startsWith("@")) {
        entries.push({
          name: item.name,
          absPath: path.join(full, "package.json"),
        });
        continue;
      }
      // 作用域包：`@scope` 这层是目录，包名是 `@scope/<名字>`。
      const scoped = readdirForScan(full);
      if (scoped === null) {
        vanished += 1;
        continue;
      }
      for (const child of scoped) {
        if (child.isSymbolicLink() || !child.isDirectory()) continue;
        entries.push({
          name: `${item.name}/${child.name}`,
          absPath: path.join(full, child.name, "package.json"),
        });
      }
    }
  }
  return { entries, vanished };
}

/**
 * 从一份 `package.json` 正文里挑出真正会执行的生命周期脚本。
 *
 * 空串不算：`"postinstall": ""` 这类残留不执行任何东西，pnpm 也不会为它要求批准 ——
 * 把它算成站点就是误报。
 *
 * @param {string} raw 文件正文（消失的那一路由调用方处理）
 * @returns {{name: string, version: string, scripts: string[]} | null} 无站点返回 `null`
 */
function scriptBearingPackage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 装出来的 package.json 解析不了 = 这一条输入不可信，不当作站点；
    // 它不会静默消失：结论行报「几个条目没读到」（同 gate-scan-read 那句口径）。
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const scripts = parsed.scripts;
  if (!scripts || typeof scripts !== "object") return null;
  const hits = LIFECYCLE_SCRIPTS.filter(
    (key) => typeof scripts[key] === "string" && scripts[key].trim() !== "",
  );
  if (hits.length === 0) return null;
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") return null;
  return {
    name: parsed.name.trim(),
    version: typeof parsed.version === "string" ? parsed.version : "未知版本",
    scripts: hits,
  };
}

/* ── 判定 ────────────────────────────────────────────────────────── */

/* `--staged`：没动依赖面就跳过（省下那一次全树扫描），并打印理由让「跳过」与
   「扫过之后没问题」可分辨。共用短路器自己处理「读不到暂存清单 ⇒ exit 2」，
   不会把「判据没跑成」冒充成「未触及」。 */
if (process.argv.includes("--staged")) {
  skipUnlessStagedTouches({
    roots: DEPENDENCY_FILES,
    tag: "[allow-builds]",
    root: ROOT,
    what: "依赖面",
  });
}

const problems = [];
let scanned = 0;
let unread = 0;
const bearing = [];

if (!dirExists(WORKSPACE_FILE)) {
  problems.push(
    `读不到 pnpm-workspace.yaml（${path.relative(ROOT, WORKSPACE_FILE)}）。` +
      `本判据的名单在那一份文件里 —— 它不在，判据就没有输入，跳过等于报绿。`,
  );
} else {
  const workspaceText = readForScan(WORKSPACE_FILE);
  if (workspaceText === null) {
    problems.push("pnpm-workspace.yaml 在扫描期间消失了，重新跑一次即可。");
  } else {
    const { keys, blockFound } = readAllowBuildsKeys(workspaceText);
    if (!blockFound) {
      problems.push(
        "pnpm-workspace.yaml 里没有 `allowBuilds:` 块。名单整档消失之后，" +
          "任何一个带构建脚本的依赖都会让别人的 `pnpm install --frozen-lockfile` " +
          "以 ERR_PNPM_IGNORED_BUILDS 失败（AGENTS 硬规则 8）。",
      );
    }

    if (!dirExists(PNPM_DIR)) {
      problems.push(
        `读不到 ${path.relative(ROOT, PNPM_DIR)} —— 依赖还没装（不是「本机装不了」，` +
          "见 AGENTS 硬规则 26）。先跑 `pnpm install --frozen-lockfile` 再提交，" +
          "否则这一步没有输入可判。",
      );
    } else {
      const collected = collectInstalledPackages();
      unread += collected.vanished;
      const seenNames = new Set();
      for (const entry of collected.entries) {
        scanned += 1;
        const raw = readForScan(entry.absPath);
        if (raw === null) {
          unread += 1;
          continue;
        }
        const found = scriptBearingPackage(raw);
        if (found === null) continue;
        if (seenNames.has(found.name)) continue;
        seenNames.add(found.name);
        bearing.push(found);
        if (keys.has(found.name)) continue;
        problems.push(
          `「${found.name}@${found.version}」带 ${found.scripts.join(" / ")} 构建脚本，` +
            `但 pnpm-workspace.yaml 的 allowBuilds 里没有它（AGENTS 硬规则 8）。\n` +
            `    后果不在这次提交里：下一个人（或另一台检出、另一个容器）跑非交互的\n` +
            `    \`pnpm install --frozen-lockfile\` 会以 ERR_PNPM_IGNORED_BUILDS exit 1。\n` +
            `    出路：在 allowBuilds 里显式写 "${found.name}": true（它确实需要被编译 / 下载产物）\n` +
            `    或 false（不需要，并写一句为什么）—— 两种都算回答过，漏答才是问题。`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("❌ 依赖构建脚本与 allowBuilds 未对账：");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(
    `\n  本轮扫描 ${scanned} 个安装条目，其中 ${bearing.length} 个带构建脚本。${vanishedNote(unread)}`,
  );
  process.exit(1);
}

console.log(
  `✅ allowBuilds 覆盖了全部带构建脚本的依赖：${bearing.length} 个` +
    `（扫了 ${scanned} 个安装条目）${vanishedNote(unread)}`,
);
process.exit(0);
