#!/usr/bin/env node
/**
 * check-comment-headers.mjs — 「向平台写文字开头一行署名」这条约定的**只读审计**（ISSUE #2269）。
 *
 * ── 这一格为什么要有执行者 ──────────────────────────────────────────
 *
 * 署名那一行（`**[评论人：<短名>]**`，#2217 立、AGENTS 硬规则 14 / 规范 §13.10.10）由
 * `ship` 的四条出口保证（`withCommentHeader`，#2268 收成「有且只有一行」）。但约定写在
 * 正文里，而**没有任何一处能回答「现在哪些文字没照做」**：手工
 * `cnb issues create-issue --body-file …` 那一路不过 `ship`，#2217 之前建的存量也不经过它。
 * 当场读数（2026-10-23，扫 open 单子全部 21 张的正文首行）：**缺 19 · 重复 1 · 正常 1**。
 *
 * 这就是「在册 ≠ 出勤」那一型（#2114：五派发零跑完期间账面全绿）—— 判据在场、执行者不在场，
 * 而失效形态是**读者以为那串字是本人写的**。本脚本补的是「看得见」那一半。
 *
 * ── 三条口径 ────────────────────────────────────────────────────────
 *
 *   ① **只读**：一次写动作都没有。回填是改别人建的单子正文（共享面写动作），
 *      由人点名，不在这里自动做；
 *   ② **三态**：`0` 全在场 / `1` 有缺、重复或不在首行 / `2` **没读到读数**
 *      （`cnb` 不在、列表取不到）。把 `2` 并进「绿」等于宣布审过，而事实是没审
 *      （与 `check:daily-attendance` 同口径）；
 *   ③ **单张读不到 ≠ 缺**：某张 `get-issue` 失败时记进「读不到」那一档，不改判成缺，
 *      也不因此变红 —— 「拿不到测量」与「测量结果是红的」是两件事。
 *
 * 成本：一次列表 + **每张 open 对象一次 `get-*`**（单子 `get-issue`、PR `get-pull`；
 *       默认只扫第 1 页 open 单，`--pages` 可调）。PR 那一侧**不能**省成列表带回来的
 *       `body` —— 列表形态里那个键是空串，见 `collectShapes` 里那段（ISSUE #2788）。
 *       走网络 ⇒ **不进钩子**，登记在 `scripts/.gate-executor-ledger.json` 的按需台账。
 *
 * 用法：
 *   pnpm check:comment-headers                 # 人读清单
 *   node scripts/check-comment-headers.mjs --json    # 机器可读
 *   node scripts/check-comment-headers.mjs --pages 2 # 多扫一页 open 单
 */
import path from "node:path";
import process from "node:process";

import { CODE, parseSlug } from "./ship-core.mjs";
import { cnbJson, makeRunner } from "./ship-exec.mjs";
import { headerShape } from "./ship-ticket.mjs";

const SHADES = ["正常", "缺", "重复", "不在首行", "读不到"];

/** 平台列表信封的两种形状都收（数组 / `data.data` 嵌套）。 */
/** @param {any} json @returns {any[]} */
function asList(json) {
  const raw = json?.data;
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw?.data)) {
    return raw.data;
  }
  return [];
}

/**
 * 扫 open 单子与 open PR 的正文署名形状。
 *
 * @param {{run:(cmd:string,args:string[])=>any, slug:string, pages?:number, pageSize?:number}} ctx
 * @returns {{ran:boolean, rows:{kind:string,number:string,title:string,shape:string}[]}}
 *   `ran=false` 表示**一次列表都没读到**（那是「没审」，不是「审过且干净」）
 */
export function collectShapes(ctx) {
  const { run, slug, pages = 1, pageSize = 30 } = ctx;
  /** @type {{kind:string,number:string,title:string,shape:string}[]} */
  const rows = [];
  let ran = false;
  for (let p = 1; p <= pages; p += 1) {
    const got = cnbJson(run, [
      "issues",
      "list-issues",
      "--repo",
      slug,
      "--state",
      "open",
      "--page",
      String(p),
      "--page-size",
      String(pageSize),
      "-v",
    ]);
    if (!got) {
      break;
    }
    ran = true;
    const list = asList(got.json);
    for (const item of list) {
      const number = String(item?.number ?? "");
      if (!number) {
        continue;
      }
      const one = cnbJson(run, ["issues", "get-issue", "--repo", slug, "--number", number, "-v"]);
      const body = one?.json?.data?.body;
      rows.push({
        kind: "单",
        number,
        title: String(item?.title ?? ""),
        /* 单张读不到时不判「缺」—— 那是「没拿到测量」，另一档。 */
        shape: typeof body === "string" ? headerShape(body) : "读不到",
      });
    }
    if (list.length < pageSize) {
      break;
    }
  }
  const pulls = cnbJson(run, ["pulls", "list-pulls", "--repo", slug, "--state", "open", "-v"]);
  if (pulls) {
    ran = true;
    for (const item of asList(pulls.json)) {
      const number = String(item?.number ?? "");
      if (!number) {
        continue;
      }
      /* 正文**逐张 `get-pull` 取**，与上面单子那一侧同一个形状。
       *
       * 曾经这里直接用 `list-pulls` 带回来的 `item.body`，理由是「PR 列表自带 `body`
       * （实测字段表里有）」—— 那句**半真**：键在、类型是 string，而列表形态里它的值是
       * **空串**（ISSUE #2788 实测四张 open PR 全为 0 长度，同几张 `get-pull` 有正文）。
       * 于是 `typeof body === "string"` 守卫放行，`headerShape("")` 给「缺」⇒
       * **每一条 open PR 都被判成缺署名**，与本单自己口径 ③（「读不到 ≠ 缺」）相反，
       * 而下面那句 `shape !== "读不到"` 把这份假阳性一路带进退码（红）。
       * 「字段存在」不等于「字段有值」—— 拿缺字段当结论是这一族反复在收的形状。 */
      const one = cnbJson(run, ["pulls", "get-pull", "--repo", slug, "--number", number, "-v"]);
      const body = one?.json?.data?.body;
      rows.push({
        kind: "PR",
        number,
        title: String(item?.title ?? ""),
        /* 读不到 ⇒ 「读不到」那一档，不判成缺、也不因此变红（与单子那一侧同口径）。 */
        shape: typeof body === "string" ? headerShape(body) : "读不到",
      });
    }
  }
  return { ran, rows };
}

/**
 * 主流程：念清单 + 给三态码。
 *
 * @param {{run?:(cmd:string,args:string[])=>any, log?:(s:string)=>void, slug?:string|null, pages?:number, pageSize?:number, json?:boolean}} [deps]
 * @returns {number} 0 / 1 / 2
 */
export function main(deps = {}) {
  const log = deps.log ?? ((/** @type {string} */ s) => process.stdout.write(`${s}\n`));
  const run = deps.run ?? makeRunner(process.cwd());
  const slug = deps.slug ?? parseSlug(run("git", ["remote", "get-url", "origin"]).stdout);
  if (!slug) {
    log("[header-audit] 取不到仓库 slug（不是 git 检出 / 没有 origin）⇒ 这一格没审，退 2");
    return CODE.NOT_RUN;
  }
  const { ran, rows } = collectShapes({
    run,
    slug,
    pages: deps.pages,
    pageSize: deps.pageSize,
  });
  if (!ran) {
    log(
      "[header-audit] 平台列表一次都没读到（cnb 不在 / 输出不是 JSON）⇒ **不构成「已审过且干净」**，退 2",
    );
    return CODE.NOT_RUN;
  }
  /** @type {Record<string, number>} */
  const tally = {};
  for (const r of rows) {
    tally[r.shape] = (tally[r.shape] ?? 0) + 1;
  }
  const bad = rows.filter((r) => r.shape !== "正常");
  if (deps.json) {
    /* `--json` 只发一份 JSON 文档：再追一行人类读的总结，机器侧 `JSON.parse`
     * 就会撞上「尾部有多余内容」，而那种失败看起来像数据坏了，不像我打印多了。 */
    log(JSON.stringify({ total: rows.length, tally, rows: bad }, null, 2));
  } else {
    for (const r of bad) {
      log(`[${r.shape}] ${r.kind} #${r.number} ${r.title.slice(0, 46)}`);
    }
    const unreadable = tally["读不到"] ?? 0;
    log(
      `[header-audit] 样本 ${rows.length} 条：${
        SHADES.filter((s) => (tally[s] ?? 0) > 0)
          .map((s) => `${s} ${tally[s]}`)
          .join(" · ")
        }${unreadable > 0 ? "（「读不到」不判成「缺」，也不因此变红）" : ""}`,
    );
  }
  return bad.some((r) => r.shape !== "读不到") ? CODE.RED : CODE.GREEN;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--pages");
  process.exit(
    main({
      pages: pi > -1 ? Number(argv[pi + 1]) || 1 : 1,
      json: argv.includes("--json"),
    }),
  );
}
