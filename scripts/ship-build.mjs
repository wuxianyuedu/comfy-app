#!/usr/bin/env node
/**
 * ship-build.mjs —— `pnpm ship` 里**与 build 读数有关的那几个纯判定**。
 *
 * 从 `ship-core.mjs` 分出来只因为一份文件里叠了三族「读外部形状」的判定（git 远端 / build /
 * PR），而它已经越过 `check-infra-file-size.cjs` 那 900 行硬闸（AGENTS 硬规则 22）。拆的是
 * 职责：这里只回答「在并行构建里哪一条属于我」「这一眼与上一眼是不是同一件事」
 * 「`data.status` 该读成三态里的哪一档」，不产生副作用、不起进程。
 *
 * 与 `ci-build-readout.mjs` 的分工要说清 —— 两个名字里都有 build，但「谁在读」不同：
 *   · 本文件是 **`pnpm ship` 自己的取数**：按 sha 归属构建、给轮询算签名、把状态读成三态，
 *     判据服务于「这次推送的流程要不要继续」；
 *   · `ci-build-readout.mjs` 是**给人看的诊断出口**（`pnpm ship --diagnose` / 独立 CLI）：
 *     逐格分类、念失败行、给完整日志链接，判据服务于「这一跑为什么红、红在哪一格」。
 * 两边的唯一交集是「都读平台 JSON」，而那正是共同的纪律：只读 `data.*`，取不到回
 * `null` / `unknown`，**不猜方向**（空数组会被读成「查过了、没有我的」，而 null 才是
 * 「没拿到列表」）。
 */

/** build 的终态集合（其余一律当「还没完」）。 */
const TERMINAL = new Set(["success", "failed", "error", "cancelled", "canceled"]);
/** build 里「在跑 / 排队」的形态。 */
const RUNNING = new Set(["running", "pending", "queued", "waiting", "created"]);

/**
 * **只**读 build JSON 的 `data.status`。
 *
 * 入参声明成 `any` 是诚实的：它解析的是外部平台的 JSON，形状不由本仓决定，
 * 而本函数的职责恰恰是**在形状不对时给出 `unknown`（⇒ 退 2）而不是抛**。
 * 期望的形状是 `{ status:number, data:{ status:string } }` —— 注意取的是 `data.status`。
 *
 * @param {any} json `cnb … -v` 解析结果
 * @returns {{state:"green"|"red"|"running"|"unknown",raw:string|null}} 判决用的中间态
 */
export function readBuildVerdict(json) {
  const raw = json && json.data && typeof json.data.status === "string" ? json.data.status : null;
  // ⚠️ 这里**故意不看** `json.status`：那是 HTTP 信封（200 只说明「问到了」）。
  if (raw === null) {
    return { state: "unknown", raw: null };
  }
  const low = raw.toLowerCase();
  if (low === "success") {
    return { state: "green", raw };
  }
  if (TERMINAL.has(low)) {
    return { state: "red", raw };
  }
  if (RUNNING.has(low)) {
    return { state: "running", raw };
  }
  return { state: "unknown", raw };
}

/**
 * 在**并行**的 build 列表里挑出属于本次 sha 的那一条。
 *
 * 同一台节点上会同时有多条 `pull_request` build（实测撞过两条并存），而列表项里
 * **没有 PR 号**可锚 —— 唯一可靠的归属键是 `sha`。取不到就回 `null`（⇒ 阶段判
 * 「没跑起来」），**不许**退化成「拿最新那条」：那等于把别人的绿灯读成自己的。
 *
 * @param {any[] | null | undefined} builds 平台返回的列表（外部形状，逐条判字段）
 * @param {string} sha 本次要归属的 commit sha
 * @returns {{sn:string,createTime:string} | null} 命中的 build（多条取最新）
 */
export function pickBuildForSha(builds, sha) {
  if (!Array.isArray(builds) || !sha) {
    return null;
  }
  /** @type {{sn:string,createTime:string}[]} */
  const hit = [];
  for (const b of builds) {
    if (
      b &&
      typeof b.sha === "string" &&
      b.sha.toLowerCase() === sha.toLowerCase() &&
      b.event === "pull_request" &&
      typeof b.sn === "string"
    ) {
      hit.push({ sn: b.sn, createTime: String(b.createTime ?? "") });
    }
  }
  if (hit.length === 0) {
    return null;
  }
  hit.sort((x, y) => y.createTime.localeCompare(x.createTime));
  return hit[0] ?? null;
}

/**
 * 「这一眼与上一眼是不是同一件事」的签名 —— 轮询用它判**有没有在动**，不判绿不绿。
 *
 * 为什么需要它：预算 45 分钟是按墙钟烧的，而实测烧完之后常见的是「20 次读数一模一样」
 * （按 sha 还没解析到 build，或平台把 build 排在队列里没动）。那种情况下每 20 秒念一遍
 * 同一句话，最后落 exit 2 —— 等待本身没有换来任何新事实，而屏幕上看不出来。
 * 签名取**四件原值**：`sn` / `data.status` / pipeline 的「完成数-总数」/ **stage 的
 * 「完成数-总数」**；任何一件变了都算「在动」，计数器归零。
 *
 * ⚠️ 后一件是 2026-10-22 补的，因为它补的是**一句被现场推翻的话**：本仓的 PR 流水线是
 * **一条 pipeline、三十几个 stage** 的拓扑（实测 `cnb-7d9-1k5h9edct`：`pipelinesStatus`
 * 只有 1 个条目、`stages` 有 33 个），所以 `done-total` 整跑都停在 `0-1` —— 只看 pipeline 级
 * 计数的版本会把一条**正在推进**的流水线（28/33 格已完成）读成「连着 10 眼一模一样」而掐掉。
 * stage 级计数才是这条拓扑上唯一会动的量；而运行中的那一格 `duration` 是占位值 `0`
 * （同一眼 `cnb-7d9-1k5h9edct` 里在跑的那格就是 `dur=0`，平台按格缓冲），所以也不能拿时长当进度。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果（外部形状）
 * @param {string} sn 这一眼归属的 build sn（列表里取到的那条）
 * @returns {string} 形如 `cnb-xxx-yyy/success/1-1+12/33`；没解析到 build 时形如 `(未解析到 build)/?/0-0+0/0`
 */
export function buildSignature(json, sn = "") {
  const d = (json && json.data) ?? null;
  const status = d && typeof d.status === "string" ? d.status : "(取不到 data)";
  const entries =
    d && d.pipelinesStatus && typeof d.pipelinesStatus === "object"
      ? Object.values(d.pipelinesStatus)
      : [];
  const total = entries.length;
  const done = entries.filter(
    (p) => p && typeof p.status === "string" && !RUNNING.has(p.status.toLowerCase()),
  ).length;
  /* stage 级：把每条 pipeline 的 `stages[]` 汇起来数完成格。缺 `stages`（外部形状不完整）
   * 时按 0 计，签名照样稳定可比 —— 这里不替平台补一个「大概在进行」的形状。
   * ⚠️ 判「完成」比 pipeline 级多排除一个 `start`：平台那一层的词汇里**运行中的那一格就叫
   * `start`**（且它的 `duration` 是占位 `0`，见上面那段），照 `RUNNING` 那份集合会把它数成
   * 已完成 —— 于是「pending → start」这一步推进在签名里看不见，正是要防的那种念法。 */
  let stageTotal = 0;
  let stageDone = 0;
  for (const p of entries) {
    /** @type {{ status?: unknown }[]} */
    const stages = p && Array.isArray(p.stages) ? p.stages : [];
    stageTotal += stages.length;
    stageDone += stages.filter(
      (s) =>
        s &&
        typeof s.status === "string" &&
        !RUNNING.has(s.status.toLowerCase()) &&
        s.status.toLowerCase() !== "start",
    ).length;
  }
  return `${sn || "(未解析到 build)"}/${status}/${done}-${total}+${stageDone}/${stageTotal}`;
}

/**
 * `cnb build get-build-logs -v` 的 data 形状在版本间有两种（裸数组 / `{data:[…]}`）。
 * 两种都收，取不到就回 null —— **不回空数组**：空数组会被 `pickBuildForSha` 读成
 * 「列表拿到了、里面没有我的」，而 null 读成「没拿到列表」，后者才是「没跑起来」。
 *
 * @param {any} json 解析结果
 * @returns {any[] | null} 列表或 null
 */
export function asArray(json) {
  const d = json && json.data;
  if (Array.isArray(d)) {
    return d;
  }
  if (d && Array.isArray(d.data)) {
    return d.data;
  }
  return null;
}
