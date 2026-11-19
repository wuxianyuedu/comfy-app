#!/usr/bin/env node
// @ts-nocheck -- 门禁共用件：`vitest.config.ts` 的 projects 解析与 glob 引擎（被 scripts/check-*.cjs 调用，自己不判成败）
/**
 * `vitest.config.ts` 的 `projects` 配置 ⇒ 「哪个档收哪些用例」的**唯一一份解析**。
 *
 * 为什么抽成共用件而不是各判据自己写一份：判「用例归属」的门禁有两份
 * （`check-test-environment.cjs` 判目录档与文件头的一致性、`check-test-inventory.cjs`
 * 判磁盘上的用例是否真被某个档收走），两份都要回答同一个问题「这个文件进哪个档」。
 * 各自抄一遍 `indexOf("projects:")` + glob → 正则的代价是**静默的**：配置里
 * `DOM_TEST_GLOBS` 加一条目录，两份判据里只有一份跟着变，另一份照旧报 OK ——
 * 而它比对的已经是旧口径（§12.12 的字面孪生、§12.18 的复用优先）。
 *
 * 三条口径（与抽出前那份逐字同义，别在这里「顺手改进」）：
 *
 *   · **解析源码文本，不 import 配置** —— 那份配置顶层 import 了 `vitest/config`，
 *     判据里加载它会把 vitest 一起拉起来（判据要能独立跑、要快）。
 *   · **只认一种形状**：`projects` 数组里各对象 `name: "<档名>"` + 同对象内
 *     `include` / `exclude`。形状不认识 ⇒ `found` 不增，由调用方的
 *     `found < 2` 兜住（**不许**退回「没有目录档」＝判据静默消失）。
 *   · **glob 引擎只有三种语法**：`**`、`*`、`{a,b}` —— 本仓 `include` 里实际出现的
 *     全部。写更多语法前先确认配置里真有，否则是给没人走的分支配气。
 */
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_REL = "vitest.config.ts";

/**
 * 读 `vitest.config.ts` 原文。**读不到返回 `null`**（调用方判失败），
 * 不抛也不返回空串 —— 空串会让解析器安静地产出 `found: 0`，
 * 而下游把它当「配置里没有 projects」与「配置文件不存在」混为一谈。
 *
 * @param {string} root 仓库根（绝对路径）
 * @returns {string | null}
 */
function loadConfig(root) {
  try {
    return fs.readFileSync(path.join(root, CONFIG_REL), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * 把**注释**换成等长空白（字符串原样保留）—— 给「必须按原文偏移去切配置」的那一步用。
 *
 * 为什么必须有这一步（实测撞出来的形状）：`indexOf("projects:")` 直接在**原文**上找时，
 * 一段解释性注释里写了一句「inline project（`projects: [{ test: {…} }]`）」——
 * 于是命中的是**注释里那一处**、`[` 也落在注释里，两个 project 一个都解析不出来。
 * 表现不是「判据报错」而是**判据判失败**；若没有调用方那条 `found < 2` 的兜底，
 * 它会退回「没有目录档」＝判据静默消失、照样报 OK。
 *
 * ⚠️ 不能用「字符串也换成占位符」的那一版：**偏移会变**，而这里要拿 `indexOf`
 * 的偏移去切数组、还要读 `include: DOM_TEST_GLOBS` 这种标识符与字符串条目。
 *
 * @param {string} src 配置原文
 * @returns {string} 等长、只把注释抹成空白的文本
 */
function blankComments(src) {
  const chars = [...src];
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | str | tpl
  let open = "";
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === "code") {
      if (c2 === "//") {
        state = "line";
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c2 === "/*") {
        state = "block";
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        state = "str";
        open = c;
        i += 1;
        continue;
      }
      if (c === "`") {
        state = "tpl";
        open = c;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i += 1;
        continue;
      }
      chars[i] = " ";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c2 === "*/") {
        state = "code";
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c !== "\n") {
        chars[i] = " ";
      }
      i += 1;
      continue;
    }
    /* str / tpl：原样保留，只处理转义与闭合 */
    if (c === "\\") {
      i += 2;
      continue;
    }
    const closer = state === "str" ? (open === '"' ? '"' : "'") : "`";
    if (c === closer) {
      state = "code";
    }
    i += 1;
  }
  return chars.join("");
}

/** 按括号配对把数组体切成顶层元素（不处理嵌套对象里的逗号）。 */
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let cur = "";
  let state = "code";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (state === "str") {
      cur += ch;
      if (ch === "\\") {
        cur += body[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        state = "code";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      state = "str";
      cur += ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      /* 回到 0 就是 `projects: [...]` 那一层的收尾，后面的内容不属于它。 */
      if (depth < 0) {
        break;
      }
    }
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) {
    out.push(cur);
  }
  return out;
}

/**
 * 取对象字面量里 `key: [ "…", … ]` 的字符串条目。
 *
 * 支持两种写法，因为它们各自都好用、且**都必须被认出来**：
 *   · `include: [<字符串字面量>, …]` —— 直接写在一行里；
 *   · `include: DOM_TEST_GLOBS`      —— 顶层 `const` 数组（列出 26 个目录用的就是它，
 *     写成字面量会把两个 project 挤成一坨）。
 * 认不出标识符时**返回 `null`**（调用方判失败），不静默按空数组处理 —— 那正是
 * 「`include: []` 却退 0」那个静默消失的形状。
 *
 * @returns {string[] | null} 形状不认识时 `null`
 */
function literalArray(objText, key, configText) {
  const at = objText.indexOf(`${key}:`);
  if (at === -1) {
    return null;
  }
  /* 标识符写法：`key: SOME_CONST` —— 去顶层找 `const SOME_CONST = [...]`。 */
  const ident = new RegExp(key + String.raw`:\s*([A-Za-z_$][\w$]*)\s*[,}\n]`).exec(objText);
  if (ident && configText) {
    const decl = new RegExp(String.raw`const\s+` + ident[1] + String.raw`\s*=\s*\[`).exec(
      configText,
    );
    if (!decl) {
      return null;
    }
    return collectStringLiterals(configText.slice(decl.index + decl[0].length - 1));
  }
  const open = objText.indexOf("[", at);
  if (open === -1) {
    return null;
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < objText.length; i += 1) {
    if (objText[i] === "[") {
      depth += 1;
    } else if (objText[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return null;
  }
  return collectStringLiterals(objText.slice(open));
}

/** 从一个 `[…]` 字面量（含方括号）里取出所有字符串条目名。 */
function collectStringLiterals(arrayText) {
  let depth = 0;
  let close = -1;
  for (let i = 0; i < arrayText.length; i += 1) {
    if (arrayText[i] === "[") {
      depth += 1;
    } else if (arrayText[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return null;
  }
  const inner = arrayText.slice(1, close);
  return [...inner.matchAll(/"(?<content>(?:[^"\\]|\\.)*)"/g)].map((m) => m.groups?.content ?? "");
}

/**
 * 每个档的 `include` / `exclude` —— 从**配置源码**读，不写死档名、不手抄目录清单。
 *
 * 为什么值得单独一步：把 `DOM_TEST_GLOBS` 那份目录抄进任何一份判据，就等于让判据持有
 * 第二份「哪个档收哪些用例」的真相 —— 配置里加一个目录时判据不会跟着变，于是它照旧
 * 报 OK，而比对的已是旧口径（同族坑见 §11.17.4「判据自己不许静默降级」）。
 *
 * @param {string} configText `vitest.config.ts` 原文
 * @returns {{ tiers: Map<string, {include: string[], exclude: string[]}>, found: number }}
 *   `found` = 认出来的档数；调用方必须自己判「够不够」（本仓是两个档）。
 */
function readTiers(configText) {
  /* ⚠️ 在**抹掉注释**的文本上找 `projects:`（偏移不变，字符串照旧）——
   * 解释性注释里正当会出现 `projects:` 这个词，直接在原文上找会命中注释那一处。 */
  const text = blankComments(configText);
  const tiers = new Map();
  const marker = "projects:";
  const at = text.indexOf(marker);
  if (at === -1) {
    return { tiers, found: 0 };
  }
  /* 从 `projects:` 后的 `[` 开始，按括号配对切出这个数组的**顶层元素**。 */
  const bracket = text.indexOf("[", at);
  if (bracket === -1) {
    return { tiers, found: 0 };
  }
  const items = splitTopLevel(text.slice(bracket + 1));
  let found = 0;
  for (const item of items) {
    const nameM = /name:\s*"(?<name>[^"]+)"/.exec(item);
    if (!nameM) {
      continue;
    }
    const name = nameM.groups?.name ?? "";
    const inc = literalArray(item, "include", text);
    const exc = literalArray(item, "exclude", text);
    if (inc === null) {
      continue;
    } // 形状不认识 —— 不计入 found，由 found 不足兜住
    found += 1;
    tiers.set(name, { include: inc, exclude: exc ?? [] });
  }
  return { tiers, found };
}

/**
 * 每个档的 `environment` —— 从**配置源码**读，不写死档名。
 *
 * @param {string} configText `vitest.config.ts` 原文
 * @returns {Record<string, string>} 档名 ⇒ 环境名；读不到的档不在表里。
 */
function readEnvironments(configText) {
  const text = blankComments(configText);
  const marker = "projects:";
  const at = text.indexOf(marker);
  if (at === -1) {
    return {};
  }
  const bracket = text.indexOf("[", at);
  if (bracket === -1) {
    return {};
  }
  const out = {};
  for (const item of splitTopLevel(text.slice(bracket + 1))) {
    const nameM = /name:\s*"(?<name>[^"]+)"/.exec(item);
    const envM = /environment:\s*"(?<environment>[^"]+)"/.exec(item);
    if (nameM && envM) {
      out[nameM.groups?.name ?? ""] = envM.groups?.environment ?? "";
    }
  }
  return out;
}

/** 正则里需要转义的字面量字符。 */
const ESCAPE_RE = /[.+^${}()|[\]\\?]/g;

/**
 * 极简 glob → 正则。支持 `**`、`*`、`{a,b}` 三种（本仓 `include` 里实际出现的全部）。
 *
 * ⚠️ 「双星号 + 斜杠」必须翻成 `(?:[^/]+/)*`（**零层或多层**目录），
 * 不能翻成「任意字符 + 斜杠」：后者要求**至少一层**目录，于是
 * `src/config/<星号><星号>/x.test.ts` 匹配不到 `src/config/custom-nodes.test.ts`
 * （实测：目录档整条失效、判据静默空转）。
 * `*` 翻 `[^/]*`（不跨目录），字面量段先转义 —— 顺序不能反。
 */
function globToRe(g) {
  let out = "";
  for (let i = 0; i < g.length; i += 1) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        /* 「双星号 + 斜杠」→ 零层或多层目录；结尾的裸双星号 → 任意 */
        if (g[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "{") {
      const close = g.indexOf("}", i);
      if (close > 0) {
        out += `(?:${g
          .slice(i + 1, close)
          .split(",")
          .map(escapeRe)
          .join("|")})`;
        i = close;
        continue;
      }
    }
    out += escapeRe(ch);
  }
  return new RegExp(`^${out}$`);
}

function escapeRe(s) {
  return s.replaceAll(ESCAPE_RE, `${String.fromCharCode(92)}$&`);
}

function matchesAny(rel, globs) {
  return globs.some((g) => globToRe(g).test(rel));
}

/**
 * 一次把「档 ⇄ glob ⇄ 环境」读全，供两份判据共用。
 *
 * @param {string} root 仓库根（绝对路径）
 * @returns {{tiers: Map<string, {include: string[], exclude: string[]}>, found: number,
 *            environments: Record<string, string>, configText: string|null}}
 */
function loadProjects(root) {
  const configText = loadConfig(root);
  if (configText === null) {
    return { tiers: new Map(), found: 0, environments: {}, configText: null };
  }
  const { tiers, found } = readTiers(configText);
  return {
    tiers,
    found,
    environments: readEnvironments(configText),
    configText,
  };
}

module.exports = {
  CONFIG_REL,
  blankComments,
  collectStringLiterals,
  escapeRe,
  globToRe,
  literalArray,
  loadConfig,
  loadProjects,
  matchesAny,
  readEnvironments,
  readTiers,
  splitTopLevel,
};
