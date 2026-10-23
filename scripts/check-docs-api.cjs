#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:API 文档生成物与源同步(由平台侧 .cnb.yml 调用,ISSUE #1975 起)
/**
 * check-docs-api.cjs — `docs/api/**` 生成物与当前源同步（规范 §13.5.5 的同族判据）。
 *
 * 背景（ISSUE #1329 收尾时翻出来的真残留）：
 * `docs/api/` 是 **428 个文件提交进 git** 的 TypeDoc 产物（不是被忽略的构建输出），
 * 而 AGENTS / 主规范 §9 都承诺它「随构建链更新」。实测**构建链里没有任何一处调用
 * `pnpm docs`** —— 产物停在最开始那两次提交上（`ab12a551` / `b2c32994`），之后所有
 * `src/lib/**` 增删都没再重生成。于是 #1329 迁完 markdown 渲染器后：
 *   · `docs/api/modules/lib_comfyui_markdown.html` 还在 —— 指向一个**已不存在**的模块；
 *   · `lib_markdown*` 五个新模块的产物**一个没有**；
 *   · 全量口径：2627 个文件的差异（214 删 / 2229 新增 / 184 改）。
 *
 * 为什么没人发现：`docs/reference-facts.md` 把它作为「TypeDoc 自动生成」显式豁免出
 * 文档引用核对；`doc:check` / `doc:render` 只管 `docs/generated/`；pre-commit 也不跑
 * typedoc。结果就是「进 git + 零判据」= 一条只增不减的过期面，比 #1436「文档里的数字
 * 没有判据」更靠里一层：不是引用过期，是**生成物本身过期**。
 *
 * 判据（与 `render-doc-placeholders.cjs --check` 同口径，三个方向都报，少报一个
 * 漏掉的那类就会静默留在产物目录里）：
 *   · 落后 —— 同名文件内容与重生成结果不同（源改了没重生成，最常见）；
 *   · 缺失 —— 重生成产出了、`docs/api/` 里没有（新增模块忘了重生成）；
 *   · 多余 —— `docs/api/` 里有、重生成不再产出（模块删了/改名了留下的孤儿）。
 *
 * 实现要点：
 *   1. **重生成到临时目录、只比对不写入** —— 判据不许污染工作区（否则「跑一次判据」
 *      本身就会产生一份需要提交的 diff，把提交者逼到 `--no-verify`）。
 *   2. **实测幂等 + 跨路径一致**：同源两次重生成逐字节相同；在另一个路径的 worktree 里
 *      重生成与仓库内结果逐字节相同（产物不含绝对路径 / 生成时间戳）。这是「比对」这个
 *      做法成立的前提 —— 判据会自己先验证一遍（见 `verifyDeterminism`）。
 *   3. **重生成这一步按产物判，不按 typedoc 的退出码判**（`scripts/typedoc-run.mjs`，
 *      `pnpm run docs` 与 `pnpm docs:check` 共用同一份）：typedoc 写出失败时照样
 *      退 0、日志照样收在 `[info] html generated at …` 上，而落到本判据里的形状是
 *      「重生成的临时目录是空的」→ 把仓库里的产物**全报成多余**（源已不再产出），
 *      照那条提示去修就是把 `docs/api` 删掉。现在「退出 0 但没写」= 失败并重试，
 *      全失败就在这里停下，不拿空目录去做比对。
 *   4. **触发面 = typedoc 的输入面**：`src/lib/**` / `src/server/**` / `src/trpc/**`
 *      （`typedoc.json` 的 `entryPoints` 三条 glob）+ `typedoc.json` 本身 + 依赖声明
 *      （`package.json` / `pnpm-lock.yaml`，typedoc 与 TS 版本会改变产物形态）
 *      + **闭包叶子集**（`CLOSURE_LEAVES`）。
 *      改这几个以外的文件时本步立刻返回 0（`--staged` 模式），不给普通
 *      提交加那 31s（实测 `pnpm exec typedoc` 冷 31s）。
 *      ⚠️ **2026-10-23 订正（ISSUE #2223）**：这一条原来写着「这**不是启发式收窄**，
 *      是『产物只由这些输入决定』的直接映射：输入没变，产物不可能漂」—— **那句话是错的**。
 *      typedoc 沿 import 走：三根**之外**的文件也会进产物（`BackupResult` 定义在
 *      `scripts/db-backup-core.mjs`，而它出现在 `docs/api/**` 里）⇒ 收窄面判窄了就是
 *      **漏判**，而漏判是静默的（`ifModify` 跳过的形态与「判过且通过」在读数上无差别）。
 *      实测：三根之外有 11 个被引用的文件，其中 10 个原先不在面内。
 *      现在的面 = 三根 ∪ 闭包叶子集，而那份叶子集**不是手抄的事实** ——
 *      真相由 `scripts/docs-api-input-closure.mjs` 算出（从 `typedoc.json` 的
 *      `entryPoints` 出发沿静态 import 走），由 `tests/ci-incremental-gates.test.ts`
 *      双向核对：闭包里多出任何一个文件、而面里没有它 ⇒ 当场红。
 *   5. **平台侧的触发面与这份清单同源**（ISSUE #1981）：`.cnb.yml` 的
 *      `API 文档生成物与源同步` 带着由 `INPUT_RES` 机械导出的 `ifModify`
 *      （`scripts/ci-incremental-gates.mjs` 的 `INCREMENTAL_GATES`），
 *      判据 `tests/ci-incremental-gates.test.ts` 双向核对 —— 于是「产物由哪些输入决定」
 *      写在**一处**（声明），而**真相**由闭包模块算、由那条用例盯（事实）。
 *      实测这一步在自托管节点上是**全流水线最贵的一格**（201.8s，
 *      占 12m14s 的 27.5%），而绝大多数 PR 一行 `src/lib|server|trpc` 都没碰。
 *
 * 用法：
 *   `node scripts/check-docs-api.cjs`            全量比对（默认档）
 *   `node scripts/check-docs-api.cjs --staged`   仅当暂存改动命中输入面才比对（本地手跑用）
 *   `node scripts/check-docs-api.cjs --check --autofix`
 *                                                平台侧那一档（`.cnb.yml` 的
 *                                                `API 文档生成物与源同步`）：先判一次，红了
 *                                                就地重生成 `docs/api/`、**再判一次**
 * 退出码：0 通过（或未触发）；1 漂移 / 重生成失败。
 *
 * ── 执行者在哪（ISSUE #1975 改了，别照着旧注释去找）────────────────────────
 *
 * 它原先挂在 `.githooks/pre-commit` 的 D 组、带 `--staged`。而那个跳过的输入面是
 * `src/lib|server|trpc` —— 本仓最常见的提交类别正落在里面，于是「跳过」在真实提交上
 * 几乎不生效：实测**改一个 `src/lib` 文件**（加一行注释都算）这一档照旧走满 **31s**，
 * 是 D 组最贵的一步。改挂 `.cnb.yml`（平台侧、全量档）之后：判据一个字没改，
 * 而它判的是「产物与源码同不同步」—— 挡不住任何代码回归，正该放在合并前那一层。
 *
 * ⚠️ 平台侧那一步**不带** `--staged`：平台侧的工作区就是这次要判的那份源码，
 * 传 `--staged` 会让它在那边读到空暂存区、恒跳过（挂了等于没挂）。
 * 口径与逐条实测见规范 §13.5.17。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_REL = "docs/api";
const OUT_ABS = path.join(ROOT, OUT_REL);
const TAG = "[docs-api --check]";

/**
 * **闭包叶子集** —— typedoc 输入面的「根外」那一部分（ISSUE #2223）。
 *
 * 这些文件不在 `src/lib` / `src/server` / `src/trpc` 三根里，但**改它们会改
 * `docs/api/**`**：typedoc 沿 import 走，而根外的文件里有**被产物引用**的类型 ——
 * 例：`BackupResult` 定义在 `scripts/db-backup-core.mjs`，它出现在 `docs/api/**` 里。
 *
 * 为什么它们必须在面内：面判窄了 = **漏判**，而漏判是静默的（`ifModify` 跳过的形态
 * 与「判过且通过」在读数上无差别）。2026-10-20 之前那批判据「一个执行者都没有」，
 * 而 `docs/api/**` 随后漂了 32 份 —— 同一个洞的两面。
 *
 * 这份名单**不是手抄的事实**：真相由 `scripts/docs-api-input-closure.mjs` 算出
 * （从 `typedoc.json` 的 `entryPoints` 出发沿静态 import 走），由
 * `tests/ci-incremental-gates.test.ts` 双向核对 —— 闭包里多出任何一个文件、而这里
 * 没有它 ⇒ 当场红。**本列表是「声明」，闭包模块是「事实」，两者对账。**
 *
 * @type {readonly string[]}
 */
const CLOSURE_LEAVES = [
  "scripts/db-backup-core.mjs",
  "scripts/db-push-core.mjs",
  "scripts/db-schema-state.mjs",
  "scripts/launcher-core/command-echo.mjs",
  "scripts/launcher-core/shell.mjs",
  "scripts/launcher-core/worktree.mjs",
  "scripts/lockfile/lock-diff.d.mts",
  "scripts/lockfile/lock-diff.mjs",
  "src/config/custom-nodes.ts",
  "src/env.js",
];

/** 把一个路径变成「逐字匹配它自己」的正则（点号等元字符要转义）。 */
function exactPathRe(p) {
  return new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * 决定产物的输入面（相对仓库根、正斜杠）。与 `typedoc.json` 的 `entryPoints` 同集合，
 * 另加「会改变产物形态」的两类：typedoc 配置自身与依赖声明；
 * 另加**闭包叶子集**（三根之外、但改它们会改产物的那批，见 ISSUE #2223）。
 */
const INPUT_RES = [
  /^src\/lib\/.*\.ts$/,
  /^src\/server\/.*\.ts$/,
  /^src\/trpc\/.*\.ts$/,
  /^typedoc\.json$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /* 判据自身（ISSUE #1981）：改这份脚本或它共用的跑法，同样能改变「本步红不红」——
   * 此前它改了自己不触发，于是「改了判据 → 推上去 → 没跑」是这类改动的默认形状。 */
  /^scripts\/check-docs-api\.cjs$/,
  /^scripts\/typedoc-run\.mjs$/,
  ...CLOSURE_LEAVES.map(exactPathRe),
];

/**
 * 同一张输入面的 **glob 形态** —— 平台侧 `ifModify` 收窄的唯一出处。
 *
 * 为什么是**上界**而不是逐字等价的窄面：`ifModify` 的判据是「变更文件一个都不落在
 * 给定 glob 内 ⇒ 这一步不执行」（`scripts/ci-incremental-gates.mjs` 的口径），
 * **判宽只会少省几秒，判窄是漏判** —— 而 `INPUT_RES` 的窄面（只收 `.ts`）与它的
 * glob 形态（收该目录下的一切）不是一一等价的，抄一份窄的进来就等于把
 * 「改了 `src/lib` 下的非 `.ts` 文件」这一类改动放过头。
 *
 * 两条形态住在**同一个文件**里，而不是一份在判据、一份在登记表：跨文件抄一份就是
 * 第二份会漂的副本（§12.12 / §12.18），而漂的方向恰好是「判据改了触发面、配置没跟」
 * —— 那一格于是再也不跑，且没人看见。
 *
 * ⚠️ 两侧的对应关系由 `tests/ci-incremental-gates.test.ts` 核，**而且核的是「罩住」
 * 而不是「前缀沾边」**（ISSUE #2223 的现场：旧写法只比第一段前缀，于是
 * `scripts/db-backup-core.mjs` 的前缀 `scripts` 被 `scripts/check-docs-api.cjs`
 * 满足 ⇒ 任何 `scripts/` 下的新文件都「已覆盖」⇒ 面判窄了而没人看见）。
 * 现在那条用例做两件事：① 每条 `INPUT_RES` 命中的**每一个文件**都要被某条 glob
 * 真的罩住；② 闭包算出来的**每一个叶子**都要被某条 glob 罩住。
 *
 * @type {readonly string[]}
 */
const INPUT_GLOBS = [
  "src/lib/**",
  "src/server/**",
  "src/trpc/**",
  "typedoc.json",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/check-docs-api.cjs",
  "scripts/typedoc-run.mjs",
  ...CLOSURE_LEAVES,
];

/**
 * 暂存改动是否命中输入面。
 * @param {string[]} files 相对仓库根、正斜杠的文件清单
 * @returns {string[]} 命中的文件（空数组 = 不触发）
 */
function matchedInputs(files) {
  return files.filter((f) => INPUT_RES.some((re) => re.test(f)));
}

/** 读暂存区文件清单。 */
function stagedFiles() {
  const out = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * 递归收集目录下所有文件（相对该目录的 posix 路径 → 绝对路径）。
 * 不穿符号链接：产物目录里若有人手放了一个指向别处的链接，跟着走会把无关文件
 * 算成「多余」（同 §7.3 standalone 的减法口径）。
 * @param {string} dir 绝对路径
 * @returns {Map<string, string>}
 */
function walk(dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  /** @param {string} cur 当前绝对路径 @param {string} rel 相对前缀 */
  const rec = (cur, rel) => {
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) rec(abs, r);
      else if (ent.isFile()) out.set(r, abs);
    }
  };
  rec(dir, "");
  return out;
}

/**
 * 跑一次 typedoc 输出到指定目录。
 *
 * 实现在 `scripts/typedoc-run.mjs`（与 `pnpm run docs` 同一份）：那里验的是产物
 * （`index.html` 的 mtime 是不是这一轮写的）、失败会重试、全失败才给 `ok:false`。
 * 本判据不再自己 `spawn` typedoc —— 自己起一份就等于把「退出码不可信」这个坑
 * 再挖一遍（见过「退出 0 + 日志写 html generated + 产物一个没更新」）。
 *
 * @param {string} outDir 绝对路径
 * @returns {Promise<{ok: boolean, reason: string, log: string}>}
 */
async function runTypedoc(outDir) {
  // CJS 里取 ESM 只能动态 import：跨平台逻辑一律 ESM（规范 §9.5），而本文件是被
  // `require` 的 .cjs（钩子与 `tests/check-docs-api.test.ts` 都按 CJS 引它）。
  const { runTypedoc: run } = await import("./typedoc-run.mjs");
  return run({ root: ROOT, outDir });
}

/**
 * 全量比对：把重生成结果与 `docs/api/` 逐文件比。三个方向都报。
 * @param {string} generatedDir 重生成输出目录（绝对路径）
 * @param {string} [currentDir] 当前产物目录；默认仓库的 `docs/api`（单测传夹具）
 * @returns {{drifted: string[], missing: string[], extra: string[]}}
 */
function compare(generatedDir, currentDir = OUT_ABS) {
  const want = walk(generatedDir);
  const got = walk(currentDir);
  const drifted = [];
  const missing = [];
  const extra = [];
  for (const [rel, abs] of want) {
    const cur = got.get(rel);
    if (!cur) {
      missing.push(rel);
      continue;
    }
    // 比内容不比行尾：CRLF 检出不该让这条判据报两千处假红（行尾由 .gitattributes
    // 的 eol=lf 与 §13.7 负责，与本判据问的「内容是否一致」不是同一件事）。
    // 与 render-doc-placeholders --check 同口径（先归一换行再比）。
    if (normalizeEol(readText(abs)) !== normalizeEol(readText(cur)))
      drifted.push(rel);
  }
  for (const rel of got.keys()) if (!want.has(rel)) extra.push(rel);
  return {
    drifted: drifted.sort(),
    missing: missing.sort(),
    extra: extra.sort(),
  };
}

/** 读文本并归一换行为 LF（比对口径，见 `compare`）。 */
function readText(abs) {
  return fs.readFileSync(abs, "utf8");
}

/** 归一 CRLF / 裸 CR 为 LF。 */
function normalizeEol(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** 把清单截断打印，避免一次刷屏几千行。 */
function brief(list, limit = 12) {
  if (list.length <= limit) return list.map((x) => `  · ${x}`).join("\n");
  const head = list.slice(0, limit).map((x) => `  · ${x}`);
  head.push(`  · …另 ${list.length - limit} 个`);
  return head.join("\n");
}

/**
 * 把重生成结果落到 `docs/api/`（**写入模式**，只有 `--autofix` 走得到这里）。
 *
 * 三个方向各写一条，别只写「落后」那一半：判据报的是「不一致」，而「怎么才一致」是
 * **产物集合完全等于重生成结果** —— 只覆盖不删孤儿的话，第二轮判定照旧红（`多余`
 * 那一类永远留着），于是这一步会变成「每次都重跑一遍 typedoc 然后再红」。
 *
 * `copyFile` / `rm` 用 Node 原生而不是 shell 命令：平台侧是 Windows（没有 `rm -rf`），
 * 本地是 POSIX，同一份实现两处都对（规范 §9.5 的跨平台动作口径）。
 *
 * @param {string} generatedDir 重生成输出目录（绝对路径）
 * @param {{drifted: string[], missing: string[], extra: string[]}} diff 第一轮判定
 * @param {string} [currentDir] 当前产物目录；默认仓库的 `docs/api`（单测传夹具）
 * @returns {{written: number, removed: number}}
 */
function applyGenerated(generatedDir, diff, currentDir = OUT_ABS) {
  const want = walk(generatedDir);
  let written = 0;
  let removed = 0;
  for (const rel of [...diff.drifted, ...diff.missing]) {
    const from = want.get(rel);
    if (!from) continue;
    const to = path.join(currentDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    written += 1;
  }
  for (const rel of diff.extra) {
    const abs = path.join(currentDir, rel);
    if (!fs.existsSync(abs)) continue;
    fs.rmSync(abs, { force: true });
    removed += 1;
  }
  return { written, removed };
}

/** 三个方向的总处数（判定绿不绿只看这一个数）。 */
function tally(diff) {
  return diff.drifted.length + diff.missing.length + diff.extra.length;
}

/**
 * 把一轮判定按三个方向打印。`log` 由调用方给：第一遍读数走 stdout（`--autofix` 的读者
 * 最需要的是「本次自动修改动了哪几份」），判红那一遍走 stderr。
 */
function reportDiff(diff, log) {
  const { drifted, missing, extra } = diff;
  log(`${TAG} ✗ ${OUT_REL} 与当前源不一致（共 ${tally(diff)} 处）：`);
  if (drifted.length) {
    log(`  ▸ 落后于源（${drifted.length}）—— 源改了没重生成：`);
    log(brief(drifted));
  }
  if (missing.length) {
    log(`  ▸ 缺失（${missing.length}）—— 重生成有、仓库里没有：`);
    log(brief(missing));
  }
  if (extra.length) {
    log(`  ▸ 多余（${extra.length}）—— 仓库里有、源已不再产出：`);
    log(brief(extra));
  }
}

/** typedoc 重生成失败时的取证与修法（两条路径共用一份，免得两处话术漂开）。 */
function reportTypedocFailure(reason, log) {
  console.error(`${TAG} ✗ typedoc 重生成失败（产物无法核对）：${reason}`);
  console.error(
    `${TAG} 注：typedoc 的退出码不可信 —— 「退出 0 + 日志写 html generated +` +
      ` 产物一个没更新」是见过的现场，所以这里按产物判、失败自动重试。`,
  );
  if (log) console.error(log);
  console.error(
    `${TAG} 修法：先 node scripts/generate-api-docs.mjs 单独跑一遍看原因` +
      `（占用类失败等一等就过；别拿这次的空产物去删 ${OUT_REL}/）。`,
  );
}

/**
 * `--check --autofix`：**先判一次，红了就地重生成、再判一次**（ISSUE #1981）。
 *
 * 为什么第二次判定不能省：自动修的价值全在「修完真的对了」这一句上。只跑一遍写入模式
 * 就退 0，等于把一次未经复核的写入报成「通过」—— 写入模式本身不判任何东西。所以结论
 * **永远来自第二轮的 `compare()`**，重生成只是它中间那一步（与
 * `render-doc-placeholders.cjs --check --autofix` 同形，登记表是
 * `scripts/ci-autofix-duties.mjs`）。
 *
 * ⚠️ **它不改动 git**：提交与重跑 CI 仍由人 / 代理那一侧做（平台侧能否回写分支是另一条
 * 决策，见 `scripts/ci-autofix-duties.mjs` 头注第 1 条）。
 *
 * @returns {Promise<number>} 退出码
 */
async function checkOrAutofix() {
  const tag = `[docs-api --autofix]`;
  if (!fs.existsSync(OUT_ABS)) {
    console.error(`${TAG} ✗ ${OUT_REL}/ 不存在 —— 生成物本应提交进 git。`);
    console.error(`${TAG} 修法：pnpm run docs 后把结果一并提交。`);
    return 1;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-api-autofix-"));
  try {
    const first = await runTypedoc(tmp);
    if (!first.ok) {
      reportTypedocFailure(first.reason, first.log);
      return 1;
    }
    const diff = compare(tmp);
    /* 绿的时候一次都不多写：自动修档的常态是「本来就一致」。 */
    if (!tally(diff)) {
      console.log(
        `${TAG} ✓ ${OUT_REL} 与当前源一致（${walk(OUT_ABS).size} 个文件），无需重生成。`,
      );
      return 0;
    }
    reportDiff(diff, console.log);
    const { written, removed } = applyGenerated(tmp, diff);
    console.log(
      `${tag} 上面那份不一致 —— 就地重生成：写入 ${written} 个、删除 ${removed} 个孤儿，再判一次。`,
    );
    const after = compare(tmp);
    if (!tally(after)) {
      console.log(
        `${tag} ✓ 自动修完成。工作区里的 ${OUT_REL}/ 已经与源同步，` +
          `把它一并提交即可（不要手改生成物）。`,
      );
      return 0;
    }
    /* 「修不好」要说清是哪一种：自动修只写「源 → 产物」这一条路，重生成过还是不一致，
     * 说明差异不在这次渲染决定的那一侧（源本身有问题 / 两份源映射到同一个产物名）。 */
    reportDiff(after, console.error);
    console.error(
      `${tag} ✗ 重生成之后仍不一致 —— 这不是「忘了重渲染」，别再重试同一件事。`,
    );
    return 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const staged = process.argv.includes("--staged");
  if (staged) {
    const hits = matchedInputs(stagedFiles());
    if (!hits.length) {
      console.log(`${TAG} ✓ 本次提交未触及 typedoc 输入面，跳过。`);
      return;
    }
    console.log(
      `${TAG} 命中输入面 ${hits.length} 个文件（${hits
        .slice(0, 3)
        .join(", ")}${hits.length > 3 ? ", …" : ""}），重生成比对中…`,
    );
  }

  if (process.argv.includes("--autofix")) {
    // 用 exitCode 而不是 process.exit：后者会把还没 flush 的 stdout 截掉（Windows 管道上实测）。
    process.exitCode = await checkOrAutofix();
    return;
  }

  if (!fs.existsSync(OUT_ABS)) {
    console.error(`${TAG} ✗ ${OUT_REL}/ 不存在 —— 生成物本应提交进 git。`);
    console.error(`${TAG} 修法：pnpm run docs 后把结果一并提交。`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-api-check-"));
  try {
    const res = await runTypedoc(tmp);
    if (!res.ok) {
      reportTypedocFailure(res.reason, res.log);
      process.exit(1);
    }

    const diff = compare(tmp);
    if (!tally(diff)) {
      console.log(
        `${TAG} ✓ ${OUT_REL} 与当前源一致（${walk(OUT_ABS).size} 个文件）。`,
      );
      return;
    }
    reportDiff(diff, console.error);
    console.error(
      `${TAG} 修法：pnpm run docs 后把 docs/api/** 的重生成结果一并提交（不要手改生成物）。`,
    );
    process.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`${TAG} ✗ 判据自身异常：`, err);
    process.exit(1);
  });
}

module.exports = {
  INPUT_RES,
  INPUT_GLOBS,
  CLOSURE_LEAVES,
  matchedInputs,
  walk,
  compare,
  applyGenerated,
  OUT_REL,
};
