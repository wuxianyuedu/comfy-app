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
 *   node scripts/tw4-spacing-canonical.mjs --write      # 落盘
 *   node scripts/tw4-spacing-canonical.mjs <file...>    # 只处理给定文件
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __unstable__loadDesignSystem } from "tailwindcss";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const shouldWrite = argv.includes("--write");
const targets = argv.filter((arg) => arg !== "--write");

/** Tailwind v4 的 spacing 基线：`--spacing` 默认 0.25rem，浏览器默认根字号 16px。 */
const BASE_SPACING_PX = 0.25 * 16;

/** 候选形态：`(变体:)*工具-[值]` + 可选的 important 后缀。 */
const TOKEN = /^((?:[a-zA-Z][\w-]*:)*[a-zA-Z][\w-]*-)\[([^\]\s]+)\](!?)$/;
/** 只处理 px 任意值（rem / % / calc 不做换算：它们的等价性另有条件）。 */
const PX_VALUE = /^(\d+(?:\.\d+)?)px$/;
/** 字符串字面量（普通串与模板串；模板串里的 `${…}` 会作为普通片段保留）。 */
const STRING_LITERAL = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;

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
  const loadStylesheet = async (id, base) => {
    const file =
      id === "tailwindcss"
        ? path.join(ROOT, "node_modules", "tailwindcss", "index.css")
        : path.resolve(base, id);
    return { path: file, base: path.dirname(file), content: read(file) };
  };
  return __unstable__loadDesignSystem('@import "tailwindcss";', {
    base: ROOT,
    loadStylesheet,
  });
}

const ds = await loadDesignSystem();

/**
 * 单个候选 → 规范化候选（不改写时返回 null）。
 * @param {string} token
 * @returns {{ from: string, to: string, key: string } | null}
 */
function canonicalize(token) {
  const match = TOKEN.exec(token);
  if (!match) return null;
  const [, base, value, bang] = match;
  const px = PX_VALUE.exec(value);
  if (!px) return null;
  const k = Number(px[1]) / BASE_SPACING_PX;
  if (!Number.isFinite(k) || k <= 0) return null;

  const to = `${base}${Number(k.toFixed(4))}${bang}`;
  const [fromCss] = ds.candidatesToCss([token]);
  const [toCss] = ds.candidatesToCss([to]);
  // 原候选必须合法；换算后的裸数值必须**真能编出规则**且**挂在 spacing scale 上**。
  if (!fromCss || !toCss) return null;
  if (!toCss.includes("var(--spacing)")) return null;
  return { from: token, to, key: base + bang };
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
 */
function rewriteStringContent(content, changes) {
  const pieces = content.split(/(\s+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const hit = canonicalize(pieces[i]);
    if (!hit) continue;
    pieces[i] = hit.to;
    changes.push(hit);
  }

  const wSlots = new Map();
  const hSlots = new Map();
  for (let i = 0; i < pieces.length; i += 2) {
    const w = W_TOKEN.exec(pieces[i]);
    if (w) wSlots.set(w[1], i);
    const h = H_TOKEN.exec(pieces[i]);
    if (h) hSlots.set(h[1], i);
  }
  let merged = false;
  for (const [key, wIndex] of wSlots) {
    const hIndex = hSlots.get(key);
    if (hIndex === undefined) continue;
    pieces[wIndex] = `size-${key}`;
    pieces[hIndex] = "";
    merged = true;
    changes.push({ from: `w-${key} + h-${key}`, to: `size-${key}` });
  }
  if (!merged) return pieces.join("");
  // 被删掉的 token 留下一个空位，把它前面的分隔符一起收掉（只压空格/制表符，
  // 多行模板串的换行缩进原样保留）。
  return pieces.join("").replace(/[ \t]{2,}/g, " ");
}

/** @param {string} text @param {Array<{from:string,to:string}>} changes */
function rewriteText(text, changes) {
  return text.replace(STRING_LITERAL, (_full, quote, content) => {
    return quote + rewriteStringContent(content, changes) + quote;
  });
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

const files =
  targets.length > 0
    ? targets.map((f) => path.resolve(ROOT, f))
    : [...walk(SRC)];

let total = 0;
const touched = [];
for (const file of files) {
  const before = read(file);
  /** @type {Array<{from:string,to:string}>} */
  const changes = [];
  const after = rewriteText(before, changes);
  if (after === before) continue;
  total += changes.length;
  touched.push({ file, changes });
  if (shouldWrite) fs.writeFileSync(file, after);
}

for (const { file, changes } of touched) {
  const pairs = new Map();
  for (const { from, to } of changes) pairs.set(from, to);
  console.log(`${path.relative(ROOT, file)}`);
  for (const [from, to] of pairs) console.log(`  ${from} → ${to}`);
}
console.log(
  `\n${shouldWrite ? "已改写" : "待改写"} ${total} 处（${touched.length} 个文件）` +
    (shouldWrite ? "" : "；加 --write 落盘"),
);
