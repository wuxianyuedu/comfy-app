#!/usr/bin/env node
/**
 * `check-mirror-attendance.mjs` —— GitHub 镜像那一格的**出勤**判定档（ISSUE #3046；规范 §13.5.23 同族）。
 *
 * ## 它补的是哪一格
 *
 * 「把 CI 负担从 cnb 挪一部分到 GitHub」这条线的前置是一句：**GitHub 侧到底有没有在跑**。
 * 这句话此前没有只读出口 —— 镜像仓库是私有的（匿名 `GET /repos/wuxianyuedu/comfy-app` = 404），
 * 而唯一能证明「推过去并派发了」的东西躺在 cnb 那一格的**日志正文**里，每次都要人手工去翻
 * （#3047 之前连那一格的名字都点不到，因为 `endStages` 整族掉在取数面外）。
 * 本文件把那个动作收成入口：`在册 ≠ 出勤` 这一条口径的镜像版（#2114 那一族）。
 *
 * ## 为什么出勤只能从正文认（这是 #3051 换来的一个必然后果）
 *
 * 那一格现在是主列的**读数档**：带 `--readout`，恒不退非零 —— 为的是「它坏了不许把门禁的红
 * 洗成绿，也不许把自己的红叠进门禁的账」。代价是**它的 `status` 不再是判决**：
 * 推送失败的那一跑，格子上照样写 `success`（实测 `cnb-vj3-1k6ddf69d`：`status=success`、
 * 正文 `推送失败（exit 128）：schannel: server closed abruptly`）。所以这一档认的是正文里
 * 那句三态原值，而不是平台给的状态词 —— 拿 status 判出勤会把「推不通」念成「天天出勤」。
 *
 * ## 判什么、不判什么
 *
 *  · **判**：窗口内的 PR 跑里，那一格有没有至少一次「已推 + 已派发」，没有的话各是什么形状；
 *  · **不判** GitHub 那侧的 workflow 有没有跑成 —— 那要令牌与仓库侧的读权，本仓够不着
 *    （那是「回读格」那一单的事，#3051 期望第 3 条）；
 *  · **不判**这一格该不该承重 —— 它是读数档，本文件不改它的退码语义；
 *  · 逐格分类只调 `ci-build-readout.mjs` 那一份（`classifyBuildOutcome` / `findStageMatches` /
 *    `fetchStageDetail` / `normalizeStageContent`），这里不写第二份取数（§12.12）；
 *  · 窗口覆盖自证与「钉住现在」的口径沿用 `check-daily-attendance.mjs`（#2392 那条：
 *    没取满窗口就不许念「窗口内没有」）。
 *
 * ## 三态退码（与 `check-daily-attendance.mjs` 同口径）
 *
 *  · `0` 出勤：窗口内至少一跑念得出「已推 · 已派发」；
 *  · `1` 缺勤：取到了这一格的正文，但一次都没有 present（逐形状点名 + 各几次）；
 *  · `2` 没结论：列表取不到 / 窗口没盖满 / 一格正文都没取到 / 那些跑里根本没有这一格
 *    （前移未生效或不是 PR 档）。**退 2 不算绿，也不算红。**
 *
 * ## 用法
 *
 * ```text
 * pnpm check:mirror-attendance                       # 默认 24h 窗口、最多读 3 跑正文
 * pnpm check:mirror-attendance --hours 72 --limit 5
 * pnpm check:mirror-attendance --json                # 机器可读（逐跑形状 + 覆盖自证）
 * ```
 */
import { cnbJson, makeRunner } from "./ship-exec.mjs";
import {
  classifyBuildOutcome,
  fetchStageDetail,
  findStageMatches,
} from "./ci-build-readout.mjs";
import { CODE, fetchBuildsCoveringWindow } from "./check-daily-attendance.mjs";

/** 被问的那一格的名字（`.cnb.yml` 主列，#3051 起）。认格名而不是认 id：id 会随位置漂。 */
export const MIRROR_STAGE_NAME = "GitHub 镜像同步";

/** 缺省窗口（小时）：镜像是「每条 PR」的事，24h 足够答「最近有没有通过一次」。 */
export const DEFAULT_WINDOW_HOURS = 24;

/** 最多取几跑的正文（每跑两跳：状态 + 正文）。取太少会造出**假缺勤**：实测默认 3 时读到的是
 * egress + push-failed + no-cell，而第 4 新的一跑（`cnb-8uu-1k6dbf7oc`）写的是「已推 · 已派发」——
 * 面比结论窄就是 #2392 那一族，所以这里按「够撞到一次 present」留余量，而不是按省请求数定。 */
export const DEFAULT_DETAIL_LIMIT = 8;

/** 「已推 + 已派发」那句原话的两半（`ci-github-mirror-push.mjs` 的成功分支）。 */
const PUSHED_MARK = "已推";
const DISPATCHED_MARK = "已派发";

/**
 * 形状的机器可读键 → 一句下一动作。
 *
 * 四种失败形状**各有自己的下一动作**（#3046 记的实测：把它们念成同一句会让人去查错的层）：
 * 探针那一跳的三类由 `explainRemoteProbeFailure()` 分（egress / 仓库没建 / 身份够不到），
 * 推送与派发那两跳的形态在这里单独成键 —— 它们不经那个函数。
 *
 * @type {Record<string, string>}
 */
export const SHAPE_NOTES = {
  present: "通了：这一跑推到镜像仓并派发了 ⇒ GitHub 侧应当有对应 run（那一问归回读格）",
  egress: "节点到 github.com 的出网没通 ⇒ 白名单 / 代理 / 换 runner，与令牌和判据都无关",
  "repo-missing": "目标仓库不存在或这枚身份看不见它 ⇒ 先建仓库 / 配 fine-grained PAT 的仓库范围",
  "token-scope": "令牌被拒或够不到该仓库 ⇒ 换/补令牌的 contents:write 与仓库范围",
  "push-failed": "探针通了而推送失败（含 schannel/TLS 断流）⇒ 断点在写那一跳，不在令牌值上",
  "dispatch-rejected": "推成了、派发被 API 拒 ⇒ 看 HTTP 码那一句，多是事件名/权限形态",
  "missing-prereq": "上下文没凑齐（令牌 / IID / HEAD 之一缺席）⇒ 检查 imports 与 PR 事件字段",
  "no-cell": "这一跑里没有那一格 ⇒ 前移（#3051）还没生效、或这一跑不是 PR 质量门禁档",
  unreadable: "格子找到了而正文取不到 ⇒ 平台那一侧没给读数，不构成「它没跑」的证据",
};

/**
 * 把一格 `GitHub 镜像同步` 的正文分成一个形状键。
 *
 * 判据只用**脚本自己写出的那几句**（不猜、不做关键词大杂烩）：成功那句、三句失败结论、
 * 以及「推送前这一读没通」后面 `explainRemoteProbeFailure()` 给的那三类话术。
 *
 * @param {string} text 剥过 ANSI 的正文（`normalizeStageContent` 那一份）
 * @param {string} stageStatus 平台给的格状态（小写）；只为认「压根没跑」那一支
 * @returns {{shape: keyof typeof SHAPE_NOTES, evidence: string}} `evidence` 是命中的那句原话片段
 */
export function classifyMirrorText(text, stageStatus = "") {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 实参源自平台 API 正文，类型按 string 标窄
  const t = String(text ?? "");
  /** 命中形状的那一句原话片段（截到 160 字 —— 证据行不许变成日志转储）。 */
  const line = (/** @type {RegExp} */ re) => {
    const m = re.exec(t);
    return m ? m[0].trim().slice(0, 160) : "";
  };
  if (t.includes(PUSHED_MARK) && t.includes(DISPATCHED_MARK)) {
    return { shape: "present", evidence: line(/\[mirror\].*已派发[^\n]*/) };
  }
  if (t.includes("没跑起来的原因")) {
    return { shape: "missing-prereq", evidence: line(/没跑起来的原因[^\n]*/) };
  }
  if (t.includes("派发被拒")) {
    return { shape: "dispatch-rejected", evidence: line(/派发被拒[^\n]*/) };
  }
  if (t.includes("推送失败")) {
    return { shape: "push-failed", evidence: line(/(推送失败[^\n]*|fatal:[^\n]*)/) };
  }
  if (t.includes("推送前这一读没通")) {
    /* 探针那一跳已经由 `explainRemoteProbeFailure()` 分成三类，这里照它写出的话术接住。 */
    if (t.includes("这一跳没通")) {
      return { shape: "egress", evidence: line(/(这一跳没通[^\n]*|fatal:[^\n]*)/) };
    }
    if (t.includes("先去建仓库") || t.includes("不存在")) {
      return { shape: "repo-missing", evidence: line(/(目标仓库[^\n]*|fatal:[^\n]*)/) };
    }
    if (t.includes("身份够不到")) {
      return { shape: "token-scope", evidence: line(/(这枚令牌[^\n]*|fatal:[^\n]*)/) };
    }
    return { shape: "token-scope", evidence: line(/(推送前这一读没通[^\n]*|fatal:[^\n]*)/) };
  }
  if (stageStatus === "skipped") {
    return { shape: "no-cell", evidence: "status=skipped（这一格在这跑根本没执行）" };
  }
  return { shape: "unreadable", evidence: line(/\[mirror\][^\n]*/) };
}

/**
 * 取一跑里那一格的正文读数。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} sn 构建号
 * @returns {{found:boolean, stageId:string, status:string, shape:string, evidence:string}}
 */
export function readMirrorCell(run, slug, sn) {
  const miss = { found: false, stageId: "", status: "", shape: "no-cell", evidence: "" };
  const statusJson = cnbJson(run, ["build", "get-build-status", "--repo", slug, "--sn", sn, "-v"]);
  if (!statusJson?.json) {
    return { ...miss, shape: "unreadable", evidence: "get-build-status 取不到" };
  }
  const outcome = classifyBuildOutcome(statusJson.json);
  const { hits } = findStageMatches(outcome, MIRROR_STAGE_NAME);
  const hit = hits.length === 1 ? hits[0] : undefined;
  if (!hit) {
    /* 0 个 = 这一跑没有这一格（前移未生效 / 不是 PR 档）；>1 个 = 同名多格，
     * **不替你挑一格** —— 挑错会把另一档的读数念成这一档的结论，而它同样带着正文、
     * 看起来就像证据（与 `findStageMatches` 那条「认不出就停手」同一口径）。 */
    if (hits.length === 0) {
      return miss;
    }
    return {
      ...miss,
      shape: "unreadable",
      evidence: `同名格 ${hits.length} 个（${hits.map((h) => h.pipeline.name || h.pipeline.id).join("、")}）⇒ 不挑一格`,
    };
  }
  const detail = fetchStageDetail(run, slug, sn, hit.pipeline.id, hit.stage.id);
  if (!detail) {
    return {
      found: true,
      stageId: hit.stage.id,
      status: hit.stage.status,
      shape: "unreadable",
      evidence: "这一格的正文取不到",
    };
  }
  const text = detail.text;
  const read = classifyMirrorText(text, hit.stage.status);
  return {
    found: true,
    stageId: hit.stage.id,
    status: hit.stage.status,
    shape: read.shape,
    evidence: read.evidence,
  };
}

/**
 * 出结论：**不取数**，只对已有的逐跑读数做判决（可离线测的那一半）。
 *
 * @param {{builds:any[], readings:Array<{sn:string,found:boolean,shape:string,evidence:string}>, windowHours:number, now:number}} input
 * @returns {{code:number, verdict:string, headline:string, evidence:any[],
 *   stats:{shapeCounts:Record<string,number>, windowBuilds:number, seen:number, present:number}}}
 */
export function judgeMirrorAttendance({ builds, readings, windowHours, now }) {
  const horizonMs = now - windowHours * 3_600_000;
  const inWindow = (Array.isArray(builds) ? builds : []).filter((b) => {
    const ms = Date.parse(String(b?.createTime ?? ""));
    return !Number.isNaN(ms) && ms >= horizonMs;
  });
  /** @type {Record<string, number>} */
  const shapeCounts = {};
  for (const r of (Array.isArray(readings) ? readings : [])) {
    shapeCounts[r.shape] = (shapeCounts[r.shape] ?? 0) + 1;
  }
  const seen = (Array.isArray(readings) ? readings : []).filter((r) => r.shape !== "no-cell");
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- Record 索引缺键时运行时为 undefined（未开 noUncheckedIndexedAccess）
  const presentCount = shapeCounts.present ?? 0;
  const stats = {
    shapeCounts,
    windowBuilds: inWindow.length,
    seen: seen.length,
    present: presentCount,
  };
  if (presentCount > 0) {
    /* 「最近那一跑」取的是**读数顺序上的第一条 present**（调用方按平台给的执行序交进来）。 */
    const first = seen.find((r) => r.shape === "present");
    return {
      code: CODE.PRESENT,
      verdict: "present",
      headline:
        `出勤 ✓ 最近读的 ${readings.length} 跑里 ${presentCount}/${seen.length} 跑「已推 · 已派发」` +
        `（最近：${first?.sn ?? "(未点到)"}）· 窗口 ${windowHours}h 内共 ${inWindow.length} 跑`,
      evidence: seen.map((r) => ({ sn: r.sn, shape: r.shape, note: SHAPE_NOTES[r.shape] ?? "" })),
      stats,
    };
  }
  if (seen.length === 0) {
    return {
      code: CODE.NO_VERDICT,
      verdict: "unknown",
      headline:
        `没结论 ? 窗口 ${windowHours}h 内取了 ${(Array.isArray(readings) ? readings : []).length} 跑，没有一跑里有「${MIRROR_STAGE_NAME}」这一格 —— ` +
        "「GitHub 没出勤」这句话在这上面不成立（前移未生效 / 这一批跑不是 PR 质量门禁档）",
      evidence: (Array.isArray(readings) ? readings : []).map((r) => ({
        sn: r.sn,
        shape: r.shape,
      })),
      stats,
    };
  }
  const named = Object.entries(shapeCounts)
    .filter(([shape]) => shape !== "present")
    .map(([shape, n]) => `${shape}×${n}`)
    .join("、");
  /* 主语是**读到的那些跑**，不是整个窗口：正文按 `--limit` 逐跑取，窗口里的 PR 跑远多于它。
   * 把「最近三跑零次推成」念成「窗口内零次推成」就是 #2392 那一族（判据窗口比取数面大），
   * 所以这里同时念出未逐跑读的那几跑，让读者知道结论的量程在哪儿。 */
  const unread = Math.max(0, inWindow.length - readings.length);
  return {
    code: CODE.ABSENT,
    verdict: "absent",
    headline:
      `缺勤 ✗ 最近读的 ${readings.length} 跑里 ${seen.length} 跑有这一格、零次推成（${named}）` +
      `· 窗口 ${windowHours}h 内共 ${inWindow.length} 跑、未逐跑读 ${unread} 跑`,
    evidence: seen.map((r) => ({
      sn: r.sn,
      shape: r.shape,
      note: SHAPE_NOTES[r.shape] ?? "",
      ...(r.evidence === "" ? {} : { line: r.evidence }),
    })),
    stats,
  };
}

/**
 * `--hours` / `--now` / `--limit` / `--repo` / `--json` 的取值。
 *
 * @param {string[]} argv 参数
 * @param {string} flag 旗标名
 * @returns {string} 值，没给就是空串（⚠️ 空串不是 nullish，`??` 兜不住 —— 见
 *   `check-daily-attendance.mjs` 里那条实测踩坑）
 */
function flagValue(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? "" : (argv[at + 1] ?? "");
}

/**
 * 命令行入口。
 *
 * @param {string[]} [rawArgv] 进程参数（不含 node 与脚本名）；测试可注入
 * @param {{run?:(cmd:string,args:string[])=>any, now?:number, slug?:string}} [env]
 * @returns {number} 三态退码
 */
export function main(rawArgv, env = {}) {
  const argv = rawArgv ?? process.argv.slice(2);
  const asJson = argv.includes("--json");
  const windowHours = Number(flagValue(argv, "--hours") || DEFAULT_WINDOW_HOURS);
  const limitFlag = Number(flagValue(argv, "--limit") || DEFAULT_DETAIL_LIMIT);
  const limit = Number.isFinite(limitFlag) && limitFlag > 0 ? limitFlag : DEFAULT_DETAIL_LIMIT;
  const nowFlag = flagValue(argv, "--now");
  const nowParsed = /^\d+$/.test(nowFlag) ? Number(nowFlag) : Date.parse(nowFlag);
  const now = env.now ?? (Number.isNaN(nowParsed) ? Date.now() : nowParsed);
  const run = env.run ?? makeRunner(import.meta.dirname);
  const repoFlag = flagValue(argv, "--repo");
  const slug = env.slug ?? (repoFlag === "" ? "moon-read/comfy-app-t3" : repoFlag);

  const win = fetchBuildsCoveringWindow({ run, slug, windowHours, now });
  if (win.list === null) {
    console.log(
      "[mirror-attendance] 没结论 ? 取不到构建列表（`cnb` 起不来 / 网络不通 / 返回不是 JSON）—— 判据自身不做重试",
    );
    return CODE.NO_VERDICT;
  }
  if (!win.covered) {
    console.log(
      `[mirror-attendance] 没结论 ? 取数没盖住 ${windowHours}h 窗口 —— ${win.note}；「窗口内没出勤」这句话在这上面不成立`,
    );
    return CODE.NO_VERDICT;
  }
  /* 只读 PR 档那一族：镜像格挂在质量门禁流水线上，非 PR 的跑压根没有这一格。
   * 这里不预先按事件猜 —— 交出去取正文，`no-cell` 那一支会把「不是这一档」如实念出来。 */
  const prBuilds = win.list.filter((b) => /pull/i.test(String(b?.eventUrl ?? b?.event ?? "")));
  const picked = (prBuilds.length > 0 ? prBuilds : win.list).slice(0, limit);
  const readings = picked.map((b) => {
    const sn = String(b?.sn ?? "");
    return { sn, ...readMirrorCell(run, slug, sn) };
  });
  const out = judgeMirrorAttendance({ builds: win.list, readings, now, windowHours });
  const payload = { ...out, coverage: win.note, asked: picked.map((b) => String(b?.sn ?? "")) };
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`[mirror-attendance] ${out.headline}`);
    for (const e of out.evidence) {
      console.log(`[mirror-attendance]   ${e.sn} · ${e.shape}${e.line ? ` · ${e.line}` : ""}`);
    }
    console.log(`[mirror-attendance] 取数覆盖自证：${win.note}`);
  }
  return out.code;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exit(main());
}
