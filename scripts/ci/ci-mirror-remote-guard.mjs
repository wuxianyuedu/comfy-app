/**
 * 推送前的「远端是不是已经比本次 HEAD 更新」这一道闸（ISSUE #3252）。
 *
 * ## 为什么要有这道闸
 *
 * 镜像那一推是 `git push --force HEAD:refs/heads/master`。`--force` 的语义是
 * 「把远端那条 ref 无条件改成我这一刀」，于是只要**远端比本次 HEAD 更新**（例如同一条
 * master 上已有别人的合并、或旧构建的迟到重跑），这一推就会把远端**退回旧值**。
 * 实测回归就在这里：`cbb029de` 已推上去之后，旧 HEAD `b209aa05` 的迟到重跑照样
 * 推成功，GitHub `master` 从 `cbb029de` 退回 `b209aa05` —— 推后回读只验
 * 「remote == 本次 HEAD」，那一刀本身是「成功」的，抓不到这种倒退。
 *
 * 所以这里在 `git push` **之前**读一次远端 ref，按祖先关系判这一推会不会倒退：
 * 远端是本次 HEAD 的后代 ⇒ 拒推（`exit 1`，作为**事实**交账，不是「前提没落地」）。
 *
 * ## 与「探活」的区分（这条要写死）
 *
 * 它**不是**恢复 #3252 删掉的那个探活循环：
 *
 * · **单发、不重试、不占推送重试预算** —— 直接调 `runGit` 一次，不走
 *   `runGitWithRetry`；出网抖动时也不把整格变成 `exit 2`（那是刚改掉的行为：
 *   探活 6 次耗 201s、一次内容推送都没发起）。
 * · **读不到只记「闸不可用」并照推** —— 读失败 / 读到不懂的关系 / shallow 检出，
 *   一律 fail-open。它不是推送的前置门，只是「读了就多一层保护，读不到就按原样推」。
 *
 * ## 关系判定
 *
 * 裸 sha 无法直接判祖先，用本地对象库补上：
 *
 * · 远端 sha 在本地：`git merge-base --is-ancestor` 判「远端落后 / 远端更新 / 分叉」；
 * · 远端 sha 不在本地：完整克隆下「本地没有该对象」⇒ 它不可能是本次 HEAD 的祖先
 *   ⇒ 远端要么更新、要么已分叉 ⇒ 拒推；
 * · **shallow 检出**下这条推断不成立（浅克隆本来就可能缺祖先）⇒ 按「闸不可用」放行。
 *
 * 退码沿用本仓三态：`0` 有结论且对（照推）、`1` 有事实是错（拒推）、`2` 没读到。
 * 本模块只回 `0` / `1`：「没读到」也按 fail-open 交回 `0`，但日志逐字写「闸不可用」。
 *
 * @module scripts/ci-mirror-remote-guard — 推送前的远端更新闸
 */
import { parseRemoteRefSha } from "./ci-mirror-push-verify.mjs";

/** 三态退码（与主文件 `CODE` 同值；这里单独写一份是为了不造成循环 import）。 */
const CODE = { FAIL: 1, OK: 0 };

/** 远端与本次 HEAD 的关系（{@link classifyRemoteRelation} 的取值）。 */
export const REMOTE_RELATION = Object.freeze({
  /** 远端没有这条 ref（首次推送）。 */
  ABSENT: "absent",
  /** 远端 sha 与本次 HEAD 相等（推上去也是 0 对象）。 */
  EQUAL: "equal",
  /** 远端比本次 HEAD 旧（正常前进）。 */
  BEHIND: "behind",
  /** 远端比本次 HEAD 新（强推会倒退）。 */
  AHEAD: "ahead",
  /** 两侧各有对方没有的提交（强推会丢远端那侧）。 */
  DIVERGED: "diverged",
  /** 完整克隆下，远端 sha 在本地不存在（必不是祖先 ⇒ 更新或分叉）。 */
  MISSING_LOCAL: "missing-local",
  /** 前提不够（浅克隆 / 查询失败）⇒ 闸不可用，按「照推」处理。 */
  UNKNOWN: "unknown",
});

/**
 * 纯函数：把「远端 sha + 本地查得的事实」收成一个关系。
 *
 * @param {object} facts
 * @param {string} facts.headSha 本次要推的 HEAD（完整 sha）
 * @param {string | null} facts.remoteSha 远端那条 ref 的 sha（`null` = ref 不存在）
 * @param {boolean} [facts.localHasRemote] 远端 sha 的提交对象是否在本地
 * @param {boolean | null} [facts.shallow] 检出是不是 shallow（`null` = 没读到）
 * @param {boolean | null} [facts.remoteIsAncestorOfHead] `merge-base --is-ancestor <remote> <head>`
 * @param {boolean | null} [facts.headIsAncestorOfRemote] `merge-base --is-ancestor <head> <remote>`
 * @returns {string} {@link REMOTE_RELATION} 的取值
 */
export function classifyRemoteRelation(facts) {
  const head = String(facts.headSha ?? "").toLowerCase();
  const remote = typeof facts.remoteSha === "string" ? facts.remoteSha.toLowerCase() : null;
  if (remote === null) {
    return REMOTE_RELATION.ABSENT;
  }
  if (remote === head) {
    return REMOTE_RELATION.EQUAL;
  }
  if (facts.localHasRemote === false) {
    /* 浅克隆里「本地没有」不构成「不是祖先」的证据 ⇒ 只记闸不可用，不拒推。 */
    if (facts.shallow === false) {
      return REMOTE_RELATION.MISSING_LOCAL;
    }
    return REMOTE_RELATION.UNKNOWN;
  }
  const remoteIsAncestor = facts.remoteIsAncestorOfHead ?? null;
  const headIsAncestor = facts.headIsAncestorOfRemote ?? null;
  if (remoteIsAncestor === true) {
    return REMOTE_RELATION.BEHIND;
  }
  if (headIsAncestor === true) {
    return REMOTE_RELATION.AHEAD;
  }
  if (remoteIsAncestor === false && headIsAncestor === false) {
    return REMOTE_RELATION.DIVERGED;
  }
  return REMOTE_RELATION.UNKNOWN;
}

/**
 * 把关系翻成一行给人看的话术（拒推那几支带双 sha）。
 *
 * @param {string} relation {@link REMOTE_RELATION}
 * @param {object} facts
 * @param {string} facts.headSha 本次 HEAD（完整）
 * @param {string} facts.ref 目标 ref 全名
 * @param {string | null} facts.remoteSha 远端 sha（完整）
 * @param {string} [facts.why] `UNKNOWN` 那一支的具体原因（读失败 / 浅克隆…）
 * @returns {string} 一行结论
 */
export function describeRelation(relation, facts) {
  const head = String(facts.headSha).toLowerCase();
  const remote = String(facts.remoteSha ?? "");
  switch (relation) {
    case REMOTE_RELATION.ABSENT: {
      return `远端没有 ${facts.ref}（首次推送）⇒ 照推`;
    }
    case REMOTE_RELATION.EQUAL: {
      return `远端与本次 HEAD 相等 ⇒ 照推（0 对象）`;
    }
    case REMOTE_RELATION.BEHIND: {
      return `远端 ${remote.slice(0, 8)} 落后于本次 HEAD ⇒ 照推`;
    }
    case REMOTE_RELATION.AHEAD: {
      return `远端比本次 HEAD 更新，拒推（强推会把远端退回旧值）remote=${remote} local=${head}`;
    }
    case REMOTE_RELATION.DIVERGED: {
      return `远端与本次 HEAD 已分叉，拒推（强推会丢掉远端那侧的提交）remote=${remote} local=${head}`;
    }
    case REMOTE_RELATION.MISSING_LOCAL: {
      return `远端有本地没有的提交（更新或已分叉），拒推（强推会把远端退回去）remote=${remote} local=${head}`;
    }
    default: {
      return `闸不可用（${facts.why ?? "关系判不出"}）⇒ 照推（不是探活，不占推送重试预算）`;
    }
  }
}

/**
 * 推送前的执行面：读一次远端 ref，按祖先关系判「这一推会不会倒退」。
 *
 * @param {object} deps
 * @param {string} deps.headSha 本次要推的 HEAD（完整 sha）
 * @param {(line: string) => void} deps.log 输出通道
 * @param {string} deps.prefix 行前缀（`mirror-master`）
 * @param {string} deps.ref 目标 ref 全名（`refs/heads/master`）
 * @param {(args: string[]) => {code: number, stderr: string, stdout: string}} deps.runGit 执行者（**直接调用一次**，不重试）
 * @param {(text: string, token: string) => string} deps.sanitize 脱敏
 * @param {string} deps.token 镜像令牌（只用于脱敏）
 * @param {string} deps.url 带凭据的推送 URL
 * @returns {{code: number, note: string, relation: string, remoteSha: string | null}}
 */
export function guardRemoteNotAhead(deps) {
  const { headSha, log, prefix, ref, runGit, sanitize, token, url } = deps;
  /** @type {{headSha: string, ref: string, remoteSha: string | null}} */
  const facts = { headSha, ref, remoteSha: null };

  /* 单发、不重试：与推送重试预算完全无关（模块头「与探活的区分」）。 */
  const read = runGit(["ls-remote", url, ref]);
  if (read.code !== 0) {
    const text = sanitize(`${read.stdout}\n${read.stderr}`, token);
    for (const line of text.split("\n")) {
      if (line.trim()) {
        log(`[${prefix}]   ${line}`);
      }
    }
    const note = describeRelation(REMOTE_RELATION.UNKNOWN, {
      ...facts,
      why: `ls-remote 没通（exit ${String(read.code)}）`,
    });
    return { code: CODE.OK, note, relation: REMOTE_RELATION.UNKNOWN, remoteSha: null };
  }
  const remoteSha = parseRemoteRefSha(read.stdout, ref);
  if (remoteSha === null) {
    const note = describeRelation(REMOTE_RELATION.ABSENT, facts);
    return { code: CODE.OK, note, relation: REMOTE_RELATION.ABSENT, remoteSha: null };
  }
  facts.remoteSha = remoteSha;
  if (remoteSha === String(headSha).toLowerCase()) {
    const note = describeRelation(REMOTE_RELATION.EQUAL, facts);
    return { code: CODE.OK, note, relation: REMOTE_RELATION.EQUAL, remoteSha };
  }

  /* 远端 sha 在不在本地：在 ⇒ 能直接判祖先；不在 ⇒ 要再看检出形态（浅克隆不构成证据）。 */
  const hasCommit = runGit(["cat-file", "-e", `${remoteSha}^{commit}`]);
  const localHasRemote = hasCommit.code === 0;
  if (!localHasRemote) {
    const probe = runGit(["rev-parse", "--is-shallow-repository"]);
    /** @type {boolean | null} */
    const shallow = probe.code === 0 ? probe.stdout.trim().toLowerCase() === "true" : null;
    /* 完整克隆下「本地没有该对象」⇒ 它不可能是 HEAD 的祖先 ⇒ 拒推；
     * 浅克隆 / 形态没读到 ⇒ 这条推断不成立，只记「闸不可用」放行。 */
    const base = classifyRemoteRelation({ headSha, localHasRemote, remoteSha, shallow });
    if (base === REMOTE_RELATION.MISSING_LOCAL) {
      const note = describeRelation(REMOTE_RELATION.MISSING_LOCAL, facts);
      return { code: CODE.FAIL, note, relation: REMOTE_RELATION.MISSING_LOCAL, remoteSha };
    }
    const why = shallow === null ? "浅克隆形态没读到" : "检出是 shallow，本地缺对象不构成证据";
    const note = describeRelation(REMOTE_RELATION.UNKNOWN, { ...facts, why });
    return { code: CODE.OK, note, relation: REMOTE_RELATION.UNKNOWN, remoteSha };
  }

  /* 在本地：先问「远端是不是 HEAD 的祖先」（是 ⇒ 落后、照推），再问反向（是 ⇒ 更新、拒推）。
   * `--is-ancestor` 的 0 / 1 是答案；其他退出码是查询本身没跑成 ⇒ 闸不可用。 */
  const remoteIsAncestor = runGit(["merge-base", "--is-ancestor", remoteSha, headSha]);
  if (remoteIsAncestor.code === 0) {
    const note = describeRelation(REMOTE_RELATION.BEHIND, facts);
    return { code: CODE.OK, note, relation: REMOTE_RELATION.BEHIND, remoteSha };
  }
  if (remoteIsAncestor.code !== 1) {
    const note = describeRelation(REMOTE_RELATION.UNKNOWN, {
      ...facts,
      why: `merge-base 没跑成（exit ${String(remoteIsAncestor.code)}）`,
    });
    return { code: CODE.OK, note, relation: REMOTE_RELATION.UNKNOWN, remoteSha };
  }
  const headIsAncestor = runGit(["merge-base", "--is-ancestor", headSha, remoteSha]);
  if (headIsAncestor.code !== 0 && headIsAncestor.code !== 1) {
    const note = describeRelation(REMOTE_RELATION.UNKNOWN, {
      ...facts,
      why: `merge-base 没跑成（exit ${String(headIsAncestor.code)}）`,
    });
    return { code: CODE.OK, note, relation: REMOTE_RELATION.UNKNOWN, remoteSha };
  }
  const relation = classifyRemoteRelation({
    headSha,
    headIsAncestorOfRemote: headIsAncestor.code === 0,
    localHasRemote,
    remoteIsAncestorOfHead: false,
    remoteSha,
  });
  const note = describeRelation(relation, facts);
  /* 走到这里只剩「更新（head 是远端的祖先）」与「分叉」两支，都是拒推。 */
  return { code: CODE.FAIL, note, relation, remoteSha };
}
