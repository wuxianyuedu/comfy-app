/**
 * `docs-api-input-closure.mjs` — `docs/api/**` 那份产物**真正由哪些文件决定**（单一出处）。
 *
 * ── 为什么要有这个模块（ISSUE #2223 的现场）──────────────────────────────
 *
 * `scripts/check-docs-api.cjs` 的文件头原来写着：
 *
 *   > 触发面 = typedoc 的输入面：`src/lib/**` / `src/server/**` / `src/trpc/**`
 *   > （`typedoc.json` 的 `entryPoints` 三条 glob）…… 这**不是启发式收窄**，是
 *   > 「产物只由这些输入决定」的直接映射：输入没变，产物不可能漂。
 *
 * **那句话是错的。** typedoc 沿 import 走：`src/lib/db-backup/backup.ts` 从
 * `scripts/db-backup-core.mjs` 导入 `BackupResult`，而那个类型**出现在 `docs/api/**` 里**
 * ⇒ 改 `scripts/db-backup-core.mjs` 会改产物，可它**不在那三条 glob 里**。
 *
 * ⇒ 收窄面判窄了就是**漏判**，而漏判是静默的：`ifModify` 跳过的形态与「判过且通过」
 * 在读数上无差别（本仓最恨的那一族）。实测：三根之外有 11 个被引用的文件，其中
 * 10 个原先不在收窄面内（`package.json` 原本就在面内）。
 *
 * ── 这个模块回答什么 ────────────────────────────────────────────────────
 *
 *   · `typedocRoots()` —— typedoc 的**根**是哪几个。**从 `typedoc.json` 的
 *     `entryPoints` 导出**（不手抄第二份；抄一份的漂移形态是「typedoc 改了入口、
 *     面还罩着旧的那几条」）。
 *   · `closureOutsideRoots()` —— 从那些根出发沿静态 import 走，**走到根外面**的文件
 *     （= 叶子集）。这才是「产物由哪些文件决定」的真相。
 *
 * ── 复用什么、不重写什么（§12.18 / 硬规则 27）───────────────────────────
 *
 * 说明符解析复用 `scripts/affected-tests.mjs` 的 `specifiersOf` / `specCandidates`
 * （同一份 `SPEC_RE`、同一套扩展名候选、同一套别名与相对路径口径）。
 * 另两处也各有出处，本模块只**引用**：
 *   · glob → 正则：`scripts/vitest-projects.cjs` 已导出的 `globToRe`；
 *   · 收窄面本身：`scripts/check-docs-api.cjs` 的 `INPUT_GLOBS`（配置侧逐字对齐由
 *     `tests/ci-incremental-gates.test.ts` 核）。
 *
 * ── 边界（刻意不做的事）──────────────────────────────────────────────────
 *
 *   · **不判「绿不绿」**。本模块只给事实（哪些文件在闭包里），判决在既有判据里。
 *   · **不替人维护那份清单**。清单（`INPUT_GLOBS`）是**声明**，本模块算的是**事实**；
 *     两者对不上时由 `tests/ci-incremental-gates.test.ts` 判红 —— 那是「登记面 ⇄ 事实面」
 *     那一对（§13.5.27 的同一族），不是这里替人改。
 *   · **不追运行期动态路径**。`import()` / `require()` 的字面量说明符追得到；
 *     运行期拼出来的路径追不到（那不是「产物由这些输入决定」能回答的问题，
 *     与 `affected-tests` 的同款边界同口径）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { specifiersOf } from "./affected-tests.mjs";

/* glob → 正则**复用** `scripts/vitest-projects.cjs` 已导出的那一份（同一套 `**` / `*` /
 * `{a,b}` 口径，且带 `^…$` 锚点）—— 不在本模块写第二套 glob 匹配（§12.12 / §12.18：
 * 抄一份就会漂，而漂的形态是「面罩不住闭包」＝静默漏判）。它是 CJS，用 createRequire 引。 */
const { globToRe } = createRequire(import.meta.url)("./vitest-projects.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** typedoc 的配置 —— 根的**唯一出处**。 */
const TYPEDOC_CONFIG = "typedoc.json";

/**
 * 进闭包的文件扩展名。
 *
 * 说明符解析出来的候选里有一批是**不带扩展名**的（`~/env` → `src/env`），那是
 * 「先试无扩展名」的第一步，不是文件 ⇒ 用这一条剔掉。`.js` / `.mjs` 也在内：
 * `src/env.js` 就是 typedoc 会读、而三根罩不住的那种文件（ISSUE #2223 的现场之一）。
 */
const NODE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;

/**
 * 读一个文件；读不到（不存在 / 是目录 / 权限）返回 `null`。
 *
 * @param {string} abs
 * @returns {string | null}
 */
function readTextFile(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * 递归列出某个目录下的候选文件（仓库相对、正斜杠）。
 *
 * 用**盘上**而不是 `git ls-files`：typedoc 读的就是盘，而「产物由哪些文件决定」
 * 这句话的主语是产物生成器 —— 它看不见未跟踪的文件，但看得见已跟踪的工作区改动。
 *
 * @param {string} dir 仓库相对目录
 * @param {string} root 仓库根
 * @param {string[]} out 收集器
 * @returns {void}
 */
function walkFiles(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      /* 跳过依赖目录与**点目录**（`.git` / `.next` / `.turbo` 那一族）。
       * 为什么按「点开头」跳而不是点名跳某一个：点目录在源码树里一律不是入口，
       * 而点名写死某一个就要在源码里留下那个名字的字面量 ——
       * `scripts/git-dir-literal-scan.mjs` 那条判据正是守着「检出子目录的名字只许
       * `scripts/git-dir.mjs` 一处知道」，而这里要的不是「检出目录在哪」，是
       * 「别走进不是源码的地方」。 */
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walkFiles(rel, root, out);
    } else if (e.isFile() && NODE_EXT_RE.test(e.name)) {
      out.push(rel);
    }
  }
}

/**
 * 某个目录下的候选文件（仓库相对、正斜杠、排序）。
 *
 * 导出给用例复用：「把某个目录列出来」这件事在本仓有两处要用（闭包模块自己走入口点、
 * 判据用例走输入面枚举），抄第二份遍历就是第二份会漂的副本（§12.12 / §12.18）。
 *
 * @param {string} dir 仓库相对目录
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function filesUnder(dir, root = ROOT) {
  /** @type {string[]} */
  const out = [];
  walkFiles(dir, root, out);
  return out.sort();
}

/**
 * `typedoc.json` 的解析结果（读不到 / 解析失败 ⇒ 空对象，**不抛**）。
 *
 * 返回的是**整个解析结果**（不是只挑几个键）—— 别的模块要读的键不止
 * `entryPoints` / `exclude`：`scripts/check-docs-api.cjs` 要读 `cleanOutputDir`
 * （它判「输出目录有没有被清空过」，见那份判据的「骨架齐全 + 可移植」那节）。
 * 「typedoc 的配置」的**唯一出处**在这里：别的模块读它，不各自解析一遍。
 *
 * @param {string} [root] 仓库根
 * @returns {Record<string, unknown>}
 */
export function typedocConfig(root = ROOT) {
  const raw = readTextFile(path.join(root, TYPEDOC_CONFIG));
  if (raw === null) return {};
  try {
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

/**
 * typedoc 的 `entryPoints`（原文，来自 `typedoc.json`）。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function typedocEntryPoints(root = ROOT) {
  const eps = typedocConfig(root).entryPoints;
  if (!Array.isArray(eps)) return [];
  return eps.filter((e) => typeof e === "string");
}

/**
 * typedoc 的 `exclude`（原文，来自 `typedoc.json`）。
 *
 * 为什么它要紧：typedoc 的 `exclude` 是**不进程序**（不是「不写进文档」）⇒ 被排除的
 * 文件 typedoc 根本不读 ⇒ 它的可达集也不该进闭包。不认这条的话，`tests/helpers/**`
 * 会因为「被 `src/lib` 下的 `*.test.ts` 引用」而进闭包 —— 而那些测试文件 typedoc 明确不读
 * （entryPoint 里的 `!(*.test).ts`）。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function typedocExcludes(root = ROOT) {
  const ex = typedocConfig(root).exclude;
  if (!Array.isArray(ex)) return [];
  return ex.filter((e) => typeof e === "string");
}

/**
 * 一条 entryPoint 的**扩展名**（`src/lib/**\/*.ts` → `.ts`）。
 *
 * 取最后一段里最后一个 `.` 之后的部分 —— `!(*.test).ts` 的最后一个点号在 `test` 与
 * `ts` 之间 ⇒ 得 `.ts` ✓。
 *
 * @param {string} entryPoint
 * @returns {string}
 */
export function entryPointExtension(entryPoint) {
  const base = entryPoint.slice(entryPoint.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
}

/**
 * entryPoint 里的**取反括号**（extglob `!(...)`）里那个模式。
 *
 * `src/lib/**\/!(*.test).ts` → `*.test`。它的意思是「基名不是这个形状」⇒ 那些文件
 * **不是入口点**（typedoc 不读它们 ⇒ 它们的可达集也不进闭包）。
 *
 * @param {string} entryPoint
 * @returns {string | null}
 */
export function negatedBasenamePattern(entryPoint) {
  const m = /!\(([^)]*)\)/.exec(entryPoint);
  return m?.[1] ?? null;
}

/**
 * 一条 entryPoint 的**根** = 第一个通配符之前的那段静态前缀。
 *
 * `src/lib/**\/!(*.test).ts` → `src/lib`。
 *
 * 为什么取「静态前缀」而不是「目录部分」：`entryPoints` 是一条 glob，它的目录部分
 * 就是第一个通配符之前的那段 —— 这一条对 `src/lib/**` 与 `src/lib/**\/*.ts`
 * 都成立，而按「最后一个斜杠」切会在后者上切出 `*.ts`。
 *
 * @param {string} entryPoint
 * @returns {string}
 */
export function rootOfEntryPoint(entryPoint) {
  const m = /^([^*?[{]+)/.exec(entryPoint);
  return (m?.[1] ?? entryPoint).replace(/\/+$/, "");
}

/**
 * typedoc 的根目录（排序、去重）。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function typedocRoots(root = ROOT) {
  const roots = typedocEntryPoints(root).map(rootOfEntryPoint).filter((r) => r !== "");
  return [...new Set(roots)].sort();
}

/**
 * 根的 **glob 形态**（`src/lib/**`）—— `ifModify` 那一侧要的形状。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function typedocRootGlobs(root = ROOT) {
  return typedocRoots(root).map((r) => `${r}/**`);
}

/**
 * 一个路径是否落在某个根里面。
 *
 * @param {string} rel 仓库相对路径
 * @param {string[]} roots
 * @returns {boolean}
 */
export function isUnderRoots(rel, roots) {
  return roots.some((r) => rel === r || rel.startsWith(`${r}/`));
}

/**
 * **传递闭包里落在根外面的文件**（= 叶子集，排序）。
 *
 * 走法（三步，各有出处）：
 *   ① **入口点** = 根下扩展名对得上 `typedoc.json` 的 `entryPoints`、基名不被
 *      `!(*.test)` 排除、也不在 `exclude` 里的文件 —— **这些是 typedoc 读作入口的**。
 *      （测试文件不在其中 ⇒ 它们可达的 `tests/helpers/**` 也不该进闭包。）
 *   ② **可达集** = 入口点 ∪ 它们沿静态 import 说明符走到的文件（**传递**），
 *      途中被 `exclude` 命中的文件不算（typedoc 不把它放进程序）。
 *   ③ **叶子集** = 可达集 − 根。落在根外的那批就是「改了它，产物就会变」的文件。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]} 仓库相对、正斜杠、排序
 */
export function closureOutsideRoots(root = ROOT) {
  const entryPoints = typedocEntryPoints(root);
  const roots = typedocRoots(root);
  if (roots.length === 0 || entryPoints.length === 0) return [];
  const excludeRes = typedocExcludes(root).map((g) => globToRe(g));
  /**
   * 这个文件是不是被 typedoc 的 `exclude` 排掉了（排掉 ⇒ typedoc 根本不读它）。
   *
   * @param {string} rel 仓库相对路径
   * @returns {boolean}
   */
  const isExcluded = (rel) => excludeRes.some((re) => re.test(rel));
  const negatedBases = entryPoints
    .map(negatedBasenamePattern)
    .filter((p) => p !== null)
    .map((p) => globToRe(p));
  const startExts = new Set(
    entryPoints.map(entryPointExtension).filter((e) => e !== ""),
  );

  /** ① 入口点 */
  /** @type {string[]} */
  const queue = [];
  /** @type {string[]} */
  const underRoots = [];
  for (const r of roots) walkFiles(r, root, underRoots);
  for (const f of underRoots) {
    if (!startExts.has(entryPointExtension(f))) continue;
    const base = f.slice(f.lastIndexOf("/") + 1);
    if (negatedBases.some((re) => re.test(base))) continue;
    if (isExcluded(f)) continue;
    queue.push(f);
  }

  /** ② 可达集（传递） */
  const seen = new Set();
  /** @type {Set<string>} */
  const outside = new Set();
  while (queue.length > 0) {
    const rel = queue.pop();
    if (rel === undefined || seen.has(rel)) continue;
    seen.add(rel);
    const text = readTextFile(path.join(root, rel));
    if (text === null) continue;
    for (const cand of specifiersOf(text, rel)) {
      if (!NODE_EXT_RE.test(cand)) continue;
      if (readTextFile(path.join(root, cand)) === null) continue;
      if (isExcluded(cand)) continue;
      if (!isUnderRoots(cand, roots)) outside.add(cand);
      if (!seen.has(cand)) queue.push(cand);
    }
  }
  /** ③ 叶子集 */
  return [...outside].sort();
}

/**
 * 一次算全：根 + 叶子集 + 根的 glob 形态。
 *
 * @param {string} [root] 仓库根
 * @returns {{roots: string[], rootGlobs: string[], leaves: string[]}}
 */
export function docsApiInputClosure(root = ROOT) {
  const roots = typedocRoots(root);
  return {
    roots,
    rootGlobs: roots.map((r) => `${r}/**`),
    leaves: closureOutsideRoots(root),
  };
}

/* 直接执行时把这份闭包打出来（人读的那一份；判据在测试里）。
 * `node scripts/docs-api-input-closure.mjs` */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const c = docsApiInputClosure();
  process.stdout.write(`[docs-api 闭包] 根：${c.roots.join(", ") || "(取不到 typedoc.json)"}\n`);
  process.stdout.write(`[docs-api 闭包] 根外叶子 ${c.leaves.length} 个：\n`);
  for (const leaf of c.leaves) process.stdout.write(`  · ${leaf}\n`);
}
