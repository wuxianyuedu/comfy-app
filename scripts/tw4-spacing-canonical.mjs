#!/usr/bin/env node
/**
 * Tailwind v4「任意值 → spacing 倍数」的等价改写器（幂等）。
 *
 * 为什么不能按工具名前缀改写：`text-[13px]` 与 `h-[22px]` 形态一模一样，但前者
 * 走 font-size、后者走 spacing —— 把它们都换成裸数值，改的是**量纲**。
 * 这里把判断交给 Tailwind 引擎本身：
 *   1. 换算后的裸数值候选必须真能编出规则（`candidatesToCss` 非空）；
 *   2. 它的声明里必须出现 `var(--spacing)`（= 该工具确实挂在 spacing scale 上）；
 *   3. 原候选本身也必须是合法候选。
 * 三条同时成立才改写，因此不会碰 text-* / leading-* / rounded-* 这些非 spacing 家族。
 *
 * 换算前提是「`--spacing` 仍是 Tailwind 默认的 0.25rem」且「根字号仍是浏览器默认
 * 16px」——前者脚本自己断言（项目主题一旦重定义 `--spacing` 就直接报错退出，
 * 而不是改出一批算着错的类名），后者是项目既有假设（全仓 `h-5.5` 这类类名同样
 * 依赖它）。
 *
 * 用法：
 *   node scripts/tw4-spacing-canonical.mjs              # 扫 src，只列清单（dry-run）
 *   node scripts/tw4-spacing-canonical.mjs --check      # 硬闸判定：候选数须为 0
 *   node scripts/tw4-spacing-canonical.mjs --write      # 落盘
 *   node scripts/tw4-spacing-canonical.mjs <file...>    # 只处理给定文件
 *
 * 判定档（ISSUE #1451 要求 2，与 `tw4-canonical-report.mjs` 同构）：本工具起 Tailwind
 * 引擎、不进 pre-commit（判的是「CSS 等价改写」而非正确性），但 03 章那句「按需跑一次」
 * 此前没有任何东西在守。出路 = 按需跑 + **硬闸**：`--check` 命中即退 1，候选须为 0。
 * 执行者与「为什么不进钩子」登记在 `scripts/.gate-executor-ledger.json`。
 *
 * **为什么是硬闸而不是棘轮**：本判据此前带一份基线（`scripts/.tw4-spacing-baseline.json`），
 * `--check` 只判「不超过基线」、`--update` 收紧。存量清零后（ISSUE #1811 的 tw4 项）
 * 棘轮的两个动作都无事可做，留下的却是一条「手改那份 JSON 就能把新候选登记成已知
 * 存量」的通道 —— 那正是硬闸类本来没有的中间态（§13.6.2 的两类对照）。
 */
import fs from "node:fs";
import path from "node:path";

import { __unstable__loadDesignSystem } from "tailwindcss";

import { rewriteLiterals } from "./tw4-scan-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const shouldWrite = argv.includes("--write");
const shouldCheck = argv.includes("--check");
const targets = argv.filter((arg) => !arg.startsWith("--"));

/** Tailwind v4 的 spacing 基线：`--spacing` 默认 0.25rem，浏览器默认根字号 16px。 */
const BASE_SPACING_PX = 0.25 * 16;

/** 候选形态：`(变体:)*工具-[值]` + 可选的 important 后缀。 */
const TOKEN = /^((?:[a-zA-Z][\w-]*:)*[a-zA-Z][\w-]*-)\[([^\]\s]+)\](!?)$/;
/** 只处理 px 任意值（rem / % / calc 不做换算：它们的等价性另有条件）。 */
const PX_VALUE = /^(\d+(?:\.\d+)?)px$/;
/* 字符串字面量的取法只有一处：`tw4-scan-core.mjs` 的 `stringLiterals()` ——
 * 它先在**注释之外**扫描。注释里用反引号引的示例（`` `min-h-[22px]` ``）与真的
 * className 同形，不剥会让 `--check` 报出不存在的候选、`--write` 去改注释里的示例
 * （「此前写成 `h-[22px]`」被改写成「此前写成 `h-5.5`」= 解释与被解释的东西一起漂）。 */

/** @param {string} file @returns {string} */
function read(file) {
  return fs.readFileSync(file, "utf8");
}

/** 编译 Tailwind（只用它自带主题，见文件头的换算前提断言）。 */
async function loadDesignSystem() {
  const globals = read(path.join(SRC, "app", "globals.css"));
  if (/--spacing\s*:/.test(globals)) {
    throw new Error(
      "项目主题重定义了 --spacing：px ↔ spacing 倍数的换算判据不再成立，" +
        "请改用项目主题编译并重新推导换算（不要直接跑 --write）。",
    );
  }
  /** @param {string} id @param {string} base */
  const loadStylesheet = (id, base) => {
    const file =
      id === "tailwindcss"
        ? path.join(ROOT, "node_modules", "tailwindcss", "index.css")
        : path.resolve(base, id);
    // 回调契约是 Promise（Tailwind 允许同步返回，保住标注形态即可）
    return Promise.resolve({ path: file, base: path.dirname(file), content: read(file) });
  };
  return __unstable__loadDesignSystem('@import "tailwindcss";', {
    base: ROOT,
    loadStylesheet,
  });
}

const ds = await loadDesignSystem();

/**
 * 一条换算改写：`from` 原候选、`to` 规范化后的候选。
 *
 * 就这两格 —— 清单的消费点读的是它们与 `changes.length`。曾经还有一个 `key`
 * （`base + bang`，即「这条换算挂在哪个 spacing 槽位上」）被写进清单而**全文件没有一处读它**，
 * 同值 `w-K h-K → size-K` 那一路还压根不给它；撤掉了（ISSUE #2717）。
 * 要按槽位分组，先给分组一个读者，别先把字段留在声明里让人以为它在承重。
 * @typedef {Object} Change
 * @property {string} from
 * @property {string} to
 */

/**
 * 单个候选 → 规范化候选（不改写时返回 null）。
 * @param {string} token
 * @returns {Change | null}
 */
function canonicalize(token) {
  const match = TOKEN.exec(token);
  if (!match) {
    return null;
  }
  /* 三个捕获组都给了默认值：`TOKEN` 里它们都是必选的，但在 `noUncheckedIndexedAccess`
   * 下解构出来仍是 `string | undefined`，而这一串值要进 `PX_VALUE.exec(…)`、`Number(…)`
   * 与拼 `to` 的那个模板串 —— 留 undefined 进去就是往候选里写一串 "undefined"。 */
  const [, base = "", value = "", bang = ""] = match;
  const px = PX_VALUE.exec(value);
  if (!px) {
    return null;
  }
  const k = Number(px[1]) / BASE_SPACING_PX;
  if (!Number.isFinite(k) || k <= 0) {
    return null;
  }

  const to = `${base}${Number(k.toFixed(4))}${bang}`;
  const [fromCss] = ds.candidatesToCss([token]);
  const [toCss] = ds.candidatesToCss([to]);
  // 原候选必须合法；换算后的裸数值必须**真能编出规则**且**挂在 spacing scale 上**。
  if (!fromCss || !toCss) {
    return null;
  }
  if (!toCss.includes("var(--spacing)")) {
    return null;
  }
  return { from: token, to };
}

/** P80 用到的两半：同一 className 里 `w-K` 与 `h-K` 同值就该写 `size-K`。
 *
 *  只认**数字**值（与 P80 判据同口径）。`w-full h-full` 这类关键字值不合并：
 *  它不是本次要修的东西（IDE 不提示），做进去等于顺手发起另一场 size 化治理。 */
const W_TOKEN = /^w-(\d+(?:\.\d+)?!?)$/;
const H_TOKEN = /^h-(\d+(?:\.\d+)?!?)$/;

/**
 * 改写一段字符串字面量的内容（按空白切 token，天然按边界匹配）。
 *
 * 两步：① spacing 换算；② 同值 `w-K` / `h-K` 合并成 `size-K`。第二步的必要性来自
 * 第一步 —— 原本写 `w-[10px] h-[10px]` 时 P80（视图层 w-N 与 h-N 同值）数不到它
 * （值在方括号里），换成裸数值 `w-2.5 h-2.5` 后就成了硬闸命中项。
 * @param {string} content
 * @param {Change[]} changes @returns {string} */
function rewriteStringContent(content, changes) {
  const pieces = content.split(/(\s+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i];
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 守卫为 noUncheckedIndexedAccess 收窄服务（删掉 tsc 红）
    if (piece === undefined) {
      continue;
    }
    const hit = canonicalize(piece);
    if (!hit) {
      continue;
    }
    pieces[i] = hit.to;
    changes.push(hit);
  }

  const wSlots = new Map();
  const hSlots = new Map();
  for (let i = 0; i < pieces.length; i += 2) {
    /* 取一次再判（第七次「补类型不是纯减法」：这两个 `.exec(…)` 此前喂的是
     * `pieces[i]`，而隐式 any 让「可能没取到」不报；上一步把参数类型指实之后才现形）。 */
    const piece = pieces[i];
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上：为 noUncheckedIndexedAccess 收窄服务（上方注释已记）
    if (piece === undefined) {
      continue;
    }
    const w = W_TOKEN.exec(piece);
    if (w) {
      wSlots.set(w[1], i);
    }
    const h = H_TOKEN.exec(piece);
    if (h) {
      hSlots.set(h[1], i);
    }
  }
  let merged = false;
  for (const [key, wIndex] of wSlots) {
    const hIndex = hSlots.get(key);
    if (hIndex === undefined) {
      continue;
    }
    // 值相等才算「同一个 token 的两半」：`w-40 h-40` → `size-40`。中间隔着别的类
    // 也照样合并（`w-40 x h-40` → `size-40 x`）；`key` 已含 `!`，`w-40! h-40` 不匹配。
    pieces[wIndex] = `size-${key}`;
    // 被删掉的 token 连同它**前面那个分隔符**一起清空：只留空位会得到
    // `" size-40"`（前导空格）或 `"size-40 "`（尾随空格），而 `[ \t]{2,}` 压不掉
    // 单个空格 —— 那会让类名字符串里多出一个空白（`w-40 h-40` 在开头时最明显）。
    pieces[hIndex] = "";
    if (hIndex > 0) {
      pieces[hIndex - 1] = "";
    }
    merged = true;
    changes.push({ from: `w-${key} + h-${key}`, to: `size-${key}` });
  }
  if (!merged) {
    return pieces.join("");
  }
  // 多行模板串的换行缩进原样保留（只压空格/制表符），并去掉收尾后的首尾空白。
  return pieces
    .join("")
    .replaceAll(/[ \t]{2,}/g, " ")
    .replaceAll(/^[ \t]+|[ \t]+$/g, "");
}

/** @param {string} text @param {Change[]} changes */
function rewriteText(text, changes) {
  return rewriteLiterals(text, (content) => {
    const before = changes.length;
    const next = rewriteStringContent(content, changes);
    /* 没有发生改写时返回 null，让内核原样保留这一段（幂等性靠它）。 */
    return changes.length > before ? next : null;
  }).text;
}

/**
 * 递归列出 `.tsx` / `.ts` 文件（相对仓库根的绝对路径）。
 *
 * 返回类型必须写出来：`yield* walk(full)` 让 tsc 自推时「返回类型依赖自己的推断结果」
 * （TS7023），与批 7 那一份 `tw4-canonical-report.mjs` 的同一个函数同一形 ——
 * 两份是各自实现的（一个扫 `.css`/`.snap`、一个只扫 TS），不是抄漏了注解。
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const files = targets.length > 0 ? targets.map((f) => path.resolve(ROOT, f)) : [...walk(SRC)];

let total = 0;
const touched = [];
for (const file of files) {
  const before = read(file);
  /** @type {Array<{from:string,to:string}>} */
  /** @type {Change[]} */
  const changes = [];
  const after = rewriteText(before, changes);
  if (after === before) {
    continue;
  }
  total += changes.length;
  touched.push({ file, changes });
  if (shouldWrite) {
    fs.writeFileSync(file, after);
  }
}

for (const { file, changes } of touched) {
  const pairs = new Map();
  for (const { from, to } of changes) {
    pairs.set(from, to);
  }
  console.log(path.relative(ROOT, file));
  for (const [from, to] of pairs) {
    console.log(`  ${from} → ${to}`);
  }
}
console.log(
  `\n${shouldWrite ? "已改写" : "待改写"} ${total} 处（${touched.length} 个文件）${
    shouldWrite ? "" : "；加 --write 落盘"
  }`,
);

/* ── 判定档（--check）：候选数须为 0 ────────────────────────────────────
 *
 * 计数口径 = 「待改写的处数」按文件记账。与 `tw4-canonical-report.mjs` 的判定档
 * 同构（那个按源文件记 canonical 候选数），两者互补、各扫一类。
 * 注意：本工具扫全部 `src` 下的 tsx/ts（含测试文件）—— 测试文件里的候选**同样计入**，
 * 因为它的改写是**整 token 等值替换**，不像 canonical 那类会改坏断言样本。
 *
 * 硬闸形态（ISSUE #1811）：不再有基线、不再有 `--update`，命中即退 1。清零后的
 * 自证靠**默认档**（不带 flag 的那次清单）—— 一个永远扫不到东西的判据也会「0 处全绿」。 */

if (shouldCheck) {
  if (total > 0) {
    console.error(`\nspacing canonical 硬闸：待改写 ${total} 处（须为 0）\n`);
    for (const { file, changes } of touched) {
      console.error(`  ✗ ${path.relative(ROOT, file)}：${changes.length} 处`);
    }
    console.error(`\n修法：node scripts/tw4-spacing-canonical.mjs --write 落盘改写。`);
    process.exit(1);
  }
  console.log("\nspacing canonical 硬闸：0 处 ✓");
  process.exit(0);
}
