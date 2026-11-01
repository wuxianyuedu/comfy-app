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
 * 3. **这一格是 endStage**：成败不影响流水线状态 —— 它坏了**不许**把质量门禁的红
 *    洗成绿，也不许把自己的红叠进门禁的账；可见性就是它自己的读数。
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
 * `git ls-remote` 的输出里有没有**任何一条** ref —— 有 ⇒ 那枚令牌认到了目标仓库。
 *
 * 只看「有没有 refs 行」、不看 ref 名：空仓库的 `ls-remote` 回**零行且退 0**，非空仓库
 * 一定回 `HEAD` 或某条 `refs/*`。所以这一判的语义是「仓库在、且令牌读得到它」，
 * 与这个 PR 自己的 ref 存不存在无关（`--force` 推的是新 ref）。
 *
 * @param {string} stdout `git ls-remote` 的标准输出（可空串）
 * @returns {boolean} 非空 ⇒ 在
 */
export function hasRemoteRefs(stdout) {
  return stdout.split("\n").some((line) => /^[0-9a-f]{40}\s+\S+\s*$/i.test(line.trim()));
}

/**
 * 把 `git ls-remote` 的失败回话翻成**具体那一句**（回话本身不判红，它只被念出来）。
 *
 * 两形态逐字不同，读的人不必自己去猜：`Repository not found` 是**仓库层面**没通
 * （没建 / 令牌对它没有读权），其余认证回话则更可能落在令牌值上。这一函数**不改变退码** ——
 * 两种都落「前提没落地」，改的只是下一动作能不能被照着做。
 *
 * @param {string} text `ls-remote` 的 stdout + stderr（未脱敏）
 * @returns {string} 一句中文读数
 */
export function explainRemoteProbeFailure(text) {
  if (/repository not found|does not appear to be a git repository/i.test(text)) {
    return "目标仓库在 GitHub 上不存在（或以这枚令牌的身份看不见它）⇒ 先去建仓库，再重跑这一格";
  }
  if (/repository access blocked|not accessible|deploy key/i.test(text)) {
    return "这枚令牌的身份够不到目标仓库（fine-grained PAT 须把该仓库列进仓库访问范围）";
  }
  return "推送前的这一读就被拒了 ⇒ 现场拿真值在本地 `git ls-remote` 一次定值（仓库在不在 / 令牌活不活）";
}

/**
 * 执行镜像：先问「仓库在不在」→ 推 HEAD → 派发。每一跳各自独立成读数，前一跳没通后一跳不发。
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
  const url = buildPushUrl(ctx.repo, ctx.token, (env.GITHUB_MIRROR_USER ?? "").trim() || "oauth2");
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
  /* 推送前那一问：目标仓库没建时 git 的回话与「令牌坏了」逐字同形（见文件头第 5 条）。 */
  const probe = runGit(["ls-remote", url]);
  const probeText = sanitize(`${probe.stdout}\n${probe.stderr}`, ctx.token);
  /* 两种形态先分开念：读失败是「前提没落地」，零条 ref 是**空仓库**（合法，继续推）。 */
  log(
    probe.code === 0
      ? "[mirror] 推送前这一读：通（空仓库 ⇒ 零条 ref 也是通的）"
      : `[mirror] 推送前这一读没通（exit ${probe.code}）：${explainRemoteProbeFailure(probeText)}`,
  );
  if (probe.code === 0 && !hasRemoteRefs(probe.stdout)) {
    log("[mirror]   目标仓库是空的（零条 ref）—— `--force` 推一个新 ref 正是它该有的第一笔");
  }
  if (probe.code !== 0) {
    for (const line of probeText.split("\n")) {
      if (line.trim()) {
        log(`[mirror]   ${line}`);
      }
    }
    log("[mirror] 结论：exit 2 —— 目标仓库 / 令牌这一层的前提没落地（不是这一格判出的红）");
    return CODE.NO_FACT;
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
