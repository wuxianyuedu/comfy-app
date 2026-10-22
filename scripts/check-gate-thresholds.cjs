#!/usr/bin/env node
/**
 * check-gate-thresholds.cjs —— 「判据自己的数值」也要有账（ISSUE #2156）
 *
 * ── 为什么要有这一格 ──────────────────────────────────────────
 *
 * `scripts/check-*.cjs` 那几十份判据把「什么算违规」钉在源码里的一批数值上（R5 的 900、函数长度
 * 400、孪生 0.75 / 60…）。而**把这些数值调松，没有任何一格会红**：`check-file-structure.cjs`
 * 判的是「这份文件超没超 900」，不是「这条判据里的 900 还是不是 900」。于是一条只改阈值的
 * PR 本地全绿、CI 全绿、评审一眼看不出来，落进 `master` 之后那道闸对所有人事后失效 ——
 * 而且**没有一条红可查**。本判据把这层「没人看的放宽」变成「必须显形」：
 * 想放宽就得同时改源码与账，两处一起动才不红，而账里那一行会记下**从多少改到多少**。
 *
 * ── 账的形状与「方向逐条记」这条口径 ──────────────────────────
 *
 * 账里有多少条由脚本自己念（跑一次即知，散文里不抄 —— 抄一份就会与判据文件漂移）。三档是
 * **扫出来**才知道的，不是先设想好的：
 *   · `threshold` 阻断阈值：有的越大越松（R5 的 900），有的越大越严（孪生的 `MIN_LINES`）——
 *     所以方向**逐条记**在账里（`strictness`），不按全局符号推；
 *   · `floor` 防静默失效的地板（`MIN_DUTIES` / `MIN_ENTRIES` / `MIN_CHUNKS`…）：**变小**才是危险
 *     （提取坏了退化成「0 条、全绿」），方向与第一档相反；
 *   · `report` 不是松紧量（探测预算、搜索窗口、版本戳）：漂移只报不拦 —— 否则这条判据会因为
 *     一个无关的超时调整而红，那正是逼人去加旁路的头号成因。
 *
 * ── 它判的四件事 + 一件自证 ──────────────────────────────────
 *
 *   1. 账 ⇄ 源码 数值相等（漂移即红，并说出是**变松**还是变严）；
 *   2. 同组必须同数（R5 与 infra 那两把 900 —— 只改一把 = 半边失效）；
 *   3. 这些判据文件里出现、而账里没有的顶层数值 ⇒ 红（不承重的也以 `kind:"report"` 入账：
 *      入账这个动作本身就是那次判断）；
 *   4. 相对主干账变松而未签字（`movedFrom` + `movedIssue`）⇒ 红；
 *   5. 自证：账非空、每条都定位得到 —— 正则写漂会让「比对了 0 条」与「全部一致」长得一样。
 *
 * 用法：node scripts/check-gate-thresholds.cjs [--report|--json]
 * 退出码：0 一致；1 有漂移 / 未入账 / 组内不一致 / 变松未签字；2 账读不到（不构成结论）。
 * `analyze()` 与 IO 分开导出，是为了让「方向反了会不会红」这种判据能被真喂假值测出来
 * （同 `base-check` 那一家：判断是纯函数，效应才碰盘）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const LEDGER_REL = "scripts/.gate-thresholds.json";
/** 自证的下限：账少于这个条数就是提取或账本身坏了，而不是「大家都对齐了」。 */
const MIN_ENTRIES = 15;

/**
 * 顶层具名数值常量：`const NAME = 123;` / `0.75` / `10_000`。
 * 数值分隔写法要一起认，否则账上写 10000 会永远「找不到」；多行表达式不算，也不该入账。
 */
const CONST_DECL =
  /^const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(-?\d[\d_]*(?:\.\d+)?)(?=[;,\s])/gm;

/**
 * 把源码里那串数值（可能带 `_` 分隔）归成数字。
 *
 * @param {string} raw
 * @returns {number}
 */
function num(raw) {
  return Number(String(raw).replace(/_/g, ""));
}

/**
 * 「这一档数值往哪边走算变松」—— 逐条查账里的 `strictness`。
 *
 * @param {{strictness?: string}} entry
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function isLooser(entry, from, to) {
  const s = entry.strictness || "larger-is-looser";
  if (s === "larger-is-looser") return to > from;
  if (s === "larger-is-stricter") return to < from;
  if (s === "smaller-is-looser") return to < from;
  return false;
}

/**
 * 纯判断：喂账、喂「怎么读源码」、喂主干那份账，回问题清单与读数清单。
 *
 * @param {{
 *   entries: any[],
 *   readSource: (file: string) => string | null,
 *   masterEntries?: Map<string, any> | null,
 *   minEntries?: number,
 * }} input
 * @returns {{problems: string[], notes: string[]}}
 */
function analyze({
  entries,
  readSource,
  masterEntries = null,
  minEntries = MIN_ENTRIES,
}) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];

  /**
   * @param {string} file
   * @param {string} name
   * @returns {{value: number, missing?: undefined} | {value?: undefined, missing: string}}
   */
  const sourceValue = (file, name) => {
    const text = readSource(file);
    if (text === null) return { missing: "文件不存在" };
    const re = new RegExp(
      `^const\\s+${name}\\s*=\\s*(-?\\d[\\d_]*(?:\\.\\d+)?)(?=[;,\\s])`,
      "m",
    );
    const raw = re.exec(text)?.[1];
    return raw === undefined
      ? { missing: "源码里找不到该常量声明" }
      : { value: num(raw) };
  };

  const located = entries.filter(
    (e) => sourceValue(e.file, e.const).value !== undefined,
  );

  // 自证：提取本身要真的抓到东西（正则写漂 ⇒ 两侧都空集 ⇒ 恒绿）。
  if (entries.length < minEntries) {
    problems.push(
      `账里只有 ${entries.length} 条（下限 ${minEntries}）⇒ 要么账被清空，要么判据文件被搬走：` +
        "这一格不能按「全部一致」念。",
    );
  } else if (located.length !== entries.length) {
    problems.push(
      `账里 ${entries.length} 条只有 ${located.length} 条在源码里定位得到 —— ` +
        "改名 / 搬文件会让这条判据静默放过它本来要守的那些数。",
    );
  }

  // 1) 账 ⇄ 源码
  for (const e of entries) {
    const got = sourceValue(e.file, e.const);
    if (got.value === undefined) {
      problems.push(
        `${e.file} :: ${e.const} —— ${got.missing}（账上记的是 ${e.value}）`,
      );
      continue;
    }
    if (got.value === e.value) continue;
    const line = `${e.file} :: ${e.const} 源码 ${got.value} ≠ 账 ${e.value}${e.unit ? `（${e.unit}）` : ""}`;
    if (e.kind === "report") {
      notes.push(`${line} —— 这一条是 report（不是松紧量），只报不拦`);
      continue;
    }
    const looser = isLooser(e, e.value, got.value);
    problems.push(
      `${line} ⇒ 源码与账不同步。这次是**${looser ? "变松（放宽判据）" : "变严"}**：` +
        (looser
          ? `要放宽就把账一起改成 ${got.value} 并写 movedFrom / movedIssue —— 让它在 diff 里显形，而不是只动源码`
          : "收紧也要同批改账，否则下一次有人「顺手复原」就没人看得出来"),
    );
  }

  // 2) 同组同数
  /** @type {Map<string, Array<{at: string, value: number}>>} */
  const groups = new Map();
  for (const e of entries) {
    if (!e.group) continue;
    const got = sourceValue(e.file, e.const);
    if (got.value === undefined) continue;
    const list = groups.get(e.group) ?? [];
    list.push({ at: `${e.file}::${e.const}`, value: got.value });
    groups.set(e.group, list);
  }
  for (const [g, list] of groups) {
    const vals = [...new Set(list.map((x) => x.value))];
    if (vals.length > 1) {
      problems.push(
        `组 ${g} 要求同数，实测 ${list.map((x) => `${x.at}=${x.value}`).join(" / ")}` +
          " —— 只改一把尺子 = 半边失效（两个判据会互相说对方错了）。",
      );
    }
  }

  // 3) 未入账的顶层数值
  for (const f of [...new Set(entries.map((e) => e.file))]) {
    const text = readSource(f);
    if (text === null) continue;
    const inLedger = new Set(
      entries.filter((e) => e.file === f).map((e) => e.const),
    );
    for (const m of text.matchAll(CONST_DECL)) {
      if (!inLedger.has(m[1])) {
        problems.push(
          `${f} 里有顶层数值 ${m[1]} 而账上没有 —— 是承重的就入账（threshold / floor），` +
            '不是承重的也以 "kind": "report" 入账：入账这个动作本身就是那次判断。',
        );
      }
    }
  }

  // 4) 相对主干变松要签字
  if (masterEntries) {
    for (const e of entries) {
      const prev = masterEntries.get(`${e.file}#${e.const}`);
      if (!prev || e.kind === "report" || e.value === prev.value) continue;
      if (!isLooser(e, prev.value, e.value)) continue;
      const signed =
        Number(e.movedFrom) === prev.value &&
        /^#\d{2,}$/.test(String(e.movedIssue || ""));
      if (!signed) {
        problems.push(
          `${e.file}#${e.const} 相对主干是**放宽**（${prev.value} → ${e.value}），` +
            '但账上没有签字 —— 写 "movedFrom": ' +
            prev.value +
            ', "movedIssue": "#<issue号>" 再来（放宽判据要有一份说清为什么的单子，不是改个数字）。',
        );
      }
    }
  } else {
    notes.push(
      "主干上还没有这本账 ⇒ 「相对主干放宽要签字」那一判本轮无从比较（不是「已通过」）。",
    );
  }

  return { problems, notes };
}

/**
 * 真实 IO 的那几件：读源码、读本机账、读主干账。
 *
 * @param {string} file 相对仓库根的判据文件
 * @returns {string | null} 读不到（文件不在）时返回 null，由调用方念成「定位不到」
 */
function realReadSource(file) {
  const abs = path.join(ROOT, file);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function readLedger() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, ".gate-thresholds.json"), "utf8"),
  ).entries;
}

/**
 * 主干上那本账（相对放宽的基准）。取不到（首次落地 / 无 origin/master）返回 null，
 * 由 `analyze()` 念成「这一轮无从比较」而不是「这一轮一致」。
 *
 * @returns {Map<string, any> | null}
 */
function masterLedger() {
  try {
    const out = execFileSync("git", ["show", `origin/master:${LEDGER_REL}`], {
      cwd: ROOT,
      encoding: "utf8",
      // stderr 不转发：主干上还没有这本账时 git 会打一行 fatal，那是实现细节不是结论。
      stdio: ["ignore", "pipe", "ignore"],
    });
    /** @type {any[]} */
    const list = JSON.parse(out).entries ?? [];
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const e of list) map.set(`${e.file}#${e.const}`, e);
    return map;
  } catch {
    return null;
  }
}

function main(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const REPORT_ONLY = args.has("--report");
  const AS_JSON = args.has("--json");
  if (!fs.existsSync(path.join(__dirname, ".gate-thresholds.json"))) {
    process.stdout.write(
      `[gate-thresholds] 读不到账 ${LEDGER_REL} ⇒ 这一格没有结论（不是「一致」）\n`,
    );
    return 2;
  }
  let entries;
  try {
    entries = readLedger();
  } catch (e) {
    process.stdout.write(
      `[gate-thresholds] 账解析失败：${e instanceof Error ? e.message : String(e)} ⇒ 不构成结论\n`,
    );
    return 2;
  }
  const { problems, notes } = analyze({
    entries,
    readSource: realReadSource,
    masterEntries: masterLedger(),
  });
  for (const n of notes) process.stdout.write(`[gate-thresholds] ⚠ ${n}\n`);
  if (AS_JSON) {
    process.stdout.write(
      JSON.stringify({ entries: entries.length, problems, notes }, null, 2) +
        "\n",
    );
    return problems.length && !REPORT_ONLY ? 1 : 0;
  }
  if (problems.length === 0) {
    process.stdout.write(
      `[gate-thresholds] ✓ ${entries.length} 条承重数值与账一致（含组内同数与未入账检查）。\n`,
    );
    return 0;
  }
  process.stdout.write(
    `[gate-thresholds] ✗ ${problems.length} 处判据自身的数值与账不一致：\n`,
  );
  for (const p of problems) process.stdout.write(`  · ${p}\n`);
  process.stdout.write(
    `\n账：${LEDGER_REL}（方向逐条记 —— threshold 阻断阈值、floor 防静默失效的地板、report 只报不拦）\n`,
  );
  return REPORT_ONLY ? 0 : 1;
}

module.exports = { analyze, isLooser, num, main, MIN_ENTRIES };

if (require.main === module) process.exit(main());
