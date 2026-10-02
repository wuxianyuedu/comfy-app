#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：依赖漏洞扫描（供 check:all 调用，判据见下方注释）
/**
 * `check-dependency-audit.mjs` —— 依赖漏洞扫描门禁（ISSUE #1331）。
 *
 * 补的是「**发现** CVE」这一步：此前全靠人肉 —— `pnpm-workspace.yaml` 里那三条
 * `overrides` 的注释本身就是证据（每次都是「有人发现了 → 手工查传递路径 → 手工写
 * override → 手工写注释解释为什么」），而「这次忘了查」没有任何反馈。本仓取向是
 * 缺能力就补地基（AGENTS 硬规则 24），所以把扫描机器化。
 *
 * 判据形状（三条都是刻意的，别「顺手简化」）：
 *
 * 1. **按 `(包名, advisory id)` 记账，不按计数。** 计数口径下「修好 1 个、引入 2 个」
 *    总量变大才失败，而引入的那 2 个无人知晓 —— 与 §13.5.1 对格式棘轮讲的是同一个道理。
 *    advisory id 是 registry 给的稳定标识，用它做键还能让「同一条漏洞换了引入路径」
 *    不被误判成新增。
 * 2. **双向拦**（§1192 定的台账口径）：基线外出现新条目 → 红；基线里的条目**已经不再
 *    命中** → 也红。只写「不许新增」的话，收敛掉一份却把条目留在台账里，这张表就失去
 *    记账能力，下一次同种漏洞进来时没人看得出来。
 * 3. **每条基线必须写 reason。** 验收要求「当前漏洞要么修掉，要么逐条注明为什么现在修
 *    不了」；空 reason 的条目等于「登记了但没人负责」，所以缺 reason 直接判红。
 *
 * `--update` **只许降**：可以删掉不再命中的条目，**拒绝把新出现的条目写进基线**
 * （与 `check-code-duplication.cjs` / `check-function-length.cjs` 同口径 —— 否则
 * `--update` 就成了放宽棘轮的后门）。唯一例外是基线文件不存在时的首次记账。
 *
 * 为什么**不**接进 `.githooks/pre-commit`：这是**网络请求**（依赖 registry 可达性）。
 * 塞进每次提交会把「离线 / registry 抖动」变成提交失败，与仓库一贯的「按需召唤」分层
 * （§13.5.4）不一致；所以它住在 `check:all`（`scripts/quality-gate.mjs` 的 `GATES`
 * 与 `scripts/quality-gate.ps1` 的 `$Blocks`，两处同步）。
 *
 * 与之配套的一条口径：**拿不到 registry 时判「未扫描」并以 0 退出，但话术里不许出现
 * 「干净」**。这条不是「让离线也能过」的便利 —— 而是把「没扫」与「扫了且没有」在输出
 * 形态上分开（用例钉着）。真故障（stdout 不是 JSON、pnpm 压根没起来）仍然判红：
 * 那种形态是判据坏了，不是网络抖动。
 *
 * 用法：
 *   node scripts/check-dependency-audit.mjs            # 判定
 *   node scripts/check-dependency-audit.mjs --update    # 收紧基线（只许降）
 *   node scripts/check-dependency-audit.mjs --json      # 打印本轮命中清单（排障用）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, ".dependency-audit-baseline.json");

/**
 * 判据版本号。改了「拦哪些严重级」这类判据口径必须同步 +1，否则旧基线里的条目
 * 与新一轮的判据不是同一个量（`--update` 会把「新看见的存量」当成「新增」拒掉，
 * 或反过来把真新增洗进基线）。
 */
export const RULE_VERSION = 1;

/**
 * 拦哪些严重级。
 *
 * 为什么只到 high：`moderate`/`low` 在本仓当前存量里有 15 条，且多数是
 * 「DoS / 原型污染类、要特定调用形状才成立」的传递依赖 —— 一开就把它们全记进基线，
 * 台账会被噪声填满，真正的新增 high 反而埋在里面。要收窄就改这个常数 + `RULE_VERSION`，
 * 别在调用点各写一份。
 */
export const BLOCKED_SEVERITIES = ["high", "critical"];

const argv = process.argv.slice(2);
const UPDATE = argv.includes("--update");
const AS_JSON = argv.includes("--json");
/**
 * `--fixture <path>`：**只给契约测试**用的一份 registry JSON，跑它就不碰网络。
 *
 * 为什么不换成「注入 runner」那种更纯的写法：契约测试要跑的是**真脚本的退出码与话术**
 * （`--update 拒绝新增`、`未扫描` 这些形态只有走 CLI 才成立），而把外部 registry 当测试
 * 依赖会让这盏灯随上游 advisory 的变化自己变红 —— 那时红就不可归因了。判据本身
 * （`collectBlocked` / `diffAgainstBaseline` / `runAudit`）另有直接喂数据的用例。
 */
const FIXTURE = (() => {
  const i = argv.indexOf("--fixture");
  return i >= 0 && argv[i + 1] ? path.resolve(ROOT, argv[i + 1]) : null;
})();

// `--json` 是给管道读的，而 `runPnpmSync` 会把即将执行的命令行回显到**本进程的 stdout**
// （`launcher-core/command-echo.mjs` 的默认 sink）。两种模式都不该带这行，所以按它自己的
// 开关关掉；关掉的是回显，不是审计。
if (AS_JSON || FIXTURE) process.env.COMFYAPP_ECHO_COMMANDS = "0";

/** 记账键：`(包名, advisory id)`。 */
export function advisoryKey(advisory) {
  return `${advisory.module_name}#${advisory.id}`;
}

/**
 * 从 `pnpm audit --json` 的对象里挑出要拦的条目，并带上定位信息。
 *
 * `paths` 取引入链的**前两条**各截断到 4 段就够指认了 —— 实测 `brace-expansion`
 * 一条有 100 条路径、`fast-uri` 有 20 条，整份打出来没人读，等于没给定位。
 *
 * @param {{advisories?: Record<string, any>}} audit
 */
export function collectBlocked(audit) {
  const advisories = audit?.advisories ?? {};
  const out = [];
  for (const raw of Object.values(advisories)) {
    if (!BLOCKED_SEVERITIES.includes(raw?.severity)) continue;
    out.push({
      key: advisoryKey(raw),
      module: raw.module_name,
      advisoryId: String(raw.id),
      severity: raw.severity,
      vulnerable: raw.vulnerable_versions ?? "(未知)",
      patched: raw.patched_versions || null,
      paths: summarizePaths(raw.findings),
    });
  }
  // 稳定序：critical 在前、同严重级按包名 —— 输出与基线文件都不该随 registry 返回顺序漂。
  out.sort(
    (a, b) =>
      BLOCKED_SEVERITIES.indexOf(b.severity) -
        BLOCKED_SEVERITIES.indexOf(a.severity) ||
      a.module.localeCompare(b.module) ||
      a.advisoryId.localeCompare(b.advisoryId),
  );
  return out;
}

/**
 * 把 findings 里的引入链压成「最多两条、每条最多 4 段」的可读串。
 *
 * registry 给的形状是 `.>better-auth>next` —— 分隔符是**裸 `>`**、首段 `.` 是工作区根本身
 * （实测读数，不是猜的：按 `" > "` 切会得到一整段没人看得懂的字符串）。这里按 `>` 切、
 * 丢掉那个 `.`，再用 ` > ` 拼回去，输出形态与仓库其它地方写引入链的惯例一致。
 */
function summarizePaths(findings) {
  const chains = [];
  for (const finding of findings ?? []) {
    for (const chain of finding?.paths ?? []) {
      const names = String(chain)
        .split(/\s*>\s*/)
        .filter((seg) => seg.length > 0 && seg !== ".");
      if (names.length === 0) continue;
      chains.push(names.slice(0, 4).join(" > "));
      if (chains.length >= 2) return dedupe(chains);
    }
  }
  return dedupe(chains);
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * 与基线对账。
 *
 * @param {Array<{key: string, severity: string, module: string}>} blocked 本轮命中
 * @param {{ruleVersion?: number, entries?: Array<{key: string, reason?: string}>}} baseline
 *   `ruleVersion` 由 `main()` 自己比对（对不上就要求重记），本函数只读 `entries`，
 *   但类型上得带着它 —— 否则调用点原样传整份基线文件会被 excess-property 判成多余字段。
 */
export function diffAgainstBaseline(blocked, baseline) {
  const entries = baseline?.entries ?? [];
  const baselineKeys = new Set(entries.map((e) => e.key));
  const hitKeys = new Set(blocked.map((b) => b.key));
  return {
    // 基线外新出现的：判红
    added: blocked.filter((b) => !baselineKeys.has(b.key)),
    // 基线里已经不再命中的：判红（要 --update 收紧，别把账留在表上）
    stale: entries.filter((e) => !hitKeys.has(e.key)),
    // 命中且在基线里的：绿，但缺 reason 的仍要拦
    known: blocked.filter((b) => baselineKeys.has(b.key)),
    // 基线里「在且空 reason」的条目：登记了却没人写为什么修不了
    unexplained: entries.filter(
      (e) => hitKeys.has(e.key) && !String(e.reason ?? "").trim(),
    ),
  };
}

/**
 * 跑一次 `pnpm audit --json`。
 *
 * 返回值刻意分三种形态，因为「拿不到 registry」与「有漏洞」在退出码上长得一样
 * （都是非 0），混在一起就会把离线读成「干净」或把漏洞读成「网络坏了」：
 *   · `{kind:"ok", audit}`       —— 拿到可解析的 JSON（有没有漏洞由调用方判）
 *   · `{kind:"unreachable"}`     —— 命令起来了但没给出 JSON：按离线/registry 抖动处理
 *   · `{kind:"broken"}`          —— pnpm 压根没起来：判据自身坏了，必须判红
 *
 * @param {{cwd?: string, runner?: typeof runPnpmSync, fixtureFile?: string|null}} [options]
 *   `fixtureFile` 是**只给契约测试**的口：判据要能对着固定的 registry 形状跑，而不是
 *   把外部世界当测试依赖（否则这盏灯会随上游 advisory 变化自己变红，红就不可归因）。
 */
export function runAudit({ cwd = ROOT, runner = runPnpmSync, fixtureFile = null } = {}) {
  if (fixtureFile) {
    return { kind: "ok", audit: JSON.parse(fs.readFileSync(fixtureFile, "utf8")) };
  }
  const result = runner(["audit", "--json"], { cwd, timeoutMs: 180_000 });
  if (result.error || result.status === null) {
    return {
      kind: "broken",
      detail: `pnpm 没起来：${result.error?.code ?? result.error ?? "无退出码"}`,
      command: `${result.command} ${result.args.join(" ")}`,
    };
  }
  const text = String(result.stdout ?? "").trim();
  if (text.length === 0) {
    return {
      kind: "unreachable",
      detail: firstLine(result.stderr) || `exit ${result.status}`,
    };
  }
  try {
    return { kind: "ok", audit: JSON.parse(text) };
  } catch {
    // 有 stdout 但不是 JSON：形态变了（registry 换了错误页？pnpm 改了输出？）。
    // 这不属于「网络抖动」，静默跳过会让判据整条失效，所以判红。
    return {
      kind: "broken",
      detail: `audit 的输出不是 JSON：${text.slice(0, 160).replace(/\s+/g, " ")}`,
    };
  }
}

function firstLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(entries) {
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ ruleVersion: RULE_VERSION, entries }, null, 2)}\n`,
  );
}

/**
 * 红话必须给「下一步做什么」，而不只是「有漏洞」。
 * 每条打：包名 + advisory id + 当前版本区间 + **有没有现成修复版**（这条决定走
 * 升级还是走 override，也决定它该不该进基线）+ 引入链示例。
 */
function printAdded(added) {
  console.error(
    `[dep-audit] 基线外新增 high/critical 漏洞 ${added.length} 条（规范 §13.5、ISSUE #1331）：`,
  );
  for (const a of added) {
    // 把**台账键原文**也印出来：出路那句要求「逐条补 key + reason」，不印键的话
    // 人得自己按 `(包名, advisory id)` 拼一遍 —— 拼错的那条会静默不生效。
    console.error(
      `  · ${a.key}  [${a.severity}]  受影响版本 ${a.vulnerable}`,
    );
    console.error(
      a.patched
        ? `      修复版本：${a.patched} —— 优先升/override 到它，别登记进基线`
        : `      修复版本：上游未给 —— 这才是要进基线并注明原因的形态`,
    );
    if (a.paths.length > 0) {
      console.error(`      引入路径：${a.paths.join("   |   ")}`);
    }
  }
  console.error(
    "  出路：① 能修的先修（`pnpm-workspace.yaml` 的 overrides 或直接升级，写清为什么）；\n" +
      "        ② 确实修不了的，先 `pnpm audit --json` 看清形状，再在\n" +
      "           `scripts/.dependency-audit-baseline.json` 里**逐条补 key + reason**\n" +
      "           （`--update` 拒绝把新增写进基线 —— 那是棘轮的后门，不是收口）。\n" +
      "        ③ 别把 RULE_VERSION 改了当「新判据」绕过这几条。",
  );
}

function main() {
  const result = runAudit({ fixtureFile: FIXTURE });
  if (result.kind === "broken") {
    console.error(
      `[dep-audit] 判据自身跑不起来：${result.detail}` +
        (result.command ? `（命令：${result.command}）` : ""),
    );
    console.error(
      "  这条按红处理：它不是「离线」，是扫描没产出可信结果 —— 静默跳过的判据等于没有判据。",
    );
    return 1;
  }
  if (result.kind === "unreachable") {
    console.log(
      `[dep-audit] 未扫描（拿不到 registry：${result.detail}）—— 本次**没有**判定任何漏洞，` +
        "不代表依赖是干净的。",
    );
    console.log(
      "  离线跑 `check:all` 时这一条会这样过；联网后请单独跑一次 `node scripts/check-dependency-audit.mjs`。",
    );
    return 0;
  }

  const blocked = collectBlocked(result.audit);
  if (AS_JSON) {
    console.log(JSON.stringify({ ruleVersion: RULE_VERSION, blocked }, null, 2));
    return 0;
  }

  const baseline = readBaseline();
  if (baseline === null) {
    if (!UPDATE) {
      console.error(
        "[dep-audit] 基线文件缺失：先执行 node scripts/check-dependency-audit.mjs --update",
      );
      console.error(
        `  本轮命中 ${blocked.length} 条；首次记账会把它们全写进\n` +
          "  `scripts/.dependency-audit-baseline.json`，**写完必须逐条补 reason**（缺 reason 判红）。",
      );
      return 1;
    }
    // 首次记账：`--update` 的「拒绝新增」在「还没有账可记」时不适用，但它也
    // 不替任何人编造理由 —— reason 一律留空，随后每一轮都会被 unexplained 判红，
    // 直到有人逐条写下「为什么现在修不了」。
    const entries = blocked.map((b) => ({
      key: b.key,
      module: b.module,
      advisoryId: b.advisoryId,
      severity: b.severity,
      vulnerable: b.vulnerable,
      patched: b.patched,
      reason: "",
    }));
    writeBaseline(entries);
    if (entries.length === 0) {
      // 0 条是这条门禁**最好的形态**（本轮所有 high/critical 都有现成修复版并被修掉了），
      // 别把它印成「reason 全为空」那种待办口吻 —— 空台账不是空原因。
      console.log(
        `[dep-audit] 基线已建立：0 条（${path.relative(ROOT, BASELINE_PATH)}）—— ` +
          "本轮没有任何 high/critical 存量需要记账。",
      );
      return 0;
    }
    console.log(
      `[dep-audit] 基线已建立：${entries.length} 条（${path.relative(ROOT, BASELINE_PATH)}），` +
        "reason 全为空。",
    );
    console.log(
      "  下一步：能修的先修（升级 / overrides），剩下的**逐条补 reason** —— 空 reason 的条目\n" +
        "  会被判红，这是刻意的：「登记了但没人写为什么修不了」的台账没有记账价值。",
    );
    return 0;
  }
  if (baseline.ruleVersion !== RULE_VERSION) {
    console.error(
      `[dep-audit] 判据变了（基线记的是 ruleVersion=${baseline.ruleVersion}，现在是 ${RULE_VERSION}），旧基线不再是同一个量。`,
    );
    console.error(
      "  先确认这条判据变更是对的，再执行 node scripts/check-dependency-audit.mjs --update 重记。",
    );
    return 1;
  }

  const diff = diffAgainstBaseline(blocked, baseline);

  if (UPDATE) {
    // 只许降：保留「仍在命中」的条目，删掉不再命中的；新出现的一律拒绝写进基线。
    if (diff.added.length > 0) {
      console.error(
        `[dep-audit] --update 拒绝执行：基线外有 ${diff.added.length} 条新增，棘轮只许降。`,
      );
      printAdded(diff.added);
      return 1;
    }
    const knownKeys = new Set(diff.known.map((b) => b.key));
    const entries = baseline.entries
      .filter((e) => knownKeys.has(e.key))
      .map((e) => {
        const hit = diff.known.find((b) => b.key === e.key);
        return { ...e, severity: hit.severity, vulnerable: hit.vulnerable };
      });
    writeBaseline(entries);
    console.log(
      `[dep-audit] 基线已收紧：${baseline.entries.length} → ${entries.length}（${path.relative(ROOT, BASELINE_PATH)}）` +
        "；条目减了就得把对应 reason 一起核一遍，别留「已修掉却还在表上」的行。",
    );
    return 0;
  }

  let failed = false;
  if (diff.added.length > 0) {
    printAdded(diff.added);
    failed = true;
  }
  if (diff.unexplained.length > 0) {
    console.error(
      `[dep-audit] 基线里有 ${diff.unexplained.length} 条命中项没写 reason：`,
    );
    for (const e of diff.unexplained) console.error(`  · ${e.key}`);
    console.error(
      "  「登记了但没人写为什么修不了」的条目没有记账价值；补上原因，或把它修掉。",
    );
    failed = true;
  }
  if (diff.stale.length > 0) {
    console.error(
      `[dep-audit] 基线里有 ${diff.stale.length} 条已经不再命中：`,
    );
    for (const e of diff.stale) console.error(`  · ${e.key}`);
    console.error(
      "  修法：`node scripts/check-dependency-audit.mjs --update` 收紧（台账型判据要双向拦，\n" +
        "        留着不动会让下一次同种漏洞进来时没人看得出来）。",
    );
    failed = true;
  }

  if (!failed) {
    console.log(
      `[dep-audit] ✓ 无基线外新增（high/critical 命中 ${blocked.length} 条，` +
        `其中基线内 ${diff.known.length} 条）`,
    );
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
