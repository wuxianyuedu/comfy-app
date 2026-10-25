#!/usr/bin/env node
/**
 * `dev-handle.mjs` —— 「这份检出是谁」的**单一定义点**（ISSUE #2355）。
 *
 * 这一格过去有三个读者各自回答一遍：`ship-ticket.mjs` 的 `readDevHandle()`
 * （只读 `COMFYAPP_DEV_HANDLE`，读不到就回 `null`）、`ship-claim.mjs` 的「没配 ⇒ 退 2」、
 * `env-init.mjs` 的补齐（按 `.env.example` 的空值原样写回去）。三处口径一致时看不出问题，
 * 不一致时的形态是：`pnpm env:init` 补了一行**空值**、`ship` 念「未配」、领取直接拦下 ——
 * 照提示做过一遍，仍然没有名字。
 *
 * 取值链（第一个非空者胜出，顺序是这条读数的全部内容）：
 *
 *   ① `COMFYAPP_DEV_HANDLE`（进程环境 → 本检出 `.env`）—— 人显式填的，原值直接用；
 *   ② 平台给的运行身份：`CNB_NPC_NAME`（NPC 的名字，容器里现成）→ `CNB_TOKEN_USER_NAME`
 *      → `CNB_BUILD_USER_NICKNAME` / `CNB_BUILD_USER`；
 *   ③ 本地开发者的 `git config user.name`（只在这一台机器上取，**不是**提交身份的定义处 ——
 *      提交那一侧仍需 `docs/guides/git-identity.md` 的那套配置）；
 *   ④ 仍为空 ⇒ `SETTLED_FALLBACK`（`cnb`）。
 *
 * ②与③都是**取的**，不是填的：这决定了话术（`source` 字段）——「取自 CNB_NPC_NAME」与
 * 「你填的」是两件事，读者据此判断要不要换。**不取平台账号昵称**（`CNB_BUILD_USER` 只在
 * 机器自起的账号上使用，见 `ci-daily-failure-issue.mjs` 那一路）：把人的昵称当机器留痕是
 * 假读数，#2314 / #2310 / #2294 的 `提单人:月读` 就是这么来的。
 *
 * 一处也不碰平台、不写文件：调用方决定要不要落盘（`env-init.mjs` 落，`ship` 只念）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { readEnvFileValue } from "./app-port.mjs";

/** 提单人这一格读的键名（`.env` 与进程环境同一名）。 */
export const DEV_HANDLE_ENV_KEY = "COMFYAPP_DEV_HANDLE";

/** 谁都取不到时的兜底名 —— 不再是「未配」，而是一个明确的、可被读者理解的短名。 */
export const SETTLED_FALLBACK = "cnb";

/**
 * `dev-handle.mjs` 的 `source` 词表 —— 有两档是**人填的**（进程环境 / `.env`），其余都是「取的」。
 *
 * 这两个词是话术与判别的共用常量：`ship` 靠它决定念不念「这是自动命名的」，
 * 文档与用例也照这两串念。写成字面量散在各处时，改一处就会让另一处静默失效。
 */
export const HANDLE_SOURCES = Object.freeze({
  processEnv: "进程环境",
  dotenv: ".env",
  explicit: new Set(["进程环境", ".env"]),
});

/**
 * 平台侧那几个候选键，按可信度排序（NPC 名先于 token 用户名：前者是**这次会话是谁**，
 * 后者只是「拿谁的 token」—— 一台机器多份检出的 token 用户名是同一个）。
 */
export const PLATFORM_HANDLE_KEYS = Object.freeze([
  "CNB_NPC_NAME",
  "CNB_TOKEN_USER_NAME",
]);

/**
 * `git config user.name` —— 取不到就回空串（不是抛、不是 `undefined`）。
 *
 * 只在 ③ 那一档用：本地开发者最常见的形态是「git 里早就配了自己的名字」，
 * 让他为了留痕再抄一遍是没必要的负担。仍然**不碰** `user.email`：那是提交身份。
 *
 * @param {string} root 仓库根
 * @returns {string}
 */
function gitName(root) {
  try {
    const got = spawnSync("git", ["config", "user.name"], {
      cwd: root || process.cwd(),
      encoding: "utf8",
    });
    return got.status === 0 ? String(got.stdout ?? "").trim() : "";
  } catch {
    return "";
  }
}

/**
 * 这一份检出「是谁」—— 取值链的**唯一实现**。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 *   `root` 是这份检出的根（读它自己的 `.env`、跑它自己的 `git config`）。
 * @returns {{name: string, source: string, explicit: boolean}}
 *   `name` 永不为空（到最后就是 `SETTLED_FALLBACK`）；`explicit=true` 表示这是人填的
 *   `COMFYAPP_DEV_HANDLE`，`false` 表示是**取的**（`source` 说清取自哪里）。
 */
export function resolveDevHandle({ root, env = {} }) {
  const fromProcess = String(env[DEV_HANDLE_ENV_KEY] ?? "").trim();
  if (fromProcess !== "") {
    return {
      name: fromProcess,
      source: HANDLE_SOURCES.processEnv,
      explicit: true,
    };
  }
  try {
    const fromFile = String(
      readEnvFileValue(
        fs.readFileSync(path.join(root, ".env"), "utf8"),
        DEV_HANDLE_ENV_KEY,
      ) ?? "",
    ).trim();
    if (fromFile !== "") {
      return { name: fromFile, source: HANDLE_SOURCES.dotenv, explicit: true };
    }
  } catch {
    // 没有 `.env`（CI / 干净检出）是常态 ⇒ 不是「读不出来」，是这一档没有值。
  }
  for (const key of PLATFORM_HANDLE_KEYS) {
    const value = String(env[key] ?? "").trim();
    if (value !== "") return { name: value, source: key, explicit: false };
  }
  const name = gitName(root);
  if (name !== "") return { name, source: "git config user.name", explicit: false };
  return { name: SETTLED_FALLBACK, source: "兜底", explicit: false };
}

/**
 * **人真的填过没有**：只看 `COMFYAPP_DEV_HANDLE`（进程环境 → 本检出 `.env`），不回落到取值链。
 *
 * 这一格与「名字是什么」是两个问题，别合并：
 *   · `resolveDevHandle` 回答「这份检出该自称谁」—— 它保证有答案；
 *   · 这个回答「有没有人**指认过**这个名字」—— 建单回读判「标签没落地」时要用它：
 *     取来的名字本来就不该有 `提单人:` 标签（建单那一路不带标签），把它读成
 *     「你填了、但没落上」是一次误判，而且会让一次正常建单退 2。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 * @returns {string | null} 填的那个名字；没填过回 `null`
 */
export function explicitDevHandle({ root, env = {} }) {
  const fromProcess = String(env[DEV_HANDLE_ENV_KEY] ?? "").trim();
  if (fromProcess !== "") return fromProcess;
  try {
    const fromFile = String(
      readEnvFileValue(
        fs.readFileSync(path.join(root, ".env"), "utf8"),
        DEV_HANDLE_ENV_KEY,
      ) ?? "",
    ).trim();
    return fromFile === "" ? null : fromFile;
  } catch {
    return null;
  }
}

/**
 * `resolveDevHandle` 的短形态：只要那个名字。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 * @returns {string}
 */
export function devHandle({ root, env = {} }) {
  return resolveDevHandle({ root, env }).name;
}

/**
 * **机器自起**的账（每日 / PR 失败自动立案）用的名字：`<前缀>:<NPC 名或兜底>`。
 *
 * 为什么它不走 `resolveDevHandle`：那条链的第一顺位是「人填的」，而机器账的第一句话是
 * 「这不是谁写的，是机器写的」。更要紧的是它**必须不取平台的账号昵称** ——
 * `gitUser()` 的第一顺位是 `CNB_BUILD_USER_NICKNAME`，那是**人**的昵称，
 * 于是每日那几跑建的单被读成「月读提的」（#2314 / #2310 / #2294 的现场）。
 * 宿主给了 NPC 名字（`CNB_NPC_NAME`）就带上它，这样「哪台机器 / 哪个 NPC 建的」还分得开。
 *
 * @param {string} prefix 账的类型（`ci-daily` / `ci-pr`）
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function machineHandle(prefix, env = {}) {
  const npc = String(env.CNB_NPC_NAME ?? "").trim();
  return npc === "" ? prefix : `${prefix}:${npc}`;
}

/**
 * `pnpm env:init` 往 `.env` 里写的那个值 —— 与 `resolveDevHandle` 同一条链，
 * **只少一档**：`.env`（正要写它，读到空值没有意义）。
 *
 * 顺序与人工填的一致，所以「跑过一次 `env:init`」之后的读数与「人自己抄一遍」等价；
 * 该不该覆盖已有值由调用方判（`env-init.mjs` 只补缺，见那里的 `missingLines`）。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 * @returns {{name: string, source: string}}
 */
export function devHandleForEnvFile({ root, env = {} }) {
  const fromProcess = String(env[DEV_HANDLE_ENV_KEY] ?? "").trim();
  if (fromProcess !== "") {
    return { name: fromProcess, source: HANDLE_SOURCES.processEnv };
  }
  for (const key of PLATFORM_HANDLE_KEYS) {
    const value = String(env[key] ?? "").trim();
    if (value !== "") return { name: value, source: key };
  }
  const name = gitName(root);
  if (name !== "") return { name, source: "git config user.name" };
  return { name: SETTLED_FALLBACK, source: "兜底" };
}
