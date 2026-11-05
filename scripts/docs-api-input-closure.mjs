/**
 * `docs-api-input-closure.mjs` — 「typedoc 到底会读哪些文件」的**唯一权威定义**。
 *
 * ── 为什么要有这个模块（ISSUE #2537 的现场，事故是 #2528）──────────────────
 *
 * typedoc 的**解析面**不是 `typedoc.json` 的 `entryPoints`，而是 **TS 程序**：
 * `typedoc` 从 `tsconfig.json` 的 `include`/`exclude` 展开出 `rootNames`，交给
 * `ts.createProgram`，再沿 import 走到的一切文件都进了程序（含 `.test.ts` 与
 * `.mjs`）。`entryPoints` 只决定「哪几个文件被渲染成页面」，不影响程序读谁。
 *
 * #2528 新增的 `scripts/publish-desktop-bundle.mjs` 不是 entryPoint、也不在三根下，
 * 却被 `tests/**` 的文件 import ⇒ 它在程序里 ⇒ 它的 JSDoc 一坏，那一格红。
 * 而当时的 `ifModify` 面是「三根 ∪ 沿 entryPoints 走的叶子」⇒ 它不在面里 ⇒
 * **那一格根本没跑**。判窄了就是漏判，而漏判是静默的（本仓最恨的那一族）。
 *
 * ── 这个模块回答什么 ────────────────────────────────────────────────────
 *
 *   · `typedocProgramRoots()` —— typedoc 传给 `createProgram` 的 `rootNames`：
 *     从 `typedoc.json` 的 `tsconfig`（缺省 `tsconfig.json`）经 TS 自己的
 *     `parseJsonConfigFileContent` 展开。**不手抄第二份 glob**。
 *   · `typedocProgramFiles()` —— 事实面：根 ∪ 沿静态 import 走到的一切文件
 *     （按 git 跟踪过滤：`ifModify` 看的是 PR 变更文件，构建产物永远不进 diff）。
 *   · `docsApiTriggerGlobs()` —— 门禁触发面，从上面的根派生（目录 → `dir/**`，
 *     根级文件 → `*.<ext>`），`check-docs-api.cjs` 的 `INPUT_GLOBS` 取它。
 *
 * ── 复用什么、不重写什么（§12.18 / 硬规则 27）───────────────────────────
 *
 *   · 说明符解析复用 `scripts/affected-tests.mjs` 的 `specifiersOf`（同一份
 *     TypeScript 预处理扫描器、同一套别名与相对路径口径）；
 *   · glob → 正则复用 `scripts/vitest-projects.cjs` 的 `globToRe`；
 *   · tsconfig 展开复用 TypeScript 自己的 API —— 那正是 typedoc 走的那一条。
 *
 * ── 边界（刻意不做的事）──────────────────────────────────────────────────
 *
 *   · **不判「绿不绿」**：本模块只给事实，判决在 `check-docs-api.cjs`。
 *   · **不追运行期动态路径**：`import()` / `require()` 的字面量说明符追得到，
 *     运行期拼出来的路径追不到（与 `affected-tests` 同款边界）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import ts from "typescript";

import { specifiersOf } from "./affected-tests.mjs";

/* glob → 正则**复用** `scripts/vitest-projects.cjs` 已导出的那一份（同一套 `**` /
 * `*` / `{a,b}` 口径，且带 `^…$` 锚点）—— 不在本模块写第二套 glob 匹配。它是 CJS。 */
const { globToRe } = createRequire(import.meta.url)("./vitest-projects.cjs");

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** typedoc 的配置 —— `tsconfig` 键的唯一出处。 */
const TYPEDOC_CONFIG = "typedoc.json";
/** `typedoc.json` 没有 `tsconfig` 键时 typedoc 的缺省。 */
const DEFAULT_TSCONFIG = "tsconfig.json";

/**
 * 进闭包的文件扩展名。
 *
 * 说明符解析出来的候选里有一批是**不带扩展名**的（`~/env` → `src/env`），那是
 * 「先试无扩展名」的第一步，不是文件 ⇒ 用这一条剔掉。`.js` / `.mjs` 也在内：
 * `src/env.js` 就是 typedoc 会读、而三根罩不住的那种文件（ISSUE #2223 的现场之一）。
 */
const NODE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;

/** 依赖面：typedoc 版本 / 可选依赖换代会改产物，与程序文件无关，但必须算输入。 */
const GATE_INPUT_EXTRAS = ["pnpm-lock.yaml"];

/**
 * 读一个文件；读不到（不存在 / 是目录 / 权限）返回 `null`。
 *
 * @param {string} abs
 * @returns {string | null}
 */
function readTextFile(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) {
      return null;
    }
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * 绝对路径 → 仓库相对、正斜杠。
 *
 * @param {string} root
 * @param {string} abs
 * @returns {string}
 */
function toRel(root, abs) {
  return path.relative(root, path.resolve(abs)).split(path.sep).join("/");
}

/**
 * 这个仓库相对路径是不是「仓库内的普通文件」。
 *
 * @param {string} rel
 * @returns {boolean}
 */
function isRepoPath(rel) {
  return rel !== "" && !rel.startsWith("..") && !rel.includes("node_modules/");
}

/**
 * `typedoc.json` 的解析结果（读不到 / 解析失败 ⇒ 空对象，**不抛**）。
 *
 * 返回的是**整个解析结果**（不是只挑几个键）—— `check-docs-api.cjs` 还要读
 * `cleanOutputDir`。「typedoc 的配置」的唯一出处在这里。
 *
 * @param {string} [root] 仓库根
 * @returns {Record<string, unknown>}
 */
export function typedocConfig(root = ROOT) {
  const raw = readTextFile(path.join(root, TYPEDOC_CONFIG));
  if (raw === null) {
    return {};
  }
  try {
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

/**
 * typedoc 实际用的 tsconfig（`typedoc.json` 的 `tsconfig` 键，缺省 `tsconfig.json`）。
 *
 * @param {string} [root] 仓库根
 * @returns {string}
 */
export function typedocTsconfigPath(root = ROOT) {
  const configured = typedocConfig(root).tsconfig;
  return typeof configured === "string" && configured !== "" ? configured : DEFAULT_TSCONFIG;
}

/**
 * 仓库里 **git 跟踪**的文件集合（`ifModify` 判的是 PR 变更文件）。
 *
 * 为什么要这一层：tsconfig 还显式 include 了 `.next/types/**\/*.ts`，那是构建产物，
 * 盘上有没有取决于本机跑没跑过 `next build` —— 让触发面跟着它变，同一份配置在
 * 不同机器上就会派生出不同的 glob（`.cnb.yml` 的逐字对账当场红）。git 不可用 ⇒
 * 返回 `null`，调用方不筛（宁可判宽，不许判窄）。
 *
 * @param {string} [root] 仓库根
 * @returns {Set<string> | null}
 */
export function gitTrackedFiles(root = ROOT) {
  const out = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (out.status !== 0 || typeof out.stdout !== "string") {
    return null;
  }
  return new Set(out.stdout.split("\0").filter(Boolean));
}

/**
 * 从 tsconfig 的 `include` 与 `compilerOptions` 推出「根级文件可能用到的扩展名」。
 *
 * 为什么不是从盘上碰巧存在的根文件反推：`*.mjs` / `*.json` 本来就不在 `include`
 * 里，它们是**沿 import 进程序**的（`allowJs` / `resolveJsonModule`）—— 只按盘上
 * 现存的根文件反推，会漏掉 `oxlint.parity.config.mjs` 那一类。
 *
 * @param {Record<string, unknown>} raw tsconfig 原文（已解析）
 * @param {import("typescript").CompilerOptions} options
 * @returns {string[]}
 */
function rootExtensions(raw, options) {
  const exts = new Set();
  const includes = Array.isArray(raw.include) ? raw.include : [];
  for (const entry of includes) {
    if (typeof entry !== "string") {
      continue;
    }
    const base = entry.slice(entry.lastIndexOf("/") + 1);
    const i = base.lastIndexOf(".");
    if (i !== -1) {
      exts.add(base.slice(i));
    }
  }
  if (options.allowJs) {
    exts.add(".jsx");
    exts.add(".mjs");
  }
  if (options.resolveJsonModule) {
    exts.add(".json");
  }
  return [...exts].sort();
}

/**
 * typedoc 传给 `ts.createProgram` 的 `rootNames`（= tsconfig 展开的文件清单）。
 *
 * 这就是 typedoc 的**解析根**：它不看 `typedoc.json` 的 `entryPoints`，只认这份
 * 文件清单（见 `node_modules/typedoc/dist/node-utils.js` 的 `getEntryPrograms`）。
 *
 * @param {string} [root] 仓库根
 * @returns {{files: string[], extensions: string[]}}
 */
export function typedocProgramRoots(root = ROOT) {
  const cfgAbs = path.join(root, typedocTsconfigPath(root));
  const read = ts.readConfigFile(cfgAbs, ts.sys.readFile);
  if (read.error) {
    return { files: [], extensions: [] };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(cfgAbs));
  const tracked = gitTrackedFiles(root);
  const files = parsed.fileNames
    .map((abs) => toRel(root, abs))
    .filter((rel) => isRepoPath(rel))
    .filter((rel) => tracked === null || tracked.has(rel))
    .sort();
  return { files, extensions: rootExtensions(read.config, parsed.options) };
}

/**
 * 一组文件 → 触发面 glob（目录 → `dir/**`，根级文件 → `*.<ext>`）。
 *
 * 这是**纯函数**：给「会被 typedoc 读的文件」就派生出能罩住它们的面。新增路径
 * 落在已有目录里 ⇒ 自动被 `dir/**` 罩住；落在新目录/新根级扩展名 ⇒ 面随之变化，
 * `.cnb.yml` 的逐字对账会红（不是静默跳格）。
 *
 * @param {Iterable<string>} files 仓库相对路径
 * @param {Iterable<string>} [extensions] 额外根级扩展名（见 `rootExtensions`）
 * @returns {string[]}
 */
export function globFaceForFiles(files, extensions = []) {
  const dirs = new Set();
  const rootExts = new Set(extensions);
  for (const rel of files) {
    const slash = rel.indexOf("/");
    if (slash === -1) {
      const i = rel.lastIndexOf(".");
      if (i > 0) {
        rootExts.add(rel.slice(i));
      }
    } else {
      dirs.add(rel.slice(0, slash));
    }
  }
  return [
    ...[...dirs].sort().map((dir) => `${dir}/**`),
    ...[...rootExts].sort().map((ext) => `*${ext}`),
  ];
}

/**
 * `ifModify` 的触发面 —— **从 typedoc 的解析根派生**，不是第二份手抄 glob。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]}
 */
export function docsApiTriggerGlobs(root = ROOT) {
  const { files, extensions } = typedocProgramRoots(root);
  return [...globFaceForFiles(files, extensions), ...GATE_INPUT_EXTRAS];
}

/**
 * **事实面**：typedoc 程序里的一切仓库文件（根 ∪ 沿静态 import 走到的文件）。
 *
 * 与 `docsApiTriggerGlobs` 的关系是「声明 ⇄ 事实」：面罩不住这里任何一个文件
 * ⇒ 改它不会触发那一格 ⇒ 静默漏判。双向对账在 `tests/docs-api-input-closure.test.ts`。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]} 仓库相对、正斜杠、排序
 */
export function typedocProgramFiles(root = ROOT) {
  const { files } = typedocProgramRoots(root);
  const tracked = gitTrackedFiles(root);
  const seen = new Set();
  const queue = [...files];
  while (queue.length > 0) {
    const rel = queue.pop();
    if (rel === undefined || seen.has(rel)) {
      continue;
    }
    seen.add(rel);
    const text = readTextFile(path.join(root, rel));
    if (text === null) {
      continue;
    }
    for (const cand of specifiersOf(text, rel)) {
      if (!NODE_EXT_RE.test(cand) || !isRepoPath(cand)) {
        continue;
      }
      if (tracked !== null && !tracked.has(cand)) {
        continue;
      }
      if (readTextFile(path.join(root, cand)) === null) {
        continue;
      }
      if (!seen.has(cand)) {
        queue.push(cand);
      }
    }
  }
  return [...seen].sort();
}

/* 直接执行时把面与事实打出来（人读的那一份；判决在测试里）。
 * `node scripts/docs-api-input-closure.mjs` */
// oxlint-disable-next-line typescript/no-unnecessary-condition -- process.argv[1] 在 node -e / REPL 形态下实为 undefined，@types/node 标成 string
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const globs = docsApiTriggerGlobs();
  const files = typedocProgramFiles();
  process.stdout.write(`[docs-api 触发面] ${globs.length} 条：\n`);
  for (const g of globs) {
    process.stdout.write(`  · ${g}\n`);
  }
  process.stdout.write(`[docs-api 事实面] typedoc 程序内 ${files.length} 个仓库文件\n`);
  const uncovered = files.filter((rel) => !globs.some((g) => globToRe(g).test(rel)));
  process.stdout.write(`[docs-api 面罩不住] ${uncovered.length} 个：\n`);
  for (const rel of uncovered) {
    process.stdout.write(`  · ${rel}\n`);
  }
}
