/**
 * `ci-mirror-hosted-await.mjs` —— 自托管主列「GitHub 镜像同步」的**等托管机**前置
 * （ISSUE #3346，托管机镜像实验的第二半）。
 *
 * ## 它回答的那一格
 *
 * 平台池上另有一条影子流水线（`.cnb.yml` 的「GitHub 镜像同步（托管机实验）」）在同一个
 * PR 事件上跑 `--once --readout`：三跳各只试一次、不重试、退码恒 0。本模块让自托管主列
 * 那一格在推送**之前**先问一句：「托管机那条已经把本跑 HEAD 推上去了吗？」——
 *
 * - **见 HEAD** ⇒ 托管机已推送并派发，本格落一份派发回执（`mirror-dispatch.json`，
 *   主列末尾的「GitHub 判决回读」读的就是它）后**跳过推送** —— 「成功了就不在自托管跑」；
 * - **预算到点仍没见** ⇒ 落回原有重试推送（兜底语义一个字不改，PR 可靠性不回退）。
 *
 * 为什么用「回读镜像 ref」当信号，而不去问 CNB 侧的构建状态：ref 回读走的是**同一条**
 * 认证路径与同一枚令牌（`buildPushUrl()`，PR 流水线已 import 的那枚镜像令牌），不需要
 * 额外的 CNB API 权限面；而「ref 上是不是本跑 HEAD」本身就是这件事的**事实**，比任何
 * 第二手状态都少一层转述。
 *
 * ## 边界
 *
 * 1. **本模块不判红**：两种出路（跳过 / 兜底）都是合法出路，退出码由后面的推送流程决定
 *    —— 这一层要是会红，「实验失败」就会拦合并，那不是它的职责。
 * 2. **前提取不到不在这一层交账**：令牌 / IID / HEAD 取不到时落回 `runMirror()`，由它按
 *    既定话术打「没跑起来」的三态与回执 —— 这里抢着报会把同一件事说两遍、还少一套读数。
 * 3. **ref 在但不是本跑 HEAD**（同 PR 上一跑留下的旧值）不算命中：等；到点后兜底推送
 *    用 `--force` 覆盖它（ref 按 IID 专属，覆盖自己的旧值正是幂等语义）。
 * 4. **双派发竞态窗是已知代价**：兜底推送进行中托管机恰好落地 ⇒ GitHub 收到两条同 sha 的
 *    `repository_dispatch` ⇒ 两条同树同判的 run。判决链按 sha 取读数，结论不受影响；
 *    窗口只有「最后一次回读」与「兜底推送完成」之间的那几秒。
 *
 * @module scripts/ci-mirror-hosted-await — 等托管机实验格的 refs 回读与跳过判定
 */

import { mkdirSync as realMkdirSync, writeFileSync as realWriteFileSync } from "node:fs";

import { writeDispatchState } from "./ci-mirror-failure-report.mjs";
import path from "node:path";
import {
  HOSTED_AWAIT_BUDGET_MS,
  HOSTED_AWAIT_POLL_INTERVAL_MS,
  REMOTE_READ_TIMEOUT_MS,
} from "./ci-mirror-retry-policy.mjs";
import {
  buildPushUrl,
  realRunGit,
  realSleep,
  resolveContext,
  sanitize,
} from "./ci-github-mirror-push.mjs";

/** 派发回执的落点根：与 `runMirror` 的 `ROOT` 同一出处（scripts/ 的上一级）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 在托管机实验格的预算内等它的推送结果；见到本跑 HEAD 就让调用方跳过推送。
 *
 * @param {{env: Record<string, string | undefined>, log: (line: string) => void}} io
 *   `env` 是进程环境（令牌 / IID 从这里来），`log` 与主流程同一通道（读数才会在同一份日志里）。
 * @param {{mkdirSync?: (dir: string, opts?: object) => void, now?: () => number, root?: string,
 *           runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>,
 *           writeFileSync?: (file: string, data: string) => void}} [extras]
 *   注入面（测试用假件；生产走缺省真身）。`root` 是派发回执的落点根（`runMirror` 同款）。
 * @returns {Promise<{skipped: boolean, why: string}>}
 *   `skipped: true` = 托管机已推送并派发，调用方应跳过推送（回执已由本模块落盘）；
 *   `skipped: false` = 落回原有推送（`why` 交代为什么没等到）。
 */
export async function maybeSkipViaHosted(io, extras = {}) {
  const { env, log } = io;
  const {
    mkdirSync = realMkdirSync,
    now = Date.now,
    root = ROOT,
    runGit = realRunGit,
    sleep = realSleep,
    writeFileSync = realWriteFileSync,
  } = extras;
  const ctx = resolveContext({ env, runGit });
  if (!ctx.ok) {
    return {
      skipped: false,
      why: "前提没配齐（令牌 / IID / HEAD）—— 落回 runMirror 按既定话术交账",
    };
  }
  const url = buildPushUrl(
    ctx.repo,
    ctx.token,
    String(env.GITHUB_MIRROR_USER ?? "").trim() || "oauth2",
  );
  const refFull = `refs/heads/${ctx.ref}`;
  log(
    `[mirror] 等托管机实验格：回读 ${ctx.repo}:${refFull}` +
      `（预算 ${String(Math.round(HOSTED_AWAIT_BUDGET_MS / 1000))}s、每 ${String(
        Math.round(HOSTED_AWAIT_POLL_INTERVAL_MS / 1000),
      )}s 一读；见到本跑 HEAD 就跳过推送 —— ISSUE #3346）`,
  );
  const start = now();
  let reads = 0;
  /** @type {string} */
  let lastNote;
  for (;;) {
    reads += 1;
    const read = runGit(["ls-remote", url, refFull], { timeout: REMOTE_READ_TIMEOUT_MS });
    if (read.code === 0) {
      const text = sanitize(`${read.stdout}\n${read.stderr}`, ctx.token);
      const hit = text.split("\n").some((line) => line.startsWith(`${ctx.headSha}\t${refFull}`));
      if (hit) {
        log(
          `[mirror] ✓ 等托管机：第 ${String(reads)} 读见本跑 HEAD @ ${ctx.headSha.slice(0, 8)}` +
            " ⇒ 托管机已推送并派发，本格跳过推送（回执照落，判决回读格不受影响）",
        );
        writeDispatchState(
          writeFileSync,
          root,
          {
            dispatched: true,
            reason: `已由托管机实验格推送并派发（${ctx.repo}:${refFull} @ ${ctx.headSha.slice(0, 8)}；--await-hosted 回读见 sha）`,
          },
          mkdirSync,
        );
        return { skipped: true, why: `第 ${String(reads)} 读见本跑 HEAD` };
      }
      lastNote = `ref 在但不是本跑 HEAD（旧值或还没推到）`;
    } else {
      lastNote = `这一读没通（exit ${String(read.code)}：egress 抖动 / 远端慢，预算内继续等）`;
    }
    const elapsed = now() - start;
    if (elapsed >= HOSTED_AWAIT_BUDGET_MS) {
      log(
        `[mirror] 等托管机：到点（已等 ${String(Math.round(elapsed / 1000))}s，预算 ${String(
          Math.round(HOSTED_AWAIT_BUDGET_MS / 1000),
        )}s，共读 ${String(reads)} 次）仍没见本跑 HEAD —— ${lastNote}` +
          " ⇒ 落回原有重试推送（兜底）",
      );
      return { skipped: false, why: `到点没见 HEAD（${lastNote}）` };
    }
    log(
      `[mirror] 等托管机：第 ${String(reads)} 读没见 HEAD（${lastNote}；已等 ${String(
        Math.round(elapsed / 1000),
      )}s）⇒ ${String(Math.round(HOSTED_AWAIT_POLL_INTERVAL_MS / 1000))}s 后再读`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待（命令行/进程编排），并行没有意义
    await sleep(HOSTED_AWAIT_POLL_INTERVAL_MS);
  }
}
