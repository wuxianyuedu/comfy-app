/**
 * freshness-gate.mjs — 「每一档都有主」的提交门禁（规范 §11.8 / §13.5.4）
 *
 * 守**三份同形的账**（`FRESHNESS_TRACKS`：全量 e2e / 全量单测 + 覆盖率 / 产物级护栏），
 * 三份都由本脚本在 pre-commit 的 D 组判。它补的是**「跑过一次」与「一直绿」是两件事**：
 * 一档可以「看着有主、实际三个月没人碰过」，而账面上一个字都不说。
 *
 * 判据的形状（与 `shell-gate.mjs` 同族：触发面窄、判决可执行）：
 *   · 每一登记档都要有一条新鲜度记录，写清「谁 / 什么时候 / 按哪条命令复核的」
 *     —— 缺一条 = 这一档还停在「录过就算数」；
 *   · 记录**不许**挂在非登记档上（删了一档，账要同批抹掉）；
 *   · 每次提交顺带打印各档「上次自证距今多久」——账的价值在于被**看见**。
 *
 * 「多久没跑算旧」这条判据读的是**这一档吃什么输入面**（`track.dirty`），不是机器时钟：
 *   · 今天动过这一档的输入面 ⇒ **当天必须有一次自证**（账停在改动之前就算旧）；
 *   · 今天没动过 ⇒ 以 `graceMs` 为宽限；
 *   · `track.daily` 决定还要不要按本地日历日卡第一次提交。
 * 三档现在**同形**（全量 e2e 也吃输入面了 —— 它以前是「按日历日、不看面」那一档，
 * 于是只动 `.githooks/` 或文档的提交也欠一次全量 e2e 凭证，而那次跑与不跑结论都不变；
 * 面与宽限的理由与那一格的现场都记在 `FRESHNESS_TRACKS.e2e` 与 §11.8）。
 *
 * 每一档都有两条出路，且都不是绕过（留下的是一条能复核的事实）：
 * `run` 那一栏的命令跑绿即记，或 `skipHow` / `dirtyHow` 记一条写明理由的账
 * （占位理由被拦）。
 *
 * ⚠️ **而这三档现在都不必在本地跑**（2026-10-19 的口径，规范 §13.5.23）：登记里
 * `ciStage` 非空 ⇒ 「今天必须有凭证」那一层整层跳过，本地这笔账退成**读数** ——
 * 执行者是平台侧每日档的那三格（`每日单元测试` / `每日生产构建` / `每日全量E2E`）。
 * 这不是把判据放宽：用例、预算、覆盖率阈值一个字没动，动的只有「谁在什么时候跑它」
 * （§13.5.17），而它换过去的条件是**那三格真在场** —— 由
 * `tests/daily-tracks.test.ts` 判「每个非空 `ciStage` 都必须在
 * `COMFYAPP_CI_DAILY_GATES` 里」。`dirty` / `graceMs` 那两栏仍然留着并照旧被读：
 * 它们现在服务的是**读数**（「今天动过这一档的面」这件事仍然打在台面上），
 * 而任何一档日后没有平台侧执行者时，把 `ciStage` 清空就回到拦截口径。
 *
 * 用法：`node scripts/freshness-gate.mjs`（由 `.githooks/pre-commit` 的 **D0 形态前置档**调用）
 *      `node scripts/freshness-gate.mjs --ledger`（= `pnpm check:freshness`）：开工那一眼 ——
 *      打账面（时刻 / 距今 / 谁 + 命令）**并打出这一档现在欠不欠**，但**不阻断**（退 0）；
 *      阻断的那一份在钩子里，两者是同一条判据的两个读者。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FRESHNESS_TRACKS,
  checkFreshnessLedger,
  dirtiesTrack,
  freshnessReading,
  freshnessStamp,
  freshnessTrack,
  readFreshnessLedgerAt,
} from "./freshness-ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 读一份新鲜度账（不存在 / 读不出 → `{}`，由判决把它当成「一档都没记」）。
 *
 * 读写语义都在 `freshness-ledger.mjs`（`readFreshnessLedgerAt` / `writeFreshness`）：
 * 两条账各写一份「读不出怎么办」时，一边会把坏 JSON 当成空账（判红，话术正确）、
 * 另一边会静默放行 —— 而后者不报错，只是少守一条。
 *
 * @param {string} kind `FRESHNESS_TRACKS` 的键
 * @param {string} [root]
 * @returns {Record<string, unknown>}
 */
export function readFreshnessLedger(kind = "e2e", root = ROOT) {
  return readFreshnessLedgerAt(root, freshnessTrack(kind).ledger);
}

/**
 * 各档的判决面 —— **从登记表派生，不是分支、也不是一张手抄的清单**。
 *
 * 这里要的只有一件事：每一档的账里该有哪些**键**。键的唯一出处是 `track.key`
 * （`e2e` / `full` / `artifact`）。
 *
 * ⚠️ 这段**曾经是手抄的**，于是「新增一档却忘了在这里加一行」⇒ 那一档**谁都不判**
 * （判据的覆盖面与它自称的不符，正是本节立案现场那条病），而新增档这件事本身不会有
 * 任何东西变红。现在由 `FRESHNESS_TRACKS` 现算：新增一档自动被纳入判决面。
 *
 * 为什么不是「在 `main` 里 `if (kind === ...)`」：那样「第四档」会变成四分支，
 * 而某一处漏了不会有任何东西告诉你。
 *
 * @returns {Array<{kind: string, keys: string[]}>}
 */
export function trackScopes() {
  return Object.keys(FRESHNESS_TRACKS).map((kind) => {
    const track = freshnessTrack(kind);
    return { kind, keys: [track.key] };
  });
}

/**
 * 判决本体：给定新鲜度账，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `shell-gate.mjs` 的 `runGate` 先例）：
 * 不接输入的话，「永远说没问题」这一层静默退化不会有任何东西红。
 *
 * 返回值里**给人读的那一栏是三件一起给的**（ISSUE #1979）：`ages` 是拼好的
 * 「键：距今多久（具体时刻）」，`stamps` 是纯时刻（没有则 null），`records` 是
 * 「谁 / 按哪条命令」。拆开是因为消费方不同 —— 人读 `ages`，要核另外两栏的（或要判
 * 「这条到底有没有时刻」的用例）读 `stamps` / `records`，不去正则拆一句中文。
 *
 * @param {{ledger: Record<string, unknown>, kind?: string, keys?: string[], track?: import("./freshness-ledger.mjs").FreshnessTrack | null, now?: Date, dirtySince?: Date | null}} input
 * @returns {{exitCode: number, problems: string[], ages: string[], stamps: (string | null)[], records: {key: string, who: string, how: string}[], ciStage: string}}
 */
export function runGate({
  ledger,
  kind = "e2e",
  keys,
  track: trackOverride = null,
  now = new Date(),
  dirtySince = null,
}) {
  /* `track` 这一格可注入**不是为了让判据好测**：三档从 2026-10-19 起都登记了
   * `ciStage`（执行者在平台侧），于是「本地要拦」那几支在真实档上**再也走不到**。
   * 那几支仍然要能被执行、能被判红（它们是任何一档将来失去平台侧执行者时的口径），
   * 所以这里给一个注入点，让判据拿合成档去打 —— 与 `now` / `dirtySince` 同一个理由。 */
  const track = trackOverride ?? freshnessTrack(kind);
  /* 缺省值与 `trackScopes()` **同源**（那里是判决面的唯一出处）：两个地方各自写一份
   * 「这一档有哪些键」时，`main`（走 `trackScopes`）与直接调 `runGate` 的调用方
   * （走缺省值）会对同一档给出不同答案 —— 而默认值那一侧错了不会红（调用方几乎总是
   * 显式传，缺省那条路径只在用例里走）。 */
  const required = keys ?? [track.key];
  const problems = checkFreshnessLedger(ledger, {
    required,
    registered: required,
    track,
    kind,
    now,
    dirtySince,
  });
  /* 「上次自证」这一栏给的是**具体时刻 + 距今多久**（`freshnessReading`），
   * 不是只有一句「今天 / N 天前」：日期是判据要的，时刻是人和排障要的 ——
   * 只给天数时「今天 08:45 跑过」与「今天 23:50 才跑过」在账面上同形（ISSUE #1979）。
   * 拆成 `at` / `age` 两栏给出去，是因为**消费方要的东西不同**：人要读拼好的那一句，
   * 而机器（`--ledger` 的补栏、用例）要得出「这一条到底有没有时刻」。 */
  const ages = required.map(
    (p) => `${p}：${freshnessReading(ledger[p], now) ?? "无记录"}`,
  );
  const stamps = required.map((p) => freshnessStamp(ledger[p]));
  /* `who` / `how` 一并带出去（ISSUE #1979）：账存在的全部意义是
   * 「谁、什么时候、按哪条命令复核的」，此前输出只打第三栏的半句 ——
   * 要核另外两栏就得自己开 JSON，于是「账面被看见」这件事只成了一半。 */
  const records = required.map((p) => {
    const entry = ledger[p];
    const rec =
      entry && typeof entry === "object"
        ? /** @type {Record<string, unknown>} */ (entry)
        : {};
    return {
      key: p,
      who: String(rec.who ?? "").trim(),
      how: String(rec.how ?? "").trim(),
    };
  });
  return {
    exitCode: problems.length === 0 ? 0 : 1,
    problems,
    ages,
    stamps,
    records,
    /* 「这一档的执行者在不在平台侧」是**判决的一部分**，不是话术：调用方要据此把
     * 同一行读成「拦」或「读数」。留空 = 本地仍然是必经之路。 */
    ciStage: String(track.ciStage ?? "").trim(),
  };
}

/**
 * 「今天动过这一档的输入面」的那个提交时刻（没有则 null）。
 *
 * 只有 `track.dirty` 非空的档读它，而它们对**谁该在什么时候跑**的答案与全量 e2e 不同：
 * 那两档的代价是十分钟量级，**没必要每天都跑** —— 真正要的是「改了就当天跑」。
 * 于是判据要能回答「今天这个工作区有没有提交动过 `src/`（或产物链那几个文件）」。
 *
 * 用**提交时间**而不是文件 mtime：mtime 会被 `git checkout` / `stash` / 拉取整体刷新
 * （`--cache-strategy metadata` 那件事的同源坑），于是「今天动过」会变成「今天 checkout 过」。
 *
 * ⚠️ 但**只看已提交的**会让这条判据在钩子里系统性放行「正在改的这一笔」：pre-commit 跑在
 * 提交之前，此刻 `git log` 里还没有这次改动 —— 一笔改了 `tests/` 的提交会被判成
 * 「今天没动过这一档」，等它落进 master，下一个人第一次提交才立刻红。
 * 「改了就当天跑」因此退化成「改了由别人补跑」。所以取证面是**今天的提交 ∪ 待提交那一批**
 * （`git diff --cached --name-only`），合成规则抽成纯函数 `combineEvidence` 让四种组合
 * 都能被真跑；待提交没有时刻，成立且今天还没有任何提交动过时用 `now` 顶上。
 *
 * ⚠️ 拿不到答案时返回 `null`（**不是**「今天没动过」）：`git` 不在 PATH 上、这不是一个
 * git 检出、或命令超时 —— 三者都让「改了就当天跑」这条判据**无话可说**，而把「问不出来」
 * 当成「没动过」正是 §9.2 第 3 条禁止的静默失败。退回按 `graceMs` 判（宽松但仍有时限），
 * 且这一档的账文件不在时另有宽限期兜底。
 *
 * @param {{dirty: string[]}} track
 * @param {Date} now
 * @returns {Date | null}
 */
export function dirtySinceToday(track, now = new Date()) {
  if (!track.dirty || track.dirty.length === 0) return null;
  /* 取证面 = **今天的提交 ∪ 待提交的那一批**。
   *
   * 只问 `git log` 时这条判据跑在**提交之前**：一笔改了 `tests/` 的提交在钩子里被判成
   * 「今天没动过这一档」而放行，它落进 master 之后下一个人第一次提交立刻红 ——
   * 「改了就当天跑」于是退化成「改了由别人补跑」。`git diff --cached` 正是那一刻
   * 就要进提交的内容，所以把它并进同一个问题里。
   *
   * 两半的取法不同：提交带时刻（要的是「今天第一次动它的那一刻」，用来判「先跑后改」），
   * 待提交没有时刻 —— 它成立时若今天还没有任何提交动过它，就用 `now` 顶上去，
   * 语义是「此刻正有一批要吃这一档的改动等着提交」。已有更早的提交时**保留更早的那个**：
   * 结论更严格，且不会把「先跑后改」那一条边界（自证晚于改动即放行）弄丢。 */
  const committed = committedSinceMidnight(track, now);
  return combineEvidence(committed, stagedTouchesTrack(track), now);
}

/**
 * 两半取证合成一个时刻（抽成纯函数是为了让**四种组合**都能被真跑一次）。
 *
 * @param {Date | null} committed 今天的提交里最早动过它的那一刻（null = 没有，或问不出来）
 * @param {boolean | null} stagedHit 待提交那一批动不动它（null = git 问不出来）
 * @param {Date} now
 * @returns {Date | null}
 */
export function combineEvidence(committed, stagedHit, now) {
  // 问不出来时**不新增结论**（也不撤销已有的）：把「问不出」当成「没动过」是 §9.2 第 3 条
  // 禁的静默失败，反过来凭空造一个时刻又会把「今天其实没人动它」误判成必须跑。
  if (stagedHit === null) return committed;
  if (stagedHit && committed === null) return now;
  // 已有更早的提交时保留更早的那个：结论更严格，且「先跑后改」那条边界仍按真实时刻比。
  return committed;
}

/**
 * 待提交（已 `git add`）的那一批里有没有这一档的输入面。
 *
 * @param {{dirty: string[]}} track
 * @returns {boolean | null} `null` = git 问不出来（**不是**「没动过」—— 与
 *   `committedSinceMidnight` 同一口径：拿不到答案时不许让这一档白放行，也不许凭空加结论）
 */
function stagedTouchesTrack(track) {
  const res = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string")
    return null;
  return stagedDirtiesTrack(track, res.stdout.split("\n"));
}

/**
 * 纯函数那一半：把 `git diff --cached --name-only` 的输出行归一成路径前缀判断。
 *
 * 抽出来是为了让**分隔符这一档可被执行**：`git` 在 Windows 上给的是正斜杠，但工作区里
 * 任何一段路径处理都可能把反斜杠喂进来（本仓在 `path.relative` 上栽过第二次），
 * 而 `track.dirty` 的前缀全是正斜杠 —— 不归一时「动了 `tests/`」会被读成没动，
 * 表现正是这条判据静默恒放行。
 *
 * @param {{dirty?: string[]}} track
 * @param {string[]} rawLines
 * @returns {boolean}
 */
export function stagedDirtiesTrack(track, rawLines) {
  const paths = rawLines
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
  return dirtiesTrack(track, paths);
}

/**
 * 今天的提交里，最早一个动了这一档输入面的时刻（没有则 null；问不出来也是 null）。
 *
 * @param {{dirty: string[]}} track
 * @param {Date} now
 * @returns {Date | null}
 */
function committedSinceMidnight(track, now) {
  /* 只看**当天**的提交：`--since` 给午夜，配合 `%cI` 的严格 ISO 时刻。本地日历日
   * 与 `isSameLocalDay` 同源 —— 两处用不同日界时会出现「账说今天动过、判据说没动」。 */
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  /* `--format=%cI` 与 `--name-only` 的实际形状是「时刻行 · **空行** · 文件行…」：
   * 空行分隔的是**时刻与它的文件清单**，不是两次提交（实测 `git log` 的输出字节：
   * `…T14:10:05+08:00\n\nsrc/a.ts\n…`）。所以「遇空行就收段」是错的 ——
   * 那样 `stamp` 会在文件行到达**之前**被清掉，于是**每一次**都判成「今天没动过这一档」，
   * 而话术里一个字都不会提（判据静默失效，正是本条要防的形态）。
   * 正确的状态机：新时刻出现时才把上一段收掉，空行一律忽略。 */
  const res = spawnSync(
    "git",
    [
      "log",
      "--since",
      midnight.toISOString(),
      "--format=%cI",
      "--name-only",
      "--",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (res.error || res.status !== 0 || typeof res.stdout !== "string")
    return null;
  /* 两栏都显式标类型：它们在闭包 `flush()` 里被赋值，TS 的控制流分析看不进去 ——
   * 不标的话会被收窄成初值 `null`，下面每次比较都报「隐式 any」。 */
  /** @type {Date | null} */
  let earliest = null;
  /** @type {string | null} */
  let stamp = null;
  let hit = false;
  const flush = () => {
    if (hit && stamp) {
      const at = new Date(stamp);
      if (!Number.isNaN(at.getTime()) && (!earliest || at < earliest))
        earliest = at;
    }
    hit = false;
  };
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      flush();
      stamp = trimmed;
      continue;
    }
    if (dirtiesTrack(track, [trimmed.replace(/\\/g, "/")])) hit = true;
  }
  flush();
  return earliest;
}

function main() {
  const ledgerOnly = process.argv.includes("--ledger");
  const now = new Date();
  let failed = 0;
  for (const scope of trackScopes()) {
    const track = freshnessTrack(scope.kind);
    const ledger = readFreshnessLedger(scope.kind);
    const result = runGate({
      ledger,
      kind: scope.kind,
      keys: scope.keys,
      now,
      dirtySince: dirtySinceToday(track, now),
    });
    const reading = `上次自证 —— ${result.ages.join("；")}`;
    /* `--ledger` 是「给人读当下账面」的那一档，所以它打**三栏全的**那一条
     * （时刻 / 距今多久 / 谁 + 按哪条命令）—— 与钩子里 `[ok]` 那一行刻意不同：
     * 钩子里每一屏都要出现，时刻已经够用；这里是人主动要看，少一栏就得去开 JSON。 */
    if (ledgerOnly) {
      /* 这一档**改过一次用途**：它原本只印账面（时刻 / 距今 / 谁 + 命令）就 `continue`，
       * 于是「开工先看一眼」的人看得到**上次是谁什么时候跑的**，却看不到
       * **「按今天这笔要提交的改动，我欠不欠一次自证」**—— 而那恰恰是这眼要看的东西，
       * 也是「显式的开工动作」与「提交时被拦」之间唯一的那道桥。
       * 现在把同一份判决（`runGate` 已经算完，不额外花一次钱）作为**待办**打出来：
       * 措辞是「欠」而不是「✗」，退出码仍为 0 —— 这一档是给人看状态的，
       * 阻断的那份在钩子里，两份各有各的执行者（§13.5.12 那一族：别写一把没人读的判据，
       * 也别让一条读数线变成必经之路）。 */
      const owed = result.ciStage
        ? `        本地**不欠**这一档：执行者是平台侧每日档 \`${result.ciStage}\`；` +
          "这一栏只是本地留痕（谁在本地自己证过一次、按哪条命令）。\n"
        : result.exitCode === 0
          ? "        这一档现在**不缺**：账面满足当下的判据。\n"
          : `        这一档现在**欠**一次自证（判据若跑在钩子里，这一次会被拦下）：\n` +
            result.problems.map((p) => `      · ${p}\n`).join("");
      process.stdout.write(
        `[freshness] ${track.label}：${reading}\n` +
          result.records
            .map(
              (r) =>
                `            ${r.key}：who=${r.who || "(未写)"}；how=${r.how || "(未写)"}\n`,
            )
            .join("") +
          owed,
      );
      continue;
    }
    /* 宽限期：账文件**还没入库**时只提醒、不阻断。这份账是随提交进来的（平台侧 squash
     * 合并不跑本地钩子，硬规则 6），所以「文件不在」是一个**本人做不到**的状态 ——
     * 无条件阻断会拦住从它分出的每一次提交。宽限期里那一步照样把「今天该跑一次」打在
     * 台面上：账面缺席与「这件事已经有人管」不该长得一样。
     * 这一条对**四档一视同仁**（`track.daily` 只是「这一档按日历日/改动面判」，
     * 与「账还没入库」是两件事 —— 此前把两者写在一起，于是新加的非 daily 档
     * 在账文件缺席时会直接走 `runGate` 报「没有记录」并阻断本人做不到的事）。 */
    if (!fs.existsSync(path.join(ROOT, track.ledger))) {
      process.stdout.write(
        `  [warn] ${track.label}：还没有账文件（${track.ledger}）—— 宽限期只提醒、不阻断。` +
          `跑一次 \`${track.run}\` 会留下第一条凭证。\n`,
      );
      continue;
    }
    if (result.exitCode !== 0) {
      failed = 1;
      /* 判决自己已经把「跑哪条命令 / 记哪条豁免」写进每一条问题里了（它要能独立
       * 被执行 —— `runGate` 的调用方直接读 `problems`）。这里只补它给不出的那一句
       * **落点**（账文件路径），不再把「记账」整段复述一遍 —— 复述的形态是同一段话
       * 在同一屏里出现两次，而第二次读起来像两件不同的事。 */
      process.stderr.write(
        `[freshness-gate] ✗ ${track.label} 的新鲜度账不完整：\n      · ` +
          result.problems.join("\n      · ") +
          `\n        账文件：${track.ledger}（手工补一条也可以，但要写全 who / how / verifiedAt）。\n` +
          "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
      );
      continue;
    }
    process.stdout.write(
      `  [ok] ${track.label}：每档都有主（${reading}）` +
        (result.ciStage
          ? ` —— **执行者在平台侧**：每日档 \`${result.ciStage}\`，本地这一档不拦、只留读数\n`
          : "\n"),
    );
  }
  return failed;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
