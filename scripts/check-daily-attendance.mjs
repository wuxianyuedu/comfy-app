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
 * node scripts/check-daily-attendance.mjs --from <文件> --now <ISO 时刻>  # 离线：读一份已取回的构建列表 JSON，且把「现在」钉住
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

/**
 * 翻页的单位（一页几条）。**它不是窗口** —— 窗口只有上面那一把尺子；这条只决定
 * 「一次问平台要多少行」。忙的一天里 60 条只回到约 7.5 小时，所以它单独盖不住 36h。
 */
export const FETCH_PAGE_SIZE = 60;

/**
 * 往回最多翻几页 —— **上界不是「够了」的结论**：撞到它就拿 `covered=false` 收，
 * 由调用方念「没取满窗口 ⇒ 不判」。（按实测密度 36h 约 4 页，留一倍余量。）
 */
export const FETCH_MAX_PAGES = 8;

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
 * 两份形状写成 `@typedef` + `@property`（每行带中文说明），不写多行内联
 * `@param {{…}}`：内联那种类型的**续行**会被注释语言判据（§12.4.6）当普通注释行读，
 * 而 `any` / `details` 这类标识符凑够三个词就构成「疑似英文句子」—— 实测在这里红过一次。
 *
 * @typedef {object} AttendanceInput
 * @property {any[]} builds 平台列表那份（项里要有 `event` / `createTime` / `sn`）
 * @property {Array<{sn: string, json: any}>} [details] `sn → get-build-status -v 那份 JSON` 的配对；可为空 ⇒ 判「取不到逐格」
 * @property {number} now 现在时刻（毫秒）
 * @property {number} [windowHours] 窗口小时数，缺省取 `DEFAULT_WINDOW_HOURS`
 *
 * @typedef {object} AttendanceVerdict
 * @property {"present" | "absent" | "cancelled" | "running" | "unknown"} verdict 落在哪一档
 * @property {number} code 三态退码：0 出勤 / 1 缺勤 / 2 没结论或取不到读数
 * @property {string} headline 念给人的那一句
 * @property {string[]} evidence 逐格读数
 * @property {number | null} ageHours 距「现在」几小时；认不出来时 null
 * @property {string | null} sn 判的是哪一跑；一次派发都没有时 null
 *
 * @param {AttendanceInput} input 列表 + 逐格详情 + 现在时刻
 * @returns {AttendanceVerdict} 判定与逐格读数
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
 * 取**一页**构建列表（**不按事件过滤** —— 每日类有三个事件名、其中那个 crontab 还带小时，
 * 过滤条件本身就是一条会漂的清单；拿回整份再按前缀认，见 `isDailyDispatch`）。
 *
 * `ci-build-readout.mjs` 的 `fetchBuildList()` 是按单一事件查的，所以这里只能自己发一次
 * 同形状的命令 —— 复用的是它那条 `cnbJson` 通道，不是重拼 `cnb` 的起法。
 *
 * 平台按 `createTime` **新→旧**返回（实测第 1 页最早 08:59Z、第 2 页 03:06Z 起，中间无空洞），
 * 所以「翻到某页的最早一条已经早于地平线」就是覆盖判定的依据 —— 不必拿顺序去赌。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {number} page 第几页（从 1 起）
 * @param {number} pageSize 一页几条
 * @returns {any[] | null} 这一页；取不到时 null（由调用方念「未校验」）
 */
function fetchBuildPage(run, slug, page, pageSize = FETCH_PAGE_SIZE) {
  const res = cnbJson(run, [
    "build",
    "get-build-logs",
    "--repo",
    slug,
    "--page",
    String(page),
    "--page-size",
    String(pageSize),
    "-v",
  ]);
  return asBuildArray(res?.json);
}

/**
 * 一页里最早那条的时刻（列表新→旧 ⇒ 取最后一项）。认不出来回 null。
 *
 * @param {any[]} builds 一页或整份列表
 * @returns {number | null} 毫秒时刻
 */
function oldestCreateTime(builds) {
  const rows = Array.isArray(builds) ? builds : [];
  const last = rows[rows.length - 1];
  const parsed = Date.parse(String(last?.createTime ?? ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 按**时间地平线**取数：翻页往回取，直到最早一条早于 `now - windowHours`、或翻到列表末尾、
 * 或撞到页数上界。
 *
 * 为什么不是「取最近 N 条就够」（ISSUE #2392）：**N 条折算多久由当天多忙决定，不由判据决定**。
 * 实测会话密集的一天里 60 条只回到 7.5 小时，而这里声明的窗口是 36 小时 —— 于是
 * 「窗口内没有每日派发」这句话有一半概率其实是「我没取到」。判据把前者念出来，账上就落成
 * **假缺勤**（出勤那侧退 1）或**假「无事可立」**（立案那侧被 `--no-block` 按成 0，平台读数是
 * 一格 success）。盖不住就明说盖不住，这一格按未校验收 —— 「取不到」既不是「没有」也不是「绿」。
 *
 * @param {{run:(cmd:string,args:string[])=>any, slug:string, windowHours:number,
 *   now?:number, pageSize?:number, maxPages?:number}} input 窗口与执行者
 * @returns {{list:any[]|null, covered:boolean, pages:number, oldestMs:number|null, note:string}}
 *   `list=null` 是第一页就没取到；`covered=false` 是**没资格判「窗口内没有」**
 */
export function fetchBuildsCoveringWindow({
  run,
  slug,
  windowHours,
  now = Date.now(),
  pageSize = FETCH_PAGE_SIZE,
  maxPages = FETCH_MAX_PAGES,
}) {
  const horizonMs = now - windowHours * 3_600_000;
  /** @type {any[]} */
  const list = [];
  let pages = 0;
  /** @type {number | null} */
  let oldestMs = null;
  let exhausted = false;
  /** @type {string | null} 中途断掉的原因（没断就是 null） */
  let broke = null;
  while (pages < maxPages) {
    const batch = fetchBuildPage(run, slug, pages + 1, pageSize);
    if (batch === null) {
      broke = `第 ${pages + 1} 页取不到（已翻 ${pages} 页）`;
      break;
    }
    pages += 1;
    list.push(...batch);
    oldestMs = oldestCreateTime(batch) ?? oldestMs;
    /* 不满一页 = 平台后面没有更多历史了：这时窗口**天然被盖住**（再往回是空，不是没取到）。 */
    if (batch.length < pageSize) {
      exhausted = true;
      break;
    }
    if (oldestMs !== null && oldestMs <= horizonMs) break;
  }
  const covered =
    broke === null &&
    (exhausted || (oldestMs !== null && oldestMs <= horizonMs));
  const span = `${pages} 页 / ${list.length} 条 · 最早 ${
    oldestMs === null ? "(认不出时刻)" : new Date(oldestMs).toISOString()
  }`;
  return {
    list: pages === 0 && broke !== null ? null : list,
    covered,
    pages,
    oldestMs,
    note:
      broke ??
      (covered
        ? `取满窗口（${windowHours}h）：${span}${exhausted ? " · 已到列表末尾" : ""}`
        : `没取满 ${windowHours}h 窗口，撞在页数上界：${span}`),
  };
}

/**
 * 给「挑出来的那几跑」补取逐格详情。
 *
 * 返回里**带着列表那一侧的 sn**：`get-build-status -v` 只给 `status` + `pipelinesStatus`
 * （实测），自己说不出它是哪一跑。对齐只能在这里做 —— 让判定去「拿第一条详情凑到最近那次
 * 派发上」是张冠李戴的形状。
 *
 * ⚠️ 这个函数**只管取，不管挑**（`isDailyDispatch` 那一刀留在 `fetchDailyDetails`）：
 * 「哪几跑要取详情」在两个消费点上答案不同 —— 每日档按事件认「上一跑」，PR 档取的是
 * **这一跑自己**（它带着 `CNB_BUILD_ID`，压根不用认事件）。把过滤写死在这里，
 * 第二个消费点就只能抄一份（§12.12）。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {any[]} builds 列表（调用方已挑好，按执行顺序）
 * @returns {Array<{sn:string,json:any}>} 详情（取不到的那跑就不出现，不冒充成「跑坏了」）
 */
export function fetchBuildDetails(run, slug, builds) {
  const out = [];
  for (const build of (Array.isArray(builds) ? builds : []).slice(0, 3)) {
    const sn = String(build?.sn ?? "");
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
 * 最近几跑里**每日类派发**的逐格详情（最多三跑，够定位「上一次」）。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {any[]} builds 列表
 * @returns {Array<{sn:string,json:any}>} 详情（取不到的那跑就不出现）
 */
export function fetchDailyDetails(run, slug, builds) {
  return fetchBuildDetails(
    run,
    slug,
    (Array.isArray(builds) ? builds : []).filter(isDailyDispatch),
  );
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
  /* 「现在」也要能钉住：夹具里的派发时刻是**绝对时刻**，而窗口比的是「距现在多久」
   * ⇒ 不钉住 now，这一档就会随真实时间推移自己变红（2026-10-24 现场：夹具写的是
   * 10-22 16:00Z，真实时间到 10-24 08:21Z 已隔 40.4h > 36h ⇒ 一条本该恒绿的离线
   * 用例红成「每日缺勤」，并把这一档变成「随时间漂移的平台状态判据」）。
   * 解析：纯数字当毫秒，其余当 ISO 时刻；解析不出来按「没给」处理。 */
  const nowFlag = flagValue(argv, "--now");
  const nowParsed = /^\d+$/.test(nowFlag) ? Number(nowFlag) : Date.parse(nowFlag);
  const now = env.now ?? (Number.isNaN(nowParsed) ? Date.now() : nowParsed);
  /** @type {{list:any[],details:any[],failure:string|null}} */
  let source;
  /**
   * 覆盖自证（念出「翻了几个窗口、最早一条是什么时候」）：让「窗口内没有派发」这句话
   * **带着依据出场**，而不是一句孤零零的缺勤（ISSUE #2392）。
   *
   * @type {{label:string, text:string} | null}
   */
  let coverage = null;
  const from = flagValue(argv, "--from");
  if (from) {
    source = readOffline(from);
    coverage = {
      label: "离线档不证明覆盖",
      text:
        "这份列表是谁取的谁负责 —— 它盖到多久以前不在判据的量程里，" +
        "所以「窗口内没有派发」在这一档只能当**候选结论**（要自证就别带 --from）",
    };
    /* 离线档**必须**钉住「现在」：不钉就用真实时间去判一个绝对时刻，等于让判据自己
     * 摸真实时间（§13.5.13 那条：什么时候去问平台、什么时候算现在，都是调用者的事）。
     * 缺了 ⇒ 落成「未校验」并说清，不猜。 */
    if (env.now === undefined && Number.isNaN(nowParsed)) {
      source = {
        ...source,
        failure:
          source.failure ??
          "--from 那一档必须同时钉住「现在」（--now <ISO 时刻> 或 --now <毫秒>）",
      };
    }
  } else {
    const run =
      env.run ?? makeRunner(fileURLToPath(new URL(".", import.meta.url)));
    /* `flagValue` 对「没给这个旗标」回**空串**，而空串不是 nullish —— `??` 兜不住，
     * 于是 `--repo` 会被交成一个空字符串，表现就是「取不到构建列表」
     * （实测踩过：把 null 换成空串的那一次改动，在线那一跳当场落到红档）。要显式判空。 */
    const repoFlag = flagValue(argv, "--repo");
    const slug =
      env.slug ?? (repoFlag === "" ? "moon-read/comfy-app-t3" : repoFlag);
    const win = fetchBuildsCoveringWindow({
      run,
      slug,
      windowHours,
      now,
    });
    if (win.list === null) {
      source = {
        list: [],
        details: [],
        failure:
          "取不到构建列表（`cnb` 起不来 / 网络不通 / 返回不是 JSON）—— 判据自身不做重试",
      };
    } else if (!win.covered) {
      /* 这一格是整个判据最坏的形状在这里：窗口没盖住就往下单念「缺勤」，是把「我没取到」
       * 写成「它没跑」（ISSUE #2392）。所以这里**不进判决**，落成未校验（退 2 不算绿）。 */
      source = {
        list: [],
        details: [],
        failure: `取数没盖住窗口 —— ${win.note}；「窗口内没有派发」这句话在这上面不成立`,
      };
    } else {
      source = {
        list: win.list,
        details: fetchDailyDetails(run, slug, win.list),
        failure: null,
      };
      coverage = { label: "取数覆盖自证", text: win.note };
    }
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
  /** JSON 里多带一句覆盖自证（只有拿得出来的时候才多这个键，形状不凭空长）。 */
  const payload = coverage ? { ...out, coverage } : out;
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`[daily-attendance] ${out.headline}`);
    /* 「窗口内没有派发」这句话必须有依据才能念，而依据是**取数盖到了多久以前**。
     * 成功路径上把它一起打出来：不印就等于让读者只看见结论（§11.23 那一族）。 */
    if (coverage) console.log(`[daily-attendance] ${coverage.label}：${coverage.text}`);
    for (const line of out.evidence) console.log(line);
  }
  return out.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
