#!/usr/bin/env node
/**
 * 每日那一跑的**出勤**判定档（ISSUE #2114 出路 1；规范 §13.5.23 末节）。
 *
 * ## 它补的是哪一格
 *
 * 三档重档（`全量单测` / `生产构建` / `全量E2E`）与 `ESLint 零警告` 的**唯一执行者**是
 * 平台上的每日那一跑（§13.5.21）。而「执行者在平台」这句话此前只有**在册**那一半有人守：
 * `tests/no-platform-ci-config.test.ts` 判的是「那一格**名字**在每日清单里」。
 * 2026-10-18 → 10-22 那五派发零跑完（两次没落到这台机、一次被 8640s 墙钟掐、
 * 一次被同一把锁取消、一次睡满 3.0h）期间**账面全绿** —— 没有任何一条判据答得出
 * 「昨天那一跑到底有没有执行」。在册 ≠ 出勤：本文件把后半句变成一个可失败的事实。
 *
 * ## 判什么、不判什么（每件都有别的出处，这里不重做）
 *
 *  · **判**：窗口内最近一次「每日类」派发在不在、跑成了哪一档、隔多久了；
 *  · **不判**「这一跑红在哪」—— 那是 `ci-build-readout.mjs` 的 `classifyBuildOutcome()`
 *    （绿 / 真失败 / 被取消 / 没结论四档，含「哪一格被取消、下面哪几格根本没跑」），
 *    本文件只**调它**，不在这里再写一份格级判定（写第二份就是 §12.12 的孪生）；
 *  · **不判**清单是不是全的 —— 那是 `no-platform-ci-config` 的活；
 *  · **不认具体钟点**：`crontab` 的事件名**含小时**，而 10-22 一天内换过两次
 *    （`0 4` → `0 2` → `0 0`）⇒ 按 `crontab:` **前缀**认事件，绝不写死时刻。
 *    三条触发口（定时 / 手点 / API）按 §13.5.23 跑的是同一件事，所以都算出勤。
 *
 * ## 三态退码（与 `ci-build-readout` / `base-check` 同口径）
 *
 *  · `0` 出勤：窗口内有一次逐格跑完且为绿的每日派发；
 *  · `1` 缺勤：窗口内没有每日派发，或最近那一次是「真失败」；
 *  · `2` **没有结论 / 没跑到**：最近那一次被取消、还在跑、取不到逐格读数，
 *    或者根本联系不上平台。这一档**既不是绿也不是红** —— 「被取消」说成红就是替平台
 *    编一个不存在的产物问题（那条口径见 `ci-build-readout.mjs` 头注），而「拿不到测量」
 *    并进红会让这条判据自己说谎。
 *
 * ## 用法
 *
 * ```text
 * pnpm check:daily-attendance                    # 上网读平台（人 / 代理决定什么时候问）
 * pnpm check:daily-attendance --json             # 机器可读那份
 * pnpm check:daily-attendance --hours 12         # 收紧窗口（默认 36h = 每天一次 + 半天余量）
 * node scripts/check-daily-attendance.mjs --from <文件> # 离线：读一份已取回的构建列表 JSON
 * ```
 *
 * 网络那一跳**只在被要求时发生** —— 判据自身不做网络请求（§13.5.13 同一口径：
 * `git fetch` 是人的动作，这里同理：跑它的人就是决定「现在去不去问平台」的人）。
 * 起 `cnb` 一律经 `ship-exec.mjs` 的 `makeRunner`（它是 pnpm 全局垫片，Node 直接
 * spawn 会 ENOENT —— 那一份形态判据已有出处，不在这里重拼）。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cnbJson, makeRunner } from "./ship-exec.mjs";
import {
  classifyBuildOutcome,
  downstreamSkipped,
} from "./ci-build-readout.mjs";

/** 一天一次 + 半天余量：补派与延迟落地（实测有 04:00 事件 08:42 才落的那次）都吃得下。 */
export const DEFAULT_WINDOW_HOURS = 36;

/** 0 出勤 / 1 缺勤（真失败或压根没有派发）/ 2 没有结论、没跑到，或取不到读数。 */
export const CODE = { PRESENT: 0, ABSENT: 1, NO_VERDICT: 2 };

/**
 * 这一条构建算不算「每日那一跑」的一次派发。
 *
 * 按前缀认 `crontab:`（事件名里带小时 ⇒ 换时刻不需要改这里），外加两条手点 / API 触发口。
 *
 * @param {any} build 平台列表里的一项
 * @returns {boolean} 是不是每日类
 */
export function isDailyDispatch(build) {
  const event = String(build?.event ?? "");
  return (
    event.startsWith("crontab:") ||
    event === "web_trigger_daily" ||
    event === "api_trigger_daily"
  );
}

/**
 * 从一批构建里挑出最近一次每日类派发。
 *
 * @param {any[]} builds 列表（项里要有 `event` / `createTime` / `sn`）
 * @returns {any | null} 最近那一次；一次都没有时回 null
 */
export function latestDailyDispatch(builds) {
  const daily = (Array.isArray(builds) ? builds : [])
    .filter(isDailyDispatch)
    .sort((a, b) =>
      String(b?.createTime ?? "").localeCompare(String(a?.createTime ?? "")),
    );
  return daily[0] ?? null;
}

/**
 * 「列表 + 逐格详情 + 现在时刻」→ 一句结论（纯函数，用例从这里注入）。
 *
 * @param {{
 *   builds: any[];
 *   details?: Array<{sn:string,json:any}>;
 *   now: number;
 *   windowHours?: number;
 * }} input `details` 是「sn → `get-build-status -v` 那份 JSON」的配对（可为空 ⇒ 判「取不到逐格」）
 * @returns {{
 *   code: number;
 *   verdict: "present" | "absent" | "cancelled" | "running" | "unknown";
 *   headline: string;
 *   evidence: string[];
 *   ageHours: number | null;
 *   sn: string | null;
 * }} 判定与逐格读数
 */
export function judgeAttendance({
  builds,
  details = [],
  now,
  windowHours = DEFAULT_WINDOW_HOURS,
}) {
  const latest = latestDailyDispatch(builds);
  if (!latest) {
    return {
      code: CODE.ABSENT,
      verdict: "absent",
      headline:
        "缺勤 ✗ 构建列表里一次每日类派发都没有（事件以 `crontab:` 开头，或 web_trigger_daily / api_trigger_daily）",
      evidence: [],
      ageHours: null,
      sn: null,
    };
  }
  const sn = String(latest.sn ?? "");
  const created = Date.parse(String(latest.createTime ?? ""));
  if (Number.isNaN(created)) {
    return {
      code: CODE.NO_VERDICT,
      verdict: "unknown",
      headline: `未校验 ? 最近一次每日派发「${sn}」的 createTime 读不出时间 —— 不构成结论`,
      evidence: [],
      ageHours: null,
      sn,
    };
  }
  const ageHours = (now - created) / 3_600_000;
  const evidence = [
    `最近一次每日派发：${sn} · 事件 ${latest.event} · ${latest.createTime}（${ageHours.toFixed(1)} 小时前）`,
  ];
  /* 按 sn 对齐：详情自己说不出它是哪一跑（见 `fetchDailyDetails`），所以配对必须由调用方带上。 */
  const detail = details.find((d) => String(d?.sn ?? "") === sn)?.json ?? null;
  if (!detail) {
    return {
      code: CODE.NO_VERDICT,
      verdict: "unknown",
      headline: `未校验 ? 「${sn}」取不到逐格读数 —— 拿不到测量不等于结论是红的`,
      evidence,
      ageHours,
      sn,
    };
  }
  /* 逐格判定整个交给 ci-build-readout（它那份四档是现成的，这里再写一份就是孪生）。 */
  const outcome = classifyBuildOutcome(detail);
  evidence.push(
    `逐格：${outcome.configured.length} 格有结论 · 判定 ${outcome.state}（平台原文 ${outcome.raw || "?"}）`,
  );
  for (const s of outcome.failed.slice(0, 5)) {
    evidence.push(`  · 真失败 ${s.name}`);
  }
  for (const s of outcome.cancelled.slice(0, 5)) {
    evidence.push(`  · 被取消 ${s.name}`);
  }
  const dragged = downstreamSkipped(outcome);
  if (dragged.length > 0) {
    evidence.push(
      `  · 被它带下去、根本没跑的格：${dragged.map((s) => s.name).join("、")}`,
    );
  }

  if (outcome.state === "green" && ageHours <= windowHours) {
    return {
      code: CODE.PRESENT,
      verdict: "present",
      headline: `出勤 ✓ ${sn} 在 ${ageHours.toFixed(1)} 小时前跑完，每一格都有 success 结论`,
      evidence,
      ageHours,
      sn,
    };
  }
  if (outcome.state === "green") {
    return {
      code: CODE.ABSENT,
      verdict: "absent",
      headline: `缺勤 ✗ 最近一次每日派发是绿的，但已经 ${ageHours.toFixed(1)} 小时没有下一次（窗口 ${windowHours}h）`,
      evidence,
      ageHours,
      sn,
    };
  }
  if (outcome.state === "failed") {
    return {
      code: CODE.ABSENT,
      verdict: "absent",
      headline: `缺勤 ✗ ${sn} 那一跑有格真失败：${outcome.failed.map((s) => s.name).join("、") || "（没点到格）"}`,
      evidence,
      ageHours,
      sn,
    };
  }
  if (outcome.state === "cancelled") {
    return {
      code: CODE.NO_VERDICT,
      verdict: "cancelled",
      headline: `没结论 ? ${sn} 那一跑被取消 —— 它没有验证过任何产物，下一动作是重跑，不是去查产物（#2114 记的那条锁退化就是这个形状）`,
      evidence,
      ageHours,
      sn,
    };
  }
  if (outcome.state === "running") {
    return {
      code: CODE.NO_VERDICT,
      verdict: "running",
      headline: `没结论 ? ${sn} 还在跑（等它到终态再看）`,
      evidence,
      ageHours,
      sn,
    };
  }
  return {
    code: CODE.NO_VERDICT,
    verdict: "unknown",
    headline: `未校验 ? ${sn} 的读数形状不认识（state=${outcome.state}）—— 不替平台编结论`,
    evidence,
    ageHours,
    sn,
  };
}

/**
 * 把平台那份「一层套一层」的返回收成数组。
 *
 * `cnb … -v` 的 JSON 是 `{status, header, data: {total, data: [...]}}`（实测：
 * `x-cnb-total: 1959` 那一页），所以列表在 `json.data.data` —— 只看 `json.data`
 * 会拿到一个对象，然后判据念出一句「取不到构建列表」。这一层解包写得宽容，
 * 是因为两种形状（列表直挂 / 套一层）在真实返回里都出现过。
 *
 * @param {any} json 解析出来的响应
 * @returns {any[] | null} 数组；认不出形状回 null（由调用方念「未校验」）
 */
function asBuildArray(json) {
  const first = json?.data ?? json;
  if (Array.isArray(first)) return first;
  if (Array.isArray(first?.data)) return first.data;
  return null;
}

/**
 * 取最近的构建列表（**不按事件过滤** —— 每日类有三个事件名、其中那个 crontab 还带小时，
 * 过滤条件本身就是一条会漂的清单；拿回整份再按前缀认，见 `isDailyDispatch`）。
 *
 * `ci-build-readout.mjs` 的 `fetchBuildList()` 是按单一事件查的，所以这里只能自己发一次
 * 同形状的命令 —— 复用的是它那条 `cnbJson` 通道，不是重拼 `cnb` 的起法。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {number} pageSize 取几跑
 * @returns {any[] | null} 列表；取不到时 null（由调用方念「未校验」）
 */
export function fetchRecentBuilds(run, slug, pageSize = 60) {
  const res = cnbJson(run, [
    "build",
    "get-build-logs",
    "--repo",
    slug,
    "--page-size",
    String(pageSize),
    "-v",
  ]);
  return asBuildArray(res?.json);
}

/**
 * 对最近几跑里的每日类派发补取逐格详情（最多三跑，够定位「上一次」）。
 *
 * 返回里**带着列表那一侧的 sn**：`get-build-status -v` 只给 `status` + `pipelinesStatus`
 * （实测），自己说不出它是哪一跑。对齐只能在这里做 —— 让判定去「拿第一条详情凑到最近那次
 * 派发上」是张冠李戴的形状。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {any[]} builds 列表
 * @returns {Array<{sn:string,json:any}>} 详情（取不到的那跑就不出现，不冒充成「跑坏了」）
 */
export function fetchDailyDetails(run, slug, builds) {
  const out = [];
  for (const build of (Array.isArray(builds) ? builds : [])
    .filter(isDailyDispatch)
    .slice(0, 3)) {
    const sn = String(build.sn ?? "");
    if (sn === "") continue;
    const res = cnbJson(run, [
      "build",
      "get-build-status",
      "--repo",
      slug,
      "--sn",
      sn,
      "-v",
    ]);
    if (res?.json) out.push({ sn, json: res.json });
  }
  return out;
}

/**
 * 从 `--from` 那份 JSON 取构建（离线档）。认两种形状：一份列表，或一跑详情。
 *
 * @param {string} file 路径
 * @returns {{list:any[],details:Array<{sn:string,json:any}>,failure:string|null}} 读不出时 failure 说清
 */
export function readOffline(file) {
  if (!existsSync(file)) {
    return { list: [], details: [], failure: `--from 那个路径不存在：${file}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return {
      list: [],
      details: [],
      failure: `--from 那份不是能解析的 JSON：${/** @type {Error} */ (e).message}`,
    };
  }
  const list = asBuildArray(parsed);
  if (list) {
    /* 列表里**没有逐格读数**，所以不拿它当详情：`get-build-logs` 的构建级 `success`
     * 掩盖的正是「某一格被取消、下面几格根本没跑」那一族形状（#2114 的现场），
     * 拿它判「每一格都执行过」就是替平台下结论。⇒ 让它落到「取不到逐格 = 未校验」。 */
    return { list, details: [], failure: null };
  }
  /* 单跑详情那份：要求它**认得出自己是谁**。`get-build-status -v` 实测只返回
   * `status` + `pipelinesStatus` —— 没有 `event` 就没有「这是不是每日派发」的依据，
   * 没有 `createTime` 就没有「在不在窗口里」的依据。少了这两样还硬判，就是把判据
   * 写成「拿一份形状像的 JSON 就能凑出结论」，那正是本文件存在的理由要反对的东西。
   * ⇒ 明说取不到，退「未校验」，并把出路给出来（用列表那份，或直接跑在线档）。 */
  const one = parsed?.data ?? parsed;
  const looksLikeBuild =
    one &&
    typeof one === "object" &&
    (one.pipelinesStatus !== undefined ||
      (typeof one.status === "string" && one.status !== ""));
  if (!one || !looksLikeBuild) {
    return {
      list: [],
      details: [],
      failure: "--from 那份 JSON 既不是列表也不是单跑详情",
    };
  }
  if (typeof one.event !== "string" || typeof one.createTime !== "string") {
    return {
      list: [],
      details: [],
      failure:
        "这份单跑详情里没有 event / createTime，认不出它是不是每日派发（`get-build-status -v` 就是这份形状）—— 用列表那份 JSON，或直接跑不带 --from 的在线档",
    };
  }
  const item = {
    sn: String(one.sn ?? ""),
    event: one.event,
    createTime: one.createTime,
    status: String(one.status ?? ""),
  };
  return {
    list: [item],
    details: [{ sn: item.sn, json: parsed }],
    failure: null,
  };
}

/**
 * 取一个 `--<flag> <值>` 形态的参数（没给回空串 —— 这几格「没给」与「给了空值」是同一件事）。
 *
 * @param {string[]} argv 进程参数
 * @param {string} flag 旗标名
 * @returns {string} 值，或空串
 */
function flagValue(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? "" : (argv[at + 1] ?? "");
}

/**
 * 命令行入口。
 *
 * @param {string[]} [rawArgv] 进程参数（不含 node 与脚本名）；测试可注入
 * @param {{run?:(cmd:string,args:string[])=>any,now?:number,slug?:string}} [env]
 *   注入面：执行者与「现在」（不注入就真上网、真取当前时间）
 * @returns {number} 退出码
 */
export function main(rawArgv, env = {}) {
  const argv = rawArgv ?? process.argv.slice(2);
  const asJson = argv.includes("--json");
  const windowHours = Number(
    flagValue(argv, "--hours") || DEFAULT_WINDOW_HOURS,
  );
  const now = env.now ?? Date.now();
  /** @type {{list:any[],details:any[],failure:string|null}} */
  let source;
  const from = flagValue(argv, "--from");
  if (from) {
    source = readOffline(from);
  } else {
    const run =
      env.run ?? makeRunner(fileURLToPath(new URL(".", import.meta.url)));
    /* `flagValue` 对「没给这个旗标」回**空串**，而空串不是 nullish —— `??` 兜不住，
     * 于是 `--repo` 会被交成一个空字符串，表现就是「取不到构建列表」
     * （实测踩过：把 null 换成空串的那一次改动，在线那一跳当场落到红档）。要显式判空。 */
    const repoFlag = flagValue(argv, "--repo");
    const slug =
      env.slug ?? (repoFlag === "" ? "moon-read/comfy-app-t3" : repoFlag);
    const list = fetchRecentBuilds(run, slug);
    source = list
      ? {
          list,
          details: fetchDailyDetails(run, slug, list),
          failure: null,
        }
      : {
          list: [],
          details: [],
          failure:
            "取不到构建列表（`cnb` 起不来 / 网络不通 / 返回不是 JSON）—— 判据自身不做重试",
        };
  }
  const out = source.failure
    ? {
        code: CODE.NO_VERDICT,
        verdict: "unknown",
        headline: `未校验 ? ${source.failure}`,
        evidence: [],
        ageHours: null,
        sn: null,
      }
    : judgeAttendance({
        builds: source.list,
        details: source.details,
        now,
        windowHours,
      });
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[daily-attendance] ${out.headline}`);
    for (const line of out.evidence) console.log(line);
  }
  return out.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
