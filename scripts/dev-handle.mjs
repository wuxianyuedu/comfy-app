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
  /* 链接 worktree 的回落档（ISSUE #2833）：worktree 天然没有 `.gitignore` 掉的 `.env`，
   * 人配留痕的那份在主检出根下 —— 读到它仍然算「人填的」（同一个键、同一支笔），
   * 但 source 要把来路说出来，读日志的人才知道这份检出的 `.env` 其实不在自己根下。 */
  dotenvMain: ".env（主检出）",
  explicit: new Set(["进程环境", ".env", ".env（主检出）"]),
});

/**
 * 读某个根下 `.env` 里的一个键；文件不在 / 键为空 ⇒ `null`。
 *
 * `resolveDevHandle` 与 `explicitDevHandle` 共用这一份 —— 两处各写一遍 `readFileSync`
 * 的话，worktree 回落那一刀（#2833）加在哪一边、另一边就会静默漂掉。
 *
 * @param {string} root 仓库根
 * @param {string} key 要读的键名
 * @returns {string | null}
 */
function dotenvValueAt(root, key) {
  try {
    const v = String(
      readEnvFileValue(fs.readFileSync(path.join(root, ".env"), "utf8"), key) ?? "",
    ).trim();
    return v === "" ? null : v;
  } catch {
    // 没有 `.env`（CI / 干净检出 / 链接 worktree）是常态 ⇒ 不是「读不出来」，是这一档没有值。
    return null;
  }
}

/**
 * 本检出若是**链接 worktree**，回主检出的根；否则回 `null`。
 *
 * 判据是**两次 rev-parse 的差**：`--git-dir`（本检出自己的 git 目录）与
 * `--git-common-dir`（共享的那份）在主检出里相等，在链接 worktree 里前者指向
 * 主检出的 worktrees/<名> 子目录 —— 不等 ⇒ 是链接 worktree，主检出根 =
 * commondir 的父目录。**不**拿根路径去硬拼 git 目录名：worktree / CI 缓存
 * 检出里那个名字对应的是一个文件而不是目录，那类拼接正是 `git-dir-literal-scan`
 * 判据存在要拦的形状（scripts/** 除 git-dir.mjs 外禁止；连注释里的形状都拦 ——
 * 实测 cnb-lpr-1k68pquq6：本文件的注释原样被它点名）。非 git 检出 spawn 非 0 ⇒
 * 同样 `null`。
 *
 * @param {string} root 本检出根
 * @returns {string | null}
 */
function mainCheckoutRoot(root) {
  try {
    const cwd = root || process.cwd();
    const rev = (args) => {
      const got = spawnSync("git", args, { cwd, encoding: "utf8" });
      return got.status === 0 ? String(got.stdout ?? "").trim() : "";
    };
    const own = rev(["rev-parse", "--git-dir"]);
    const common = rev(["rev-parse", "--git-common-dir"]);
    if (own === "" || common === "") {
      return null;
    }
    const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));
    if (path.resolve(abs(own)) === path.resolve(abs(common))) {
      return null;
    }
    return path.dirname(abs(common));
  } catch {
    return null;
  }
}

/**
 * 「这个 source 是**人填的**吗」—— 「名字稳不稳」那半问的共用谓词（ISSUE #2387）。
 *
 * 「去哪读名字」（source 分档）与「标签打不打得上」（名字在不在）是两个问题：
 * 话术里凡是要按 source 分支的，都必须经由这个谓词，不许各处手写字面量比对
 * —— `whoamiLines()` 与 `runNewIssue()` 曾各写一份 `from === "进程环境" || from === ".env"`，
 * 词表一变就是两处静默失效。
 *
 * @param {string | null | undefined} source `resolveDevHandle().source`
 * @returns {boolean}
 */
export function isExplicitSource(source) {
  return HANDLE_SOURCES.explicit.has(String(source ?? ""));
}

/**
 * 平台侧那几个候选键，按可信度排序（NPC 名先于 token 用户名：前者是**这次会话是谁**，
 * 后者只是「拿谁的 token」—— 一台机器多份检出的 token 用户名是同一个）。
 */
export const PLATFORM_HANDLE_KEYS = Object.freeze(["CNB_NPC_NAME", "CNB_TOKEN_USER_NAME"]);

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
      readEnvFileValue(fs.readFileSync(path.join(root, ".env"), "utf8"), DEV_HANDLE_ENV_KEY) ?? "",
    ).trim();
    if (fromFile !== "") {
      return { name: fromFile, source: HANDLE_SOURCES.dotenv, explicit: true };
    }
  } catch {
    // 没有 `.env`（CI / 干净检出）是常态 ⇒ 不是「读不出来」，是这一档没有值。
  }
  /* 链接 worktree 的回落（ISSUE #2833）：worktree 天然没有 `.gitignore` 掉的 `.env`，
   * 而留痕是人配在**主检出**根下的 —— 不接这一档，worktree 里的 ship 会把「我是谁」
   * 跌到 git config user.name 上，收尾时「处理人是不是我」就答错人（#2833 的现场：
   * 自动释放被跳过，而话术把因果说成「处理人是别人」）。 */
  const mainRoot = mainCheckoutRoot(root);
  const fromMain = mainRoot ? dotenvValueAt(mainRoot, DEV_HANDLE_ENV_KEY) : null;
  if (fromMain) {
    return { name: fromMain, source: HANDLE_SOURCES.dotenvMain, explicit: true };
  }
  for (const key of PLATFORM_HANDLE_KEYS) {
    const value = String(env[key] ?? "").trim();
    if (value !== "") {
      return { name: value, source: key, explicit: false };
    }
  }
  const name = gitName(root);
  if (name !== "") {
    return { name, source: "git config user.name", explicit: false };
  }
  return { name: SETTLED_FALLBACK, source: "兜底", explicit: false };
}

/**
 * **人真的填过没有**：只看 `COMFYAPP_DEV_HANDLE`（进程环境 → 本检出 `.env`），不回落到取值链。
 *
 * 这一格与「名字是什么」是两个问题，别合并：
 *   · `resolveDevHandle` 回答「这份检出该自称谁」—— 它保证有答案；
 *   · 这个回答「有没有人**指认过**这个名字」—— 建单回读判「标签没落地」时要用它：
 *     建单那一路对**取的**名字也按标签（名字非空就按，ISSUE #2387），只有**你填的**
 *     名字没落上才算「留痕没落地」退 2（ISSUE #2355）—— 把取的读成「你填了却没落上」
 *     是误判，会让一次正常建单退 2。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 * @returns {string | null} 填的那个名字；没填过回 `null`
 */
export function explicitDevHandle({ root, env = {} }) {
  const fromProcess = String(env[DEV_HANDLE_ENV_KEY] ?? "").trim();
  if (fromProcess !== "") {
    return fromProcess;
  }
  const fromFile = dotenvValueAt(root, DEV_HANDLE_ENV_KEY);
  if (fromFile) {
    return fromFile;
  }
  /* 与 `resolveDevHandle` 同一档回落（ISSUE #2833）：两个读「人填过没有」的口子
   * 必须看到同一个 `.env` 面，否则 worktree 里「名字从哪来」与「填过没有」会分叉。 */
  const mainRoot = mainCheckoutRoot(root);
  return mainRoot ? dotenvValueAt(mainRoot, DEV_HANDLE_ENV_KEY) : null;
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
    if (value !== "") {
      return { name: value, source: key };
    }
  }
  const name = gitName(root);
  if (name !== "") {
    return { name, source: "git config user.name" };
  }
  return { name: SETTLED_FALLBACK, source: "兜底" };
}
