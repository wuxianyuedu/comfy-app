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
 *      入账这个动作本身就是那次判断）。**扫描根是磁盘现算的「门禁链按名字调起的判定脚本」
 *      ∪ `scripts/check-*.cjs` 名字族兜底**（ISSUE #2383），不是「账上点名的文件」—— 后者
 *      让整份没进账的新判据永远不被扫（ISSUE #2188 的立案现场）；而"顶层具名"两向都认
 *      `export`（ISSUE #2236：可见性不是承重与否的分界）。
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

const { gateChainScripts } = require("./gate-chain-scripts.cjs");

const ROOT = path.resolve(__dirname, "..");
const LEDGER_REL = "scripts/.gate-thresholds.json";
/** 自证的下限：账少于这个条数就是提取或账本身坏了，而不是「大家都对齐了」。 */
const MIN_ENTRIES = 15;

/**
 * 「顶层具名数值常量」的开头形状 —— **一处定义、两处消费**（下面的 `CONST_DECL` 扫面，
 * 与 `sourceValue()` 按账上点名的那个常量定点取值）。
 *
 * `export` 是**可选前缀**，不是另一件事：一条阈值只要写在这一层，它承不承重与它被不被
 * 别的文件 import 无关。按可见性划覆盖面 = 教下一个人把阈值藏进 `export const` 后面
 * （ISSUE #2236：本仓自己就先撞上过一次 —— 新常量先写成 `export const`，账一个字都没念它，
 * 改成非导出才进得了面）。
 */
const CONST_HEAD = String.raw`^(?:export\s+)?const\s+`;

/**
 * 顶层具名数值常量：`const NAME = 123;` / `export const NAME = 0.75;` / `10_000`。
 * 数值分隔写法要一起认，否则账上写 10000 会永远「找不到」；多行表达式不算，也不该入账。
 * 单行算术表达式（`const X = 7 * 24 * …`）会读到**表达式头上的那个数** —— 这是既定约定
 * 而不是 bug：账上同以「头数」记（unit 写明源码字面），两侧同一把尺（先例：
 * STAGE_WALL_CLOCK_MS 那条，kind 是 report 只报不拦）。
 */
const CONST_DECL = new RegExp(
  `${CONST_HEAD}([A-Z][A-Z0-9_]{2,})\\s*=\\s*(-?\\d[\\d_]*(?:\\.\\d+)?)(?=[;,\\s])`,
  "gm",
);

/**
 * 把源码里那串数值（可能带 `_` 分隔）归成数字。
 *
 * @param {string} raw
 * @returns {number}
 */
function num(raw) {
  return Number(String(raw).replaceAll("_", ""));
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
  if (s === "larger-is-looser") {
    return to > from;
  }
  if (s === "larger-is-stricter") {
    return to < from;
  }
  if (s === "smaller-is-looser") {
    return to < from;
  }
  return false;
}

/**
 * 账里一条的形状。方向记在 `strictness` 上（缺省按「越大越松」），三档口径见文件头。
 *
 * @typedef {{
 *   file: string, const: string, value: number, unit?: string, kind: string,
 *   strictness?: string, group?: string, movedFrom?: number, movedIssue?: string
 * }} GateThreshold
 */

/**
 * 纯判断：喂账、喂「怎么读源码」、喂主干那份账，回问题清单与读数清单。
 *
 * 参数那一行刻意不折行：折成多行之后，`Map<string, GateThreshold>` 这类**类型续行**会脱离
 * JSDoc 结构行的豁免（上一行的 `{{` 让「整段是一个类型块」判不出来），而「注释一律中文」
 * 那条硬闸是按英文虚词表筛的 —— 旧写法里那个 `any` 恰好在表里，于是类型语法被读成一句英文。
 *
 * @param {{entries: GateThreshold[], readSource: (file: string) => string | null, masterEntries?: ReadonlyMap<string, { value: number }> | null, minEntries?: number, scanFiles?: string[] | null}} input
 * @returns {{problems: string[], notes: string[]}}
 */
function analyze({
  entries,
  readSource,
  masterEntries = null,
  minEntries = MIN_ENTRIES,
  scanFiles = null,
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
    if (text === null) {
      return { missing: "文件不存在" };
    }
    /* 前缀取上面那一条 `CONST_HEAD` —— 扫面与定点取值必须是同一把尺子，否则会出现
       「这份文件被扫到了，但账上那条按老形状找不到」这种自相矛盾的红。 */
    const re = new RegExp(
      `${CONST_HEAD}${name}\\s*=\\s*(-?\\d[\\d_]*(?:\\.\\d+)?)(?=[;,\\s])`,
      "m",
    );
    const raw = re.exec(text)?.[1];
    return raw === undefined ? { missing: "源码里找不到该常量声明" } : { value: num(raw) };
  };

  const located = entries.filter((e) => sourceValue(e.file, e.const).value !== undefined);

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
      problems.push(`${e.file} :: ${e.const} —— ${got.missing}（账上记的是 ${e.value}）`);
      continue;
    }
    if (got.value === e.value) {
      continue;
    }
    const line = `${e.file} :: ${e.const} 源码 ${got.value} ≠ 账 ${e.value}${e.unit ? `（${e.unit}）` : ""}`;
    if (e.kind === "report") {
      notes.push(`${line} —— 这一条是 report（不是松紧量），只报不拦`);
      continue;
    }
    const looser = isLooser(e, e.value, got.value);
    problems.push(
      `${line} ⇒ 源码与账不同步。这次是**${looser ? "变松（放宽判据）" : "变严"}**：${
        looser
          ? `要放宽就把账一起改成 ${got.value} 并写 movedFrom / movedIssue —— 让它在 diff 里显形，而不是只动源码`
          : "收紧也要同批改账，否则下一次有人「顺手复原」就没人看得出来"}`,
    );
  }

  // 2) 同组同数
  /** @type {Map<string, Array<{at: string, value: number}>>} */
  const groups = new Map();
  for (const e of entries) {
    if (!e.group) {
      continue;
    }
    const got = sourceValue(e.file, e.const);
    if (got.value === undefined) {
      continue;
    }
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

  // 3) 未入账的顶层数值 —— 输入面是**磁盘上的判据文件**，不是账上点名的那些
  //    （ISSUE #2188：从账里推面 ⇒ 整份没进账的文件根本不进循环）。
  const ledgerFiles = [...new Set(entries.map((e) => e.file))];
  const filesToScan = [...new Set([...(scanFiles ?? ledgerFiles), ...ledgerFiles])];
  for (const f of filesToScan) {
    const text = readSource(f);
    if (text === null) {
      continue;
    }
    const names = [...text.matchAll(CONST_DECL)].map((m) => /** @type {string} */ (m[1]));
    if (names.length === 0) {
      continue;
    }
    const inLedger = new Set(entries.filter((e) => e.file === f).map((e) => e.const));
    /* 整份没进账 ⇒ 这一格里它一个字都不被判。单列一句而不是并入下面那条：
       话术要点名「这份文件从没被这本账看过」，否则读者只会以为自己漏登记了一个数。
       只报数名、不报数值 —— 数值在账里才对读者可见。 */
    if (inLedger.size === 0) {
      problems.push(
        `${f} 里扫到 ${names.length} 个顶层具名数值（${names.join(" / ")}），` +
          "而账里**一条都没有** ⇒ 这份文件整体不在本判据的覆盖面内。出路仍是那两条：" +
          '是承重的入账（threshold / floor），不是承重的也以 "kind": "report" 入账' +
          "—— 入账这个动作本身就是那次判断。",
      );
      continue;
    }
    for (const name of names) {
      if (!inLedger.has(name)) {
        problems.push(
          `${f} 里有顶层数值 ${name} 而账上没有 —— 是承重的就入账（threshold / floor），` +
            '不是承重的也以 "kind": "report" 入账：入账这个动作本身就是那次判断。',
        );
      }
    }
  }

  // 4) 相对主干变松要签字
  if (masterEntries) {
    for (const e of entries) {
      const prev = masterEntries.get(`${e.file}#${e.const}`);
      if (!prev || e.kind === "report" || e.value === prev.value) {
        continue;
      }
      if (!isLooser(e, prev.value, e.value)) {
        continue;
      }
      const signed =
        Number(e.movedFrom) === prev.value && /^#\d{2,}$/.test(String(e.movedIssue || ""));
      if (!signed) {
        problems.push(
          `${e.file}#${e.const} 相对主干是**放宽**（${prev.value} → ${e.value}），` +
            `但账上没有签字 —— 写 "movedFrom": ${
            prev.value
            }, "movedIssue": "#<issue号>" 再来（放宽判据要有一份说清为什么的单子，不是改个数字）。`,
        );
      }
    }
  } else {
    notes.push("主干上还没有这本账 ⇒ 「相对主干放宽要签字」那一判本轮无从比较（不是「已通过」）。");
  }

  return { problems, notes };
}

/**
 * 真实 IO 的那几件：读源码、读本机账、读主干账、从磁盘现算「哪些文件算判据」。
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

/**
 * 扫描根 —— 「门禁链里被按名字调起的判定脚本」∪ `scripts/check-*.cjs` 名字族兜底，
 * **从磁盘现算**（ISSUE #2383）。
 *
 * 这一行就是 ISSUE #2188 的全部内容：旧写法的输入面是「账上点名的文件」，于是**整份没进账
 * 的判据文件根本不进循环**，它那几个顶层数值一个字都不被判 —— 而这条判据的本职恰恰是
 * 「新建判据的那一笔要显形」。#2157 那批新建 `check-tracked-secrets.cjs` 时，四个下限是
 * 作者**自己记得**去入账的；没记得的话，这一格当场也是绿的（同 #2156 文件头那一型的第二次
 * 出现，对象换成了它自己）。
 *
 * #2383 补的那一半：`check-*.cjs` 名字族之外，**凡是门禁链按名字调起的判据**（`shell-gate.mjs`
 * / `storybook-check.mjs` 这些名字不叫 check- 的，#1444 残活 A / #1451）数值同样要有人守。
 * 链的现算**只有一份实现**（`gate-chain-scripts.cjs`，与 `check-gate-executors.cjs` 共用）
 * —— 两处各算一份必然漂（§12.12），漂的形态就是「这条判据有执行者、它的数值却没人看」。
 *
 * 链外的两类**刻意不进**，边界写在账的 `$notCovered` 里：
 *   · 只在平台档（`.cnb.yml`）调起的 `ci-*.mjs` —— 门禁链口径刻意不读 `.cnb.yml`
 *     （AGENTS 硬规则 7），与 `check-gate-executors.cjs` 同一条边界；
 *   · 编排器与流程件（`quality-gate.mjs` / `ship-*.mjs`）—— 它们不是判据，
 *     没有自己「什么算违规」的数值。
 *
 * @returns {string[]} 相对仓库根的路径
 */
function scanJudgeFiles() {
  const chain = [...gateChainScripts()].map((name) => `scripts/${name}`);
  const checkFamily = fs
    .readdirSync(path.join(ROOT, "scripts"), { withFileTypes: true })
    .filter((e) => e.isFile() && /^check-.*\.cjs$/.test(e.name))
    .map((e) => `scripts/${e.name}`);
  return [...new Set([...chain, ...checkFamily])];
}

function readLedger() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ".gate-thresholds.json"), "utf8")).entries;
}

/**
 * 主干上那本账（相对放宽的基准）。取不到（首次落地 / 无 origin/master）返回 null，
 * 由 `analyze()` 念成「这一轮无从比较」而不是「这一轮一致」。
 *
 * @returns {Map<string, GateThreshold> | null}
 */
function masterLedger() {
  try {
    const out = execFileSync("git", ["show", `origin/master:${LEDGER_REL}`], {
      cwd: ROOT,
      encoding: "utf8",
      // stderr 不转发：主干上还没有这本账时 git 会打一行 fatal，那是实现细节不是结论。
      stdio: ["ignore", "pipe", "ignore"],
    });
    /** @type {GateThreshold[]} */
    const list = JSON.parse(out).entries ?? [];
    /** @type {Map<string, GateThreshold>} */
    const map = new Map();
    for (const e of list) {
      map.set(`${e.file}#${e.const}`, e);
    }
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
  } catch (error) {
    process.stdout.write(
      `[gate-thresholds] 账解析失败：${error instanceof Error ? error.message : String(error)} ⇒ 不构成结论\n`,
    );
    return 2;
  }
  const { problems, notes } = analyze({
    entries,
    readSource: realReadSource,
    masterEntries: masterLedger(),
    scanFiles: scanJudgeFiles(),
  });
  for (const n of notes) {
    process.stdout.write(`[gate-thresholds] ⚠ ${n}\n`);
  }
  if (AS_JSON) {
    process.stdout.write(
      `${JSON.stringify({ entries: entries.length, problems, notes }, null, 2)}\n`,
    );
    return problems.length && !REPORT_ONLY ? 1 : 0;
  }
  if (problems.length === 0) {
    process.stdout.write(
      `[gate-thresholds] ✓ ${entries.length} 条承重数值与账一致（含组内同数与未入账检查）。\n`,
    );
    return 0;
  }
  process.stdout.write(`[gate-thresholds] ✗ ${problems.length} 处判据自身的数值与账不一致：\n`);
  for (const p of problems) {
    process.stdout.write(`  · ${p}\n`);
  }
  process.stdout.write(
    `\n账：${LEDGER_REL}（方向逐条记 —— threshold 阻断阈值、floor 防静默失效的地板、report 只报不拦）\n`,
  );
  return REPORT_ONLY ? 0 : 1;
}

module.exports = { analyze, isLooser, num, main, MIN_ENTRIES };

if (require.main === module) {
  process.exit(main());
}
