#!/usr/bin/env node
/**
 * ship-core.mjs —— `pnpm ship` 的**纯判定层**（规范 §13.6）。
 *
 * 这一层只做一件事：**把外部执行者（平台 build / PR / git 输出）的原文读成三态结论**，
 * 不产生副作用。拆出来不是为了行数好看，而是因为它的输入是**外部形状** ——
 * 平台改字段、加一档状态、把 `data` 从对象换成数组，红都该落在这一层，
 * 而不是落在「编排有没有按顺序走」那一半上。两层的判据因此各自独立：
 * `tests/ship.test.ts` 判这里的取数，`ship.mjs` 的 `main()` 判顺序。
 *
 * 三条贯穿本层的纪律（与 `ship.mjs` 文件头同一条）：
 *   · 只读 `data.*`，**绝不**读信封上的 `status`（那是 HTTP 状态码，与流水线无关）；
 *   · 「取不到」一律回 `null` / `unknown`，**不猜方向** —— 空数组会被读成
 *     「查过了，里面没有我的」，而 null 读成「没拿到列表」，后者才是事实；
 *   · 不抛异常：畸形输入走到 `unknown` 那一档，由调用方退 2。
 */
import fs from "node:fs";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";

/** 退出码三态（与 `premerge-check.mjs` 逐字同口径）。 */
export const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

/** 阶段顺序表。**可反转**：新增/摘掉一段只改这张表 + 对应的 `run*`，不动判决逻辑。 */
export const PHASES = [
  "preflight",
  "commit",
  "push",
  "pull-request",
  "poll",
  "verdict",
  "merge",
];

/** build 的终态集合（其余一律当「还没完」）。 */
const TERMINAL = new Set([
  "success",
  "failed",
  "error",
  "cancelled",
  "canceled",
]);
/** build 里「在跑 / 排队」的形态。 */
const RUNNING = new Set(["running", "pending", "queued", "waiting", "created"]);

/**
 * 合并多个阶段的退出码：**`2` 压过 `1`，`1` 压过 `0`**。
 *
 * @param {number[]} codes 已跑过的各段结论
 * @returns {number} 合并后的进程退出码
 */
export function combineShipCodes(codes) {
  if (codes.includes(CODE.NOT_RUN)) return CODE.NOT_RUN;
  if (codes.includes(CODE.RED)) return CODE.RED;
  return CODE.GREEN;
}

/**
 * 解析命令行。未知旗标**不静默忽略** —— 拼错的旗标会被读成「没要那个动作」，
 * 而这里最贵的误读是「以为会合、其实没合」或反之。
 *
 * @param {string[]} argv 参数（不含 node 与脚本名）
 * @returns {{message:string|null,messageFile:string|null,adds:string[],merge:boolean,dryRun:boolean,wait:boolean,only:string|null,unknown:string[]}} 解析结果
 */
export function parseArgs(argv) {
  /** @type {{message:string|null,messageFile:string|null,adds:string[],merge:boolean,dryRun:boolean,wait:boolean,only:string|null,unknown:string[]}} */
  const out = {
    message: null,
    messageFile: null,
    adds: [],
    merge: false,
    dryRun: false,
    wait: true,
    only: null,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--merge") out.merge = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-wait") out.wait = false;
    else if (a === "--message" || a === "-m") out.message = argv[++i] ?? "";
    else if (a === "--message-file") out.messageFile = argv[++i] ?? "";
    else if (a === "--add") out.adds.push(argv[++i] ?? "");
    else if (a.startsWith("--message="))
      out.message = a.slice("--message=".length);
    else if (a.startsWith("--message-file="))
      out.messageFile = a.slice("--message-file=".length);
    else if (a.startsWith("--add=")) out.adds.push(a.slice("--add=".length));
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
    else out.unknown.push(a);
  }
  return out;
}

/**
 * 从 `git remote get-url origin` 里取 `org/repo`。
 *
 * 支持 https 与 ssh 两种形态；取不到就回 `null`，由调用方判「没跑起来」而不是
 * 猜一个仓库名 —— 猜错的代价是把 PR 开到别的仓库上。
 *
 * @param {string} remoteUrl `get-url` 的原文
 * @returns {string | null} 形如 `moon-read/comfy-app-t3`
 */
export function parseSlug(remoteUrl) {
  const s = (remoteUrl || "").trim().replace(/\/+$/, "");
  if (!s) return null;
  const m = s.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? (m[1] ?? null) : null;
}

/**
 * 「远端叫什么、基线是哪条」的推导 —— 唯一一份。
 *
 * 为什么要有这一件：这一版此前两处**写死 `origin`**（`git remote get-url origin` 与
 * `git diff origin/master...HEAD -- changelog.d`），而本仓按规范只有一个叫 `cnb` 的远端
 * （硬规则 6 / §13.6：远端名 `cnb`，无 `origin`）。后果不是「少一句提示」：
 * 两条 git 命令都**失败**，而失败在这里长得与「答案为空」一模一样 ——
 * 碎片那一查拿到空串 ⇒ preflight 判「没有 changelog.d 碎片」⇒ **`pnpm ship` 在本仓
 * 从第一次跑起就没工作过**，且报的还是一条听起来正当的理由。
 *
 * 三档来源，顺序有理由：
 *   ① `@{u}`（HEAD 自己的上游）—— 最贴事实：这条分支在跟谁比，是 git 知道的事；
 *   ② 唯一远端 + `<远端>/master` —— 新建的本地分支还没上游时的合理推法，
 *      **打印时标明是推的**（默认分支不叫 master 时它会偏，但偏了会被下面那条
 *      「基线引用不存在 ⇒ 退 2」的判据当场抓住，不会静默变成「没有碎片」）；
 *   ③ 多个远端且没有上游 ⇒ 交回 `origin`（历史习惯），再没有就给 `null` ——
 *      调用方必须按「没有执行者」处理，不许拿空 diff 冒充结论。
 *
 * @param {{upstream?: string | null, remotes?: string[]}} input
 * @returns {{remote: string | null, base: string | null, source: "upstream" | "sole-remote" | "origin" | "none"}}
 */
export function resolveUpstream({ upstream, remotes = [] }) {
  const u = (upstream || "").trim();
  const slash = u.indexOf("/");
  if (slash > 0 && u.slice(slash + 1)) {
    return {
      remote: u.slice(0, slash),
      base: u,
      source: "upstream",
    };
  }
  const named = remotes.map((r) => (r || "").trim()).filter(Boolean);
  if (named.length === 1) {
    return {
      remote: named[0] ?? null,
      base: `${named[0]}/master`,
      source: "sole-remote",
    };
  }
  if (named.includes("origin")) {
    return { remote: "origin", base: "origin/master", source: "origin" };
  }
  return { remote: null, base: null, source: "none" };
}

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
  const raw =
    json && json.data && typeof json.data.status === "string"
      ? json.data.status
      : null;
  // ⚠️ 这里**故意不看** `json.status`：那是 HTTP 信封（200 只说明「问到了」）。
  if (raw === null) return { state: "unknown", raw: null };
  const low = raw.toLowerCase();
  if (low === "success") return { state: "green", raw };
  if (TERMINAL.has(low)) return { state: "red", raw };
  if (RUNNING.has(low)) return { state: "running", raw };
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
  if (!Array.isArray(builds) || !sha) return null;
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
      hit.push({ sn: b.sn, createTime: String(b.createTime || "") });
    }
  }
  if (hit.length === 0) return null;
  hit.sort((x, y) => y.createTime.localeCompare(x.createTime));
  return hit[0] ?? null;
}

/**
 * 读 PR JSON 的判决字段（同样只读 `data.*`）。
 *
 * @param {{data?:{number?:number|string,mergeable_state?:string,blocked_on?:string,is_merged?:boolean,state?:string}} | null} json 解析结果
 * @returns {{number:number|null,mergeableState:string,blockedOn:string,isMerged:boolean,state:string}} 归一后的字段
 */
export function readPullVerdict(json) {
  const d = (json && json.data) || {};
  return {
    number: d.number === undefined ? null : Number(d.number),
    mergeableState: String(d.mergeable_state ?? "unknown"),
    blockedOn: String(d.blocked_on ?? ""),
    isMerged: d.is_merged === true,
    state: String(d.state ?? "unknown"),
  };
}

/**
 * 从 `cnb pulls list-pulls -v` 的 JSON 里按 head 分支名找已存在的 PR（幂等用）。
 *
 * @param {any} json 解析结果（外部形状，可能是裸数组也可能是 `{data:[…]}`）
 * @param {string} branch 源分支名（不含 `refs/heads/`）
 * @returns {number | null} 命中则给 PR 号
 */
export function findPullForBranch(json, branch) {
  const raw = json && json.data;
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.data)
      ? raw.data
      : [];
  for (const p of list) {
    const ref = String((p && p.head && p.head.ref) || "");
    if (ref === `refs/heads/${branch}`) return Number(p.number);
  }
  return null;
}

/**
 * 把 `changelog.d/` 里的碎片标题拼成 PR 正文的**事实部分**。
 *
 * 只搬「盘上已有的字」：段落标题 + 碎片文件名。不写因果、不写「已验证」那类声明
 * （`check-commit-claims.mjs` 会拿提交树复核句式，而 PR 正文迟早会被抄进合并信息）。
 *
 * @param {{root:string,fragments:string[],diffstat:string}} input 量到的事实
 * @returns {string} 正文
 */
export function buildPullBody({ root, fragments, diffstat }) {
  const lines = ["## 本 PR 带的变更碎片（`changelog.d/`）", ""];
  for (const f of fragments) {
    let head = "";
    try {
      head = String(
        fs.readFileSync(path.join(root, f), "utf8").split("\n", 1)[0],
      ).trim();
    } catch {
      head = "(读不到)";
    }
    lines.push(`- \`${f}\` → ${head}`);
  }
  lines.push(
    "",
    "## 改动量（`git diff --stat` 对上游）",
    "",
    "```",
    diffstat || "(空)",
    "```",
    "",
  );
  lines.push(
    "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题与 diffstat）。",
    "> 判断、读数与因果请写在下面的正文里 —— 脚本不代写，也不替你签。",
  );
  return lines.join("\n");
}

/**
 * `--dry-run` 的命令计划。它打印的就是真跑时会执行的同一份 argv ——
 * 这是量具自证：计划与执行分叉，说明有人在两处各写一遍（`tests/ship.test.ts`
 * 拿「模块+工具对同集合」逐条对账钉着这件事）。
 *
 * ⚠️ 它**不**保证恒退 0：dry-run 免掉的是「执行写动作」，不免掉「报出阻塞」。
 * 正在 `master` 上、或缺 `changelog.d/` 碎片时照样退 1 —— 一个会藏掉阻塞事实的
 * 预览比不预览更糟。
 *
 * @param {{branch:string,sha:string,slug:string,adds:string[],hasMessage:boolean,merge:boolean,remote?:string|null,baseBranch?:string|null}} st 当前状态
 * @returns {string[]} 逐条命令
 */
export function planCommands(st) {
  const p = [];
  p.push("git rev-parse --abbrev-ref HEAD");
  p.push("git status --porcelain");
  p.push("git ls-files changelog.d");
  p.push("node scripts/check-deps-freshness.mjs");
  for (const a of st.adds) p.push(`git add -- ${a}`);
  if (st.hasMessage) p.push("git commit --message=<提交信息原文>");
  /* 远端名与主干分支都来自解析（`resolveUpstream`），不写死 `origin` / `master` ——
   * 本仓的远端叫 `cnb`（硬规则 6），写死时计划与执行两头一起错。 */
  p.push(`git push -u ${st.remote || "origin"} ${st.branch}`);
  p.push(`cnb pulls list-pulls --repo ${st.slug} --state open -v`);
  p.push(
    `cnb pulls post-pull --repo ${st.slug} --base ${st.baseBranch || "master"} --head ${st.branch} --head-repo ${st.slug} --title … --body-file <git目录>/comfy-ship-tmp/ship-pr-body-<pid>.tmp -v`,
  );
  p.push(`cnb build get-build-logs --repo ${st.slug} -v`);
  p.push(`cnb build get-build-status --repo ${st.slug} --sn <sn> -v`);
  p.push(`cnb pulls get-pull --repo ${st.slug} --number <n> -v`);
  if (st.merge)
    p.push(
      `cnb pulls merge-pull --repo ${st.slug} --number <n> --merge-style squash --commit-title "… (#<n>)" -v`,
    );
  return p;
}

/**
 * 读 pre-push 落的合并前证明（机器本地、**不入库**，见 `premerge-proof.mjs`）。
 *
 * @param {string} root 仓库根
 * @returns {{headSha?:string,upstreamSha?:string,verifiedAt?:string,baselineRed?:string[]} | null} 取不到回 null
 */
export function readProof(root) {
  /* git 目录的解析不在这里重做 —— 唯一实现见 `scripts/git-dir.mjs`。
   * 这里此前自己判「`.git` 是文件就当指针读」，只覆盖 worktree 那一种，
   * `GIT_DIR` 与裸仓库一个都不认；手写一份弱化的同一件事，比不写更难被发现。 */
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(gitDir, "comfy-premerge-proof.json"), "utf8"),
    );
  } catch {
    return null;
  }
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
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  return null;
}
