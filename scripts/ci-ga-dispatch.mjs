#!/usr/bin/env node
/**
 * `ci-ga-dispatch.mjs` —— CNB 触发口把对应档**派发到 GA** 的那一跳（ISSUE #3504）。
 *
 * ## 它替掉的是哪一段
 *
 * #3504 之前，CNB 的手动 / API 触发口（`web_trigger_*` / `api_trigger_*`）在
 * 自托管 Windows 节点上**本地执行**同一份重清单（`*daily_gates` / `*oneshot_*` /
 * `*package_gates`）—— 而同样的构建内容 GA 侧早就有人在跑（`daily.yml` /
 * `package-desktop.yml` 的 schedule）。#3504 起这些清单整体退役：CNB 只作
 * **触发入口**，本脚本把按下那一刻的 master HEAD 派发到 GA 的对应 workflow，
 * 实际构建全部由 GA runner 执行。
 *
 * ## 它跑在哪
 *
 * 跑在 **CNB 平台池**（Linux 容器，与镜像出口同形态）：本脚本要出站
 * `api.github.com`，而自托管节点到 github.com:443 的出网间歇不通 ——
 * 镜像推送与派发早在 #3418 就为此整条迁到平台池（腾讯云侧另一条出网路径），
 * 本脚本沿用同一判断。所以 stage 不带 PowerShell 前缀、不包 `ci-cp936-exit`
 * （那是中文 Windows 自托管那一跳的事；Linux 上直跑，#3453 的教训）。
 *
 * ## 两跳，都要 fail-closed
 *
 * 1. **等 sha 在镜像仓可见**：触发口取的是按下那一刻的 CNB master HEAD
 *    （`CNB_COMMIT`），而 GA 的 workflow 跑在**镜像仓**上 —— master 是由 push
 *    事件的「GitHub master 镜像（平台池）」流水线跟住的。刚合完就按按钮时，
 *    镜像那一跳可能还没跑完；直接派发一个 GA 检出不到的 sha，红会长在 GA 侧、
 *    CNB 这条触发口看着是绿的。所以先轮询 `GET /repos/{repo}/commits/{sha}`
 *    直到 200（预算内没出现 ⇒ 退 1，话术指到 push 镜像流水线 —— 那是三态里
 *    最可能的病灶）。
 * 2. **派发**：`POST /repos/{repo}/actions/workflows/{workflow}/dispatches`，
 *    `ref=master` + `inputs.head_sha=<sha>`（GA 侧 workflow 的 checkout 用
 *    `inputs.head_sha || github.sha`，两者任一都能落到这一笔）。204 ⇒ 送达；
 *    其余 ⇒ 退 1 并原样打印平台回话（令牌值不落日志，硬规则 17）。
 *
 * ## 退出码（三态，与仓内 ci-github-*.mjs 同口径）
 *
 *   · `0` —— 派发送达（或 `--dry-run` 走完计划）；GA 侧跑红跑绿**不归本脚本判**。
 *   · `1` —— 红：sha 预算内没出现在镜像仓 / 派发被拒 / 网络层没跑起来。
 *   · `2` —— 没判：前提不全（令牌 / preset / sha 缺席或 preset 不在注册表）。
 *     「没判过 ≠ 判过」—— CI 侧三档都非零，红得一样，差别只在话术指路。
 *
 * ## 路由表（单一出处）
 *
 * `--preset` → workflow 文件的对应关系在 `scripts/ci-ga-trigger-map.mjs`；
 * `.cnb.yml` 的派发 stage 只写 `--preset <名>`，不写文件名 —— 判据
 * （`tests/ci-ga-trigger-map.test.ts`）双向核对「触发口的 preset」与
 * 「注册表的 workflow 真的存在、带 `workflow_dispatch`」。
 *
 * 用法（`.cnb.yml` 的派发 stage）：
 *
 * ```text
 * node scripts/ci-ga-dispatch.mjs --preset daily            # 每日档
 * node scripts/ci-ga-dispatch.mjs --preset build            # 单跑生产构建
 * node scripts/ci-ga-dispatch.mjs --preset e2e              # 单跑全量E2E
 * node scripts/ci-ga-dispatch.mjs --preset unit             # 单跑全量单测
 * node scripts/ci-ga-dispatch.mjs --preset package          # 桌面成品包
 * node scripts/ci-ga-dispatch.mjs --preset daily --dry-run  # 本地自查：只打计划
 * ```
 *
 * 环境变量：`GITHUB_MIRROR_TOKEN`（必填；与镜像出口同一枚 —— 它已经能推 refs 与
 * 发 `repository_dispatch`，`workflow_dispatch` 需要的 `actions: write` 在同一授权面上）、
 * `GITHUB_MIRROR_REPO`（缺省 `wuxianyuedu/comfy-app`，同镜像脚本）、`CNB_COMMIT`
 * （触发口按下那一刻的 master HEAD；`--sha` 可覆盖）。
 */
import path from "node:path";
import process from "node:process";

import { findTriggerTarget } from "./ci-ga-trigger-map.mjs";

/** 三态退码（与 ci-github-mirror-push / ci-ga-verdict-callback 同一套字面值）。 */
export const CODE = Object.freeze({ OK: 0, FAIL: 1, NO_FACT: 2 });

/** 镜像仓库缺省坐标（`GITHUB_MIRROR_REPO` 可覆盖；与 ci-github-mirror-push 同一字面值）。 */
export const DEFAULT_MIRROR_REPO = "wuxianyuedu/comfy-app";

/** sha 可见性轮询的缺省预算与间隔（覆盖最坏的镜像推送墙钟：预算 10m 的镜像格）。 */
export const DEFAULT_WAIT_BUDGET_SECONDS = 360;
export const DEFAULT_POLL_INTERVAL_SECONDS = 15;

const API_BASE = "https://api.github.com";
const USER_AGENT = "comfy-app-cnb-ga-dispatch";

/**
 * @typedef {{
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   log?: (...args: unknown[]) => void,
 * }} DispatchIo
 */

/**
 * 解析命令行。独立成纯函数：测试直接喂 argv 数组，不走 process.argv。
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env] 环境变量（缺省 process.env；显式声明
 *   成宽松 Record，让 main 注入的 env 与 CLI 默认值同一类型，不把 ProcessEnv 的
 *   必填 NODE_ENV 带进这一格的签名）
 * @returns {{preset: string, sha: string, ref: string, repo: string, waitBudgetSeconds: number, pollIntervalSeconds: number, dryRun: boolean}}
 */
export function parseArgs(argv, env = process.env) {
  /** @type {Record<string, string | boolean>} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`不认识的参数：${String(arg)}（本脚本只收 --键 值 形态）`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺值`);
    }
    parsed[key] = value;
    i += 1;
  }
  const preset = String(parsed.preset ?? "").trim();
  if (!preset) {
    throw new Error(
      "缺 --preset（daily / build / e2e / unit / package，见 ci-ga-trigger-map.mjs）",
    );
  }
  const budget = Number(parsed.waitBudgetSeconds ?? DEFAULT_WAIT_BUDGET_SECONDS);
  const interval = Number(parsed.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`--waitBudgetSeconds 不是正数：${String(parsed.waitBudgetSeconds)}`);
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`--pollIntervalSeconds 不是正数：${String(parsed.pollIntervalSeconds)}`);
  }
  return {
    preset,
    sha: String(parsed.sha ?? env.CNB_COMMIT ?? "").trim(),
    ref: String(parsed.ref ?? "master").trim(),
    repo: String(parsed.repo ?? env.GITHUB_MIRROR_REPO ?? DEFAULT_MIRROR_REPO).trim(),
    waitBudgetSeconds: budget,
    pollIntervalSeconds: interval,
    dryRun: parsed.dryRun === true,
  };
}

/**
 * 轮询镜像仓直到该 sha 可见（`GET /repos/{repo}/commits/{sha}` 返 200 即对象在仓里）。
 * 预算耗尽返回 null —— 调用方据此退 1，**不派发一个注定检不出的 sha**。
 *
 * @param {object} deps
 * @param {string} deps.repo 镜像仓坐标（`owner/name`）
 * @param {string} deps.sha 要等可见的那一笔
 * @param {string} deps.token GitHub 令牌
 * @param {number} deps.budgetSeconds 轮询预算（秒）
 * @param {number} deps.intervalSeconds 轮询间隔（秒）
 * @param {DispatchIo} deps.io 注入面（fetch / sleep / now / log）
 * @returns {Promise<number | null>} 花掉的秒数；null = 预算内没出现
 */
export async function awaitShaVisible({ repo, sha, token, budgetSeconds, intervalSeconds, io }) {
  const fetchImpl = io.fetchImpl ?? fetch;
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = io.now ?? (() => Date.now());
  const log = io.log ?? console.log;
  const url = `${API_BASE}/repos/${repo}/commits/${encodeURIComponent(sha)}`;
  const deadline = now() + budgetSeconds * 1000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let status = 0;
    try {
      // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
      const res = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method: "GET",
      });
      status = res.status;
      if (status === 200) {
        return attempt;
      }
    } catch (error) {
      log(`[ga-dispatch] 第 ${attempt} 次探 sha 没跑起来（网络层）：${String(error)}`);
    }
    if (now() >= deadline) {
      log(
        `[ga-dispatch] 预算 ${budgetSeconds}s 内探了 ${attempt} 次，sha 一直不可见（最后一次 HTTP ${status}）`,
      );
      return null;
    }
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
    await sleep(intervalSeconds * 1000);
  }
}

/**
 * 派发请求体与 URL 的纯构造（`--dry-run` 与真实发送共用，保证打出来的就是发出去的）。
 * 刻意**不含** Authorization 头：令牌只在 `sendDispatch` 那一跳接上 —— dry-run 打印
 * 计划时，请求对象里从头就不存在令牌，而不是「打了再摘」（硬规则 17 的那类事故）。
 *
 * @param {object} deps
 * @param {string} deps.repo 镜像仓坐标（`owner/name`）
 * @param {string} deps.workflow 注册表里的 workflow 文件名
 * @param {string} deps.ref 派发的 ref（缺省 master）
 * @param {string} deps.sha 派发目标那一笔（进 `inputs.head_sha`）
 * @param {Record<string, string>} [deps.extraInputs] 额外 inputs（ISSUE #3667 按需档用；
 *   缺省不带 ⇒ 现有五个 preset 的请求体逐字不变，不引入第二套判定）
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body: string}}}
 */
export function dispatchRequest({ repo, workflow, ref, sha, extraInputs = {} }) {
  return {
    url: `${API_BASE}/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: { head_sha: sha, ...extraInputs } }),
    },
  };
}

/**
 * 真实派发。返回平台回话状态码；204 = 送达。
 *
 * @param {object} deps
 * @param {{url: string, init: {method: string, headers: Record<string, string>, body: string}}} deps.request `dispatchRequest` 的产物
 * @param {string} deps.token GitHub 令牌（只在这一跳接上）
 * @param {DispatchIo} deps.io 注入面（fetch / log）
 * @returns {Promise<{status: number, body: string}>}
 */
export async function sendDispatch({ request, token, io }) {
  const fetchImpl = io.fetchImpl ?? fetch;
  const init = {
    ...request.init,
    headers: { ...request.init.headers, Authorization: `Bearer ${token}` },
  };
  try {
    const res = await fetchImpl(request.url, init);
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch (error) {
    io.log?.(`[ga-dispatch] 派发请求在网络层没跑起来：${String(error)}`);
    return { status: 0, body: String(error) };
  }
}

/**
 * 主入口。返回三态退码；独立导出供测试整链注入（fetch / sleep / now 全可换）。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>} & DispatchIo} [options]
 * @returns {Promise<number>}
 */
export async function main(options = {}) {
  const { argv = process.argv.slice(2), env = process.env, ...io } = options;
  const log = io.log ?? console.log;
  let args;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    log(`[ga-dispatch] 没判过：${String(error instanceof Error ? error.message : error)}`);
    return CODE.NO_FACT;
  }
  const target = findTriggerTarget(args.preset);
  if (!target) {
    log(`[ga-dispatch] 没判过：--preset ${args.preset} 不在注册表（ci-ga-trigger-map.mjs）`);
    return CODE.NO_FACT;
  }
  const token = String(env.GITHUB_MIRROR_TOKEN ?? "").trim();
  if (!token) {
    log("[ga-dispatch] 没判过：`GITHUB_MIRROR_TOKEN` 缺席（imports envs.yml 那一格没接上？）");
    return CODE.NO_FACT;
  }
  if (!args.sha) {
    log(
      "[ga-dispatch] 没判过：sha 缺席（CNB_COMMIT 没值，也没给 --sha）—— " +
        "触发口按下那一刻的 master HEAD 是派发目标，没有它这一跳没有对象",
    );
    return CODE.NO_FACT;
  }
  log(
    `[ga-dispatch] preset=${args.preset} → ${args.repo} / .github/workflows/${target.workflow} · ` +
      `ref=${args.ref} · sha=${args.sha.slice(0, 8)} · 等可见预算 ${args.waitBudgetSeconds}s`,
  );
  if (args.dryRun) {
    const request = dispatchRequest({
      repo: args.repo,
      workflow: target.workflow,
      ref: args.ref,
      sha: args.sha,
    });
    log(`[ga-dispatch] DRY-RUN：等 sha 可见后 POST ${request.url}`);
    log(`[ga-dispatch] DRY-RUN：body=${request.init.body}`);
    log("[ga-dispatch] DRY-RUN：不发任何请求");
    return CODE.OK;
  }
  const seenAt = await awaitShaVisible({
    repo: args.repo,
    sha: args.sha,
    token,
    budgetSeconds: args.waitBudgetSeconds,
    intervalSeconds: args.pollIntervalSeconds,
    io,
  });
  if (seenAt === null) {
    log(
      "[ga-dispatch] 结论：exit 1 —— sha 在镜像仓不可见 ⇒ 派发没发生。" +
        "最可能的病灶是「GitHub master 镜像（平台池）」那条流水线没跟住这次 push；先看它红没红。",
    );
    return CODE.FAIL;
  }
  log(`[ga-dispatch] sha 在镜像仓可见（第 ${seenAt} 次探到）⇒ 派发`);
  const request = dispatchRequest({
    repo: args.repo,
    workflow: target.workflow,
    ref: args.ref,
    sha: args.sha,
  });
  const { status, body } = await sendDispatch({ request, token, io });
  if (status !== 204) {
    log(`[ga-dispatch] 派发被拒：HTTP ${status}（payload 与令牌都在，拒的是请求本身）`);
    if (body.trim()) {
      log(`[ga-dispatch]   ${body.replaceAll(token, "***")}`);
    }
    log(
      "[ga-dispatch] 结论：exit 1 —— 派发没送达。" +
        "404/422 先核对 workflow 文件在镜像仓 master 上是否存在；401/403 是令牌缺 `actions: write`。",
    );
    return CODE.FAIL;
  }
  log(
    `[ga-dispatch] 派发送达：${target.workflow} @ ${args.sha.slice(0, 8)}（GA run 页面见 ` +
      `https://github.com/${args.repo}/actions/workflows/${target.workflow}）。` +
      "GA 侧跑红跑绿不归本脚本判；构建执行者自 #3504 起全部在 GA。",
  );
  return CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main({ argv: process.argv.slice(2) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-dispatch] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
