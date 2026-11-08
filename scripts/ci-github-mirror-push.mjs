#!/usr/bin/env node
/**
 * `ci-github-mirror-push.mjs` —— 双远端镜像的**推送 + 派发**一格（ISSUE #2978）。
 *
 * ## 它要回答的那一格
 *
 * 开发流（PR / issue / `pnpm ship`）全在 CNB，而 GitHub Actions 的触发器只认
 * 发生在 GitHub 侧的事件 —— 镜像推送就是把「这次 PR 跑到哪一笔」同步过去的那一跳：
 * 把本跑工作区 HEAD 推到镜像仓库的**专属 ref**，再派发 `repository_dispatch`，
 * 让 `.github/workflows/pr-gate.yml` 按同一笔 sha 起跑。
 *
 * 推的是 `HEAD`（PR 事件上是平台合成的 merge 提交）而不是 PR head：cnb 工作区
 * 跑的就是这份树，GitHub 侧判同一份树才是对账；两个父提交的历史都在可达集里，
 * 推送时一并带上。镜像 ref 按请求 ID 收口（`cnb-pr-<IID>`）—— 不猜源分支名的
 * 环境变量形状，也没有同名互踩。
 *
 * ## 边界
 *
 * 1. **fail-closed**：令牌 / 请求 ID / HEAD / 目标仓库取不到 ⇒ 退 `2`（没跑起来），
 *    不冒充成功。第 5 条那一跳让「目标仓库还没有」也落进这一类 —— 它是**外部前提**
 *    没落地，不是这一格判出了红。
 * 2. **不打令牌值**（硬规则 17）：令牌只出现在进程参数里；一切回显先过脱敏。
 * 3. **它在主列，且自 2026-11-05 起承重**（ISSUE #2978 立案时放 `endStages`；#3051 前移进主列，
 *    同一单的期望第 3 条在回读格上线后落地）：平台的 `endStages` 语义是「stages 跑完才执行」，
 *    而这条流水线实测整跑 2546s ⇒ GitHub 那一跑最早只能在一个多小时后起跑，等「读回 GitHub
 *    对同一笔 sha 的判决」那一格上线就成了串行。前移是为了并行；主列的退码**承重**（某格
 *    `error` 会把后面的格整片 `skipped`），所以这里的取舍是刻意的：**推不出去 = 这跑没判过
 *    = 不许合**。`.cnb.yml` 主列那一格因此**不再带 `--readout`**；旗标还留给 push 档
 *    （那里只报读数、合并闸由别处承重）。
 * 4. 推送用 `--force` 不用 `--force-with-lease`：lease 需要 expected 值（要先
 *    `ls-remote` 再推，两跳网络 + 竞态窗），而 ref 按 IID 专属、由并发锁保证
 *    同一 PR 同时只有一跑在推 —— 覆盖自己的旧值正是幂等语义。
 * 5. **推送前先问一次「仓库在不在」**（`ls-remote`，取它第一条 refs 行当代理）。
 *    为什么要有这一跳：目标仓库没建时，`git push` 的回话与「令牌坏了」**逐字同形**
 *    （`Invalid username or token` / `Authentication failed`）—— 现场四次跑都停在
 *    同一句上，读的人只能两边一起猜。分开它们的代价只要一次读，而猜错的代价是把
 *    「前提没落地」当成「判据红了」去改代码（ISSUE #3014 的形态）。
 *    刻意**不**用 HTTP 读 `api.github.com`：那要求令牌带读仓库元数据的权，而这一格
 *    该要的最小面只有 `contents: write`（PR 上游那一族连 `repo-cnb-history:r` 都没有，
 *    见 `.cnb.yml` 的令牌权限读数）；`ls-remote` 用的是**同一条**认证路径与同一枚令牌，
 *    所以「它探通了而推不通」仍然只可能是写权 / 保护规则那一层的事 —— 那才是红。
 *
 * 6. **推送不带本仓的钩子**（`-c core.hooksPath=`，ISSUE #3025 的第二现场）：平台侧检出
 *    是**工作区**，`prepare` 起的每一步都在同一棵树上，于是 `.githooks/pre-push` 会跟着
 *    每一次 `git push` 跑。那一跳判的是「这条分支要不要合进本仓 `master`」，对镜像仓库
 *    这一推没有对象；而它的前置（`refs/remotes/**`、`git-lfs`）在那一形态里都不成立 ——
 *    #3025 给钩子补了「按目的地放行」，但那条判据要求 `git remote get-url` 读得到本仓
 *    remote，平台检出连 remote 都没有（`refs/remotes/**` 零条）⇒ 读不到 ⇒ 按不对称口径
 *    照旧复算 ⇒ 又一次被自家钩子拦死。所以这一跳**不经过任何本地钩子**：`push` 要在
 *    别人的仓库上写东西，本仓的提交门槛对它没有管辖权。
 * 7. **`GIT_DIR` / `GIT_WORK_TREE` 一律不从环境继承**（同上）：平台 `prepare` 里有
 *    `export GIT_DIR=…` 的做法（本仓 `scripts/ci-*.mjs` 就有几处），那一形态下子进程里的
 *    `git push` 会推到别的树上 —— 这一格的每一条 git 调用都显式清掉这两个变量，只吃 `cwd`。
 * 8. **网络抖动的韧性**（判据演进、数字与 30s 首刀细节见 `ci-mirror-retry-policy.mjs` 文件头）：
 *    同一台 runner 时通时不通 ⇒ github.com:443 是间歇抖动而非硬阻断。推送那一跳单独吃一份
 *    4 分钟墙钟预算（`PUSH_RETRY_BUDGET_MS`，从第一刀推送前起算），至多 10 次、退避 5s→50s，
 *    只有 egress ∪ 远端 5xx 消耗重试，认证 / 权限类一次交账。**#3252 起不再先探活**（双跳等于
 *    把同一次出网试两遍，现场探活 6 次耗 201s、内容推送一次都没发起），失败读数直接来自真实推送。
 * 9. **refs 推完还有第二跳：LFS 对象**（第二批，字体真身那一族）。镜像仓若只有指针文件，
 *    GitHub 侧 `checkout` 开 `lfs: true` 就撞「拉不到对象」的红，所以内容推送成功后补一跳
 *    `git lfs push <镜像> HEAD`：**不带 `--all`**（增量由 git-lfs 对账，存量历史不重复计
 *    带宽）。失败 ⇒ exit 1 且**不派发**（派出去只会让 GitHub 侧拿指针文件跑出一格假红）。
 *    七类失败话术、配额风险与收尾小结见 `ci-mirror-failure-report.mjs` 模块头（#3106）。
 *    **之一（#3138）**：`git lfs push <url> HEAD` 有两处依赖「本地 ref 可枚举」——
 *    按 ref 对账该推哪些对象、以及参数 `HEAD` 本身要能解析。平台合成的合并提交 / 工作区
 *    形态下这两件都可能不成立（现场 `Error getting local refs.`）。这一类失败**自动回退**
 *    按对象 OID 推（`git lfs push --object-id`）：清单由 `git lfs ls-files --long` 按
 *    **index** 取（实测：删光 `refs/**` 之后它照样给得出 OID），不经过任何 ref 解析。
 *    回退通了就是通（原路径的 ref 枚举失败不构成结论）；回退也失败才按下面那条交账。
 *    清单为空（本地压根没有 LFS 对象）⇒ 回退没有对象，按原失败交账。
 * 10. **入口那一层也要有终点**（`861623ced` 带进来的回归）：`--master` 的执行面在
 *     `ci-github-mirror-master.mjs`、靠动态 `import` 取；那一份反过来静态 import 本文件。
 *     入口若用**顶层** `await import(...)`，两侧求值互等（本文件求值要等 master，
 *     master 求值要等本文件）⇒ Promise 永不 settle，事件循环空转后 Node 报
 *     `Detected unsettled top-level await` 并以 exit 13 收场：一格红，日志里没有一句
 *     三态读数。所以入口改成 `.then()` 收口（求值同步做完，环自然解开）；那一跳**装载**
 *     另挂显式上限 {@link MIRROR_ENTRY_TIMEOUT_MS} —— 到点按 exit 2 明念「在等什么 /
 *     等了多久 / 最后读数」，不靠 Node 的兜底退码。**只界装载那一跳**：跑起来之后的推送 /
 *     LFS 各自已有上限（见常量注释），外框 10m 包的是它们的最坏墙钟。
 *
 * ## `--master`：push 档（`master 合并复核`）的主干镜像
 *
 * 同一枚令牌、同一条推送链（`--force` 推 → 回读 ref → 推 LFS → 核对对象），三件事与 PR 模式不同：
 *
 *   1. **没有 IID**：push 事件上没有 `CNB_PULL_REQUEST_IID`，上下文集换成
 *      `resolveMasterContext()`（只要令牌与 HEAD 两件，ref 恒为 `master`）；
 *   2. **不派发**：`repository_dispatch` 是给 PR 门禁那一跑的起跑枪；master 这一推
 *      服务的对象是 GitHub 侧的 schedule（`daily.yml` / `package-desktop.yml`）——
 *      它们跑默认分支，推完即就位，没有要叫醒的 workflow；
 *   3. **日志前缀是 `[mirror-master]`**：与 PR 那一格的 `[mirror]` 分开 ——
 *      `check-mirror-attendance.mjs` 按格名 + `[mirror]` 正文认 PR 档那一格，
 *      两边各念各的，互不冒充出勤。
 *
 * 推 `HEAD:refs/heads/master` 仍带 `--force`：镜像的语义是「跟住 CNB 的 master」，
 * 这一格红过几跑（漏推）之后，下一推必须能自己追平，不需要人去镜像仓手工对齐。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-github-mirror-push.mjs               # 三态退码（CI 主列那一格：承重）
 * node scripts/ci-github-mirror-push.mjs --readout     # 读数档：三态照打点、退码恒 0（push 档 / 本地自查）
 * node scripts/ci-github-mirror-push.mjs --dry-run     # 只打印计划与 payload，不发任何请求
 * node scripts/ci-github-mirror-push.mjs --master      # push 档那一格：推 master，不派发
 * node scripts/ci-github-mirror-push.mjs --once --readout
 *     # 托管机实验档（ISSUE #3346）：三跳各只试一次、不重试；配平台池那条影子流水线
 * node scripts/ci-github-mirror-push.mjs --await-hosted
 *     # 主列那一格（ISSUE #3346）：先等托管机实验格的结果 —— refs 见本跑 HEAD 即跳过推送，
 *     # 预算（HOSTED_AWAIT_BUDGET_MS）到点没见才落回下面的正常推送
 * ```
 *
 * 环境变量：`GITHUB_MIRROR_TOKEN`（必填）、`GITHUB_MIRROR_REPO`（缺省
 * `wuxianyuedu/comfy-app`）、`CNB_PULL_REQUEST_IID`、`CNB_PULL_REQUEST_TARGET_SHA`
 * （后两件只属 PR 模式；`--master` 不读它们）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync as realMkdirSync, writeFileSync as realWriteFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  isEgressFailure,
  renderMirrorSummary,
  shouldRetryGitFailure,
  writeDispatchState,
} from "./ci-mirror-failure-report.mjs";
import { pushLfsObjects } from "./ci-mirror-lfs-push.mjs";
import { buildRunName, dispatchPayload, EVENT_TYPE, resolvePrTitle } from "./ci-mirror-payload.mjs";
import { verifyLfsObjects, verifyPushedRef } from "./ci-mirror-push-verify.mjs";
import {
  gitSubcommand,
  gitTimeoutFor,
  PUSH_MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  RETRY_MIN_ATTEMPT_MS,
  VERIFY_MAX_ATTEMPTS,
} from "./ci-mirror-retry-policy.mjs";
/* 这两个纯函数随 #3346 迁去 retry-policy（给本文件腾 900 行硬闸余量）；仍从这里转出，导入面不改。 */
export { gitSubcommand, gitTimeoutFor };
import { createWireBudget } from "./ci-mirror-wire-budget.mjs";
/* 纯拼装切出去之后仍从这里转出，用例与调用方的导入面不用动（见该模块「为什么单独一份」）。 */
export { dispatchPayload };

/* LFS 那一族搬去 `ci-mirror-lfs-push.mjs`（#3146 的 900 行闸）；仍从这里转出，导入面不用改。 */
export { lfsObjectIdPushArgs, lfsPushArgs, parseLfsObjectIds } from "./ci-mirror-lfs-push.mjs";

/* 这几件实现搬去 `ci-mirror-failure-report.mjs`（#3106 的 900 行闸）；仍从这里转出，导入面不用改。 */
export {
  classifyLfsPushFailure,
  DISPATCH_STATE_DIR,
  DISPATCH_STATE_FILE,
  explainLfsPushFailure,
  isEgressFailure,
  LFS_FAILURE_KINDS,
  LFS_FAILURE_SHORT_ACTIONS,
  parseLfsObjectCount,
  renderMirrorSummary,
  writeDispatchState,
} from "./ci-mirror-failure-report.mjs";

/**
 * 收尾小结的入参（去掉 `prefix` / `readout`，由各档闭包自己给）。
 * @typedef {Omit<Parameters<typeof renderMirrorSummary>[0], "prefix" | "readout">} MirrorSummaryFields
 */
/** 三态退码与仓内其余档同口径（`0` 有结论 / `1` 有事实是红 / `2` 没跑起来）。 */
export const CODE = { FAIL: 1, NO_FACT: 2, OK: 0 };

/** 镜像仓库缺省坐标（`GITHUB_MIRROR_REPO` 可覆盖）。 */
export const DEFAULT_REPO = "wuxianyuedu/comfy-app";

/** `--master` 模式推的目标分支（GitHub 侧的默认分支；CNB `master` 的唯一镜像出口）。 */
export const MASTER_REF = "master";

/** 本仓检出根（`scripts/` 的上一层）—— 所有 git 子进程在这里跑，不靠继承的工作目录。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 本格那次 `git push` 的完整参数表（含一条「不带本仓钩子」的 `-c`）。
 *
 * 为什么钩子必须被关掉（文件头第 6 条）：平台侧检出是一棵工作区，`.githooks/pre-push`
 * 对每一次 `git push` 都跑，而它判的是「这条分支要不要合进本仓 `master`」—— 与「在镜像
 * 仓库上写一个专属 ref」没有关系。它跑了只会把这一格拦在自己的前置条件上（远端的
 * `refs/remotes/**` 在平台检出里并不存在）。
 *
 * 关的是**这一次调用**（`-c`），不是 `git config`：不落盘、不改检出状态，也就没有
 * 「改完忘了改回去」这一种失败形态。
 *
 * @param {string} url 带凭据的推送 URL
 * @param {string} ref 目标 ref 全名（`refs/heads/...`）
 * @returns {string[]} git 参数表
 */
export function pushArgs(url, ref) {
  return ["-c", "core.hooksPath=", "push", "--force", url, `HEAD:${ref}`];
}

/**
 * git 子进程的环境：清掉 `GIT_DIR` / `GIT_WORK_TREE`（文件头第 7 条）。
 *
 * @returns {NodeJS.ProcessEnv} 交给 `spawnSync` 的环境
 */
function gitEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

/**
 * 镜像 ref 名：按 PR 请求 ID 收口的专属分支（不带 `refs/heads/` 前缀）。
 *
 * @param {string} iid 平台注入的 PR 请求 ID（纯数字）
 * @returns {string} 形如 `cnb-pr-2649`
 */
export function mirrorRefFor(iid) {
  return `cnb-pr-${iid}`;
}

/**
 * 回显脱敏：把令牌的每一次出现换成占位（URL 形态与裸值形态都覆盖）。
 *
 * @param {string} text 待回显文本
 * @param {string} secret 令牌原值
 * @returns {string} 脱敏后的文本
 */
export function sanitize(text, secret) {
  if (!secret) {
    return text;
  }
  return text.split(`${secret}@`).join("***@").split(secret).join("***");
}

/**
 * 组装推送 URL（令牌只进这一处，回显必须先过 {@link sanitize}）。
 *
 * 用户名：fine-grained PAT 有「必须用真实 GitHub 用户名」的实测反馈（classic 用
 * `oauth2` 通），所以用户名可由 `GITHUB_MIRROR_USER` 覆盖，缺省 `oauth2`；
 * 两形态都支持用户名任意。「值本身失效」与「形态不对」在同一句
 * 「Invalid username or token」里分不开 —— 现场先拿真值在本地 `ls-remote` 定值。
 *
 * @param {string} repo `owner/repo`
 * @param {string} token GitHub 令牌
 * @returns {string} 带 Basic 凭据的 HTTPS URL
 */
export function buildPushUrl(repo, token, user = "oauth2") {
  return `https://${user}:${token}@github.com/${repo}.git`;
}

/**
 * 从环境变量收口本次镜像的上下文；缺哪件就念哪件（fail-closed 的「读数」半边）。
 *
 * @param {{env: Record<string, string | undefined>, runGit: (args: string[]) => {code: number, stdout: string, stderr: string}}} io
 * @returns {{ok: true, repo: string, token: string, iid: string, ref: string, headSha: string, baseSha: string, cnbCommit: string, cnbMergeSha: string} | {ok: false, reasons: string[]}}
 */
export function resolveContext(io) {
  const { env, runGit } = io;
  const reasons = [];
  const token = env.GITHUB_MIRROR_TOKEN ?? "";
  if (!token.trim()) {
    reasons.push("`GITHUB_MIRROR_TOKEN` 未配置（平台侧注入；本地自查用 --dry-run）");
  }
  const iid = (env.CNB_PULL_REQUEST_IID ?? "").trim();
  if (!/^\d+$/.test(iid)) {
    reasons.push("`CNB_PULL_REQUEST_IID` 不是纯数字（本格只挂在 PR 流水线的质量门禁那一档上）");
  }
  const headSha = runGit(["rev-parse", "HEAD"]);
  if (headSha.code !== 0 || !/^[0-9a-f]{40}$/i.test(headSha.stdout.trim())) {
    reasons.push(`git rev-parse HEAD 取不到（exit ${headSha.code}）`);
  }
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    /* base sha 只进 payload（GitHub 侧对账用），缺席不阻断 —— 那一格不读它。 */
    baseSha: (env.CNB_PULL_REQUEST_TARGET_SHA ?? "").trim(),
    /* CNB_COMMIT（源分支 head）也只进 payload：GitHub 侧重档的「格式化提交与行为改动
     * 分离」判据（reformat-preview-range.mjs）需要它才能认出合成合并预览的两个父。
     * 缺席不阻断 —— 缺了那一档照旧退「没判」，与 CNB 侧缺变量的行为一致。 */
    cnbCommit: (env.CNB_COMMIT ?? "").trim(),
    /* PR 预合并 sha（CNB 平台合成的 merge 提交）= commit-statuses 的 sha。
     * GA 回调 build 必须绑这一笔才能把终态写进那张 statuses 集合；与 headSha
     * 「同树不同 sha」，别拿本跑 HEAD 顶替（ISSUE #3378 探针读数）。 */
    cnbMergeSha: (env.CNB_PULL_REQUEST_MERGE_SHA ?? "").trim(),
    headSha: headSha.stdout.trim(),
    iid,
    ok: true,
    ref: mirrorRefFor(iid),
    repo: (env.GITHUB_MIRROR_REPO ?? DEFAULT_REPO).trim(),
    token: token.trim(),
  };
}

/**
 * `--master` 模式的上下文收口：push 事件上没有 `CNB_PULL_REQUEST_IID`，要的两件
 * 只有令牌与 HEAD；ref 恒为 {@link MASTER_REF}（文件头「--master」一节）。
 *
 * @param {{env: Record<string, string | undefined>, runGit: (args: string[]) => {code: number, stdout: string, stderr: string}}} io
 * @returns {{ok: true, repo: string, token: string, ref: string, headSha: string} | {ok: false, reasons: string[]}}
 */
export function resolveMasterContext(io) {
  const { env, runGit } = io;
  const reasons = [];
  const token = env.GITHUB_MIRROR_TOKEN ?? "";
  if (!token.trim()) {
    reasons.push(
      "`GITHUB_MIRROR_TOKEN` 未配置（push 流水线经 imports 注入；本地自查用 --dry-run）",
    );
  }
  const headSha = runGit(["rev-parse", "HEAD"]);
  if (headSha.code !== 0 || !/^[0-9a-f]{40}$/i.test(headSha.stdout.trim())) {
    reasons.push(`git rev-parse HEAD 取不到（exit ${headSha.code}）`);
  }
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    headSha: headSha.stdout.trim(),
    ok: true,
    ref: MASTER_REF,
    repo: (env.GITHUB_MIRROR_REPO ?? DEFAULT_REPO).trim(),
    token: token.trim(),
  };
}

/**
 * 真身：git 子进程执行器（测试注入点同形的假件在用例里给）。
 *
 * ⚠️ 超时不是「git 回了个非零」：`spawnSync` 到点是**本仓把它杀了**，`status` 变 `null`、
 * `error.code` 是 `ETIMEDOUT`。原样交出去只会读成一句「exit -1」，所以这里补一句回话，
 * 让 `explainRemoteProbeFailure()` 把它归进 egress 那一类（#3051 之前这一形被念成
 * 「令牌活不活 / 仓库在不在」，把人指到错的下一动作上）。
 *
 * @param {string[]} args git 参数表
 * @param {{timeout?: number}} [opts] 这一次尝试的墙钟（缺省按子命令取 {@link gitTimeoutFor}）
 * @returns {{code: number, stderr: string, stdout: string}}
 */
export function realRunGit(args, opts) {
  const timeout = opts?.timeout ?? gitTimeoutFor(args);
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: gitEnv(), timeout });
  /* 念出来的是子命令而不是 `args[0]` —— 推送那一跳的 `args[0]` 是 `-c`。 */
  const sub = gitSubcommand(args);
  if ((r.error ?? null) !== null || r.status === null) {
    /* Node 把 `spawnSync` 的 `error` 标成 `Error`，而超时那一支带 `code: "ETIMEDOUT"`（类型没申出来）⇒ 按形状读一次。 */
    const err = typeof r.error === "object" ? r.error : null;
    const code = err !== null && "code" in err ? String(err.code) : undefined;
    const why =
      code === "ETIMEDOUT"
        ? `git ${sub} 超时（>${String(timeout)} ms）：这一跳没拿到任何回话 —— 是没通，不是判出的红`
        : `git ${sub} 连上都没连上：${String(r.error ?? "拿不到退出码")}`;
    return {
      code: -1,
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程失败时 stderr 实测为 null，@types/node 按 string 标
      stderr: `${String(r.stderr ?? "")}\n${why}`,
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程失败时 stdout 实测为 null，@types/node 按 string 标
      stdout: String(r.stdout ?? ""),
    };
  }
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程的 stdout/stderr 类型按 string 标，失败形态下实测可缺
  return { code: r.status, stderr: String(r.stderr ?? ""), stdout: String(r.stdout ?? "") };
}

/**
 * 真身的退避等待（测试注入 `io.sleep` 的假件，用例一次真墙钟都不付）。
 *
 * @param {number} ms 等多久
 * @returns {Promise<void>}
 */
export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带有限重试的一跳（文件头第 8 条）：**只有 `shouldRetryGitFailure()` 认下的 egress ∪
 * 远端 5xx** 才消耗重试；认证 / 权限 / 仓库不存在一律一次交账。判据在
 * `ci-mirror-failure-report.mjs`，话术仍只认 egress（5xx 不该被念成节点出网问题）。
 *
 * 两道上限同时收口（2026-11-05）：`maxAttempts` 管次数（别把日志刷成一片），`budgetMs`
 * 管墙钟（这一跳从第一刀到交账不许超过窗口）。给了预算会把**重试**那些尝试的超时裁到
 * 「剩余预算」，所以「首刀 240s 挂了再来一刀 240s」不会发生；**首刀不裁**（照吃单跳上限），
 * 免得 LFS 那 60s 预算把一次「慢但正常」的上传掐死。瞬时失败只吃退避 ⇒ 整档在窗口内反复试。
 * 取法与数字的理由见 `ci-mirror-retry-policy.mjs`。
 *
 * 每一次重试都留一行读数（第几次、等多久），重试耗尽后交回**最后一次**的结果 ——
 * 退码与后续话术与没有重试时逐字同形（推送没通仍是 exit 2 —— 前提没落地）。
 *
 * @param {string[]} args git 参数表
 * @param {{runGit: typeof realRunGit, sleep: (ms: number) => Promise<void>, log: (line: string) => void, prefix: string, label: string, maxAttempts: number, budgetMs?: number, now?: () => number}} ctx
 * @returns {Promise<{attempts: number, code: number, stderr: string, stdout: string}>} 最后一次尝试的结果 + 实际消耗的次数
 */
export async function runGitWithRetry(args, ctx) {
  const { budgetMs, label, log, maxAttempts, prefix, runGit, sleep, now = Date.now } = ctx;
  const startedAt = now();
  /** 这一跳还剩多少预算；不给预算 ⇒ 无穷（那时只有 `maxAttempts` 生效）。 */
  const remaining = () =>
    budgetMs === undefined ? Number.POSITIVE_INFINITY : budgetMs - (now() - startedAt);
  /** @type {(ms: number) => {timeout: number} | undefined} 有预算就裁到剩余量，否则留 undefined。 */
  const callOpts = (ms) => {
    const base = gitTimeoutFor(args);
    return budgetMs === undefined || base === undefined
      ? undefined
      : { timeout: Math.min(base, Math.round(ms)) };
  };
  let attempts = 1;
  /* 首刀不裁（照吃单跳上限，保护「慢但正常」的上传）；裁的只有下面那几跳重试。 */
  let result = runGit(args);
  for (let attempt = 2; attempt <= maxAttempts && result.code !== 0; attempt += 1) {
    if (!shouldRetryGitFailure(`${result.stdout}\n${result.stderr}`)) {
      break;
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 下标越界时运行时为 undefined（未开 noUncheckedIndexedAccess），退避表长度不随 maxAttempts 变
    const wait = RETRY_BACKOFF_MS[attempt - 2] ?? RETRY_BACKOFF_MS.at(-1) ?? 5000;
    const left = remaining() - wait;
    if (left < RETRY_MIN_ATTEMPT_MS) {
      log(
        `[${prefix}] ${label}重试预算用尽：已试 ${String(attempt - 1)} 次、耗 ${String(Math.round((now() - startedAt) / 1000))}s（预算 ${String((budgetMs ?? 0) / 1000)}s，低于一次尝试的 ${String(RETRY_MIN_ATTEMPT_MS / 1000)}s 就不再发起）⇒ 按最后一次结果交账`,
      );
      break;
    }
    log(
      `[${prefix}] ${label}第 ${String(attempt - 1)}/${String(maxAttempts)} 次没通（可重试类）⇒ ${String(wait / 1000)}s 后试第 ${String(attempt)} 次（网络抖动 / 远端 5xx 重试；认证 / 权限类不重试）`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
    await sleep(wait);
    attempts = attempt;
    result = runGit(args, callOpts(left));
  }
  return { ...result, attempts };
}

/**
 * 把推送 / 远端读的失败回话翻成**具体那一句**（回话本身不判红，它只被念出来）。
 *
 * 三形态各有各的下一动作，读的人不必自己去猜：
 *
 * · `Repository not found` 是**仓库层面**没通（没建 / 令牌对它没有读权）；
 * · 其余认证回话更可能落在**令牌值 / 身份范围**上；
 * · `Failed to connect` / `Could not connect to server` / `Connection reset` / DNS 失败 /
 *   本仓自己给的超时（`gitTimeoutFor` 那两支）都是 **egress 层** —— 网络根本没到 GitHub。
 *
 * 第三支是 #3051 补的：它缺席时那一形会落到下面那句通用话术上，把「节点连不上
 * github.com:443」念成「令牌活不活 / 仓库在不在」—— 那句把人往令牌上查，而令牌是好的
 * （实测 `cnb-61a-1k6d4na5o` 的 `stage-endStages-2`：`Failed to connect to github.com
 * port 443 after 21114 ms`）。
 *
 * 这一函数**不改变退码** —— 三种都落「前提没落地」，改的只是下一动作能不能被照着做。
 *
 * @param {string} text `ls-remote` 的 stdout + stderr（未脱敏）
 * @returns {string} 一句中文读数
 */
export function explainRemoteProbeFailure(text) {
  if (isEgressFailure(text)) {
    return "到 github.com 这一跳没通（TCP / DNS / 代理层）⇒ 出网问题在节点侧（白名单 / 代理 / 换 runner），与令牌值和这一格的判据都无关";
  }
  if (/repository not found|does not appear to be a git repository/i.test(text)) {
    return "目标仓库在 GitHub 上不存在（或以这枚令牌的身份看不见它）⇒ 先去建仓库，再重跑这一格";
  }
  if (/repository access blocked|not accessible|deploy key/i.test(text)) {
    return "这枚令牌的身份够不到目标仓库（fine-grained PAT 须把该仓库列进仓库访问范围）";
  }
  return "推送被拒且不属于上面几类 ⇒ 现场拿真值在本地 `git ls-remote` / `git push --dry-run` 各定一次值（仓库在不在 / 令牌活不活 / 保护规则拦不拦）";
}

/**
 * 执行镜像：推 HEAD → 回读远端 ref → 推 LFS → 核对对象 → 派发。每一跳各自独立成读数，前一跳没通后一跳不发。
 *
 * @param {{env: Record<string, string | undefined>, fetchImpl?: typeof fetch, runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>, now?: () => number, dryRun?: boolean, log?: (line: string) => void, readout?: boolean, once?: boolean, root?: string, writeFileSync?: (file: string, data: string) => void, mkdirSync?: (dir: string, opts: object) => void, cnbJson?: (run: any, args: string[]) => any}} io
 *   `cnbJson` 是 PR 标题回读的取数动作（`ci-mirror-payload.mjs`；用例给假件，
 *   缺省走真 `cnb` 子进程）。
 * @returns {Promise<number>} 仓内三态退码
 */
export async function runMirror(io) {
  const { dryRun = false, env } = io;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const readout = io.readout ?? false;
  /* once（ISSUE #3346）：托管机实验档「三跳各只试一次」。墙钟预算照旧（首刀不裁的纪律
   * 不变），次数收到 1 —— 「失败了也不重试」是这一档的实验语义本身，不是预算的副产品。 */
  const once = io.once ?? false;
  /** 收尾小结（ISSUE #3106）：每个终局都把 wire / LFS / 派发并排成**最后一行**。
   *  @param {MirrorSummaryFields} fields */
  const summarize = (fields) => {
    log(renderMirrorSummary({ prefix: "mirror", readout, ...fields }));
  };
  /* 派发形状落盘（ISSUE #3148）：主列末尾那一格 `GitHub 判决回读` 读它，从而在「本跑
   * 根本没派发」时不再把 45m 轮询预算花完。落盘失败不改本格三态。 */
  const { root = ROOT, writeFileSync = realWriteFileSync, mkdirSync = realMkdirSync } = io;
  /** @param {boolean} d @param {string} r */
  const leave = (d, r) => {
    writeDispatchState(writeFileSync, root, { dispatched: d, reason: r }, mkdirSync);
  };
  const fetchImpl = io.fetchImpl ?? fetch;
  const runGit = io.runGit ?? realRunGit;
  const sleep = io.sleep ?? realSleep;
  const wireBudget = createWireBudget(io.now);
  const ctx = resolveContext({ env, runGit });
  if (!ctx.ok) {
    for (const reason of ctx.reasons) {
      log(`[mirror] 没跑起来的原因：${reason}`);
    }
    log("[mirror] 结论：exit 2 —— 有一步没跑起来（不等于通过，也不等于「没有要同步的」）");
    summarize({ lfs: null, wire: "没跑（前提没配齐）" });
    leave(false, "前提没配齐（令牌 / IID / HEAD 取不到）⇒ 派发没发生");
    return CODE.NO_FACT;
  }
  const url = buildPushUrl(ctx.repo, ctx.token, (env.GITHUB_MIRROR_USER ?? "").trim() || "oauth2");
  /* PR 标题：读不到就留空，不判红、不改三态（`ci-mirror-payload.mjs` 口径 1）。
   * dry-run 刻意不读平台 —— 它承诺「不发任何请求」，那一档看到的是回落格式。 */
  const prTitle = dryRun ? "" : resolvePrTitle({ cnbJson: io.cnbJson, env, iid: ctx.iid, log });
  const payload = dispatchPayload({
    baseSha: ctx.baseSha,
    cnbCommit: ctx.cnbCommit,
    cnbMergeSha: ctx.cnbMergeSha,
    headSha: ctx.headSha,
    prNumber: ctx.iid,
    ref: ctx.ref,
    title: prTitle,
  });
  const baseNote = ctx.baseSha
    ? ` · base ${ctx.baseSha.slice(0, 8)}`
    : " · base 缺席（payload 留空）";
  log(
    `[mirror] 计划：HEAD ${ctx.headSha.slice(0, 8)} → ${ctx.repo}:${ctx.ref} · LFS 增量推送 · 派发 ${EVENT_TYPE}${baseNote}`,
  );
  /* 派发前的自证：这一跑在 GitHub run 列表里会叫什么（与 workflow 的 run-name 同口径）。
   * 读不到标题时这一行就是老格式 —— 一眼能看出「标题没读到」而不是「标题渲染坏了」。 */
  log(
    `[mirror] GitHub run 标题：${buildRunName({ prNumber: ctx.iid, sha: ctx.headSha, title: prTitle })}`,
  );
  if (dryRun) {
    log("[mirror] DRY-RUN：没推也没派发，payload 如下 ——");
    log(JSON.stringify(payload, null, 2));
    log(
      "[mirror] DRY-RUN：实跑时内容推送后还有一跳 LFS 增量推送（不带 --all，失败 ⇒ exit 1 不派发）",
    );
    return CODE.OK;
  }
  /* 不再先探活（ISSUE #3252 的现场：探活 6 次耗 201s、一次内容推送都没发起）。网络不通时
   * push 自己的回话与 ls-remote 同一形，双跳只是把同一次出网试两遍；这里第一刀就是内容推送，
   * egress 类才重试，预算从这一刀起算。 */
  const push = await runGitWithRetry(pushArgs(url, `refs/heads/${ctx.ref}`), {
    budgetMs: wireBudget(),
    label: "推送",
    log,
    maxAttempts: once ? 1 : PUSH_MAX_ATTEMPTS,
    now: io.now,
    prefix: "mirror",
    runGit,
    sleep,
  });
  if (push.code !== 0) {
    const pushText = sanitize(`${push.stdout}\n${push.stderr}`, ctx.token);
    log(`[mirror] 推送本身没通（exit ${push.code}）：${explainRemoteProbeFailure(pushText)}`);
    for (const line of pushText.split("\n")) {
      if (line.trim()) {
        log(`[mirror]   ${line}`);
      }
    }
    log(
      "[mirror] 结论：exit 2 —— 前提没落地（egress / 目标仓库 / 令牌这三层之一，看上面那句是哪一种；不是这一格判出的红）",
    );
    summarize({ lfs: null, retries: push.attempts - 1, wire: `败（exit ${String(push.code)}）` });
    leave(
      false,
      `refs 推送没通（exit ${String(push.code)}：egress / 仓库 / 令牌三层之一）⇒ 派发没发生`,
    );
    return CODE.NO_FACT;
  }
  /* 推成功 ≠ 远端那条 ref 前进到了本次 HEAD：回读一次，按远端事实交账（见 verify 模块头）。 */
  const refCheck = await verifyPushedRef({
    headSha: ctx.headSha,
    log,
    maxAttempts: once ? 1 : VERIFY_MAX_ATTEMPTS,
    now: io.now,
    prefix: "mirror",
    ref: `refs/heads/${ctx.ref}`,
    runGit,
    runGitWithRetry,
    sanitize,
    sleep,
    token: ctx.token,
    url,
  });
  if (refCheck.code !== CODE.OK) {
    log(`[mirror] 结论：exit ${String(refCheck.code)} —— ${refCheck.note}`);
    summarize({
      lfs: null,
      retries: push.attempts - 1,
      wire: `推了但没到位（${refCheck.note}）`,
    });
    leave(false, `refs 推送后回读不符（${refCheck.note}）⇒ 派发没发生`);
    return refCheck.code;
  }
  log(`[mirror] 推送后回读：${refCheck.note}`);
  /* refs 已在 ⇒ 第二跳把 LFS 对象送过去（文件头第 9 条）。它挂了照样是红，且**不派发**：
   * 派出去只会让 GitHub 侧拿指针文件跑出一格假红（字体用例对不上字节数）。 */
  const wireNote = `通（refs/heads/${ctx.ref} @ ${ctx.headSha.slice(0, 8)}）`;
  const lfs = await pushLfsObjects({
    log,
    maxAttempts: once ? 1 : undefined,
    prefix: "mirror",
    runGit,
    runGitWithRetry,
    sanitize,
    sleep,
    token: ctx.token,
    url,
  });
  if (lfs.code !== CODE.OK) {
    summarize({
      elapsedMs: lfs.elapsedMs,
      failure: lfs.failure,
      lfs: false,
      objects: lfs.objects,
      retries: lfs.attempts - 1,
      wire: wireNote,
    });
    leave(
      false,
      `refs 已推但 LFS 对象没送过去（${lfs.failure?.label ?? "类别见上一行"}）⇒ 刻意不派发`,
    );
    return lfs.code;
  }
  /* `git lfs push` 退 0 也不等于对象在远端可下载：按 batch API 逐个核对，别只看退出码。 */
  const lfsCheck = await verifyLfsObjects({
    fetchImpl,
    log,
    maxAttempts: once ? 1 : VERIFY_MAX_ATTEMPTS,
    now: io.now,
    prefix: "mirror",
    repo: ctx.repo,
    runGit,
    sleep,
    token: ctx.token,
  });
  if (lfsCheck.code !== CODE.OK) {
    log(`[mirror] 结论：exit ${String(lfsCheck.code)} —— ${lfsCheck.note}`);
    summarize({
      elapsedMs: lfs.elapsedMs,
      lfs: false,
      objects: lfsCheck.objectsText,
      retries: lfs.attempts - 1,
      wire: wireNote,
    });
    leave(false, `LFS 推送后核对没通过（${lfsCheck.note}）⇒ 刻意不派发`);
    return lfsCheck.code;
  }
  log(`[mirror] 推送后回读：${lfsCheck.note}`);
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${ctx.repo}/dispatches`, {
      body: JSON.stringify(payload),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${ctx.token}`,
        "Content-Type": "application/json",
        "User-Agent": "comfy-app-cnb-mirror",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method: "POST",
    });
  } catch (error) {
    log(`[mirror] 派发请求没跑起来（网络层）：${String(error)}`);
    summarize({
      dispatch: "没跑（网络层）",
      elapsedMs: lfs.elapsedMs,
      lfs: true,
      objects: lfs.objects,
      retries: lfs.attempts - 1,
      wire: wireNote,
    });
    leave(false, "派发请求在网络层没跑起来 ⇒ 派发没发生");
    return CODE.NO_FACT;
  }
  if (res.status !== 204) {
    const body = await res.text().catch(() => "");
    log(`[mirror] 派发被拒：HTTP ${res.status}（payload 与令牌都在，拒的是请求本身）`);
    if (body.trim()) {
      log(`[mirror]   ${sanitize(body, ctx.token)}`);
    }
    summarize({
      dispatch: `败（HTTP ${String(res.status)}）`,
      elapsedMs: lfs.elapsedMs,
      lfs: true,
      objects: lfs.objects,
      retries: lfs.attempts - 1,
      wire: wireNote,
    });
    leave(false, `派发被拒（HTTP ${String(res.status)}）⇒ GitHub 侧没有这一跑`);
    return CODE.FAIL;
  }
  log(`[mirror] ✓ 已推 ${ctx.repo}:${ctx.ref} @ ${ctx.headSha.slice(0, 8)} · 已派发 ${EVENT_TYPE}`);
  summarize({
    dispatch: "通",
    elapsedMs: lfs.elapsedMs,
    lfs: true,
    objects: lfs.objects,
    retries: lfs.attempts - 1,
    wire: wireNote,
  });
  leave(
    true,
    `已派发 ${EVENT_TYPE}（${ctx.repo}:refs/heads/${ctx.ref} @ ${ctx.headSha.slice(0, 8)}）`,
  );
  return CODE.OK;
}

/**
 * `--master` 那一档的执行面（`runMasterMirror`）在 `ci-github-mirror-master.mjs`
 * （#3148：两份文件都在 §12.6 R5 的 900 行闸内）。它反过来要 import 本文件的判据与话术，
 * 静态互相 import 会成环 ⇒ 入口那段**动态**取它，这里不转出。
 */

/**
 * 退码出口：读数档与承重档之间的那**唯一一道**分界（ISSUE #3051）。
 *
 * `--readout` 只折「对外那一位数」：上面每一行照旧念自己的三态原值（`结论：exit 2 —— …`），
 * 所以「这一格没判成事」与「这一格是被折成 0 的、因为它不承重」在读数里分得开。
 * 旗标已在 #3051 期望第 3 条落地时摘除（同批把 `.cnb.yml` 主列 `GitHub 镜像同步` /
 * `GitHub 判决回读` 两格的 `--readout` 一并摘掉）：现在 `readout=false` 走真实三态退码，
 * 推不出去/派发失败即退非零、直接拦合并 —— 这正是期望第 3 条要的 fail-closed。
 *
 * @param {number} code `runMirror()` 给出的三态
 * @param {boolean} readout 读数档（push 档 / 本地自查；PR 主列那一格 2026-11-05 起不带）
 * @returns {number} 交给进程的退出码
 */
export function exitCodeFor(code, readout) {
  return readout ? CODE.OK : code;
}

/**
 * 入口**装载**那一跳的墙钟上限（文件头第 10 条，`861623ced` 的回归）。
 *
 * 只界「动态 import `ci-github-mirror-master.mjs`」这一个最无终点的等待：它是本地盘上
 * 的模块装载（正常 <1s），30s 给的是冷启动 / 杀软扫描的余量。
 * **为什么不界整层**：跑起来之后的推送 240s、LFS 首刀 240s 各自都有上限（另有两次回读各
 * 60s），合计在 `.cnb.yml` 那格 `timeout: 10m` 的外框里；再压一个更小的数会把「慢但活着」误判成
 * 悬挂，压一个更大的数又落在 10m 之外 ⇒ 形同虚设（这条上限必须是「装载」的）。
 *
 * @type {number}
 */
export const MIRROR_ENTRY_TIMEOUT_MS = 30_000;
/** @param {unknown} h 定时器句柄 @returns {h is ReturnType<typeof setTimeout>} 是否可以交给 clearTimeout（非句柄值本就是空操作） */
const isTimeoutHandle = (h) =>
  typeof h === "number" || typeof h === "string" || (typeof h === "object" && h !== null);

/**
 * 入口的注入面。全部可缺省：生产路径吃 `.cnb.yml` 那一格的实际形态，
 * 用例吃假件（假定时器 / 永不 settle 的假装载）。
 *
 * @typedef {object} MirrorEntryIo
 * @property {boolean} [awaitHosted] 等托管机实验格的前置（ISSUE #3346；主列那一格带）
 * @property {(handle: unknown) => void} [clearTimer] 清超时定时器（缺省 `clearTimeout`）
 * @property {(dir: string, opts?: object) => void} [mkdirSync] 派发回执的建目录（透传给等托管机前置）
 * @property {() => number} [now] 墙钟注入点（透传）
 * @property {string} [root] 派发回执的落点根（透传）
 * @property {typeof realRunGit} [runGit] git 执行器（透传）
 * @property {(ms: number) => Promise<void>} [sleep] 等待注入点（透传）
 * @property {boolean} [dryRun]
 * @property {Record<string, string | undefined>} [env]
 * @property {() => Promise<{runMasterMirror: MirrorRunner}>} [importMaster] 取 `--master` 档执行面（缺省动态 import）
 * @property {(line: string) => void} [log]
 * @property {boolean} [master]
 * @property {boolean} [once] 三跳各只试一次（托管机实验档，ISSUE #3346）
 * @property {boolean} [readout]
 * @property {(file: string, data: string) => void} [writeFileSync] 派发回执的写文件（透传）
 * @property {MirrorRunner} [runPr] PR 档执行面（缺省 {@link runMirror}）
 * @property {(cb: () => void, ms: number) => unknown} [setTimer] 超时定时器（缺省 `setTimeout`）
 */

/**
 * 执行面（`runMirror` / `runMasterMirror`）的统一形状。
 *
 * @typedef {(io: {dryRun: boolean, env: Record<string, string | undefined>, log: (line: string) => void, readout: boolean}) => Promise<number>} MirrorRunner
 */

/**
 * 入口：跑完 PR 档或 `--master` 档，并保证**每一次等待都有终点**（文件头第 10 条）。
 *
 * 1. **不再是顶层 await**：求值同步收尾 ⇒ `ci-github-mirror-master.mjs` 里那句静态
 *    import 本文件不再与本文件的动态 import 互等（那一形是 ESM 循环顶层 await 死锁，
 *    Promise 永不 settle，Node 只在事件循环空转后报 `Detected unsettled top-level await`
 *    并退 13 —— 红在日志里一个字都对不上）。
 * 2. **装载那一跳显式到期**：到点退 `2` 并明念「在等什么 / 等了多久 / 最后读数」。
 *    悬挂不属于三态任何一形，所以这一档**不经 `exitCodeFor` 折零** ——
 *    `--readout` 的折零以「已经拿到读数」为前提；一个字都没有的等待不是读数。
 *
 * @param {MirrorEntryIo} [io] 注入面（用例用；生产走缺省）
 * @returns {Promise<number>} 交给进程的退出码
 */
export async function runMirrorEntry(io = {}) {
  const { awaitHosted = false, dryRun = false, master = false, once = false, readout = false } = io;
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const setTimer = io.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    io.clearTimer ??
    ((handle) => {
      if (isTimeoutHandle(handle)) clearTimeout(handle);
    });
  /* `--master` 那一档的执行面在另一份文件（#3148 为回到 900 行闸切出去的）。动态取它：
   * 那一份反过来要 import 本文件的判据与话术，静态互相 import 会成环。 */
  /** @type {() => Promise<{runMasterMirror: MirrorRunner}>} */
  const importMaster = io.importMaster ?? (() => import("./ci-github-mirror-master.mjs"));
  const runPr = io.runPr ?? runMirror;
  const prefix = master ? "mirror-master" : "mirror";
  /* 「最后读数」：超时那一刻手里只有日志末行 —— 它是唯一能指认卡在哪一跳的自证。 */
  let lastLine = "";
  /** @param {string} line */
  const track = (line) => {
    lastLine = line;
    log(line);
  };
  const runIo = { dryRun, env, log: track, once, readout };
  /** @type {unknown} 定时器句柄（`setTimeout` 的返回形态由注入面决定） */
  let timer = null;
  /** @type {number} */
  let code = CODE.NO_FACT;
  try {
    /* 托管机实验格的等待前置（ISSUE #3346）：refs 回读见本跑 HEAD ⇒ 托管机已推送并派发，
     * 本格只落回执、跳过推送（「成功了就不在自托管跑」）；到点没见 ⇒ 落回原有推送（兜底）。
     * 动态 import 与 --master 同一纪律：那一份静态 import 本文件的判据与帮助件。 */
    if (awaitHosted && !master && !dryRun) {
      const hosted = await import("./ci-mirror-hosted-await.mjs");
      if ((await hosted.maybeSkipViaHosted(runIo, io)).skipped) {
        return exitCodeFor(CODE.OK, readout);
      }
    }
    if (master) {
      /** @type {Promise<{kind: "timeout"}>} */
      const deadline = new Promise((resolve) => {
        timer = setTimer(() => {
          resolve({ kind: "timeout" });
        }, MIRROR_ENTRY_TIMEOUT_MS);
      });
      /* 装载完成前不落任何读数：这一支正常情况下一条日志都不打。 */
      const loaded = await Promise.race([importMaster().then((mod) => ({ mod })), deadline]);
      clearTimer(timer);
      timer = null;
      if (!("mod" in loaded)) {
        log(`[${prefix}] 结论：exit 2 —— 等待超时：装载 --master 的执行面（没拿到三态任何一形）`);
        log(`[${prefix}]   在等什么：动态 import ./ci-github-mirror-master.mjs`);
        log(
          `[${prefix}]   等了多久：${Math.round(MIRROR_ENTRY_TIMEOUT_MS / 1000)}s（到点；上限 MIRROR_ENTRY_TIMEOUT_MS，外框 10m 之内）`,
        );
        log(
          `[${prefix}]   最后读数：${lastLine === "" ? "（还没打出任何读数：卡在模块装载）" : lastLine}`,
        );
        log(
          `[${prefix}]   为什么退非零：等待没有终点不属于三态任何一形；--readout 折零以「已拿到读数」为前提`,
        );
        return CODE.NO_FACT;
      }
      code = await loaded.mod.runMasterMirror(runIo);
    } else {
      code = await runPr(runIo);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`[${prefix}] 结论：exit 2 —— 入口抛错（${detail}）`);
    log(
      `[${prefix}]   在等什么：${master ? "动态 import ./ci-github-mirror-master.mjs 与 runMasterMirror" : "runMirror"}`,
    );
    log(`[${prefix}]   最后读数：${lastLine === "" ? "（还没打出任何读数）" : lastLine}`);
    log(`[${prefix}]   为什么退非零：抛错不属于三态任何一形，进程故障不冒充这一格的判决`);
    return CODE.NO_FACT;
  } finally {
    if (timer !== null) {
      clearTimer(timer);
    }
  }
  /* 正常收工才折读数档（ISSUE #3051 / #3106）。 */
  return exitCodeFor(code, readout);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dryRun = process.argv.includes("--dry-run");
  const readout = process.argv.includes("--readout");
  const master = process.argv.includes("--master");
  const once = process.argv.includes("--once");
  const awaitHosted = process.argv.includes("--await-hosted");
  /* 入口**不再**是顶层 await（文件头第 10 条）：求值同步收尾，跨文件那个环自然解开；
   * 等待的终点交给 `runMirrorEntry` 的显式超时，而不是 Node 的 exit 13 兜底。 */
  runMirrorEntry({ awaitHosted, dryRun, env: process.env, master, once, readout }).then((code) => {
    process.exit(code);
  });
}
