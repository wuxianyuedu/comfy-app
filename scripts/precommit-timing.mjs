#!/usr/bin/env node
/**
 * precommit-timing.mjs — pre-commit 每次跑了多久的**本机账**（规范 §13.5.8.3）。
 *
 * ── 为什么要有它 ─────────────────────────────────────────────────────────
 *
 * §13.5.8 / §13.5.8.1 / §13.5.8.2 已经把「哪一步贵、贵多少、哪条杠杆走得通」
 * 量过很多遍，但那些读数**全是**在议题讨论里一次性测量出来的，写完就冻在文档里。
 * 于是两件事没人回答：
 *
 *   ① 「**我这台机器上**，刚才那一次提交到底花了多久」—— 实测已经反复证明时间随
 *      机器负载成比例放大（§13.5.8.1 那张表：C 组 19.7s → 229s），别人机器上的
 *      数字推不出你这一台；
 *   ② 「**上一次**慢在哪一步」—— 钩子只把每组的一行 `[ok]` 摘要打出来，逐步骤的
 *      时长只有跑的人在滚动输出里瞄一眼，**跑完就没了**。
 *
 * 所以这里做的事只有一件：把每一次 pre-commit 的墙钟**留下来**，并给出翻看它的入口。
 *
 * ── 为什么不入库、也不放 `log/` ──────────────────────────────────────────
 *
 * 与 `scripts/premerge-proof.mjs` 的 `comfy-premerge-proof.json` **同一个理由**：
 * 它记的是「**这台检出**这一次提交的耗时」。写进版本库的话，同仓的并行检出会互相
 * 污染（A 的读数变成 B 的账），而「哪次慢」这个问题本来就只有问本机才有意义。
 * 也不放 `log/`：那是**应用运行期**的日志布局（§4「固定写点 + 一次一包」，
 * 归启动编排者），与开发者机器上的钩子耗时不是同一件事。
 *
 * 落在 `.git/comfy-precommit-timing.jsonl`（JSONL，一次一行，追加写）。
 *
 * ── 它不是门禁 ───────────────────────────────────────────────────────────
 *
 * **只记账、不阻断、不判任何东西**（同 §13.5.8.2 对「提示 vs 阻断」的边界）：
 * 记账自己失败（磁盘满 / 文件被锁）只往 stderr 打一行，**绝不影响提交的退出码** ——
 * 一条记账线路变成提交的必经之路，迟早会有人为了它 `--no-verify`。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────────
 *
 * 记账侧由 `.githooks/pre-commit` 调用（人不手敲）：子命令 `record` 收一组
 * `--total-ms` / `--exit` / `--staged` 标量与成对的 `--group <id>=<ms>`、
 * `--step <标签>=<ms>`。
 *
 * 读账侧（人看）四种形态：裸跑打最近 10 次的表；`--last N` 看更多；
 * `--json` 给机器可读的原始记录；`--clear` 清空账本。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveGitDir } from "./git-dir.mjs";

/**
 * 读目录时用到的那两个 fs 动作（薄壳，不是 `typeof fs`）。
 *
 * 为什么本模块**没有**因为多了一个 import 就突然要补这几处类型：`noUncheckedIndexedAccess`
 * 开着，而下标取值的 `| undefined` 在「只被 node 直接执行」的文件里从不进 tsc 的图 ——
 * 现在 `run-affected-tests.mjs` import 了本模块（布局常量只许有一份），它就跟其余
 * 提交门槛脚本一样进了判决面，那几处**一直存在**的空位当场显形。修法按语义补，
 * 不是 `@ts-nocheck` 蒙过去。
 *
 * @typedef {{
 *   readdirSync: (dir: string) => string[],
 *   readFileSync: (file: string, encoding?: string) => string,
 * }} FsView
 */

/** @type {FsView} */
const realFs = {
  readdirSync: (dir) => fs.readdirSync(dir).map(String),
  /* 编码**固定 utf8**，不跟着入参走：`fs.readFileSync` 的重载要的是 `BufferEncoding`
   * 而不是任意 string（接缝上收的是「读文本」这件事，不是编码开关）。 */
  readFileSync: (file) => fs.readFileSync(file, "utf8"),
};

const LEDGER_NAME = "comfy-precommit-timing.jsonl";

/** 默认看最近多少次。与钩子的节奏（一天几十次提交）比，10 次是「一眼能读完」的一屏。 */
const DEFAULT_LAST = 10;

/**
 * 组 C 分文件读数的**落盘布局**（本模块是账本布局的所有者，写的一侧 import 这里）。
 *
 * 为什么要有出处：清单文件名与 junit 前缀各有两个读者/写者（`run-affected-tests.mjs`
 * 写、本模块读），抄成两份字面量的漂移形态是静默的 —— 改名那一侧照常跑、另一侧
 * 从此读不到，而「读不到」在这里长得和「这次没有读数」一模一样（§13.5.8.3 那句
 * 「判据只落形态」讲的正是这种）。
 */
export const C_FILES_PREFIX = "comfy-c-";
/** 这次真正要跑的清单（一行一个路径）—— 分文件读数的**分母**，缺它就没有对账。 */
export const C_MANIFEST_NAME = "comfy-c-files.txt";

/**
 * 一块 / 一遍的 junit 落点名。`attempt`：1 = 首跑（与三个组抢核），2 = 隔离复跑。
 *
 * @param {string} dir
 * @param {number} chunkId
 * @param {number} attempt
 * @returns {string}
 */
export function cFileXmlName(dir, chunkId, attempt) {
  return path.join(dir, `${C_FILES_PREFIX}${chunkId}-${attempt}.xml`);
}

// ── 账本位置 ────────────────────────────────────────────────────────────

/* 「本检出的 `.git` 在哪」不在这里实现了 —— 那份正确的（走
 * `rev-parse --absolute-git-dir`，覆盖 worktree 指针 / `GIT_DIR` / 裸仓库三种形态）
 * 已收进 `scripts/git-dir.mjs`，本文件按它真实的落点 import。
 * 原处不留转口：留一个「看起来还在这儿」的再导出，下一次就有人 import 那一层空的。 */

/**
 * @param {string | null} gitDir
 * @returns {string | null}
 */
function ledgerPath(gitDir) {
  return gitDir ? path.join(gitDir, LEDGER_NAME) : null;
}

// ── 记账 ────────────────────────────────────────────────────────────────

/**
 * `--group A=3500` / `--step '标签=820'` 的解析。
 *
 * 两种形态同源，因为它们在钩子里确实是同一种东西（一条带名字的耗时）。解析只做
 * 「最后一段 `=` 切开」：标签里可以带 `=`（`A=1=2` 不是场景，但**标签里带括号与
 * 中文是**，所以不能按分隔符乱切）。
 *
 * @param {string[]} pairs
 * @returns {{name: string, ms: number}[]} 解析不出的条目**丢掉并计数**（见 `recordRun`）
 */
export function parseTimings(pairs) {
  /** @type {{name: string, ms: number}[]} */
  const out = [];
  for (const raw of pairs) {
    const at = String(raw).lastIndexOf("=");
    if (at <= 0) {
      continue;
    }
    const name = raw.slice(0, at);
    const ms = Number(raw.slice(at + 1));
    if (!Number.isFinite(ms) || ms < 0) {
      continue;
    }
    out.push({ name, ms: Math.round(ms) });
  }
  return out;
}

/**
 * 追加一条记录。**只追加，不改写历史** —— 账本的价值全在「多次之间的比较」，
 * 一次写入把前面的挤掉等于让它退化成「只有最后一次」。
 *
 * @param {{gitDir: string | null, record: Record<string, unknown>}} input
 * @returns {{ok: boolean, reason?: string}}
 */
export function appendRun({ gitDir, record }) {
  const file = ledgerPath(gitDir);
  if (!file) {
    return { ok: false, reason: "不在 git 检出里" };
  }
  try {
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {string | null} gitDir
 * @returns {Record<string, unknown>[]} 读不出 / 半截行一律跳过（账本的失败代价只是少一行）
 */
export function readRuns(gitDir) {
  const file = ledgerPath(gitDir);
  if (!file) {
    return [];
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* 还没跑过钩子 = 没有账本；这不是错误。 */
    return [];
  }
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        out.push(parsed);
      }
    } catch {
      /* 半截行（上一次写入被 Ctrl-C 打断）不构成一条记录。 */
    }
  }
  return out;
}

// ── 读账 ────────────────────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} run
 * @returns {{name: string, ms: number}[]}
 */
function stepsOf(run) {
  const steps = run.steps;
  return Array.isArray(steps)
    ? steps
        .filter((s) => s && typeof s.name === "string")
        .map((s) => ({
          name: String(s.name),
          ms: Number(s.ms) || 0,
        }))
    : [];
}

/**
 * @param {Record<string, unknown>} run
 * @returns {{name: string, ms: number}[]}
 */
function groupsOf(run) {
  const groups = run.groups;
  return Array.isArray(groups)
    ? groups
        .filter((g) => g && typeof g.name === "string")
        .map((g) => ({
          name: String(g.name),
          ms: Number(g.ms) || 0,
        }))
    : [];
}

/**
 * 内层 `<testsuite …>` 标签（一个用例文件一条）。
 *
 * 单独抽出来是为了让「**谁**失败了」与「每个文件多久」共用同一份形状知识：这两件事读的是
 * 同一个标签，各自写一遍正则的话，改了外层 `testsuites` 的排除条件只会修到一半 ——
 * 而漏的那一半表现为「把汇总当成一个文件」，是个看起来像读数的假象而不是错误。
 *
 * @param {string} xml
 * @returns {string[]} 原始标签文本
 */
function suiteTags(xml) {
  return [...String(xml).matchAll(/<testsuite\b[^>]*>/g)].map((m) => m[0]);
}

/**
 * 一份 vitest junit XML → 每个用例文件的耗时。
 *
 * 形状是按 vitest 5.0.3 的实际输出定的，不是猜的：外层 `<testsuites name="vitest tests">`
 * 是汇总（它的 `time` 是各 suite 之和，**不是墙钟**），每个文件是一个内层
 * `<testsuite name="tests/x.test.ts" … time="0.33">`。所以这里只取内层，且
 * `<testsuite\b` 这个词边界恰好挡掉外层那个 `testsuites`（少一个 `\b` 就会把汇总当文件）。
 *
 * `time` 的单位是**秒**（浮点），转成 ms 与账本里其它读数同刻度 —— 两份刻度并排摆出来
 * 就是「哪个数是什么单位」重新变成一个问题（§13.5.8.3 里时钟那一段的同一条理由）。
 *
 * @param {string} xml
 * @returns {{name: string, ms: number}[]} 解析不出的 suite 跳过（调用方计数）
 */
export function parseJunitXml(xml) {
  /** @type {{name: string, ms: number}[]} */
  const out = [];
  for (const tag of suiteTags(xml)) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const time = /\btime="([^"]*)"/.exec(tag)?.[1];
    if (!name || time === undefined) {
      continue;
    }
    const secs = Number(time);
    if (!Number.isFinite(secs) || secs < 0) {
      continue;
    }
    out.push({ name, ms: Math.round(secs * 1000) });
  }
  return out;
}

/**
 * 一份 vitest junit XML → **失败过**的用例文件名（`failures` 或 `errors` 不为 0）。
 *
 * 唯一的消费者是组 C 的隔离复跑：那里要回答「第二遍该重跑哪几份」。整块重跑的版本让
 * 一份带超时指纹的文件拖着一百多份一起串行再跑一遍（实测把组 C 推到 1411s，
 * 而整条钩子的时长几乎全是这一格）—— 见 `scripts/run-affected-tests.mjs` 的 `retryScope`。
 *
 * 读不出来的那份（属性缺失 / 不是数字）**不算失败**：这一格的用途是缩小复跑面，
 * 而「解析不出 ⇒ 当作失败 ⇒ 复跑面变大」是安全方向；反过来漏一份真失败的文件
 * 才是不能接受的，所以调用方在**结果为空**时必须退回整块（那条口径写在调用点）。
 *
 * @param {string} xml
 * @returns {string[]} 失败的用例文件路径（与 junit 里的 `name` 同形态）
 */
export function failingSuitesFromJunit(xml) {
  /** @type {string[]} */
  const out = [];
  for (const tag of suiteTags(xml)) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (!name) {
      continue;
    }
    const bad = ["failures", "errors"].some((key) => {
      const raw = new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
      const n = Number(raw);
      return raw !== undefined && Number.isFinite(n) && n > 0;
    });
    if (bad) {
      out.push(name);
    }
  }
  return out;
}

/**
 * 一份 vitest junit XML → **失败过的**用例文件，连它们各自的失败文本一起。
 *
 * 与上面那条同源、只多带一份 `body`：`failingSuitesFromJunit` 回答「复跑该跑哪几份」，
 * 这一条回答「第 2 遍里，**哪一份**是超时、**哪一份**是断言红」（ISSUE #2225）。
 * 判决粒度必须能与取数粒度对齐，否则一份超时会把同块里别人的真红一起吞掉 ——
 * 那份吞掉表现为退出码 0，而没有任何一条红指向它。
 *
 * `body` 取的是「这个开标签之后、到下一个 `<testsuite` 或 `</testsuite>` 之前」那一段：
 * vitest 的失败文本落在 `<testcase>` 的子里，而 `<testcase>` 不截断这一段 ⇒ 一并拿到。
 * 形状按 vitest 5.0.3 的实际输出定（每个文件一个内层 `<testsuite>`，没有再嵌套一层）；
 * 形状变了最坏是 `body` 短了，把那份读成「认不出」，不会把真红读成超时。
 *
 * @param {string} xml
 * @returns {{name: string, body: string}[]} 属性读不出失败的 suite 不在这里
 */
export function failingSuiteTextsFromJunit(xml) {
  const text = String(xml ?? "");
  /** @type {{name: string, body: string}[]} */
  const out = [];
  const openRe = /<testsuite\b[^>]*>/g;
  for (let m = openRe.exec(text); m !== null; m = openRe.exec(text)) {
    const tag = m[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (!name) {
      continue;
    }
    const bad = ["failures", "errors"].some((key) => {
      const raw = new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
      const n = Number(raw);
      return raw !== undefined && Number.isFinite(n) && n > 0;
    });
    if (!bad) {
      continue;
    }
    const nextOpen = text.indexOf("<testsuite", openRe.lastIndex);
    const nextClose = text.indexOf("</testsuite>", openRe.lastIndex);
    const stops = [nextOpen, nextClose].filter((i) => i !== -1);
    const end = stops.length === 0 ? text.length : Math.min(...stops);
    out.push({ name, body: text.slice(openRe.lastIndex, end) });
  }
  return out;
}

/**
 * 把账本目录里的分文件读数收成一份。
 *
 * 合并规则按 **(块, 遍) 升序**，后写的覆盖先写的 —— 于是第 2 遍（`--no-file-parallelism`
 * 的隔离复跑）赢。这不是排版偏好：首跑那组数是在「与三个组抢核」的条件下测的，
 * 拿它冒充「这个文件有多贵」会把负载读成文件自己的成本（§13.6.4 那一族）。
 *
 * 对账那一格（`expected` / `missing`）是这份读数**能不能被拿来砍线**的前提：
 * junit 里少一份，与「这次清单就是少一份」在数字上逐字同形，而前者是那两份文件
 * **一次都没被计时**。所以缺多少必须说出来，不能只打表。
 *
 * @param {{dir: string, fsLike?: FsView}} input
 * @returns {{files: {name: string, ms: number}[], expected: number, missing: number, dropped: number}}
 */
export function collectFileTimings({ dir, fsLike = realFs }) {
  /** @type {Map<string, number>} */
  const byName = new Map();
  let dropped = 0;
  let names;
  try {
    names = fsLike.readdirSync(dir);
  } catch {
    return { files: [], expected: 0, missing: 0, dropped: 0 };
  }
  const xmls = names
    .filter((n) => n.startsWith(C_FILES_PREFIX) && n.endsWith(".xml"))
    .sort((a, b) => {
      const pa = new RegExp(`^${C_FILES_PREFIX}(\\d+)-(\\d+)\\.xml$`).exec(a);
      const pb = new RegExp(`^${C_FILES_PREFIX}(\\d+)-(\\d+)\\.xml$`).exec(b);
      if (!pa || !pb) {
        return a < b ? -1 : 1;
      }
      return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
    });
  for (const file of xmls) {
    let text;
    try {
      text = fsLike.readFileSync(path.join(dir, file), "utf8");
    } catch {
      dropped += 1;
      continue;
    }
    const entries = parseJunitXml(text);
    if (entries.length === 0) {
      dropped += 1;
    }
    for (const e of entries) {
      byName.set(e.name, e.ms);
    }
  }
  const files = [...byName.entries()].map(([name, ms]) => ({ name, ms }));
  /* 清单读不到 ⇒ `expected = 0`，而**不是**「等于取到读数的份数」。
   * 「拿不到结论」与「结论是一致」必须分开（§13.5.20 那条空清单同口径）。 */
  let expected;
  try {
    expected = fsLike
      .readFileSync(path.join(dir, C_MANIFEST_NAME), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean).length;
  } catch {
    expected = 0;
  }
  const missing = expected > 0 ? Math.max(0, expected - byName.size) : 0;
  return { files, expected, missing, dropped };
}

/**
 * 「哪一步最贵」要跨多次比，所以取的是**中位数**而不是平均：单次读数受负载与
 * 冷缓存影响极大（§13.5.8.1 那张表同一份代码 19.7s → 229s），平均会被一个离群值
 * 拉走，中位数回答的是「通常多少」。
 *
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  /* 下标取值在这里会是 `number | undefined`（`noUncheckedIndexedAccess`）—— 上面那条
   * `length === 0` 早退保证了 `mid < length`，但类型看不出来。收成 0 而不是断言：
   * 真取空时中位数退化成一个可读的 0，比在记账线路里抛出来好（记账不阻断）。 */
  const upper = sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? upper;
  return sorted.length % 2 === 1 ? upper : Math.round((lower + upper) / 2);
}

/**
 * @param {number} ms
 * @returns {string}
 */
function secs(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

/**
 * 账本 → 人读的文本。**渲染与数据分开**（`--json` 走上面那几个函数，不走这里），
 * 免得「给机器看的形状」被排版改动牵着走。
 *
 * @param {Record<string, unknown>[]} runs
 * @param {{last?: number}} [opts]
 * @returns {string}
 */
export function formatReport(runs, opts = {}) {
  const last = opts.last ?? DEFAULT_LAST;
  if (runs.length === 0) {
    return "[precommit-timing] 还没有记录 —— 提交一次就会有一条（账本在 .git/，本机、不入库）。\n";
  }
  const shown = runs.slice(-last);
  const lines = [
    `[precommit-timing] 最近 ${shown.length} 次（共 ${runs.length} 条；账本 .git/${LEDGER_NAME}，本机、不入库）`,
    "",
  ];

  const totals = shown.map((r) => Number(r.totalMs) || 0);
  lines.push(
    `  总时长：中位数 ${secs(median(totals))}　最快 ${secs(Math.min(...totals))}　最慢 ${secs(Math.max(...totals))}`,
  );
  lines.push("");
  lines.push("  逐次（新 → 旧）：");
  for (const run of [...shown].reverse()) {
    const at = String(run.at ?? "?")
      .replace("T", " ")
      .slice(0, 19);
    const staged = Number(run.stagedFiles) || 0;
    const code = Number(run.exitCode) || 0;
    const groups = groupsOf(run)
      .map((g) => `${g.name} ${secs(g.ms)}`)
      .join(" · ");
    lines.push(
      `    ${at}  ${secs(Number(run.totalMs) || 0).padStart(7)}  ` +
        `${code === 0 ? "绿" : `红(${code})`}  ${staged} 个文件  ${groups}`,
    );
  }

  /* 各步中位数：把「每次都不便宜」与「偶尔抽一下」分开。只打有记录的步骤，
   * 而**不打全部 51 步** —— 一屏读不完的表等于没人读。 */
  /** @type {Map<string, number[]>} */
  const byStep = new Map();
  /** @type {Map<string, number[]>} */
  const byGroup = new Map();
  for (const run of shown) {
    for (const s of stepsOf(run)) {
      byStep.set(s.name, [...(byStep.get(s.name) ?? []), s.ms]);
    }
    for (const g of groupsOf(run)) {
      byGroup.set(g.name, [...(byGroup.get(g.name) ?? []), g.ms]);
    }
  }
  if (byGroup.size > 0) {
    lines.push("");
    lines.push("  各组（中位数）：");
    for (const [name, values] of [...byGroup.entries()].sort(
      (a, b) => median(b[1]) - median(a[1]),
    )) {
      lines.push(`    组 ${name}  ${secs(median(values)).padStart(7)}`);
    }
  }
  if (byStep.size > 0) {
    const ranked = [...byStep.entries()]
      .map(([name, values]) => ({ name, ms: median(values), n: values.length }))
      .sort((a, b) => b.ms - a.ms);
    lines.push("");
    lines.push(`  D 组各步（中位数，前 ${Math.min(10, ranked.length)} 名）：`);
    for (const step of ranked.slice(0, 10)) {
      lines.push(
        `    ${secs(step.ms).padStart(7)}  ${step.name}${step.n < shown.length ? `（${step.n}/${shown.length} 次有记录）` : ""}`,
      );
    }
  }
  /* ── 组 C 的分文件读数 ────────────────────────────────────────────────
   * 这张表是**砍线的依据**，所以它必须自带分母与对账，否则它就是另一个「看起来有数
   * 其实没法比」的中位数表（§13.5.8.2.1 那句「记账自己的开销也要量，它会冒充判据的
   * 成本」是同一条纪律的另一半）。 */
  /** @type {Map<string, number[]>} */
  const byFile = new Map();
  let filesSeen = 0;
  for (const run of shown) {
    const arr = Array.isArray(run.files) ? run.files : [];
    filesSeen = Math.max(filesSeen, arr.length);
    for (const f of arr) {
      if (!f || typeof f.name !== "string") {
        continue;
      }
      byFile.set(f.name, [...(byFile.get(f.name) ?? []), Number(f.ms) || 0]);
    }
  }
  if (byFile.size > 0) {
    const ranked = [...byFile.entries()]
      .map(([name, values]) => ({ name, ms: median(values), n: values.length }))
      .sort((a, b) => b.ms - a.ms);
    const lastRun = shown.at(-1) ?? {};
    const expected = Number(lastRun.filesExpected) || 0;
    const missing = Number(lastRun.filesMissing) || 0;
    const cGroup = groupsOf(lastRun).find((g) => g.name === "C");
    const sumMs = ranked.reduce((s, r) => s + median(byFile.get(r.name) ?? []), 0);
    lines.push("");
    lines.push(
      `  组 C 各文件（中位数，前 ${Math.min(10, ranked.length)} 名；` +
        `共 ${ranked.length} 份有读数${
        expected > 0 ? ` / 清单 ${expected} 份` : ""
        }${missing > 0 ? `，缺 ${missing} 份**没有读数 —— 不是 0 秒**` : ""
        }）：`,
    );
    for (const f of ranked.slice(0, 10)) {
      lines.push(
        `    ${secs(f.ms).padStart(7)}  ${f.name}${f.n < shown.length ? `（${f.n}/${shown.length} 次有记录）` : ""}`,
      );
    }
    if (cGroup) {
      lines.push(
        `    对账（最近一次）：分文件之和 ${secs(sumMs)} ⇄ 组 C 墙钟 ${secs(cGroup.ms)} —— ` +
          `差 ${secs(Math.max(0, cGroup.ms - sumMs))} 是 vitest 启动 + 收集/transform + ` +
          "worker 拉起（junit 的 time 只算测试阶段），所以这张表用来**排序**，不能当墙钟",
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────

/**
 * `--flag value` / `--flag=value` 两种写法都收（钩子里拼的是前者，人敲的多半是后者）。
 *
 * @param {string[]} argv
 * @param {string} name
 * @returns {string[]}
 */
function collect(argv, name) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    /* 下标取值在 `noUncheckedIndexedAccess` 下是 `string | undefined`。这里按「取不到
     * 就当没有这一格」处理而不是断言 —— 与文件头那条同口径：记账线路**不阻断**提交，
     * 参数形状读不出只是少一格账，抛出来才是把记账变成了必经之路。 */
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === name) {
      const next = argv[i + 1];
      if (next !== undefined) {
        out.push(next);
      }
      i += 1;
    } else if (arg.startsWith(`${name}=`)) {
      out.push(arg.slice(name.length + 1));
    }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function value(argv, name) {
  return collect(argv, name).at(-1);
}

/**
 * 裸开关（`--clear` / `--json`）。与 `collect` 分开：那两个带值，用 `collect` 判
 * 会把「键在、值空」当成「键不在」。
 *
 * @param {string[]} argv
 * @param {string} name
 * @returns {boolean}
 */
function flag(argv, name) {
  return argv.includes(name) || argv.some((a) => a.startsWith(`${name}=`));
}

/**
 * 记账入口。返回值是**退出码**，但只有「连一条记录都没写进去」时才是非零，
 * 且调用方（钩子）**刻意不看它** —— 见文件头「它不是门禁」。
 *
 * @param {string[]} argv
 * @param {string} [cwd]
 * @returns {number}
 */
export function recordRun(argv, cwd = process.cwd()) {
  const gitDir = resolveGitDir(cwd);
  const groups = parseTimings(collect(argv, "--group"));
  const steps = parseTimings(collect(argv, "--step"));
  const declared = collect(argv, "--group").length + collect(argv, "--step").length;
  const dropped = declared - groups.length - steps.length;
  /* 组 C 的分文件读数：钩子只把**目录**递过来（shell 里解析 XML 会变成第二份实现，
   * 而那正是本钩子刻意不写的东西）。没递目录时这一格是空数组 —— 与「这次跑了但没有
   * 明细」不同形，因为 `filesExpected` 会是 0，报表那一侧照实说「没有清单」。 */
  const junitDir = value(argv, "--junit-dir") ?? "";
  const cRead = junitDir
    ? collectFileTimings({ dir: junitDir })
    : { files: [], expected: 0, missing: 0, dropped: 0 };

  const record = {
    at: new Date().toISOString(),
    totalMs: Math.round(Number(value(argv, "--total-ms")) || 0),
    exitCode: Math.round(Number(value(argv, "--exit")) || 0),
    stagedFiles: Math.round(Number(value(argv, "--staged")) || 0),
    groups,
    steps,
    files: cRead.files,
    filesExpected: cRead.expected,
    filesMissing: cRead.missing,
  };
  const { ok, reason } = appendRun({ gitDir, record });
  if (!ok) {
    /* 记账失败**只是少一行账**，不是提交失败。往 stderr 说一句就够。 */
    process.stderr.write(`[precommit-timing] 本次耗时没能落盘（${reason}）—— 不影响提交。\n`);
    return 0;
  }
  process.stdout.write(
    `[precommit-timing] 已记录本次耗时：总 ${secs(record.totalMs)}（${groups.length} 组 / ${steps.length} 步${
      cRead.files.length > 0 ? ` / 组 C 分文件 ${cRead.files.length} 份` : ""
      }）\n${
      cRead.missing > 0
        ? `[precommit-timing] 组 C 清单 ${cRead.expected} 份里有 ${cRead.missing} 份没给出读数` +
          "（加载即炸 / 被跳过 / reporter 没记上）—— 它们**不是 0 秒**，别按 0 算进砍线\n"
        : ""
      }${cRead.dropped > 0
        ? `[precommit-timing] 有 ${cRead.dropped} 个 junit 读数解析不出，已跳过\n`
        : ""
      }${dropped > 0 ? `[precommit-timing] 有 ${dropped} 条耗时读数解析不出，已跳过\n` : ""}`,
  );
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function viewRun(argv) {
  const gitDir = resolveGitDir(process.cwd());
  if (flag(argv, "--clear")) {
    const file = ledgerPath(gitDir);
    if (!file) {
      process.stderr.write("[precommit-timing] 不在 git 检出里，没有账本可清。\n");
      return 0;
    }
    try {
      fs.rmSync(file);
      process.stdout.write(`[precommit-timing] 已清空 ${file}\n`);
    } catch {
      process.stdout.write("[precommit-timing] 账本本来就不存在，无需清空。\n");
    }
    return 0;
  }
  const runs = readRuns(gitDir);
  if (flag(argv, "--json")) {
    process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    return 0;
  }
  const last = Number(value(argv, "--last")) || DEFAULT_LAST;
  process.stdout.write(formatReport(runs, { last }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  /* `record` 是唯一的子命令，其余一切 argv 都是「看账」的参数 —— 所以**不能**把
   * 第一个位置参数一律当子命令剥掉：`--clear` / `--json` / `--last` 都是看账的开关，
   * 剥掉它们等于「敲了没反应」（第一版就是这么错的）。 */
  const argv = process.argv.slice(2);
  process.exit(argv[0] === "record" ? recordRun(argv.slice(1)) : viewRun(argv));
}
