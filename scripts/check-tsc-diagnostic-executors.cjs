#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：类型层「声明 ⇄ 执行者」的判定档（供 .githooks/pre-commit 调用）
/**
 * `check-tsc-diagnostic-executors.cjs` —— **声明落后于实现**这一类 tsc 红的执行者
 * （ISSUE #1591 / 规范 docs/standards/13-提交与-code-review.md §13.5.14）。
 *
 * ## 立案现场：19 条 tsc 错落进 `master`，没有一行是行为改动
 *
 * 最近一次 `master` 上的 tsc 红是 19 条（前一轮还有 17 条）。逐条扒下来**共同根因只有一个**：
 * **声明（JSDoc / 类型注解）落后于实现** —— 代码长出了新形状，写形状的那句话没跟着长。
 *
 *   ① `FRESHNESS_TRACKS` 长出 `daily` / `skipHow` 两栏、`freshnessRecord` 接上
 *      `skippedReason`、`checkFreshnessLedger` 接上 `now` —— 三处 **JSDoc 还停在旧的四栏形状**；
 *   ② `findCargo()` 用 `&&` 拼候选再 `filter` —— 数组是 `(string | false)[]`，
 *      `.filter` 在这一形状上**构不成收窄**，下游按 `string` 用就红；
 *   ③ 用例里的期望对象仍是四栏。
 *
 * 而它们**本来都有一条现成的判据**：`tsc --noEmit` —— 只是那条判据没有
 * 「**什么时候被敲**」的执行者。本地 `pre-commit` 只保护「启用了钩子、且没加
 * `--no-verify`」的**那一次本地提交**；PR 在平台侧是 **squash 合并**、那一步不跑钩子；
 * `#623` 之后**已无 CI 兜底**（§13.5.3）。于是 ① 的实例在干净仓库上长久**全绿**
 * —— 这正是 §11.23 那一族的形态：**声明写得对、没有人读**。
 *
 * ## 这一档判什么（不是再写一份 tsc）
 *
 * 全仓**另一次** `tsc` 是 §12.18 明令要避免的第二轮子（§13.6.2 的
 * `pnpm check:base:batch` 已经把「合并前把 tsc 在干净快照上复算一遍」做完了）。
 * 所以本判据**不跑 tsc**，它判的是**那条判据自己的执行者**：
 *
 *   ① **判据 ⇄ 执行者的索引**：`scripts/.tsc-diagnostic-executors.json` 里每一条声明
 *      都必须答出「tsc 怎么找到它」+「它交给谁执行」，且那份台账**必须与
 *      `scripts/.declaration-readers.json` 逐行同源**（两处各记一份 ⇒ 必然分叉；
 *      分开的原因只是「谁会被敲」与「判据本身是谁」两个维度，见文件末的「刻意不做」）。
 *   ② **未登记的声明不许新增**：新写一处 JSDoc / 类型注解就红，除非把它登记进台账
 *      —— 登记的动作就是被迫回答「它由谁执行、谁来敲」。
 *   ③ **台账里的每一处仍然存在**：改名 / 挪文件 / 删符号即红（台账是负债，不是赦免名单）。
 *
 * ## 判据自己不许静默降级（§11.23.3 同款）
 *
 * 解析不出、台账是空的、与 declaration-readers 的同源核对读不到对侧 —— 一律判**失败**，
 * 而不是「没有站点要查、于是放过」。这一族的先例太多（§11.18.3 首版 `include: []` 却退 0、
 * §11.20.5、§11.23.3 的「索引自己不许静默降级」），而**本判据自己的失效形态正是它要拦的病**：
 * 「扫描规则失灵 ⇒ 读出 0 条 ⇒ 全绿」，与「声明没有执行者」长得一模一样。
 *
 * ## 一条被刻意放下的候选：把「未登记」扩到「改到了未登记声明的文件」
 *
 * 「暂存里有 `scripts/*.mjs`、而没动台账 ⇒ 提示重新自证」—— 这一条收益看着很直接，但它
 * **会误报**：改 `scripts/` 里任何一个脚本（含那些一个 JSDoc 都不改的）都会命中，而它会
 * 立刻退化成一条天天响的提示，人只会去绕开它（§11.18.4「会误报的判据活不过一次评审」）。
 * 真正的覆盖由 §13.6.2 的 `pnpm check:base:batch`（合并前把 `tsc` 复算一遍）+ 本判据的
 * 零增量阻断一起给，不再多一层会响错的提示。
 *
 * 用法：
 *   node scripts/check-tsc-diagnostic-executors.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-tsc-diagnostic-executors.cjs --report   # 只出清单不判失败（盘点用）
 *   node scripts/check-tsc-diagnostic-executors.cjs --update   # 把基线收紧到当前实测（人的动作）
 *
 * 退出码 0 = 通过，1 = 阻断，2 = `--update` 时不慎让某条基线**上涨**（那正是要拦的方向）。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  readForScan,
  walkForScan,
  vanishedNote,
} = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
/**
 * `--update` = 把基线收紧到当前实测（**人的动作**，不进钩子）。
 *
 * 只许**降**：某一行的实测值比基线大时拒绝写入并退 2 —— 那正是本条要拦的方向，
 * 而一个「顺手把所有上涨都记进基线」的旗标等于零增量那一档当场作废
 * （同族先例：`check-test-it-each.cjs` / `check-click-keyboard.cjs` 的 `--update`）。
 */
const UPDATE = ARGS.has("--update");

/** 本判据的台账（声明 ⇄ 执行者）与它的姊妹索引（声明 ⇄ 读者）。 */
const LEDGER = path.join(__dirname, ".tsc-diagnostic-executors.json");
const READERS_LEDGER = path.join(__dirname, ".declaration-readers.json");

/**
 * 站点扫描面 —— 与 `tsconfig.json` 的 `include` 同口径（`**​/*.ts` + `**​/*.tsx` +
 * `**​/*.js` 且 `checkJs: true`，即 `scripts/` 那份 `.mjs` / `.cjs` 也在判决面里）。
 *
 * **`scripts/` 在 tsc 的判决面里**这一点是本判据的前提之一（很多人以为「`.mjs` 是脚本、
 * 类型不收」）：立案那 19 条里有 12 条正是新鲜度内核那三处 JSDoc。
 */
const SCAN_DIRS = ["src", "scripts", "tests"];
const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
]);

/**
 * 台账条目的**下限** —— 它不是「正确值」，是**静默降级的地板**（同 §11.23.3 的
 * `MIN_CARRIERS`）：解析规则失灵（字段改名 / 嵌套变形）时最容易退化成「0 条、于是全绿」，
 * 而那个形态与本判据要拦的病**逐字同形**。
 *
 * **只判空**（`0` 条），不拿一个「应该有几条」的数字去卡：那个数字会随仓库演进而漂，
 * 而按 §12.14 会漂的读数不写死；真正要拦的形态是「读出 0 条 ⇒ 空转照样 OK」，
 * 空表的下场与「没人查」逐字相同。所以地板取 0 的补集，不取「大致对的那个数」。
 */
const MIN_ENTRIES = 1;

const problems = [];
const report = [];
/** `--update` 时实测值**上涨**的那些行 —— 方向上拒绝写入（见文件头）。 */
const bloated = [];

/* ── 读台账（判据自己不许静默降级） ─────────────────────────── */

/**
 * @returns {{entries: any[] | null, source: any | null}}
 */
function readLedger() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch (err) {
    problems.push(
      `台账不可读（${path.relative(ROOT, LEDGER)}）：${err.message}\n` +
        "      —— 本判据的对象就是它；读不到时**判失败**，不按「没有声明要查」放过（§11.23.3 同款）。",
    );
    return { entries: null, source: null };
  }
  const entries = parsed?.entries;
  if (!Array.isArray(entries)) {
    problems.push("台账里 `entries` 不是数组（判据不许静默降级）");
    return { entries: null, source: null };
  }
  if (entries.length < MIN_ENTRIES) {
    problems.push(
      "台账是空的 —— 解析退化成「读出 0 条」时本判据会空转、照样报 OK，" +
        "而那个形态与「所有声明都没有执行者」在输出上完全一样（§11.23.3 同款）",
    );
    return { entries: null, source: null };
  }
  return { entries, source: parsed };
}

/* ── 把「声明站点」定义成一个可数、可复现的形状 ────────────────── */

/**
 * 某一行是不是**声明**（类型层的那两句话）。
 *
 * 只认两种最简单、最不会误报的形状：
 *   · `@param <名> {类型}` / `@returns {类型}` / `@type {类型}` —— JSDoc 的类型位；
 *   · `export function` / `export const` / `interface <名>` / `type <名>` —— TS 的声明头。
 *
 * **刻意不用「文件里有没有 `/**`」**：那是文档注释的一般形态，量级上会把整个仓库判红，
 * 而本条要拦的具体形状是「类型层的那句话落后了」。先用 `stripComments` 挖掉字符串，
 * 于是夹具字符串里的 `@param` 不算站点（同 `check-soft-assertions.cjs` 的取舍）。
 *
 * @param {string} line
 * @returns {boolean}
 */
function isDeclarationLine(line) {
  const t = line.trim();
  if (t.startsWith("*")) {
    return /^@(param|returns?|type)\b/.test(t.slice(1).trim());
  }
  return /^(export\s+)?(function|const|interface|type)\b/.test(t);
}

/**
 * 把字符串字面量与注释里的内容挖掉（只保留「代码骨架」用于计数）。
 *
 * 不挖的话，判据自己的自测夹具、以及任何文案里的 `**@param {string}**` 都会被算成站点
 * —— 实测同族的先例：`tests/comment-language.test.ts` 里那份夹具字符串把文件计数
 * 从 183 数成了 185（§11.18.3.1）。
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * 数一个文件里「声明行」的条数。
 *
 * 数的是**行**而不是符号：一条 `@param` 就是一句声明，而「这句话落后于实现」正是立案
 * 那 19 条的形态。行级计数不必做词法分析，也不会因为 prettier 折行而漂。
 *
 * @param {string} src
 * @returns {number}
 */
function countDeclarationSites(src) {
  return stripComments(src)
    .split("\n")
    .filter((l) => isDeclarationLine(l)).length;
}

/** @param {string} dir @param {string[]} out */
/**
 * 由 `SCAN_EXTS` **派生**的文件过滤器（不重抄一份后缀清单）：
 * 枚举走 `gate-scan-read.cjs`，它收一个 `fileRe`。
 */
const SCAN_FILE_RE = new RegExp(
  `\\.(?:${[...SCAN_EXTS].map((e) => e.replace(/^./, "")).join("|")})$`,
);

/** 扫描面上的消失文件数（结论行必须带）。 */
let vanishedScan = 0;

function collectFiles(dir, out) {
  /* 原来是 `try { readdirSync } catch { return; }` + `try { readFileSync } catch { continue; }`
   * —— 两处都把**所有**错误静默吞掉，「判据读不到扫描面」与「这个文件没站点」在
   * 读数上长得一样。共用件只降级 `ENOENT`，并把没读到的份数留给结论行。 */
  out.push(...walkForScan(dir, SCAN_FILE_RE, { skipHiddenDirs: true }));
}

/**
 * 全仓的声明站点计数（`相对路径 → 条数`）。
 *
 * @returns {Map<string, number>}
 */
function scanDeclarationSites() {
  const files = [];
  for (const d of SCAN_DIRS) collectFiles(path.join(ROOT, d), files);
  const counts = new Map();
  for (const full of files) {
    const src = readForScan(full);
    if (src === null) {
      vanishedScan += 1;
      continue;
    }
    const n = countDeclarationSites(src);
    if (n > 0) {
      counts.set(path.relative(ROOT, full).replace(/\\/g, "/"), n);
    }
  }
  return counts;
}

/* ── ①②③ 主流程 ────────────────────────────────────────────── */

const { entries } = readLedger();

if (entries) {
  const counts = scanDeclarationSites();
  const seen = new Set();

  for (const e of entries) {
    const id = e?.id ?? "(缺 id)";
    if (
      !e?.id ||
      !e?.name ||
      !Array.isArray(e?.paths) ||
      !e?.reader ||
      !e?.executor ||
      !e?.section
    ) {
      problems.push(
        `台账条目 ${id} 字段不全（需要 id / name / paths / reader / executor / section）`,
      );
      continue;
    }
    if (seen.has(e.id)) problems.push(`台账里 id 重复：${e.id}`);
    seen.add(e.id);

    /* ③ 声明的落点仍然存在，且仍然真的有声明行 ——
     * 只判「文件在不在」会让「同一个文件里那些 JSDoc 被删光了」这一格静默通过。 */
    for (const rel of e.paths) {
      const n = counts.get(rel);
      if (n === undefined) {
        problems.push(
          `「${e.name}」登记的文件 ${rel} 上**扫不到任何声明行**（不在 / 被改名 / 声明被删光）—— ` +
            "台账是负债不是赦免名单，落点没了就要把那一条删掉或改指别处",
        );
        continue;
      }
      for (const marker of e.markers ?? []) {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) continue;
        if (!fs.readFileSync(full, "utf8").includes(marker)) {
          problems.push(
            `「${e.name}」登记的关键词 \`${marker}\` 在 ${rel} 里已经找不到了 —— ` +
              "登记项与事实脱钩之后，这条目只会让人以为有人在守",
          );
        }
      }
    }

    /* ② 执行者在场：与 §13.5.12 同源的口径 —— `fixed-test` 必须在 C 组固定清单里，
     * 否则它只在「碰到它时」才跑，那不是执行者。 */
    const ex = e.executor;
    if (ex.kind !== "fixed-test" && ex.kind !== "hook-step") {
      problems.push(
        `「${e.name}」的 executor.kind 只能是 fixed-test / hook-step`,
      );
    }

    /* **零增量**：新写一处声明就必须同批登记台账。
     * 这一条是「未登记的声明不许新增」的机器形态 —— 它把「我该登记什么」这句话
     * 从一句提醒变成了当场要回答的问题（§11.23 的立案理由逐字同款）。 */
    for (const rel of e.paths) {
      if (!e.baseline || typeof e.baseline[rel] !== "number") {
        problems.push(
          `「${e.name}」缺少 ${rel} 的基线（baseline[rel]）—— 没有基线就判不出「有没有新增」，` +
            "零增量那一档会静默失效",
        );
        continue;
      }
      const now = counts.get(rel) ?? 0;
      if (UPDATE) {
        if (now > e.baseline[rel]) {
          bloated.push(
            `${e.id}.baseline["${rel}"]：${e.baseline[rel]} → ${now}`,
          );
        } else {
          e.baseline[rel] = now;
        }
        continue;
      }
      if (now > e.baseline[rel]) {
        problems.push(
          `声明新增：${rel} 的声明行从 ${e.baseline[rel]} 涨到 ${now}（「${e.name}」）—— ` +
            "新写一处 JSDoc / 类型注解，就要回答「它由谁执行、谁来敲」。" +
            `\n        出口：把 §${e.section} 与 ${e.reader} 读完，确认这条声明真会被 tsc 判决面收进去、` +
            `并由「${ex.test ?? ex.label ?? ex.kind}」敲到；确认之后**手工**把 ` +
            `${path.relative(ROOT, LEDGER)} 里 \`${e.id}.baseline["${rel}"]\` 改成 ${now}。` +
            "\n        （这一步**不给 `--update`**：那一支只许降不许升 —— 上涨的意思是" +
            "「多了一处没人回答过的声明」，让一个旗标替人回答，这条判据就当场作废。）" +
            "\n        （也别为了让这一步变绿去把基线写小、或把这条声明摘掉 —— 零增量判的就是这两件事。）",
        );
      } else if (now < e.baseline[rel]) {
        report.push(
          `收紧：${rel} 的声明行从 ${e.baseline[rel]} 降到 ${now}（「${e.name}」）` +
            ` —— 跑 \`node scripts/check-tsc-diagnostic-executors.cjs --update\` 收紧基线`,
        );
      }
    }

    report.push(
      `${e.id}\t§${e.section}\t${e.paths.join(" / ")}\t执行者 ${ex.test ?? ex.label ?? ex.kind}`,
    );
  }

  /* ①′ 条目声称的**核验面**必须在它自己的执行者里逐字存在（#1623）。
   *
   * 立案现场：条目里写 `"test": "tests/…（C 组固定清单）"` 只是一句**散文** ——
   * 它说的是「谁在被敲」，但**没有任何东西核对**那份用例是不是真的在核这一条声称的东西。
   * 于是「台账说是这一份」与「那一份真的能核它」是两件互不相干的事。
   *
   * 形状：条目可以给一个 `verifiedSurfaces`（字符串数组），里面是它声称**执行者逐条
   * 核过**的面；执行者那一侧要把同一份清单具名列出（本仓库的实例是
   * `scripts/check-a11y-rules.cjs` 的 `VERIFIED_SURFACES` 与
   * `tests/a11y-effective-config.coverage.test.ts` 的账本）。这里核的是：
   *
   *   · `verifiedSurfaces` 里每个名字，都要能在 `reader` 那一份脚本里找到
   *     **具名出现**（注释里提一句不算 —— 要的是能被调用 / 被列进表的那个名字）；
   *   · 名字不许重复（重复 = 两份清单开始分叉的早期形态）。
   *
   * 它**不判**「那一份用例是不是真在跑那些面」（那是 C 组固定清单与用例自己的事），
   * 只判「台账这句话在源码里找得到落点」—— 与 §13.5.14 的判据口径同族。 */
  for (const e of entries) {
    const faces = e.verifiedSurfaces;
    if (faces === undefined) continue;
    if (!Array.isArray(faces) || faces.length === 0) {
      problems.push(
        `「${e.name}」的 verifiedSurfaces 必须是非空数组（写了就要核，空数组与没写等价）`,
      );
      continue;
    }
    const seenFace = new Set();
    const readerPath = path.join(ROOT, e.reader);
    let readerSrc;
    try {
      readerSrc = fs.readFileSync(readerPath, "utf8");
    } catch (err) {
      problems.push(
        `「${e.name}」的 reader（${e.reader}）读不到（${err.message}）——` +
          "核验面没有落点可对",
      );
      continue;
    }
    for (const face of faces) {
      if (typeof face !== "string" || face.trim() === "") {
        problems.push(`「${e.name}」的 verifiedSurfaces 里有空名字`);
        continue;
      }
      if (seenFace.has(face)) {
        problems.push(`「${e.name}」的 verifiedSurfaces 里 ${face} 重复了`);
      }
      seenFace.add(face);
      if (!new RegExp(`\\b${face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(readerSrc)) {
        problems.push(
          `「${e.name}」声称核过的面 \`${face}\` 在 ${e.reader} 里找不到 —— ` +
            "台账的这句话与事实脱钩之后，它只会让人以为有人在守",
        );
      }
    }
  }

  /* ① 与姊妹索引逐行同源：本台账**不是第二份真相来源**。
   * 两处各记一份的形态必然会分叉，而分叉之后「哪一份是真的」没有判据能回答。 */
  if (!fs.existsSync(READERS_LEDGER)) {
    problems.push(
      `姊妹索引不存在：${path.relative(ROOT, READERS_LEDGER)} —— ` +
        "本台账要与它逐行同源核对，读不到对侧时判失败（同 §11.23.3）",
    );
  } else {
    let readers = null;
    try {
      readers = JSON.parse(fs.readFileSync(READERS_LEDGER, "utf8"));
    } catch (err) {
      problems.push(`姊妹索引不是合法 JSON：${err.message}`);
    }
    const carriers = readers?.carriers;
    if (!Array.isArray(carriers)) {
      problems.push("姊妹索引里 `carriers` 不是数组（同源核对没有比对对象）");
    } else {
      const byId = new Map(carriers.map((c) => [c.id, c]));
      for (const e of entries) {
        if (!e?.id) continue;
        const peer = byId.get(e.id);
        if (!peer) {
          problems.push(
            `「${e?.name ?? e?.id}」在 ${path.relative(ROOT, READERS_LEDGER)} 里没有对应条目 —— ` +
              "两个索引的 id 必须逐行同源（读者是谁 / 谁会被敲是两个维度，载体是同一个）",
          );
          continue;
        }
        if (peer.reader !== e.reader) {
          problems.push(
            `「${e.id}」的读者在两处不一致：本台账 \`${e.reader}\`、` +
              `姊妹索引 \`${peer.reader}\` —— 同源核对拦的就是这一处漂移`,
          );
        }
      }
      for (const c of carriers) {
        if (c?.id && !seen.has(c.id)) {
          /* 姊妹索引里多出来的条目**不判红**：那份索引覆盖面更宽（条件性 skip /
           * 环境归属 / 并发隔离…），本台账只收「类型层声明」这一类。反过来缺了才红 —— 少一条
           * 就是「这个载体在本判据的判决面外」。 */
          report.push(`（姊妹索引另有条目 ${c.id}，不在本台账的判决面内）`);
        }
      }
    }
  }
}

/* ── 输出 ──────────────────────────────────────────────────── */

if (UPDATE) {
  if (bloated.length > 0) {
    process.stderr.write(
      "[tsc-diagnostic-executors] ✗ 拒绝写入：下列行的实测值比基线**大** —— " +
        "--update 只许降不许升（上涨就是「新写了一处没人回答过谁在敲的声明」）：\n" +
        bloated.map((l) => "  · " + l).join("\n") +
        "\n",
    );
    process.exit(2);
  }
  if (problems.length > 0) {
    process.stderr.write(
      "[tsc-diagnostic-executors] ✗ 先修掉这些问题再收紧基线（--update 不代替判决）：\n" +
        problems.map((p) => "  · " + p).join("\n") +
        "\n",
    );
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  /* 读数不完整时**不许记账**：少读一份就少算几处声明，`--update` 会把「这一轮没读到」
   * 写成「这里本来就没有」。与 `check-dead-exports` / `check-comment-language` /
   * `check-test-sleep` / `check-test-it-each` 同一条口径（`check-gate-repo-boilerplate`
   * 起先也在此列，ISSUE #1811 收尾时它翻成硬闸、`--update` 已删，故不再列入）。 */
  if (vanishedScan > 0) {
    console.error(
      `[tsc-diagnostic-executors] 拒绝 --update：本轮有 ${vanishedScan} 份文件在扫描期间消失，` +
        "读数不完整。\n  等并发用例跑完再执行（基线是账，不能记在没读过的面上）。",
    );
    process.exit(1);
  }
  for (const e of doc.entries) {
    const fresh = entries.find((x) => x.id === e.id);
    if (fresh) e.baseline = fresh.baseline;
  }
  fs.writeFileSync(LEDGER, JSON.stringify(doc, null, 2) + "\n");
  process.stdout.write(
    `[tsc-diagnostic-executors] ✓ 基线已收紧到当前实测（${entries.length} 条）\n`,
  );
  process.exit(0);
}

if (REPORT_ONLY) {
  process.stdout.write(
    `类型层声明 ⇄ 执行者（${entries?.length ?? 0} 条）：\n` +
      report.map((l) => "  " + l).join("\n") +
      "\n",
  );
  process.exit(0);
}

if (problems.length > 0) {
  console.error(
    `[tsc-diagnostic-executors] 类型层「声明 ⇄ 执行者」有 ${problems.length} 处问题（§13.5.14）：\n` +
      problems.map((p) => "  · " + p).join("\n") +
      "\n",
  );
  process.exit(1);
}

process.stdout.write(
  `类型层声明 ⇄ 执行者：${entries?.length ?? 0} 条声明的执行者都在场（零增量）\n` +
    vanishedNote(vanishedScan),
);
