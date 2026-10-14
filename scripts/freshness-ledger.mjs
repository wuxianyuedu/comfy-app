#!/usr/bin/env node
/**
 * freshness-ledger.mjs — 「每天首次自证」那几档的**新鲜度账内核**（规范 §11.8 / §13.5.4）。
 *
 * 一笔账 = 一份 `scripts/.<档>-freshness.json`，形状同、键不同。它答的是同一个问题：
 * **这一档上一次被实证跑绿，是什么时候、谁跑的、按哪条命令**。
 *
 * 为什么「录过一次」与「一直绿」必须分开记：执行了的判据与跑得动的判据是两件事，
 * 而账面停在前者时，一档可以「看着有主、实际三个月没人碰过」—— 那正是本条要治的形态。
 *
 * ⚠️ **纪律收在可观测的形状上，不收回时钟上**：
 *   ① 每一档**都必须有一条**记录（没有 = 这一档还停在「录过就算数」）；
 *   ② 记录必须写得清「谁 / 什么时候 / 按哪条命令复核的」（空着或写「稍后」都算没写）；
 *   ③ 记录**不许**挂在不存在的档上（删了一档，账要同批抹掉）。
 * 「多久没跑算旧」由**人**按读数决定 —— 判据把 `freshnessAge` 算出来摆在输出里，
 * 但不下一个会随机器与运气变化的阈值。
 *
 * 谁写它：各档的跑法脚本（`e2e-run.mjs` / `full-suite-run.mjs` / `artifact-run.mjs`）
 * 在**跑绿之后**刷新这一档的记录（录入档除外 —— 录入本身不是自证）。
 * 「跑一次就记一次账」，「定期跑」这件事因此有了落点。
 *
 * ⚠️ **键是「哪一档」而不是「哪个平台」**：分辨两条账抄没抄混的是 `trackedBy` 那一栏
 * （它写清这条记录是**哪一个跑法**证出来的），而不是档名的形状。
 *
 * 读写两半共用同一份实现，是因为判据说「这一档有账」而跑法脚本说「没有」时，
 * 两边都得能指出是哪一条 —— 各抄一份清点代码就是 §12.12 的孪生对。
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 「这条账是谁写的」—— 环境变量优先，其次 `git config user.name`，最后回退到入参。
 *
 * 顺序是有理由的：CI / NPC 工作区里 `git config user.name` 常常是空的或是个占位，
 * 而那一格是这条账存在的意义（「谁、什么时候、按哪条命令复核的」里那个「谁」）。
 *
 * @param {string} fallback
 * @returns {string}
 */
export function gitUser(fallback) {
  return (
    process.env.GIT_AUTHOR_NAME ||
    spawnSync("git", ["config", "user.name"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout?.trim() ||
    fallback
  );
}

/**
 * 一档新鲜度账的**登记处**：账文件 + 那一档的键 + 可读的名字。
 *
 * 差异是**数据**而不是 `if (kind === ...)` 的分支：三档的区别就是这几栏的值
 * （账文件 / 键 / 名字 / 「怎么跑」那条命令 / 输入面），把差异写成分支就得到一份带开关的
 * 实现，而开关会随「第四档」的加入变成多向分支 —— 那正是 §12.12 要拦的孪生对。
 *
 *   · `daily` —— 这一档是否按「每天首次提交带一次凭证」判。
 *   · `dirty` / `dirtyHow` / `graceMs` —— 「改了就当天跑」那一层读的三栏：输入面清单、
 *     不吃这一档的那条出路、没动输入面时的宽限。
 *   · `skipHow` —— 记一条「写明理由的豁免」那条命令。它是**另一条出路**而不是绕过：
 *     留下的是一条能复核的事实。
 *
 * @type {Record<string, {ledger: string, key: string, label: string, run: string, daily: boolean, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}>}
 */
export const FRESHNESS_TRACKS = {
  e2e: {
    ledger: "scripts/.e2e-freshness.json",
    key: "e2e",
    label: "全量 e2e",
    run: "pnpm test:e2e",
    daily: true,
    skipHow: 'node scripts/e2e-run.mjs --skip "<理由>"',
    /* 这一档**不吃输入面**（`dirty` 为空）：它的结论与改了哪几个文件无关 ——
     * 同一份 spec 在任何改动上都该绿。所以它没有「这次改动不吃这一档」那条出路
     * （`dirtyHow` 即 null），也不需要宽限（按日历日判）。 */
    dirty: [],
    dirtyHow: null,
    graceMs: 0,
    /* 这一档**不吃输入面**（`dirty` 为空）：它的结论与改了哪几个文件无关。 */
  },
  full: {
    ledger: "scripts/.full-suite-freshness.json",
    key: "full",
    label: "全量单测 + 覆盖率门槛",
    run: "pnpm run test:coverage",
    daily: true,
    skipHow: 'node scripts/full-suite-run.mjs --skip "<理由>"',
    dirty: ["src/", "tests/"],
    dirtyHow: 'node scripts/full-suite-run.mjs --dirty "<理由>"',
    graceMs: 7 * 86_400_000,
  },
  artifact: {
    ledger: "scripts/.artifact-freshness.json",
    key: "artifact",
    label: "产物级护栏（build + 数产物）",
    run: "pnpm run build",
    daily: true,
    skipHow: 'node scripts/artifact-run.mjs --skip "<理由>"',
    dirty: [
      "next.config.js",
      "src-tauri/",
      "scripts/build-desktop.mjs",
      "scripts/standalone-private-inputs.mjs",
      "scripts/standalone-runtime.mjs",
      "scripts/build-executor-host.mjs",
    ],
    dirtyHow: 'node scripts/artifact-run.mjs --dirty "<理由>"',
    graceMs: 7 * 86_400_000,
  },
};
/**
 * 取一档的登记（未知的 kind 是**编码错误**，抛而不是回落 —— 回落会让「新加一档却忘了
 * 登记」表现成「按键名当档名」而照样跑绿）。
 *
 * @param {string} kind `FRESHNESS_TRACKS` 的键
 * @returns {{ledger: string, key: string, label: string, run: string, daily: boolean, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}}
 */
export function freshnessTrack(kind) {
  const track = FRESHNESS_TRACKS[kind];
  if (!track) {
    throw new Error(
      `[freshness-ledger] 未登记的新鲜度档：${kind}（可选：${Object.keys(FRESHNESS_TRACKS).join(" / ")}）`,
    );
  }
  return track;
}

/**
 * 新鲜度记录的形状（**读写共用这一份**：各写一套时记出来的会被自己的校验判成缺字段）。
 *
 * 五栏必在（各管一件事，缺一栏这条账就退化），末栏按输入可选：
 *   · `key` —— 是**哪一档**（登记里的 `key`，如全量 e2e 那一档的 `e2e`）。
 *     写成通用名而不是 `platform`，是因为「档」不等于平台。
 *   · `verifiedAt` / `who` —— 「上一次被实证跑绿是什么时候、谁跑的」。
 *   · `how` —— **能照着重跑的那条命令**（这就是你要写 `pnpm test:e2e` 而不是「跑过了」的原因）。
 *   · `trackedBy` —— 这条记录属于**哪一个跑法**（`FRESHNESS_TRACKS` 的键）。它是几份账
 *     唯一的形状差异，作用是把「A 档的绿被记进 B 档的账」这类抄混当场照出来。
 *   · `skippedReason` / `dirtyReason` —— **两栏都可选**，各回答一件不同的事：
 *     `skippedReason` 是「今天故意不跑」，`dirtyReason` 是「这次改动不吃这一档」。
 *     各把一句话写进账面（核对它们的是同一份 `isUsableSkipReason`），
 *     它们合起来让账面上分得开「今天跑过」「今天说好不跑」「这次不吃它」三件事
 *     —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都声明不吃它」长得一模一样。
 *     所以本函数返回的**不是**一份固定栏数的记录。
 *
 * @param {{key: string, verifiedAt: string, who: string, how: string, trackedBy: string, skippedReason?: unknown, dirtyReason?: unknown}} input
 * @returns {{key: string, verifiedAt: string, who: string, how: string, trackedBy: string, skippedReason?: string, dirtyReason?: string}}
 */
export function freshnessRecord({
  key,
  verifiedAt,
  who,
  how,
  trackedBy,
  skippedReason,
  dirtyReason,
}) {
  /** @type {{key: string, verifiedAt: string, who: string, how: string, trackedBy: string, skippedReason?: string, dirtyReason?: string}} */
  const record = {
    key: key.trim(),
    verifiedAt: verifiedAt.trim(),
    who: who.trim(),
    how: how.trim(),
    trackedBy: trackedBy.trim(),
  };
  /* 两栏「不跑」的理由都在这里透传 —— **两栏都得列**：只透传 `skippedReason` 时，
   * `--dirty` 写下的那句会**在这一步被静默丢掉**（`freshnessRecord` 只搬它认识的键），
   * 于是账面上剩一条没有任何理由的记录、而 `verifiedAt` 是今天 ⇒ 判据当它「今天自证过」
   * 放行。那正是本条最不能有的形态：一个看着正常的记录指的是另一件事。
   *
   * 两栏各管一件事：`skippedReason` = 今天故意不跑；`dirtyReason` = 这次改动不吃这一档。
   * 两者都要能复核（同一份 `isUsableSkipReason` 核对），区别只在**读起来不一样**
   * —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都声明不吃它」长得一模一样。 */
  for (const [field, value] of /** @type {const} */ ([
    ["skippedReason", skippedReason],
    ["dirtyReason", dirtyReason],
  ])) {
    if (typeof value === "string" && value.trim()) record[field] = value.trim();
  }
  return record;
}

/**
 * 豁免理由的下限 —— 「有人回答过」与「没回答」要长得不一样。
 *
 * 占位词（「稍后」「待定」「TBD」…）与过短的理由都判不可用：豁免不是绕过，它留下的
 * 是一条**能被复核的事实**，而「稍后」什么都没留下。
 *
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isUsableSkipReason(reason) {
  const text = String(reason ?? "").trim();
  if (text.length < 8) return false;
  return !/^(稍后|待定|下次|回头|todo|tbd|na|n\/a)$/i.test(text);
}

/** 这一跑**是不是整档**——三档跑法（e2e / 全量单测 / 产物）共用的一条形状判据。
 *
 * 为什么需要它（实测踩到）：三档都支持把额外参数**透传**给底层命令，于是
 * `node scripts/e2e-run.mjs --help` 会让 Playwright 打一段 usage 就**退 0** ——
 * 而记账只看退出码的话，这一条 `--help` 就给「全量 e2e」买到了一整天的凭证。
 * 同理 `--grep @critical`（只跑一档的子集）、`--list`（不执行）、
 * 以及指到单个文件的过滤跑：它们退 0 只说明「那件较小的事成了」，
 * 不构成「整档绿了」的事实。
 *
 * **账的价值全在它是事实**：`freshnessVerdict` 拿它替「今天有没有人自证过」作证，
 * 所以任何「没跑整档却记上整档」的路径都必须堵在这里，而不是靠人事后心虚。
 *
 * @param {string[]} [extra] 将要透传给底层命令的参数（`--dry-run` 由调用方先摘掉）
 * @returns {{ok: boolean, why: string | null}} `why` 给话术用，`ok` 给判决用
 */
export function isWholeTrackRun(extra = []) {
  const passthrough = (Array.isArray(extra) ? extra : [])
    .map((a) => String(a ?? "").trim())
    .filter((a) => a !== "");
  if (passthrough.length === 0) return { ok: true, why: null };
  return {
    ok: false,
    why:
      `本次透传了参数（${passthrough.join(" ")}）—— 跑的不是整档，` +
      "拿不到整档的凭证（要记账就一次参数都不带地跑完它）",
  };
}

/**
 * 「退出码 0 但跑的不是整档」那一拍的话术 —— 三档共用一份，只差档名与记账入口。
 *
 * 为什么要单独一份而不是复用「✗ 未通过 … 不记账」那句：这一拍**不是红**。拿红的话术
 * 打它，输出会自相矛盾（写着「未通过」、括号里却是退出码 0），而这三档各写一遍必然
 * 分叉（§12.12），所以形状与措辞都留在这里。
 *
 * @param {{label: string, command: string, why: string | null}} input
 * @returns {string} 一整段（以换行结尾），调用方只需再加 `[<runner>] ` 前缀
 */
export function notWholeTrackNotice({ label, command, why }) {
  return (
    `○ 这一跑退出码 0，但**不记账**：${why ?? "原因未记明"}。\n` +
    `        要替「${label}」记一笔，就一次参数都不带地跑完它：${command}\n`
  );
}

/**
 * 「同一个**日历日**」的判据 —— 「每天首次提交」按本地时区日界判，不按 24 小时窗口。
 *
 * 人的记忆与工作节奏都是按日历日走的（「今天提交过了吗」），而滚动窗口会把昨天 23:00
 * 与今天 08:00 算成连续两次，于是今天早晨的第一次被静默跳过。
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
export function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 「这一档的输入面**今天**被改过」的判据 —— 三档「每天首次」里代价高的那两档读它。
 *
 * 为什么要有它（而不是一律按日历日判）：全量 e2e 人人都跑得动、结论与改了哪几个文件
 * 无关，所以「当天第一次提交带一次凭证」是句正当的话；而全量单测 + 覆盖率（10 分钟量级）
 * 与产物级护栏（`next build` + 数产物）**没必要每天都跑** —— 没碰 `src/` 的一天跑一遍，
 * 换来的是十分钟墙钟与一个不会变的结论。那两档真正想要的是「**改了就当天跑**」。
 *
 * 口径：`track.dirty` 是**路径前缀**（不是 glob）—— 前缀足够表达「这一档吃哪个目录」，
 * 而 glob 会把「为什么这条没命中」变成一处要现场调试的正则。空数组 = 这一档不改输入面
 * （= 每天都得自证），与 `dirty` 缺省同义。
 *
 * `at` 是**账上那次自证的时刻**：它比 `now` 早或同在 `dirtySince` 之后，就算这一档
 * 已经被今天的改动自证过了。比 `now` 早是常态（改动与自证之间隔着几小时）。
 *
 * @param {{dirty?: string[]}} track
 * @param {string[]} changed 当天改动过的文件（相对仓库根、POSIX 分隔符）
 * @returns {boolean}
 */
export function dirtiesTrack(track, changed) {
  const prefixes = track.dirty ?? [];
  if (prefixes.length === 0) return false;
  return changed.some((rel) => prefixes.some((p) => rel.startsWith(p)));
}

/**
 * 「每天首次」那一档的判决话术（三档共用一份，差异由 `track` 的数据决定）。
 *
 * 抽成纯函数是为了让**每一档的每一条边界**都能被真跑一次：`checkFreshnessLedger`
 * 里那段内联实现此前只服务一档，参数化之后若还写在里面，「dirty 档在没动输入面的那天
 * 放行」这条边界就永远不会被任何东西走到（那是 §11.18.3.1 那族的静默漏报）。
 *
 * 三种形态，每一种对应一句**可执行**的话：
 *   · 今天已有自证（`at` 不早于今天日界，或晚于 `dirtySince`）⇒ 放行；
 *   · 今天动过输入面而账还停在改动之前 ⇒ 拦，动作是「现在跑一次」；
 *   · 没动输入面但已经旧过 `graceMs` ⇒ 拦，动作是「跑一次，或记一条 `--dirty` 说明」。
 *
 * @param {{track: {label: string, run: string, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}, at: Date, now: Date, dirtySince: Date | null}} input
 * @returns {string | null} 拦下时给一句问题；放行时 null
 */
export function freshnessVerdict({ track, at, now, dirtySince }) {
  /* `dirtySince` 只对**吃输入面**的那几档有意义（`track.dirty` 非空）。不吃的那一档
   * （全量 e2e）收到一个非 null 的 `dirtySince` 时**必须忽略它** —— 否则「今天动过一次
   * 任何文件」会被读成「这一档已经被自证了」，于是「每天首次」那条判据在有人动过代码的
   * 日子里**整个失效**（而账面上看不出任何异常）。 */
  const since = (track.dirty ?? []).length > 0 ? dirtySince : null;
  const dirtyHows = [
    `跑一次 \`${track.run}\`（跑绿即记）`,
    track.skipHow ? `记一条写明理由的豁免：\`${track.skipHow}\`` : null,
  ].filter(Boolean);
  const how = `\n        记账：${dirtyHows.join("，或")}。`;
  /* 今天已经自证过：日界比一次（`at` 落在今天），或这次自证的时刻晚于当天的第一次
   * 改动 —— 后者是「先改后跑」与「先跑后改」两种顺序都要放行的那一条边界。 */
  if (isSameLocalDay(at, now)) return null;
  if (since && at.getTime() >= since.getTime()) return null;
  if ((track.dirty ?? []).length === 0) {
    return (
      `今天还没有自证 —— 上一次跑绿在 "${at.toISOString()}"，不是今天。` + how
    );
  }
  if (since) {
    return (
      `今天的提交动过这一档的输入面（${track.dirty.join(" / ")}），而它还没有自证 —— ` +
      `上一次跑绿在 "${at.toISOString()}"，早于当天的第一次改动。` +
      how +
      (track.dirtyHow
        ? `\n              若这次改动确实不吃这一档：\`${track.dirtyHow}\`。`
        : "")
    );
  }
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (track.graceMs > 0 && now.getTime() - at.getTime() <= track.graceMs) {
    return null;
  }
  return (
    `已经 ${days} 天没有自证（上一次跑绿在 "${at.toISOString()}"），` +
    `超过了 ${Math.round(track.graceMs / 86_400_000)} 天的宽限。` +
    how +
    (track.dirtyHow
      ? `\n              若近期改动确实不吃这一档：\`${track.dirtyHow}\`。`
      : "")
  );
}

/**
 * 校验一份新鲜度账（`{档 → 记录}`）。空 = 放行。
 *
 * 四个方向都拦：缺档（还停在「录过就算数」）/ 记录写不全（没人能按它去复核）/
 * 挂在非登记档上（删平台不抹账，账就退化成一份没人认领的名单）/
 * **记录被写错了跑法**（`trackedBy` 与这份账不是同一个 —— 两条账抄混时，
 * 「跑过一次」与「跑过的是哪一个」会变成两件事，而账面上看着完全正常）。
 *
 * @param {Record<string, unknown>} ledger
 * @param {{required: string[], registered: string[], track: {ledger: string, key: string, label: string, run: string, daily: boolean, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}, kind: string, now?: Date, dirtySince?: Date | null}} scope
 *   `required` = 必须有记录的档（登记档减去正在登记中的档）；`registered` = 全部登记档（孤儿检查）；
 *   `track` = 这一份账的登记（话术里要给出「去哪个文件补、按哪条命令跑」，
 *   它同时决定 `daily` / `skipHow` 那两条分叉）；
 *   `kind` = 这一份账属于哪个跑法（`trackedBy` 的比对基准）；
 *   `now` = 判「今天有没有自证」用的时钟（`track.daily` 那一档才读它；用例可注入）；
 *   `dirtySince` = **今天动过这一档输入面**的那个提交时刻（没有则 null）。只有
 *     `track.dirty` 非空的档读它 —— 那两档按「改了就当天跑」判，而不是「每天一次仪式」。
 *     `track.dirty` 为空的那一档收到非 null 的 `dirtySince` 时**必须忽略它**。
 * @returns {string[]} 问题清单
 */
export function checkFreshnessLedger(
  ledger,
  {
    required,
    registered,
    track,
    kind,
    now = new Date(),
    dirtySince = null,
  },
) {
  /** @type {string[]} */
  const problems = [];
  for (const key of required) {
    const entry = ledger[key];
    if (entry === undefined || entry === null) {
      problems.push(
        `${track.label}（${key}）没有新鲜度记录 —— 这一档现在是「录过一次就算数」：` +
          "没有任何东西说清它上一次被实证跑绿是什么时候、按哪条命令。" +
          `跑一次 \`${track.run}\`（绿即可记账，见 scripts 下对应的跑法脚本），` +
          `或在 ${track.ledger} 里手工补一条。`,
      );
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(
        `${track.label}（${key}）的新鲜度记录不是对象 —— 形状见 freshnessRecord。`,
      );
      continue;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    /* 每一栏的下限只挡「空着 / 明显是占位」的形状，不拿字数去判「写得好不好」：
     * `who` 是个人名（"月读" 两个字完全够用），拿统一的字数门槛会把合法值判红 ——
     * 而一个会误杀合法输入的判据，下场是被人整条绕开。`how` 要的是**能照着重跑**的命令，
     * 所以它另有一档下限（一条真命令不会短于几字符）。 */
    /** @type {Array<[string, number]>} */
    const minChars = [
      ["verifiedAt", 4],
      ["who", 2],
      ["how", 6],
    ];
    for (const [field, min] of minChars) {
      const value = String(rec[field] ?? "").trim();
      if (value.length < min) {
        problems.push(
          `${track.label}（${key}）的新鲜度记录里 ${field} 没写清（"${value}"）—— ` +
            (field === "how"
              ? "这一栏要写**能照着重跑的那条命令**（写「稍后」「已复核」等于没写）。"
              : "这一栏是这条账存在的全部意义：谁、什么时候、按哪条命令复核的。"),
        );
      }
    }
    const at = String(rec.verifiedAt ?? "").trim();
    if (at && Number.isNaN(Date.parse(at))) {
      problems.push(
        `${track.label}（${key}）的 verifiedAt（"${at}"）不是一个能解析的日期 —— ` +
          "记账要能算「多久没跑」，写「最近」等于没写。",
      );
    }
    /* 跑法必须对得上：两条账同形，抄混一次就会让「这一档被证过绿」变成一句
     * 不成立的话，而账面上看不出任何异常（都是合法的日期 + 人名 + 命令）。 */
    const by = String(rec.trackedBy ?? "").trim();
    if (by !== kind) {
      problems.push(
        `${track.label}（${key}）的记录写着它由「${by || "(空)"}」跑法证出来，` +
          `而这份账属于「${kind}」—— 两条新鲜度账同形，抄混之后账面上完全正常，` +
          "只有这一栏能把它们分开。",
      );
    }
    /* 「每天首次」那一档多一条判据：这一次自证必须是**今天**的（或一条写明理由的豁免）。
     * 它只判日历日，不判「多久算旧」—— 阈值仍然不写进判据。
     * 记录写不清时上面已经拦过，这里只在形状成立时才比日期，免得同一件事报两遍。
     *
     * 三档「每天首次」**不等价**，差异全在 `track.dirty` 上（数据，不是分支）：
     *   · `dirty` 为空（全量 e2e）—— 这一档的代价最低（人人都跑得动），而且它的结论
     *     与「改了哪几个文件」没有关系（同一份 spec 在任何改动上都该绿）。所以直接按
     *     日历日判：当天第一次提交必须带一次凭证。
     *   · `dirty` 非空（全量单测 + 覆盖率 / 产物级护栏）—— 这两档**没必要每天都跑**：
     *     没碰 `src/` 的一天跑一遍全量单测，换来的是 10 分钟墙钟与一个不会变的结论。
     *     所以它按「**当天有没有提交动过这一档的输入面**」判（`dirtyCoveredOnDay`）：
     *     动过才要今天自证；没动过则以 `graceMs` 为宽限 —— 超过宽限、或当天动过而没自证
     *     ⇒ 两头都拦。这条把「每日执行」从「每天一次仪式」改成了「**改了就当天跑**」，
     *     而后者才是这三档真正想要的。 */
    /* 判「这一档今天要不要凭证」读的是 `daily` 那一栏数据（不是按档名写死：
     * 新增一档忘了在这里补一条 = 那一档谁都不判）。 */
    if (track.daily) {
      /* 「不跑」有两种，形状各自成立、**互不等于**：`skippedReason`（今天故意不跑）与
       * `dirtyReason`（这次改动不吃这一档）。两者都放行，但都要能复核 —— 混成一栏之后，
       * 账面上就分不出「这一档一直没人跑」与「每次都声明不吃它」。 */
      const waiver = ["skippedReason", "dirtyReason"].find(
        (f) => typeof rec[f] === "string" && rec[f].trim(),
      );
      const waiverUsable =
        waiver !== undefined && isUsableSkipReason(rec[waiver]);
      /* **豁免只替它写在的那一天作证。**
       *
       * 这不是新口径，是把已有口径接上判据：写入侧 `writeSkipRecord` 把 `verifiedAt`
       * 戳成「此刻」，`--skip` 的用法原文写着「**今天**不跑，记一条写明理由的豁免」
       * （`e2e-run.mjs` 的文件头），而那一段注释点名的要防形态正是
       * 「这一档三个月没跑」与「这三个月每次都说不跑」长得一模一样。
       * 此前判据在这一支**从不比这个日期** —— 一条理由一旦写下就替未来每一天作证，
       * 于是「每日自证」这一档在有人懒得跑的日子里其实一直是绿的，而台面上看不出来。
       * 本机实测：`scripts/.e2e-freshness.json` 挂着一条 2026-10-08 的豁免，
       * 此后 e2e 那 80 条 spec（29 条 `@critical`）没有一次被自动跑过。
       *
       * 过期之后**不另判一种红**，而是把这一档交回它自己的口径：`freshnessVerdict`
       * 读 `dirty` / `graceMs` / `dirtySince`，所以「不必每天跑」的两档照样有宽限，
       * 而按日历日判的 e2e 那档当场要今天的凭证 —— 差异仍然全在数据上，不在分支里。 */
      const waiverMs = waiverUsable ? Date.parse(at) : Number.NaN;
      const waiverToday =
        !Number.isNaN(waiverMs) && isSameLocalDay(new Date(waiverMs), now);
      if (waiver && !waiverUsable) {
        problems.push(
          `${track.label}（${key}）的${waiver === "dirtyReason" ? "「不吃这一档」" : "豁免"}理由` +
            `（"${String(rec[waiver]).trim()}"）不算「有人回答过」—— ` +
            `留下的是一条能被复核的事实，占位词与过短的理由什么都没留下。` +
            `写清这次为什么不跑，或直接跑一次 \`${track.run}\`。`,
        );
      } else if (
        waiverToday &&
        waiver === "dirtyReason" &&
        dirtySince !== null &&
        (track.dirty ?? []).length > 0
      ) {
        /* 「这次改动不吃这一档」是一句**能被当天的事实驳倒**的话。
         *
         * `dirtySince` 就是这一档输入面今天的第一个提交 —— 两者同时成立时那句不成立。
         * 存量现场：`scripts/.full-suite-freshness.json` 里有一条写着
         * 「本 PR 只接三档每日自证的机制（scripts/ + tests/ + docs），未动 src/」，
         * 而这一档的输入面正是 ["src/", "tests/"]：那句话与写下它的那次提交相反。
         * 旧判据从不拿 `dirtySince` 去核这句，于是整档当天免跑，而账面上完全正常
         * （合法的日期 + 人名 + 一条读得通的理由）—— 与 §11.23 那一族同形。
         *
         * `skippedReason` **不**受这条反驳：它承认这一档相关、只声明今天没跑，
         * 所以只受日期过期约束（每天都要重写一次）。两条出路的分工正在这里 ——
         * 一条声明事实（可以被核伪），一条陈述决定（只能过期）。 */
        problems.push(
          `${track.label}（${key}）的 \`dirtyReason\` 说这次改动不吃这一档，而今天有提交` +
            `动过它的输入面（${track.dirty.join(" / ")}，第一个在 "${dirtySince.toISOString()}"）` +
            " —— 这句话与事实相反。\n" +
            `        出路：跑一次 \`${track.run}\`（跑绿即记）。` +
            "确实只改文档、这一档不受影响时不必写 `--dirty`（那条是事实声明）；" +
            "今天故意不跑就写 `--skip`，那句是决定、只替今天作证。",
        );
      } else if (!waiverToday) {
        const ms = Date.parse(at);
        if (!Number.isNaN(ms)) {
          const at2 = new Date(ms);
          const stale = freshnessVerdict({ track, at: at2, now, dirtySince });
          if (stale) {
            problems.push(
              `${track.label}（${key}）${stale}` +
                (waiver
                  ? `\n        （上一条是${waiver === "dirtyReason" ? "「不吃这一档」" : "豁免"}、写在 "${at}" —— ` +
                    `上面那句里的日期是**那次回答的时刻**，不是跑绿的凭证。` +
                    `豁免只替它写在的那一天作证；过了当天，这一档回到自己的口径上判。）`
                  : ""),
            );
          }
        }
      }
    }
  }
  for (const key of Object.keys(ledger)) {
    if (!registered.includes(key)) {
      problems.push(
        `新鲜度账里记着 ${key}，但它不在这一份账的登记口径里（${registered.join(" / ")}）—— ` +
          "删掉某一档就要同批抹账，否则这张表会退化成一份没人认领的名单。",
      );
    }
  }
  return problems;
}

/**
 * 读一份新鲜度账；读不出（不存在 / 坏 JSON / 不是对象）返回 `{}`。
 *
 * 抽在这里而不是每个跑法脚本各写一份：两条账要**同一套**「读不出就等于一档都没记」
 * 的语义 —— 各写一份时，一边把坏 JSON 当成空账（判红、话术正确），另一边把它当成
 * 「解析失败但先放行」，而后者不报错、只是静默少守一条。
 *
 * @param {string} root 仓库根
 * @param {string} rel 账文件相对路径（`FRESHNESS_TRACKS[*].ledger`）
 * @returns {Record<string, unknown>}
 */
export function readFreshnessLedgerAt(root, rel) {
  try {
    const parsed = /** @type {unknown} */ (
      JSON.parse(readFileSync(path.join(root, rel), "utf8"))
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return {};
  }
}

/**
 * 把一档的**跑绿**写进它那份账（返回给输出用的一句读数）。
 *
 * 三条边界（从各档跑法脚本内联那段收上来的，由几条账共用）：
 *   · **只有「检查档」记**：录基线 / 录快照本身**不是**自证。
 *   · **只有绿了才记**：红着的时候记一条「我跑过」会把「跑过」与「跑绿过」混成一件
 *     事，而那正是这条账要防的。
 *   · **写账失败不算跑法失败**：跑法的结论已经拿到了，返非零会把两件事混成一句
 *     「跑法挂了」。所以只提示、由调用方决定。
 *
 * 返回 `{ note, previous }`：`note` 是给人读的一句（写盘失败时也带着失败原因），
 * `previous` 是**写之前**那一档上次自证距今多久（账的价值在于被看见，不是被写下来）。
 *
 * **两件事各是一栏，回答的是两个不同的问题**（缺任一条这层账就退化）：
 *   · `key` —— **记给哪一档**。缺省回退到 `track.key`；分档的跑法（按平台或按环境）
 *     必须显式传那一档的键，否则「另一档录一次」只会写进当前键、那一档永远「没有记录」。
 *   · `how` —— **「实际跑绿的那条命令」，不是这一档的名义跑法**。
 *     缺省取 `track.run`（绝大多数跑法只有一种形状）；跑法有多种形状时（降并发、指定档）
 *     必须写出真实的那一条，否则账面上看不出「这次是怎么证的」，
 *     下一个人按名义命令复跑又红、却指不出差别在哪。
 *
 * @param {{root: string, kind: string, who: string, key?: string, how?: string}} args
 * @returns {{note: string, previous: string | null}}
 */
export function writeFreshness({ root, kind, who, key, how }) {
  const track = freshnessTrack(kind);
  const writeKey = key ?? track.key;
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessAge(ledger[writeKey]);
  ledger[writeKey] = freshnessRecord({
    key: writeKey,
    verifiedAt: new Date().toISOString(),
    who,
    how: how && how.trim() ? how.trim() : track.run,
    trackedBy: kind,
  });
  try {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch (err) {
    return {
      previous,
      note:
        `（记账失败：${err instanceof Error ? err.message : String(err)} —— ` +
        `${track.label}的结论仍然有效，手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记账（上次自证：${previous ?? "无记录"}）—— ` +
      `改 ${track.ledger} 时请连同提交，它是「这一档上次跑绿在什么时候」的唯一事实。`,
  };
}

/**
 * 把一档的**豁免**写进它那份账 —— 「今天不跑，但理由有人回答过」。
 *
 * 与 `writeFreshness` 的唯一区别是记的形状：那一份带的是「跑绿的日期」，这一份带的是
 * `skippedReason`。两者都能让「每天首次」那条判据放行，但**读起来不一样** ——
 * 账面上因此看得出「今天跑过」和「今天说好不跑」不是同一件事（豁免不是绕过）。
 *
 * 理由不合用（过短 / 占位）时**抛**，由调用方转成退出码：与其记一条没有信息的账
 * 让人以为「已经处理过」，不如当场把这条命令退回去。
 *
 * @param {{root: string, kind: string, who: string, reason: unknown, field?: "skippedReason" | "dirtyReason"}} args
 *   `field` 缺省是「豁免」（`skippedReason`）；`dirtyReason` 是「这次改动不吃这一档」。
 * @returns {{note: string, previous: string | null}}
 */
export function writeSkipRecord({ root, kind, who, reason, field }) {
  const track = freshnessTrack(kind);
  /* `field` 区分**两种**「不跑」：`skippedReason`（今天故意不跑，理由要能复核）与
   * `dirtyReason`（这次改动确实不吃这一档）。两者都让判据放行，但账面上必须看得出
   * 它们不是同一件事 —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都说不吃它」
   * 会长得一模一样，而那正是这张账要防的形态。 */
  const written = field ?? "skippedReason";
  if (written === "skippedReason" && !track.skipHow) {
    throw new Error(`[freshness-ledger] ${kind} 档没有「豁免」这条出路`);
  }
  if (!isUsableSkipReason(reason)) {
    throw new Error(
      `[freshness-ledger] 理由（"${String(reason ?? "").trim()}"）不算「有人回答过」—— ` +
        "写清这次为什么不跑（占位词与过短的理由都被拦）。",
    );
  }
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessAge(ledger[track.key]);
  ledger[track.key] = freshnessRecord({
    key: track.key,
    verifiedAt: new Date().toISOString(),
    who,
    how: track.run,
    trackedBy: kind,
    [written]: String(reason).trim(),
  });
  try {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch (err) {
    return {
      previous,
      note:
        `（记账失败：${err instanceof Error ? err.message : String(err)} —— ` +
        `手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记一条${written === "skippedReason" ? "豁免" : "「不吃这一档」"}（上次自证：` +
      `${previous ?? "无记录"}）—— 理由写在 ${track.ledger} 的 ${written} 里，改它时请连同提交。`,
  };
}

/**
 * 「这一档上次被跑绿距今多久」—— 给输出用的一句读数（**不是判据**）。
 *
 * 只在记录写得全、日期解得开时给；否则返回 null（缺日期时算一个天数毫无意义，
 * 而把 null 当 0 天读会把「没记」显示成「刚刚跑过」）。
 *
 * @param {unknown} entry
 * @param {Date} [now] 便于用例喂固定时钟
 * @returns {string | null}
 */
export function freshnessAge(entry, now = new Date()) {
  if (entry === null || typeof entry !== "object") return null;
  const at = String(
    /** @type {Record<string, unknown>} */ (entry).verifiedAt ?? "",
  ).trim();
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const days = Math.floor((now.getTime() - ms) / 86_400_000);
  if (days < 0) return null;
  return days === 0 ? "今天" : `${days} 天前`;
}