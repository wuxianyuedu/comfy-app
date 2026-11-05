#!/usr/bin/env node
/**
 * `ci-mirror-lfs-push.mjs` —— 镜像格第二跳（LFS 对象推送）的参数表与执行（#3106 / #3146）。
 *
 * ## 为什么它单独成模块
 *
 * 这一族随 `ci-github-mirror-push.mjs` 一起长，而那个文件已经贴着 900 行硬闸（§12.6 R5）：
 * 回退路径（`--object-id`）加进来之后就顶穿了。切法与 `ci-mirror-failure-report.mjs`
 * 同一纪律 —— **按职责拆出去，主文件再转出**，导入面一行不用改。
 *
 * ## 它守的那两件事
 *
 * 1. **不带本仓钩子**（`-c core.hooksPath=`）：这一跳在别人的仓库上写对象，本仓
 *    `.githooks/pre-push` 对它没有管辖权。`-c` 只作用于这一次调用，不落盘。
 * 2. **不带 `--all`**：`git lfs push <url> HEAD` 的语义是「HEAD 可达且远端还没有的对象」,
 *    增量由 git-lfs 按 LFS API 自己对账，存量历史不重复计带宽。
 *
 * ## 回退（ISSUE #3146）
 *
 * `git lfs push <url> HEAD` 有两处依赖「本地 ref 可枚举」：按 ref 对账该推哪些对象、
 * 以及参数 `HEAD` 本身要能解析。平台合成的合并提交 / 工作区形态下这两件都可能不成立
 * （现场 `Error getting local refs.`）。那一形的真出口是 `--object-id`：清单由
 * `git lfs ls-files --long` 按 **index** 取（实测删光 `refs/**` 之后照样给得出 OID），
 * 不经任何 ref 解析。
 *
 * 所以 `LOCAL_REFS` 这一形**自动回退**：回退通了就是通（原路径的 ref 枚举失败不构成
 * 结论）；回退也失败才 FAIL。清单为空（本地压根没有 LFS 对象）⇒ 回退没有对象，按原失败
 * 交账。认证 / 配额 / egress 那几类**不回退** —— `--object-id` 救不了它们。
 *
 * ## 重试窗口（2026-11-05 第二批）
 *
 * 这一跳原先是「至多 2 次 + 5s 退避」，与内容推送那次改动前同一个毛病：瞬时
 * `Connection was reset` 一次 0.3s ⇒ **6s 就交账**。现在整档（主路径 + 可能的回退）
 * 共用 `LFS_PUSH_RETRY_BUDGET_MS` = 60s、至多 5 次；常量与取法在
 * `ci-mirror-retry-policy.mjs`。**两跳共用一个窗口**，不各领一份叠成 120s。
 */
import { classifyLfsPushFailure, parseLfsObjectCount } from "./ci-mirror-failure-report.mjs";
import { LFS_PUSH_MAX_ATTEMPTS, LFS_PUSH_RETRY_BUDGET_MS } from "./ci-mirror-retry-policy.mjs";

/** 三态退码（与仓内其余档同口径）。 */
const CODE = { FAIL: 1, OK: 0 };

/**
 * 第二跳（LFS 对象推送）的完整参数表（文件头第 9 条）。
 *
 * 与 {@link pushArgs} 同一纪律：`-c core.hooksPath=` 不带本仓钩子（pre-push 那一条
 * 对「在镜像仓写对象」没有管辖权）。**不带 `--all`**：`git lfs push <url> HEAD` 的语义
 * 是「HEAD 可达且远端还没有的对象」—— 增量由 git-lfs 自己按 LFS API 对账，存量历史
 * 不重复计带宽。`HEAD` 本地可解析（PR 事件上是平台合成的 merge 提交，工作区跑的就是它）。
 *
 * @param {string} url 带凭据的推送 URL（与内容推送同一条认证路径）
 * @returns {string[]} git 参数表
 */
export function lfsPushArgs(url) {
  return ["-c", "core.hooksPath=", "lfs", "push", url, "HEAD"];
}

/**
 * 第二跳的**回退**参数表：按对象 OID 清单推（文件头第 9 条之二）。
 *
 * 为什么需要这条：`git lfs push <url> HEAD` 有两处依赖「本地 ref 可枚举」——
 * ① 它默认按 ref 对账「哪些对象该推」；② 参数 `HEAD` 本身要能解析。平台合成的合并提交
 * 形态下这两件都可能不成立（现场 `Error getting local refs.`），而 `--object-id` 走的是
 * 显式清单：清单由 `git lfs ls-files --long` 按 **index** 取（实测：删光 `refs/**` 之后
 * 它照样给出 OID），不经过任何 ref 解析。所以这条回退是「ref 枚举不到」那一形的真出口，
 * 不是话术里的占位。
 *
 * 清单为空 ⇒ 返回 `null`：那时没有可推的对象，回退本身没有对象，交账仍按原失败。
 *
 * @param {string} url 带凭据的推送 URL（与内容推送同一条认证路径）
 * @param {string[]} oids 对象 OID 清单（非空）
 * @returns {string[] | null} git 参数表；清单为空时为 `null`
 */
export function lfsObjectIdPushArgs(url, oids) {
  if (oids.length === 0) {
    return null;
  }
  return ["-c", "core.hooksPath=", "lfs", "push", "--object-id", url, ...oids];
}

/**
 * 从 `git lfs ls-files --long` 的输出里取对象 OID 清单（文件头第 9 条之二）。
 *
 * 行形态是 `<64 位 hex> <状态符> <路径>`（实测），只认第一列的 64 位十六进制 ——
 * 路径里的空格 / 中文都不影响。重复 OID 去重、保持出现顺序：同一份对象在多个路径下
 * 只该推一次。
 *
 * @param {string} text `git lfs ls-files --long` 的标准输出
 * @returns {string[]} 去重后的 OID 清单（读不到时为空数组）
 */
export function parseLfsObjectIds(text) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 入参 text 是 git push 的原始输出（外部数据），运行期可为 undefined；规则按非空 string 标
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(?<oid>[0-9a-f]{64})\b/.exec(line);
    const oid = m?.groups?.oid;
    if (oid === undefined || seen.has(oid)) {
      continue;
    }
    seen.add(oid);
    out.push(oid);
  }
  return out;
}

/**
 * 内容推送成功后那一跳：把 LFS 对象也送过去（文件头第 9 条）。
 *
 * 失败 ⇒ `CODE.FAIL`，由调用方**不派发**：refs 已在而对象不在，GitHub 侧 checkout
 * 开 `lfs: true` 的那几格会拿指针文件跑出一格假红。重试用 LFS 自己的 60s 墙钟预算
 * （`budgetMs` 由本函数按「整档还剩多少」算，主路径与回退共用，理由见文件头）；
 * 首刀不裁超时，仍是 `PUSH_TIMEOUT_MS`。
 *
 * @param {{log: (line: string) => void, prefix: string, runGit: Function,
 *   sleep: (ms: number) => Promise<void>, token: string, url: string,
 *   runGitWithRetry: Function, sanitize: (text: string, secret: string) => string}} ctx
 * @returns {Promise<{attempts: number, code: number, elapsedMs: number,
 *   failure: ReturnType<typeof classifyLfsPushFailure> | null, objects: string | null,
 *   retriedByObjectId: boolean}>}
 *   仓内三态退码（这一跳只有 OK / FAIL 两态：前提那一层已由探活挡过）+ 收尾小结要的读数；
 *   `retriedByObjectId` 记「这一跳进过 `--object-id` 回退」（读数，不参与判定）
 */
export async function pushLfsObjects(ctx) {
  const { log, prefix, runGit, sleep, token, url, runGitWithRetry, sanitize } = ctx;
  const startedAt = Date.now();
  /** 整档（主路径 + 可能的 --object-id 回退）还剩下多少预算：两跳共用一份，不各领一份。 */
  const budgetLeft = () => Math.max(0, LFS_PUSH_RETRY_BUDGET_MS - (Date.now() - startedAt));
  const lfs = await runGitWithRetry(lfsPushArgs(url), {
    budgetMs: budgetLeft(),
    label: "LFS 推送",
    log,
    maxAttempts: LFS_PUSH_MAX_ATTEMPTS,
    prefix,
    runGit,
    sleep,
  });
  const elapsedMs = Date.now() - startedAt;
  let attempts = lfs.attempts;
  let text = sanitize(`${lfs.stdout}\n${lfs.stderr}`, token);
  let objects = parseLfsObjectCount(text);
  /** 回退那一跳的读数（进了回退就非 null；收尾小结与话术按它说）。 */
  let retriedByObjectId = false;
  if (lfs.code !== 0 && classifyLfsPushFailure(text).kind === "LOCAL_REFS") {
    /* `HEAD` / ref 枚举不到 ⇒ 换按对象 OID 推（文件头第 9 条之二）。清单由
     * `git lfs ls-files --long` 按 index 取，不经过 ref 解析 —— 这正是那一形缺的东西。
     * 清单为空说明本地压根没有 LFS 对象，回退没有对象，按原失败交账。 */
    /* `-c core.quotePath=false`：`--long` 的第三列是路径，转义过的路径读不出原样
     * （ISSUE #2272）；这里只取第一列 OID，但守卫与全仓「读 git 路径的调用」同口径。 */
    const listed = runGit([
      "-c",
      "core.quotePath=false",
      "-c",
      "core.hooksPath=",
      "lfs",
      "ls-files",
      "--long",
    ]);
    const oids = listed.code === 0 ? parseLfsObjectIds(sanitize(listed.stdout, token)) : [];
    const fallbackArgs = lfsObjectIdPushArgs(url, oids);
    if (fallbackArgs === null) {
      log(
        `[${prefix}] LFS 推送：本地 ref 枚举不到，且 \`git lfs ls-files --long\` 也读不到对象 OID（exit ${String(listed.code)}）⇒ 回退没有对象，按原失败交账`,
      );
    } else {
      log(
        `[${prefix}] LFS 推送：ref 枚举不到（\`Error getting local refs.\`）⇒ 回退改按对象 OID 推（清单 ${String(oids.length)} 个，取自 \`git lfs ls-files --long\`，不经 ref 解析）`,
      );
      const fb = await runGitWithRetry(fallbackArgs, {
        budgetMs: budgetLeft(),
        label: "LFS 回退推送（--object-id）",
        log,
        maxAttempts: LFS_PUSH_MAX_ATTEMPTS,
        prefix,
        runGit,
        sleep,
      });
      attempts += fb.attempts;
      retriedByObjectId = true;
      text = sanitize(`${fb.stdout}\n${fb.stderr}`, token);
      objects = parseLfsObjectCount(text);
      if (fb.code === 0) {
        log(
          `[${prefix}] LFS 推送：通（回退路径 --object-id，${String(oids.length)} 个对象；原路径的 ref 枚举失败不构成结论）`,
        );
        return {
          attempts,
          code: CODE.OK,
          elapsedMs: Date.now() - startedAt,
          failure: null,
          objects,
          retriedByObjectId,
        };
      }
    }
  }
  if (lfs.code !== 0 || retriedByObjectId) {
    const failure = classifyLfsPushFailure(text);
    log(
      `[${prefix}] LFS 推送失败（exit ${String(lfs.code)}，重试 ${String(attempts - 1)} 次${retriedByObjectId ? "，含 --object-id 回退" : ""}）：类别=${failure.label}；最终错因=${failure.evidence || "（原文没读到）"}；${failure.next}`,
    );
    for (const line of text.split("\n")) {
      if (line.trim()) {
        log(`[${prefix}]   原文：${line}`);
      }
    }
    log(
      `[${prefix}] 结论：exit 1 —— refs 已推但 LFS 对象没送过去 ⇒ 不派发（派出去只会让 GitHub 侧拿指针文件当红）`,
    );
    return {
      attempts,
      code: CODE.FAIL,
      elapsedMs: Date.now() - startedAt,
      failure,
      objects,
      retriedByObjectId,
    };
  }
  log(
    `[${prefix}] LFS 推送：通（增量：只推该 ref 可达且远端还没有的对象，已在场的由 git-lfs 自己跳过）`,
  );
  return { attempts, code: CODE.OK, elapsedMs, failure: null, objects, retriedByObjectId };
}
