#!/usr/bin/env node
/**
 * ci-build-classify.mjs —— 把一次平台构建的**逐格读数**分成「绿 / 真失败 / 被取消」三档
 * 的**全部判断**都在这里（ISSUE #2158 第 2 条 / #2406；规范 §13.5.27）。
 *
 * ## 为什么单独一份
 *
 * 两份读者面共用同一套判断：`ci-build-readout.mjs`（诊断 CLI：取数 + 念给人看）与
 * `pnpm ship` 的四个消费口（轮询 / `--diagnose` / PR 失败立案 / 每日失败立案）。
 * 判断与取数分家之后，`ci-build-readout.mjs` 那一份才能压回 900 行硬闸以下
 * （`check-infra-file-size.cjs`，无基线、无 --update）。
 *
 * 这一份**零副作用、零 IO**：入参是平台 JSON（或一格），出参是分类结果。
 * 「原话从 `get-build-stage` 取」那一跳属于取数，在 `ci-build-readout.mjs` 的
 * `enrichStageErrors()` 里 —— 分类只吃它填好的形状。
 *
 * 「这一刻有没有格在飞、这一眼与上一眼是不是同一件事」（`inFlightStages` / `progressReadout`）
 * 也在这里：它们是 JSON 的纯函数，而签名那一个算法仍只有 `ship-build.mjs` 一份（这里只调它，
 * 不另数一遍计数）。念成那几行的工作在 `ci-build-print.mjs`（#2526 切出去的那一半）。
 *
 * ## 三档与判据顺序
 *
 * ① 任何一格**真失败** ⇒ 真失败（真红那格永远最该被看见，即便同跑还有格被取消）；
 * ② 否则任何一格 / 流水线 / 构建级**被终止** ⇒ 被取消（那一跑没跑完，产物没被验证过）；
 * ③ 否则看构建级状态 —— 兜底，只在没有逐格读数时用。
 *
 * ⚠️ 「被终止」不等于「状态是 error」（ISSUE #2406）：`prepare` 期被另一条流水线抢走锁时，
 * 那一格平台记的正是 `error`，而它一个字都没验证过。归属由 `cancelledCause()` 按
 * **平台原话**判 —— 它是这件事的唯一实现。
 */

import { buildSignature } from "./ship-build.mjs";

/** 退出码三态（与 `ship-core.mjs` 的 `CODE` 同一口径）。 */
export const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

/** 「真失败」族：某一格自己跑挂了（产物 / 代码 / 环境的问题）。 */
const FAILED_STATES = new Set(["error", "failed", "failure"]);

/** 「被取消」族：这一格没跑完，原因在人或同一把锁上的另一跑，不在产物。 */
const CANCELLED_STATES = new Set(["cancel", "cancelled", "canceled"]);

/** 「还在跑」族（**构建级** `data.status` 的那几个词，与逐格的 `start` 不是同一维）。 */
const RUNNING_STATES = new Set([
  "running",
  "pending",
  "queued",
  "waiting",
  "created",
]);

/**
 * 认「这一格属于这条流水线的工作」的两条形状：本仓配置的 `stage-N`，以及 `prepare`。
 *
 * ⚠️ **`prepare` 必须在里面**（ISSUE #2406）。它此前被当成「平台自带的噪声」与
 * `BeforeEnd` / `DebugDetection` / `End` 一起丢掉，而丢掉它的代价是**整整一类读数变成
 * 另一种结论**：prepare 期就被终止的那一跑（`cnb-9qi-1k5qojle1` 那一形）里，
 * `stage-0` 是 `skipped`、唯一有读数的是 `prepare`（`status: error`，原话是抢锁），
 * 于是 `failed` / `cancelled` 两个集合都是空的 ⇒ 分类一路落到构建级 `error` ⇒
 * 判成「真失败」。取消被念成了红，而它一个字都没验证过。
 *
 * 它不是「多念几行噪声」：prepare 是本仓流水线里跑得最多的那一格（全量 clone 在它里面），
 * 也是「一格都没跑到」时**唯一**的证人。`end` / `beforeEnd` / `debugDetection` 仍不认
 * —— 它们不承载本仓任何判据。
 */
const CONFIGURED_STAGE_ID = /^(stage-\d+|prepare)$/;

/**
 * 一格的读数。
 *
 * @typedef {Object} StageRef
 * @property {string} id 平台给的格 id（`stage-1` 那种）
 * @property {string} name 格名（中文那一句）
 * @property {string} status 格状态（小写）
 * @property {number} index 它在平台给的那份列表里的序号（执行顺序）
 * @property {string} error 平台给这一格的原话（没有就是空串）
 */

/**
 * 逐格分类。
 *
 * ⚠️ 只收**这一条流水线的工作格**（`stage-N` 与 `prepare`）。若一份读数里一个都匹配不上
 * （平台改了 id 形状），就退回「全收」—— 宁可多念几行平台自带的格，也不许因为
 * 认不出形状而把证据一起丢掉。
 *
 * @param {any} stages 平台给的 stage 数组
 * @returns {{failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[]}}
 */
export function classifyStages(stages) {
  /** @type {{failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[]}} */
  const out = { failed: [], cancelled: [], skipped: [], configured: [] };
  if (!Array.isArray(stages)) return out;
  /** @type {StageRef[]} */
  const all = [];
  stages.forEach((s, index) => {
    if (!s || typeof s !== "object") return;
    const status = typeof s.status === "string" ? s.status.toLowerCase() : "";
    all.push({
      id: String(s.id ?? ""),
      name: String(s.name ?? ""),
      status,
      index,
      /* 平台给的那句原话（`get-build-status` 里就有这一栏）。它是「被顶掉」与
       * 「真失败」在**读数层**唯一确定的分界线（ISSUE #2406）：被终止的格写的是
       * `Pipeline was stoped … got lock: …` / `The pipeline has been manually terminated …`，
       * 而真失败的格写的是判据自己的退出码（`任务执行失败，返回码：1`）。 */
      error: typeof s.error === "string" ? s.error.trim() : "",
    });
  });
  const configured = all.filter((s) => CONFIGURED_STAGE_ID.test(s.id));
  const pool = configured.length > 0 ? configured : all;
  for (const ref of pool) {
    out.configured.push(ref);
    /* ⚠️ 「状态是 error」不等于「这一格自己跑挂了」（ISSUE #2406）：被另一条流水线抢走锁时，
     * `prepare` 那一格平台记的正是 `error`，而它一个字都没验证过。归属由 `cancelledCause()`
     * 按原话判（唯一实现），这里只照它的结论分池 —— 判错方向的后果是把「取消」念成
     * 「去查产物」，而那条路上没有产物可查。 */
    const cause = cancelledCause(ref);
    /* 「error 但原话是被终止」的那一格也进 `cancelled`：它在读数上属于取消这一边，
     * 差别只在平台那个状态词 —— 念的时候要让人看得见原话（`status=error`），
     * 不然就变成「本仓悄悄改写了平台的结论」。 */
    if (cause.kind === "cancelled") out.cancelled.push(ref);
    else if (cause.kind === "failed") out.failed.push(ref);
    else if (ref.status === "skipped") out.skipped.push(ref);
  }
  return out;
}

/**
 * 「这一格是被终止的」那几种原话形状（ISSUE #2406）。
 *
 * 三条都来自实测（`get-build-stage -v` 的 `data.error` / `get-build-status` 的
 * `stages[].error`，2026-10-26 各取一份）：
 *
 *   · `Pipeline was stoped，Pipeline: cnb-jpf-1k5qok15v-001 got lock: …-push. The current pipeline is terminated`
 *   · `The pipeline has been manually terminated or terminated by another pipeline.`
 *   · 抢锁那个 id 与**本跑自己**不同 ⇒ 谁抢的也顺带读得出来（见 `cancelledCauses()`）
 *
 * 刻意写得很窄：`stoped` 是平台的拼写（少一个 `p`），照抄原样而不是「猜它应该是 stopped」——
 * 认不出形状时这一格**不说话**，交给格状态去判，绝不因为原话认不出就把它读成终止。
 */
const TERMINATED_MARKERS = [
  /got lock:\s*(\S+)/i,
  /pipeline was stop+ed/i,
  /current pipeline is terminated/i,
  /has been manually terminated/i,
  /terminated by another pipeline/i,
];

/**
 * 一格「为什么不是绿」—— 把平台的**原话**读成人话（ISSUE #2406）。
 *
 * 这一格答的是业主那一句「是取消还是真红需要能区分」。区分依据只有两条，都在平台的原始
 * 读数里（本仓不编）：
 *
 *   ① **格状态**：`cancel` 一族就是被终止（#2158 第 2 条已落）；
 *   ② **原话**：状态是 `error` 时，被终止的格写的是「抢锁 / 被另一条流水线终止」，
 *      而真失败的格写的是**判据自己的退出码**（`任务执行失败，返回码：1`）。
 *
 * ② 是这次补的关键：`prepare` 期被顶掉的那一跑，`prepare` 的平台状态是 `error`
 * （不是 `cancel` —— 它是被外部终止的，平台只把它记成 error），光看状态永远分不出来。
 *
 *   ⚠️ **原话住在 `get-build-stage -v` 的 `data.error` 里，不在 `get-build-status` 的
 *   `stages[]` 上**（ISSUE #2406 实测 `cnb-9qi-1k5qojle1`：`get-build-status -v` 那一格
 *   只有 `status/duration/name/id` 四个键，同一格用 `get-build-stage -v` 取回来才带
 *   `error`，原话就是那句 `… got lock: …`）。所以「谁抢了锁」这件事**必须多问一次平台**，
 *   由调用方用 `enrichStageErrors()` 把原话填进 `stages[]` 再分类 —— 分类本身仍是纯函数。
 *
 * 返回 `kind` 是判断，`holder` 是「谁抢了锁」（认不出就 null）—— 后者是给人看的那半句，
 * 不参与判断。
 *
 * @param {{status?: string, error?: string, id?: string, name?: string} | null | undefined} stage
 * @returns {{kind: "failed" | "cancelled" | "clean", reason: string | null,
 *   holder: string | null, sn: string | null} }
 *   `kind` 只说这一格属于哪一边；`reason` 是平台原话（拿不到就 null，**不代写**）
 */
export function cancelledCause(stage) {
  const status =
    typeof stage?.status === "string" ? stage.status.toLowerCase() : "";
  const error = typeof stage?.error === "string" ? stage.error.trim() : "";
  /** 平台原话里有没有「被终止」这个形状，以及被谁（`got lock: <流水线 id>`）。 */
  let holder = null;
  let byLock = false;
  /* 「谁抢的锁」只认 `got lock:` 后面那一格 —— 不能拿「任意一条 marker 有捕获组」去判，
     否则锁 key（`…-push`）会被当成流水线 id 念出来。 */
  const lockHit = error.match(/got lock:\s*([^\s，,。]+)/i);
  if (lockHit && lockHit[1]) {
    holder = lockHit[1].replace(/\.$/, "");
    /* 锁 key 里没有 `cnb-` 前缀，而抢锁的是**某一条流水线**：`got lock` 的原话里
       永远带着那条流水线的 id 或构建号（实测两种都出现过），优先认 `cnb-` 打头的那个。 */
    const snHit = error.match(/\b(cnb-[\w-]+?-\d{3,})\b/);
    if (snHit && snHit[1]) holder = pipelineSn(snHit[1]);
    byLock = true;
  }
  if (!byLock) {
    byLock = TERMINATED_MARKERS.some((re) => re.test(error));
  }
  if (status === "" && error === "") {
    return { kind: "clean", reason: null, holder: null, sn: null };
  }
  /* ① 状态就说取消了 —— 原话只是补充。 */
  if (CANCELLED_STATES.has(status)) {
    return {
      kind: "cancelled",
      reason: error || null,
      holder,
      sn: holder && holder.startsWith("cnb-") ? holder : null,
    };
  }
  /* ② 状态是 error，但原话是「被另一条流水线拿走了锁 / 被终止」⇒ 仍然是取消。
     这一支是 #2406 的现场：`prepare` 那种格平台只记 error。 */
  if (byLock) {
    return {
      kind: "cancelled",
      reason: error || null,
      holder,
      sn: holder && holder.startsWith("cnb-") ? holder : null,
    };
  }
  if (FAILED_STATES.has(status)) {
    return { kind: "failed", reason: error || null, holder: null, sn: null };
  }
  return { kind: "clean", reason: error || null, holder: null, sn: null };
}

/**
 * 流水线 id → 构建号（`cnb-jpf-1k5qok15v-001` → `cnb-jpf-1k5qok15v`）。
 *
 * 只为把「谁抢了锁」念成一条能点进去的构建号。形状对不上就原样回（**不猜**）。
 *
 * @param {string} pipelineId 抢锁那一跑的流水线 id
 * @returns {string}
 */
export function pipelineSn(pipelineId) {
  const id = String(pipelineId ?? "").trim();
  /* 流水线 id 的形状是 `<构建号>-<序号>`，而构建号自己是 `cnb-<短码>-<轮次>` ⇒
     先解到 `cnb-` 打头的那一段，再去掉尾部序号。`-\d+` 这条尾巴是唯一的收尾信号。 */
  const m = id.match(/^(cnb-.*?)-\d+$/);
  return m && m[1] ? m[1] : id;
}

/**
 * 整条构建的分类。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果
 * @returns {{
 *   state: "green" | "failed" | "cancelled" | "running" | "unknown",
 *   raw: string | null,
 *   pipelines: Array<{
 *     id: string, name: string, status: string,
 *     failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[],
 *   }>,
 *   failed: StageRef[],
 *   cancelled: StageRef[],
 *   skipped: StageRef[],
 *   configured: StageRef[],
 *   reasons: Array<{stage: string, reason: string, holder: string | null, sn: string | null,
 *     kind: "stage-cancel" | "stage-terminated" | "pipeline-cancel" | "build-cancel"}>,
 * }}
 *   `reasons` 是「为什么它没有结论」的原话清单（ISSUE #2406）：一条一条对应
 *   「哪一格 / 哪条流水线 / 构建级」被终止，`holder` 与 `sn` 是抢走锁的那一跑（认不出就
 *   null）。它只读平台原话，本仓一个字都不代写。
 */
export function classifyBuildOutcome(json) {
  const data = json && typeof json === "object" ? json.data : null;
  const raw = data && typeof data.status === "string" ? data.status : null;
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const failed = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const cancelled = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const skipped = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const configured = [];
  const pipelines = [];
  const table =
    data && data.pipelinesStatus && typeof data.pipelinesStatus === "object"
      ? data.pipelinesStatus
      : {};
  for (const key of Object.keys(table)) {
    const p = table[key];
    if (!p || typeof p !== "object") continue;
    const c = classifyStages(p.stages);
    const pipeline = {
      id: String(p.id ?? key),
      name: String(p.name ?? ""),
      status: typeof p.status === "string" ? p.status.toLowerCase() : "",
      failed: c.failed,
      cancelled: c.cancelled,
      skipped: c.skipped,
      configured: c.configured,
    };
    pipelines.push(pipeline);
    failed.push(...c.failed);
    cancelled.push(...c.cancelled);
    skipped.push(...c.skipped);
    configured.push(...c.configured);
  }

  const low = raw === null ? "" : raw.toLowerCase();
  /**
   * ② 这一跑「被终止」的三层证据（ISSUE #2406）。此前只有「有格是 cancel」这一条，
   * 于是 prepare 期被顶掉的那一形（`stage-0` skipped、`prepare` error、流水线 cancel）
   * 一条都够不着，最后落到构建级 `error` 被判成真失败。
   *
   * 顺序：格状态 `cancel` → 格原话是「抢锁 / 被终止」→ 流水线级 `cancel`。
   * 前两条都由 `cancelledCause()` 判（唯一实现），第三条只读平台自己的词。
   *
   * @type {ReturnType<typeof classifyBuildOutcome>["reasons"]}
   */
  const reasons = [];
  for (const ref of configured) {
    const cause = cancelledCause(ref);
    if (cause.kind !== "cancelled") continue;
    reasons.push({
      stage: ref.name || ref.id,
      reason: cause.reason ?? "",
      holder: cause.holder,
      sn: cause.sn,
      kind: CANCELLED_STATES.has(ref.status)
        ? "stage-cancel"
        : "stage-terminated",
    });
  }
  for (const p of pipelines) {
    if (!CANCELLED_STATES.has(p.status)) continue;
    /* 流水线级 cancel 而逐格没给出取消格（那几格压根没跑成 cancel）：这不常见，
     * 但正是「一格都没跑到」的另一半证据，念出来而不是让构建级 `error` 顶替它。 */
    if (reasons.some((r) => r.kind !== "pipeline-cancel")) continue;
    reasons.push({
      stage: p.name || p.id,
      reason: "",
      holder: null,
      sn: null,
      kind: "pipeline-cancel",
    });
  }
  if (
    reasons.length === 0 &&
    failed.length === 0 &&
    CANCELLED_STATES.has(low)
  ) {
    /* 构建级就说 cancel、而逐格一个读数都没有（老构建 / 形状变了）：仍要念出它，
     * 只是把「原话取不到」如实标成空串，不拿构建级那个词冒充平台原话。 */
    reasons.push({
      stage: "",
      reason: "",
      holder: null,
      sn: null,
      kind: "build-cancel",
    });
  }

  /** @type {"green"|"failed"|"cancelled"|"running"|"unknown"} */
  let state = "unknown";
  if (failed.length > 0) {
    /* ① 真红的那格最该被看见 —— 即便同一跑里还有别的格被取消。
     * ⚠️ `failed` 只收**状态**是 error/failed 的格；被终止的格（哪怕平台把它记成 error）
     * 已经在 `cancelledCause()` 里被挪进 `reasons`，所以这里不会把取消读成红。 */
    state = "failed";
  } else if (reasons.length > 0) {
    /* ② 这一跑没跑完（格 cancel / 原话说被终止 / 流水线 cancel）⇒ 产物没被验证过。 */
    state = "cancelled";
  } else if (low === "success") {
    state = "green";
  } else if (FAILED_STATES.has(low)) {
    state = "failed";
  } else if (RUNNING_STATES.has(low)) {
    state = "running";
  }
  return {
    state,
    raw,
    pipelines,
    failed,
    cancelled,
    skipped,
    configured,
    reasons,
  };
}

/**
 * 「被取消 / 真失败」那一格**下面**那些根本没跑的格。
 *
 * 「下面」按平台给的那份列表的序号判定（那份列表就是执行顺序）—— 只有排在出问题
 * 那格之后的 `skipped` 才是「被它带下去的」；排在它之前的 `skipped` 是**平台自带**
 * 那一档（如 `DebugDetection`），与本次无关。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @returns {StageRef[]}
 */
export function downstreamSkipped(outcome) {
  const blockers = [...outcome.failed, ...outcome.cancelled];
  if (blockers.length === 0) {
    /* 被终止的那一跑可能**一格都没跑到 cancel**（prepare 期就被顶掉：`stage-0` 是 skipped）——
     * 那时 `cancelled` 是空的，而「下面这些格根本没跑」这句话恰恰是最该说的（ISSUE #2406）。
     * 起点取 `prepare` 的序号：它之后的所有 skipped 都是被它带下去的。 */
    if (outcome.state !== "cancelled") return [];
    const from = outcome.configured.find((s) => s.id === "prepare");
    if (!from) return [];
    return outcome.skipped.filter((s) => s.index > from.index);
  }
  const from = Math.min(...blockers.map((s) => s.index));
  return outcome.skipped.filter((s) => s.index > from);
}

/**
 * 「某一格**正在跑**」的词汇表（ISSUE #2184）。
 *
 * 它与上面那份 `RUNNING_STATES` **不是同一维**，也不是抄来的第二份：那份作用在**构建级**
 * `data.status`（实测那一层在跑时回的是 `pending`），而平台给**逐格**的运行中状态用的词是
 * `start`（#2167 实测：整跑期间 `data.status` 恒 `pending`，格与格之间靠 `start` 标在飞）。
 * 判「这条流水线此刻有没有一格在动」只认这一份 —— 拿 `RUNNING_STATES` 去数格会把 `start`
 * 读成「没在跑」，而那正是 #2184 断错的那一形。
 */
const STAGE_IN_FLIGHT_STATES = new Set(["start", "running", "processing"]);

/**
 * 「这一格此刻还没有终态」—— 给要念「正文是截到此刻的」那一格的调用方用（ISSUE #2455：
 * `--stage-log` 在在飞的格上取到的日志不是完整日志，不说这一句就会被读成「它就念这么多」）。
 *
 * @param {string | null | undefined} status 平台给的格状态
 * @returns {boolean}
 */
export function stageInFlight(status) {
  return STAGE_IN_FLIGHT_STATES.has(
    typeof status === "string" ? status.toLowerCase() : "",
  );
}

/**
 * 「人说的那一格」在这份读数里对应哪几格（ISSUE #2455，`--stage-log` 的反查）。
 *
 * 只认两种**逐字**命中：格 id 相同，或格名去空白后相同（不分大小写）。刻意不做
 * 「模糊匹配就替你挑一个」：本仓一条流水线有三十几格，其中若干格名互为子串
 * （`生产构建` ⇄ `每日生产构建`、`受影响用例` ⇄ `全量单元测试` 那类），挑错一格
 * **不会报错**，只会念出另一格的日志 —— 而另一格也有日志，看起来就像证据。
 * 这正是 #2455 现场那条手工命令的坑（`stageId` 拼错就读到别的格）。
 *
 * 命中多格时如实给出多格（由人改用 id 点名），不挑一个。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @param {string} ref 人给的格名或格 id
 * @returns {{hits: Array<{pipeline: ReturnType<typeof classifyBuildOutcome>["pipelines"][number], stage: StageRef}>, near: StageRef[], examined: number}}
 *   `hits` 逐字命中的那些；`hits` 为空时 `near` 是子串相近的候选（**只作提示，不构成结论**）；
 *   `examined` 是比过几格 —— 念出来才能把「这一跑没这一格」与「没取到这一跑的格表」分开
 */
export function findStageMatches(outcome, ref) {
  const want = String(ref ?? "")
    .trim()
    .toLowerCase();
  /** @type {Array<{pipeline: ReturnType<typeof classifyBuildOutcome>["pipelines"][number], stage: StageRef}>} */
  const hits = [];
  /** @type {StageRef[]} */
  const near = [];
  for (const pipeline of outcome.pipelines) {
    for (const stage of pipeline.configured) {
      const name = stage.name.trim().toLowerCase();
      if (
        stage.id.toLowerCase() === want ||
        (name !== "" && name === want)
      ) {
        hits.push({ pipeline, stage });
        continue;
      }
      if (want === "") continue;
      /* 候选只用于「念回去让人改正点名」：格名包含所给词、或所给词包含格名，都算相近。 */
      if (
        (name !== "" && (name.includes(want) || want.includes(name))) ||
        stage.id.toLowerCase().includes(want)
      ) {
        near.push(stage);
      }
    }
  }
  return { hits, near, examined: outcome.configured.length };
}

/**
 * 这一眼里**在飞的格数**与最久的那一格 —— 轮询用它把「一格都没起来」与「一格跑了很久」分开。
 *
 * 只数**本仓配置的那几格**（`classifyStages` 那条 id 形状口径），平台自带的
 * `Prepare` / `End` 不算 —— 它们在跑不代表本仓的判据在推进。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果（null / 畸形都当「读到 0 格」）
 * @returns {{count: number, names: string[]}}
 */
export function inFlightStages(json) {
  const configured = classifyBuildOutcome(json).configured;
  const flying = configured.filter((s) => STAGE_IN_FLIGHT_STATES.has(s.status));
  return { count: flying.length, names: flying.map((s) => s.name || s.id) };
}

/**
 * 「还在跑」那一支的进度读数（ISSUE #2304）：签名 + 在飞格，一次遍历同时给出。
 *
 * 为什么要有这一件：诊断与轮询此前是**两个读者面**——轮询那行带 `…/pending/0-1+30/37`，
 * 而 `--diagnose` 只念「还在跑，等它跑完再读一次」；看诊断的人只能去翻原始 JSON，
 * 而那层嵌套（`data.pipelinesStatus.<sn>-001.stages[]`）读错一次就会把「在推进」念成
 * 「一格都没起」。签名本身仍只有 `ship-build.mjs` 一个算法，这里不另数一遍计数。
 *
 * @param {unknown} json `get-build-status` 的原值
 * @param {string} [sn] 构建号（进签名的第一段）
 * @returns {{signature: string, flyingCount: number, flyingNames: string[]}}
 */
export function progressReadout(json, sn = "") {
  const flying = inFlightStages(json);
  return {
    signature: buildSignature(json, sn),
    flyingCount: flying.count,
    flyingNames: flying.names,
  };
}
