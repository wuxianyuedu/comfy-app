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
 * 1. **fail-closed**：令牌 / 请求 ID / HEAD 取不到 ⇒ 退 `2`（没跑起来），不冒充成功。
 * 2. **不打令牌值**（硬规则 17）：令牌只出现在进程参数里；一切回显先过脱敏。
 * 3. **这一格是 endStage**：成败不影响流水线状态 —— 它坏了**不许**把质量门禁的红
 *    洗成绿，也不许把自己的红叠进门禁的账；可见性就是它自己的读数。
 * 4. 推送用 `--force` 不用 `--force-with-lease`：lease 需要 expected 值（要先
 *    `ls-remote` 再推，两跳网络 + 竞态窗），而 ref 按 IID 专属、由并发锁保证
 *    同一 PR 同时只有一跑在推 —— 覆盖自己的旧值正是幂等语义。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-github-mirror-push.mjs            # 推 HEAD + 派发（读环境变量）
 * node scripts/ci-github-mirror-push.mjs --dry-run  # 只打印计划与 payload，不发任何请求
 * ```
 *
 * 环境变量：`GITHUB_MIRROR_TOKEN`（必填）、`GITHUB_MIRROR_REPO`（缺省
 * `wuxianyuedu/comfy-app`）、`CNB_PULL_REQUEST_IID`、`CNB_PULL_REQUEST_TARGET_SHA`。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** 三态退码与仓内其余档同口径（`0` 有结论 / `1` 有事实是红 / `2` 没跑起来）。 */
export const CODE = { FAIL: 1, NO_FACT: 2, OK: 0 };

/** 镜像仓库缺省坐标（`GITHUB_MIRROR_REPO` 可覆盖）。 */
export const DEFAULT_REPO = "wuxianyuedu/comfy-app";

/** 派发的事件名，与 `.github/workflows/pr-gate.yml` 的 `types:` 逐字配对。 */
export const EVENT_TYPE = "cnb-pr-sync";

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
 * @param {string} repo `owner/repo`
 * @param {string} token GitHub 令牌
 * @returns {string} 带 Basic 凭据的 HTTPS URL
 */
export function buildPushUrl(repo, token) {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

/**
 * 组装派发 payload（形状与 `.github/workflows/pr-gate.yml` 的
 * `client_payload` 消费面一一对应）。
 *
 * @param {{ref: string, headSha: string, baseSha: string, prNumber: string}} args
 * @returns {{event_type: string, client_payload: Record<string, string>}}
 */
export function dispatchPayload({ baseSha, headSha, prNumber, ref }) {
  return {
    client_payload: { base_sha: baseSha, branch: ref, head_sha: headSha, pr_number: prNumber },
    event_type: EVENT_TYPE,
  };
}

/**
 * 从环境变量收口本次镜像的上下文；缺哪件就念哪件（fail-closed 的「读数」半边）。
 *
 * @param {{env: Record<string, string | undefined>, runGit: (args: string[]) => {code: number, stdout: string, stderr: string}}} io
 * @returns {{ok: true, repo: string, token: string, iid: string, ref: string, headSha: string, baseSha: string} | {ok: false, reasons: string[]}}
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
    reasons.push("`CNB_PULL_REQUEST_IID` 不是纯数字（本格只挂在 PR 流水线的 endStages 上）");
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
    headSha: headSha.stdout.trim(),
    iid,
    ok: true,
    ref: mirrorRefFor(iid),
    repo: (env.GITHUB_MIRROR_REPO ?? DEFAULT_REPO).trim(),
    token: token.trim(),
  };
}

/**
 * 真身：git 子进程执行器（测试注入点同形的假件在用例里给）。
 *
 * @param {string[]} args git 参数表
 * @returns {{code: number, stderr: string, stdout: string}}
 */
function realRunGit(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return {
    code: r.status ?? -1,
    stderr: String(r.stderr ?? ""),
    stdout: String(r.stdout ?? ""),
  };
}

/**
 * 执行镜像：推 HEAD → 派发。两跳各自独立成读数，前一跳红后一跳不发。
 *
 * @param {{env: Record<string, string | undefined>, fetchImpl?: typeof fetch, runGit?: typeof realRunGit, dryRun?: boolean, log?: (line: string) => void}} io
 * @returns {Promise<number>} 仓内三态退码
 */
export async function runMirror(io) {
  const { dryRun = false, env } = io;
  const log = io.log ?? ((line) => console.log(line));
  const fetchImpl = io.fetchImpl ?? fetch;
  const runGit = io.runGit ?? realRunGit;
  const ctx = resolveContext({ env, runGit });
  if (!ctx.ok) {
    for (const reason of ctx.reasons) {
      log(`[mirror] 没跑起来的原因：${reason}`);
    }
    log("[mirror] 结论：exit 2 —— 有一步没跑起来（不等于通过，也不等于「没有要同步的」）");
    return CODE.NO_FACT;
  }
  const url = buildPushUrl(ctx.repo, ctx.token);
  const payload = dispatchPayload({
    baseSha: ctx.baseSha,
    headSha: ctx.headSha,
    prNumber: ctx.iid,
    ref: ctx.ref,
  });
  const baseNote = ctx.baseSha
    ? ` · base ${ctx.baseSha.slice(0, 8)}`
    : " · base 缺席（payload 留空）";
  log(
    `[mirror] 计划：HEAD ${ctx.headSha.slice(0, 8)} → ${ctx.repo}:${ctx.ref} · 派发 ${EVENT_TYPE}${baseNote}`,
  );
  if (dryRun) {
    log("[mirror] DRY-RUN：没推也没派发，payload 如下 ——");
    log(JSON.stringify(payload, null, 2));
    return CODE.OK;
  }
  const push = runGit(["push", "--force", url, `HEAD:refs/heads/${ctx.ref}`]);
  if (push.code !== 0) {
    log(`[mirror] 推送失败（exit ${push.code}）：`);
    for (const line of `${push.stdout}\n${push.stderr}`.split("\n")) {
      if (line.trim()) {
        log(`[mirror]   ${sanitize(line, ctx.token)}`);
      }
    }
    return CODE.FAIL;
  }
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
    return CODE.NO_FACT;
  }
  if (res.status !== 204) {
    const body = await res.text().catch(() => "");
    log(`[mirror] 派发被拒：HTTP ${res.status}（payload 与令牌都在，拒的是请求本身）`);
    if (body.trim()) {
      log(`[mirror]   ${sanitize(body, ctx.token)}`);
    }
    return CODE.FAIL;
  }
  log(`[mirror] ✓ 已推 ${ctx.repo}:${ctx.ref} @ ${ctx.headSha.slice(0, 8)} · 已派发 ${EVENT_TYPE}`);
  return CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dryRun = process.argv.includes("--dry-run");
  process.exit(await runMirror({ dryRun, env: process.env }));
}
