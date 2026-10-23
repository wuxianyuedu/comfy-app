#!/usr/bin/env node
/**
 * ship-close.mjs —— 「单子关掉了没有」那一格：判断 + 效应（规范 §13.10.9 / §13.6，ISSUE #2199）。
 *
 * 为什么单独一份（而不是接着往 `ship-core` 里加）：#2189 现场量过的那条 900 硬闸
 * （`check-infra-file-size.cjs`，无基线、无 `--update`，出口只有「拆」）不是只针对 `ship.mjs` ——
 * 把「人点名的号 + 平台侧落地证明」那一整套判断叠进 `ship-core.mjs`（当时 775 行）会把它推到
 * **917 行**，正好把 #2189 刚解掉的那个问题原样搬到隔壁文件上。所以这里按**变化方向**分家：
 *   · `ship-core.mjs`     判的是外部执行者的形状（平台 build / PR / git 输出 → 三态结论）；
 *   · `ship-platform.mjs` 平台侧四段：PR / 轮询 / verdict / 合并并回读；
 *   · **本文件**          「要不要关、关哪几张、凭什么关、关完回读什么」——
 *     它跟着**单子的落地证明口径**动（标题约定、squash 尾数、`is_merged` 的取法），
 *     不跟着 build 状态机的形状动。
 * 判断与效应仍分两层：`decideCloseIssue` 是纯函数（给读数就给结论），`closeIssues` /
 * `findMergedPullProofs` 只经注入的 `run` 摸世界 —— 所以整段可被假执行者跑完。
 *
 * 三条不许（与 #2199 的「不许怎么修」同稿）：
 *   1. **没有落地证明就不关**。`landedVerified` 那条判断是整个动作面里唯一挡着「假完成」的线，
 *      放宽它 = 一条红都没有而状态已经写给别人了。
 *   2. **不许把「查不到」念成「没落地」**，也不许把「cnb 没跑起来」念成「查不到」
 *      （三态：结论 / 没有结论 / 没跑起来）。
 *   3. **不加 `--force-close` 这类绕过口**：查不到该去修标题约定，不是把单子标成完成。
 */

/** 一次 `run` 的形状直接借 `ship-exec.mjs` 那份（`ExecResult` 的必填项在那边定，这里不另立一套）。 */
/** @typedef {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} CloseRun */

import { CODE, combineShipCodes, asArray } from "./ship-core.mjs";
import { cnbJson, short } from "./ship-exec.mjs";
import { finishIssueWork } from "./ship-claim.mjs";

/**
 * 一行文字里点名的 issue 号（`#2070` / `(#2070)` 两种写法都认，按出现顺序去重）。
 *
 * ⚠️ **只许喂 squash 那一行的「标题本体」，不许喂拼完 PR 号的那一整行**：
 * `mergeAndVerify` 发给平台的是 `${title} (#${number})`，而那个尾数是 **PR 号**
 * （本仓 PR 号与 issue 号共用一套编号空间，`#2110` 既是一条 PR、也可能正好是
 * 某个人的 issue）。拿整行去提号就会把「关掉这个 PR」读成「关掉那张 issue」——
 * 而那是一张别人正在用的单子。同一件事的列表侧形态见 `pullTitleBody`。
 *
 * @param {string} text 标题本体
 * @returns {number[]}
 */
export function issueNumbersFromText(text) {
  /** @type {number[]} */
  const out = [];
  for (const m of String(text ?? "").matchAll(/#\s?(\d{2,})/g)) {
    out.push(Number(m[1]));
  }
  return [...new Set(out)];
}

/**
 * 剥掉平台在 squash 那一行**末尾追加的 PR 号**，回到「标题本体」。
 *
 * 为什么必须有这一格：见 `issueNumbersFromText` 那段——PR 号与 issue 号共用一套编号空间，
 * 而对 squash 那一整行提号会把 PR 自己的号读成一张单子。`ship` 反查落地证明时读的是平台
 * 列表里的标题，那些标题已经被拼过尾数，所以先剥回本体再提号。
 *
 * `prNumber` 只认纯数字（拿到的就是 `Number(item.number)`）：不是数字就原样返回，
 * 不把它拼进正则 —— 拼进去会把「剥尾数」变成「按别人的输入构造一次正则」。
 *
 * @param {string} title 平台给的标题（可能已被拼上 PR 号）
 * @param {number | string} prNumber 那条 PR 自己的号
 * @returns {string} 标题本体
 */
export function pullTitleBody(title, prNumber) {
  const t = String(title ?? "");
  const n = String(prNumber ?? "");
  if (!/^\d+$/.test(n)) return t;
  return t.replace(new RegExp(`\\s*\\(#${n}\\)\\s*$`), "");
}

/**
 * 「这次要不要关单、关哪几张、凭什么关」—— 判断与效应分家（与 `decideCleanBranch` 同一形状）。
 *
 * 两条通道，前提**刻意不同**（ISSUE #2199）：
 *   · **本轮号**（从落地那一行的标题本体取）：前提是「本轮合并已验真」—— #2070 那批的口径，一字未改；
 *   · **人点名的号**（`--close-issue 2179`）：本轮没合并时，前提换成「平台侧查得到它随某条
 *     **已合并**的 PR 落地」（`proofs` 那份读数）—— 这是给「早已落地却没关掉」的单子开的补关入口。
 * 两条都不许在**没有任何落地证明**时关单（见文件头那条不许）。
 *
 * 退码口径沿用三态：要求了却没有结论 ⇒ `NOT_RUN`（2），不是静默跳过；`2` 压过 `0`，
 * 所以「误带旗标在轮询那一跳」当场就读得出来。
 *
 * @param {{
 *   requested: boolean,
 *   landedVerified: boolean,
 *   title: string,
 *   explicit?: number[],
 *   proofs?: Map<number, {prNumber: number, title: string}>,
 *   proofScanned?: number,
 *   proofRan?: boolean,
 * }} input `proofRan` = 那一趟反查**跑起来了没有**（false ⇒ 取不到列表，不构成结论）
 * @returns {{act: boolean, code: number | null, numbers: number[], sources: Map<number, string>, unproven: number[], reason: string}}
 */
export function decideCloseIssue({
  requested,
  landedVerified,
  title,
  explicit = [],
  proofs = new Map(),
  proofScanned = 0,
  proofRan = true,
}) {
  /** @type {Map<number, string>} */
  const sources = new Map();
  if (!requested) {
    return {
      act: false,
      code: null,
      numbers: [],
      sources,
      unproven: [],
      reason: "未要求关单（--close-issue）。",
    };
  }
  /** @type {number[]} */
  const numbers = [];
  if (landedVerified) {
    // 本轮已验真 ⇒ 标题里点名的号 + 人额外点名的号，并集去重。
    for (const n of issueNumbersFromText(title)) {
      sources.set(n, "本轮落地那一行点名的");
      numbers.push(n);
    }
    for (const n of explicit) {
      if (!sources.has(n)) sources.set(n, "人点名的（本轮合并已验真）");
      numbers.push(n);
    }
    const uniq = [...new Set(numbers)];
    if (uniq.length === 0) {
      return {
        act: false,
        code: CODE.NOT_RUN,
        numbers: [],
        sources,
        unproven: [],
        reason: `落地那一行的标题本体里没有 (#号)，人也没点名：「${title}」`,
      };
    }
    return {
      act: true,
      code: null,
      numbers: uniq,
      sources,
      unproven: [],
      reason: "",
    };
  }
  // 本轮没验真合并 ⇒ 只有「人点名、且平台查得到落地证明」的那些可以补关。
  if (explicit.length === 0) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      numbers: [],
      sources,
      unproven: [],
      reason:
        "这一跳没有**验真的合并**（合并是显式动作，且要回读到 is_merged + 碎片在主干顶端），" +
        "人也没点名要补关哪张 ⇒ 单子不能标成完成",
    };
  }
  if (!proofRan) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      numbers: [],
      sources,
      unproven: [...explicit],
      reason:
        "取不到「已合并的 PR」那份列表（cnb 不在 / 输出不是 JSON）" +
        ` ⇒ #${explicit.join("、")} 这一格没有结论，不猜它落没落地`,
    };
  }
  /** @type {number[]} */
  const unproven = [];
  for (const n of explicit) {
    const p = proofs.get(n);
    if (!p) {
      unproven.push(n);
      continue;
    }
    sources.set(n, `人点名的，落地证明是已合并的 PR #${p.prNumber}`);
    numbers.push(n);
  }
  if (numbers.length === 0) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      numbers: [],
      sources,
      unproven,
      reason:
        `在平台最近 ${proofScanned} 条已合并的 PR 里查不到 #${unproven.join("、")} 随哪一条落地` +
        " ⇒ 不构成结论（「查不到」不等于「没落地」，也不等于「已落地」）",
    };
  }
  return { act: true, code: null, numbers, sources, unproven, reason: "" };
}

/**
 * 「这张单是不是随某条**已合并**的 PR 落过地」—— 问平台，不问人（ISSUE #2199）。
 *
 * 两个坑都在这份读数的形状里：
 *   · `pulls list-pulls` 的 `--state` **没有** `merged` 这一档（实测只有 `open|closed|all`），
 *     而 `closed` 里混着「被合并」与「被关掉没合」两种 —— 所以只认逐条的 `is_merged`，
 *     不认列表页那个状态词（与「信封上的 `status` 是 HTTP」同一族取法）。
 *   · 平台在 squash 那一行末尾拼的 `(#<PR 号>)` 与 issue 号共用编号空间
 *     ⇒ 先 `pullTitleBody` 剥回标题本体，再提号。
 *
 * 只扫最近若干条（有界）：扫不到就如实报「在最近 N 条里查不到」，不念成「没落地」。
 *
 * @param {{
 *   run: CloseRun,
 *   slug: string,
 *   numbers: number[],
 *   pages?: number,
 *   pageSize?: number,
 * }} ctx
 * @returns {{proofs: Map<number, {prNumber: number, title: string}>, scanned: number, ran: boolean}}
 */
export function findMergedPullProofs(ctx) {
  const { run, slug, numbers, pages = 5, pageSize = 20 } = ctx;
  /** @type {Map<number, {prNumber: number, title: string}>} */
  const proofs = new Map();
  const want = new Set(numbers);
  /** @type {{proofs: Map<number, {prNumber: number, title: string}>, scanned: number, ran: boolean}} */
  const nothing = { proofs, scanned: 0, ran: false };
  if (!slug) return nothing;
  let scanned = 0;
  let ran = false;
  for (let p = 1; p <= pages; p += 1) {
    const got = cnbJson(run, [
      "pulls",
      "list-pulls",
      "--repo",
      slug,
      "--state",
      "closed",
      "--page",
      String(p),
      "--page-size",
      String(pageSize),
      "-v",
    ]);
    if (!got) break;
    ran = true;
    const list = asArray(got.json);
    if (!list || list.length === 0) break;
    for (const item of list) {
      if (item?.is_merged !== true) continue;
      scanned += 1;
      const number = Number(item.number ?? 0);
      const body = pullTitleBody(String(item.title ?? ""), number);
      for (const n of issueNumbersFromText(body)) {
        if (want.has(n) && !proofs.has(n)) {
          proofs.set(n, { prNumber: number, title: body });
        }
      }
    }
    if (list.length < pageSize) break;
  }
  return { proofs, scanned, ran };
}

/**
 * 阶段 7：把点名的单子置成 `closed / completed`，然后**独立回读**三件原值。
 *
 * `explicit`（人在命令行上点名的号）与本轮号的差别只在**前提**：本轮号跟着验真的合并，
 * 显式号在本轮没合并时要一份平台侧的落地证明（见 `findMergedPullProofs`）。两条都不许在
 * 没有任何落地证明时关单 —— 判据全在 `decideCloseIssue`，这里只发请求、回读、把原值打出来。
 *
 * 与合并那一格同一条纪律：平台回执只是半个结论。所以调完 `update-issue` 之后走一次独立的
 * `get-issue`，认 `state` / `state_reason` / `closed_at` 三件原值并原样打出来
 * （`closed_at` 在场意味着这不是一句「我发了个请求」）。
 *
 * 幂等：对一张**已经关着**的单子再跑一次，回读照样是那三件（`closed_at` 是第一次关它的那个
 * 时刻）⇒「重跑一遍 ship」不会把状态改坏，也不会谎报。
 *
 * @param {{
 *   run: CloseRun,
 *   log: (s: string) => void,
 *   slug: string,
 *   closeIssue: boolean,
 *   landed?: {verified: boolean, sha?: string, title?: string} | null,
 *   explicit?: number[],
 *   handle?: string | null,
 *   mkTmp?: ((name: string, text: string) => string | null) | null,
 * }} ctx
 *   `handle` / `mkTmp` 是「关完之后补结束评论并撤处理人标签」那一格的执行面：
 *   未配留痕、或调用方没给临时文件落点时，那一格**跳过**（关单本身照常）。
 * @returns {number} `CODE` 之一
 */
export function closeIssues(ctx) {
  const {
    run,
    log,
    slug,
    closeIssue,
    landed = null,
    explicit = [],
    handle = null,
    mkTmp = null,
  } = ctx;
  const landedVerified = landed?.verified === true;
  const title = landed?.title ?? "";
  let scan = { proofs: new Map(), scanned: 0, ran: true };
  if (!landedVerified && explicit.length > 0) {
    scan = findMergedPullProofs({ run, slug, numbers: explicit });
  }
  const plan = decideCloseIssue({
    requested: closeIssue === true,
    landedVerified,
    title,
    explicit,
    proofs: scan.proofs,
    proofScanned: scan.scanned,
    proofRan: scan.ran,
  });
  if (!plan.act) {
    if (plan.code === CODE.NOT_RUN) {
      log(`[ship] 关单这一格**没有执行**：${plan.reason}`);
      return CODE.NOT_RUN;
    }
    return CODE.GREEN;
  }
  for (const number of plan.numbers) {
    log(
      `[ship] 关 #${number} —— 依据：${plan.sources.get(number) ?? "(未标注)"}`,
    );
  }
  for (const number of plan.unproven) {
    log(
      `[ship] #${number} **不关**：查不到它的落地证明 ⇒ 这一格对它没有结论` +
        "（不是「它没落地」，也不是「请你手动」）",
    );
  }

  /** @type {number[]} */
  const codes = [];
  for (const number of plan.numbers) {
    const put = cnbJson(run, [
      "issues",
      "update-issue",
      "--repo",
      slug,
      "--number",
      String(number),
      "--state",
      "closed",
      "--state-reason",
      "completed",
      "-v",
    ]);
    if (!put) {
      log(
        `[ship] #${number}：关闭调用没有拿到 JSON 回执（cnb 不在 / 输出不是 JSON）` +
          " ⇒ 记「没有执行者」，不去猜它成没成。",
      );
      codes.push(CODE.NOT_RUN);
      continue;
    }
    /* **独立回读**：不看 update 的返回值当结论。 */
    const back = cnbJson(run, [
      "issues",
      "get-issue",
      "--repo",
      slug,
      "--number",
      String(number),
      "-v",
    ]);
    const d = back?.json?.data ?? null;
    const state = d?.state ?? "(取不到)";
    const reason = d?.state_reason ?? "(无)";
    const at = d?.closed_at ?? "(无)";
    log(
      `[ship] #${number} 回读：state=${state} state_reason=${reason} closed_at=${at}` +
        (landed?.sha
          ? ` · 落地那一行 sha=${short(landed.sha)}`
          : ` · 落地证明：${plan.sources.get(number) ?? "(未标注)"}`),
    );
    if (state === "closed") {
      codes.push(CODE.GREEN);
      /* 关单成功之后才做「开发结束」评论与撤处理人标签：单子还没关成就先放掉标签，
       * 等于在「还在开着的单」上宣布结束。评论失败时 `finishIssueWork` 会保留标签。 */
      if (handle && mkTmp) {
        codes.push(
          finishIssueWork({ run, log, slug, handle, number, mkTmp }),
        );
      }
    } else {
      codes.push(CODE.RED);
    }
  }
  return combineShipCodes(codes);
}
