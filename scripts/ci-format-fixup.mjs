#!/usr/bin/env node
/**
 * ci-format-fixup.mjs — `prettier 格式` 一格的**自动修复 + 回写 PR 分支**执行者
 * （ISSUE #2342；口径变更由业主拍板：§13.5.19 的「CI 回写分支」留白在本档解除）。
 *
 * ## 形状（§13.5.19 的「--check --autofix = 先判、红就修、结论永远来自第二次判定」；
 * 两个旗标都是本脚本的字面参数 —— 登记表守卫按字面核对，`--check` 声明「先判」这一拍，
 * `--autofix` 授权「红就修」）
 *
 *   1. **先判**：原样跑 `check-format.cjs`（读数与今天的门禁逐字相同）。绿 ⇒ 立刻
 *      返回，一个字节不多写；「判据没跑成」（exit 2）⇒ 原样转 2，不冒充任何结论。
 *   2. **红 ⇒ 就地修**：`prettier --write` **门禁判出的那几个文件**（同一份
 *      `collectUnformatted()` 实现，白名单过滤同源）—— 不许碰格外的文件。
 *   3. **再判**：`collectUnformatted()` 必须清空；清不掉 ⇒ 照旧红（exit 1），
 *      「修不好时必须红」与 §13.5.19 同一句。
 *   4. **回写**：commit + push 到 PR 源分支。bot 身份固定可辨
 *      （`comfy-format-bot`）；提交信息**不带** `[ci skip]` —— 新提交必须触发
 *      完整流水线，PR 跑绿才合并（硬规则 7）。
 *
 * ## 四道护栏
 *
 *   ① 只在平台 PR 流水线回写：本地跑只判 + 修工作区（这就是 `--write` 的日常形态），
 *      不提交不推送 —— 以平台身份环境变量判定（与 freshness-ledger-sync 同一条口径）；
 *   ② 永不回写 `master`（分支保护 + 直连主干禁令，硬规则 6）；
 *   ③ 防连环：HEAD 已是 bot 的修复提交而 prettier 仍红 ⇒ 停（--write 修不明白的
 *      文件推一百次也一样）；
 *   ④ 只 `git add` 本轮写过的文件（`git add -A` 禁止 —— 工作区里可能有别的东西）。
 *
 * ## 凭据
 *
 * 官方权限表口径 PR 类事件只有 `repo-code:r` ⇒ 首跑 push 可能被拒。被拒时如实打
 * 读数（含平台给的原因）并退 1 —— 修法是业主动作（给流水线配可回写的 bot 凭据）；
 * 机制先落位，凭据可后补。**失败不许静默**：自动修的失效形态是「看不见」，把拒绝
 * 读数打出来是本脚本唯一的出路。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** bot 提交的固定身份（blame 可辨：这一族的提交都是机器写的格式修复）。 */
export const FIXUP_AUTHOR_NAME = "comfy-format-bot";
export const FIXUP_AUTHOR_EMAIL = "comfy-format-bot@noreply.cnb.cool";
/** 修复提交的标题前缀 —— 也是防连环护栏认的形状。 */
export const FIXUP_SUBJECT_PREFIX = "style(format): ";

/** check-format.cjs 是 CJS（带 require.main 守卫，require 它不会跑 main）；
 * 经 createRequire 引它的导出（collectUnformatted 同一份实现，§12.18）。
 * 它与本文件同目录（scripts/）。⚠️ createRequire 的怪癖实录（ISSUE #2347）：
 * 以 `<ROOT>/package.json` 打底、`./check-format.cjs` 为目标时解析失败，而同一
 * 目标以本文件路径打底的相对写法（`path.join(HERE, "ci-format-fixup.mjs")` +
 * `path.join(HERE, "check-format.cjs")`）成功 —— 这里按已验的形状写。 */
function requireCheckFormat() {
  return createRequire(path.join(HERE, "ci-format-fixup.mjs"))(
    path.join(HERE, "check-format.cjs"),
  );
}

/** 默认的「判一次」：跑门禁本体，读数原样进本 stage 日志。 */
function defaultJudge() {
  const r = spawnSync(process.execPath, [path.join(HERE, "check-format.cjs")], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status ?? 2;
}

/** 默认的「列出未过文件」：门禁自己的 collectUnformatted（白名单过滤同源）。 */
function defaultListUnformatted() {
  const fmt = requireCheckFormat();
  const entry = fmt.resolvePrettierEntry();
  if (!entry) return null;
  return fmt.collectUnformatted(entry);
}

/**
 * 默认的「写」：prettier --write 按块分片（Windows 无 shell 的命令行长度上限）。
 *
 * @param {string[]} files 门禁判出的未过文件（仓库根相对 POSIX 路径）
 * @param {string | null} entry resolvePrettierEntry() 的结论
 * @returns {boolean}
 */
function defaultWrite(files, entry) {
  if (!entry) return false; // 调用方已判过；留这一行是给直接调用本函数的读者一个不炸的答案
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const r = spawnSync(
      process.execPath,
      [
        entry,
        "--write",
        "--cache",
        "--cache-location",
        path.join(ROOT, "node_modules", ".cache", "prettier-gate.json"),
        ...chunk,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (r.status !== 0) return false;
  }
  return true;
}

/**
 * 默认的 git 调用（测试注入 `deps.git` 替换）。第二参只用于 {@link buildFixCommit}
 * 的临时索引（`GIT_INDEX_FILE`）—— plumbing 路线不碰工作区与主索引的前提。
 *
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{status: number, stdout: string}}
 */
function defaultGit(args, env) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? "") };
}

/**
 * 解析「回写目标」：源分支名 + 要垫在它上面的基提交（baseSha）。
 *
 * ⚠️ 平台事实（红路径首跑实测 + 仓内已有记载）：
 *   · **PR 事件下 `CNB_BRANCH` 是目标分支名**（官方 build-in-env.md：合并类事件取
 *     目标分支 —— `.cnb.yml` 的锁注释引用过同一条）；首跑就拿它当了源分支，
 *     「永不回写 master」护栏当场拦住了自己（读数见 #2358）。
 *   · **`CNB_COMMIT` 在 PR 事件给的是源分支 head**（`ci-workspace-probe` 的注释
 *     记过两个 sha 的区别：HEAD 是 merge 提交、CNB_COMMIT 是源分支 head）。
 *   · HEAD 是 merge 检出 ⇒ **不能推 HEAD**（会把 merge 提交推进源分支）。
 *     修复提交用 plumbing 只建在源分支 head 之上（见 {@link buildFixCommit}）。
 *
 * 源分支名的权威来源：`git ls-remote` 反查 —— 哪个远端头的 sha 等于 `CNB_COMMIT`。
 * 恰好一个 ⇒ 就是它；零个（分支已删/被推走）或多个 ⇒ 判不出来，可读地红。
 *
 * @param {(args: string[], env?: Record<string, string>) => { status: number, stdout: string }} gitFn
 * @returns {{ kind: "ok", branch: string, baseSha: string }
 *   | { kind: "error", reason: string }}
 */
export function resolveSourceTarget(gitFn) {
  const iid = String(process.env.CNB_PULL_REQUEST_IID ?? "").trim();
  const cnbCommit = String(process.env.CNB_COMMIT ?? "").trim();
  if (iid) {
    if (!cnbCommit) {
      return {
        kind: "error",
        reason: "PR 事件但 CNB_COMMIT 不在场（源分支 head 判不出）",
      };
    }
    const ls = gitFn(["ls-remote", "origin", "refs/heads/*"]);
    if (ls.status !== 0) {
      return { kind: "error", reason: `ls-remote 失败（exit ${ls.status}）` };
    }
    /** @type {string[]} */
    const matches = [];
    for (const line of ls.stdout.split("\n")) {
      const m = /^([0-9a-f]{40})\trefs\/heads\/(\S+)$/.exec(line.trim());
      const [, sha, name] = m ?? ["", "", ""];
      if (sha === cnbCommit && name) matches.push(name);
    }
    if (matches.length !== 1) {
      return {
        kind: "error",
        reason:
          `按 CNB_COMMIT=${cnbCommit.slice(0, 8)}… 反查源分支得 ${matches.length} 个` +
          `（${matches.join(", ") || "无"}）—— 分支已删/被推走/多头同 sha 都判不出唯一目标`,
      };
    }
    return { kind: "ok", branch: matches[0] ?? "", baseSha: cnbCommit };
  }
  /* push 事件：CNB_BRANCH 就是被推的那条分支（官方同文档），检出也不是 merge 形态。 */
  const branch = String(process.env.CNB_BRANCH ?? "").trim();
  if (branch) {
    const baseSha = cnbCommit || gitFn(["rev-parse", "HEAD"]).stdout.trim();
    return { kind: "ok", branch, baseSha };
  }
  return {
    kind: "error",
    reason: "既不在 PR 事件也没有 CNB_BRANCH —— 判不出回写目标",
  };
}

/**
 * 用 plumbing 把「只含本轮修复文件」的提交建在 `baseSha` 之上，返回提交 sha。
 *
 * 为什么不用 `git add` + `git commit`：那是**当前索引**（PR 检出是 merge 树）的
 * 提交 —— 父提交是 merge 检出、树是整棵 merge 树，推进源分支等于把 master 并进 PR。
 * plumbing 路线（临时索引）完全不碰工作区与主索引，后续 stage 照旧：
 *   hash-object（修复后的文件内容）→ read-tree baseSha → update-index --cacheinfo
 *   → write-tree → commit-tree -p baseSha。
 *
 * @param {(args: string[], env?: Record<string, string>) => { status: number, stdout: string }} gitFn
 * @param {string[]} files 修复过的文件（仓库根相对 POSIX 路径）
 * @param {{baseSha: string, message: string}} ctx
 * @returns {string | null} 提交 sha；任何一步失败 null（调用方可读地红）
 */
export function buildFixCommit(gitFn, files, { baseSha, message }) {
  /* 逐文件取内容 blob（工作区里已是修好的内容）。 */
  /** @type {string[]} */
  const blobs = [];
  for (const f of files) {
    const h = gitFn(["hash-object", "-w", "--", f]);
    if (h.status !== 0) return null;
    blobs.push(h.stdout.trim());
  }
  const tmpIndex = path.join(
    ROOT,
    "node_modules",
    ".cache",
    `format-fixup-index-${process.pid}`,
  );
  const indexEnv = { GIT_INDEX_FILE: tmpIndex };
  const read = gitFn(["read-tree", baseSha], indexEnv);
  if (read.status !== 0) return null;
  for (let i = 0; i < files.length; i += 1) {
    const up = gitFn(
      ["update-index", "--cacheinfo", `100644,${blobs[i]},${files[i]}`],
      indexEnv,
    );
    if (up.status !== 0) return null;
  }
  const tree = gitFn(["write-tree"], indexEnv);
  if (tree.status !== 0) return null;
  const commit = gitFn([
    "-c",
    `user.name=${FIXUP_AUTHOR_NAME}`,
    "-c",
    `user.email=${FIXUP_AUTHOR_EMAIL}`,
    "commit-tree",
    tree.stdout.trim(),
    "-p",
    baseSha,
    "-m",
    message,
  ]);
  if (commit.status !== 0) return null;
  /* 临时索引只在 node_modules/.cache 下（git 忽略面），不清理也不入库。 */
  return commit.stdout.trim();
}

/**
 * 编排本体。全部 IO 可注入 —— 用例据此判「建了什么提交 / 推没推 / 为什么没推」。
 *
 * @param {{
 *   judge?: () => number,
 *   listUnformatted?: () => string[] | null,
 *   write?: (files: string[], entry: string | null) => boolean,
 *   git?: (args: string[], env?: Record<string, string>) => { status: number, stdout: string },
 *   resolveSource?: () => { kind: "ok", branch: string, baseSha: string } | { kind: "error", reason: string },
 *   baseSubject?: string | null,
 *   platformUser?: string | null,
 *   log?: (s: string) => void,
 * }} [deps]
 * @returns {{ exitCode: number, action: string, lines: string[] }}
 */
export function runFormatFixup(deps = {}) {
  /** 本拍的读数（main 只管退出码与打印；用例按它复核「说清了哪一种」）。 */
  /** @type {string[]} */
  const lines = [];
  const log = deps.log ?? ((s) => lines.push(s));
  const git = deps.git ?? defaultGit;
  const judge = deps.judge ?? defaultJudge;
  const listUnformatted = deps.listUnformatted ?? defaultListUnformatted;
  const write = deps.write ?? defaultWrite;
  const platformUser =
    deps.platformUser ??
    process.env.CNB_BUILD_USER_NICKNAME ??
    process.env.CNB_COMMITTER ??
    process.env.CNB_BUILD_USER ??
    null;
  /* 防连环护栏看的标题：**源分支头**（PR 事件 = CNB_COMMIT；平台检出是 merge
   * 提交，HEAD 的标题不是任何一分支的事实）。不需要分支名，读 sha 就够。 */
  const guardSha =
    deps.baseSubject !== undefined
      ? null
      : String(process.env.CNB_COMMIT ?? "").trim() || null;
  const baseSubject =
    deps.baseSubject ??
    (guardSha
      ? git(["log", "-1", "--pretty=%s", guardSha]).stdout.trim()
      : git(["log", "-1", "--pretty=%s"]).stdout.trim());

  // ① 先判：绿就返回（与今天的门禁同价）。`--check` 旗标是这一拍的显式形状
  // （§13.5.19：--check --autofix = 先判一次、红就修、结论来自第二次判定）——
  // 登记表守卫按字面核对它，防止这一格退化成「只写不判」的恒绿。
  const code = judge();
  if (code === 0) return { exitCode: 0, action: "green", lines };
  if (code === 2) {
    return {
      exitCode: 2,
      action: "judge-didnt-run",
      lines: [
        "[format-fixup] 判据没跑成（exit 2）—— 原样转 2，不冒充任何结论。",
      ],
    };
  }

  // ② 红 ⇒ 就地修（只修门禁判出的那几个文件）。
  const files = listUnformatted();
  if (files === null || files.length === 0) {
    log(
      "[format-fixup] × 判据说红、清单却是空的 —— 两份读数矛盾，按 fail-closed 红（不提交不推送）。",
    );
    return { exitCode: 1, action: "inconsistent", lines };
  }
  const fmt = requireCheckFormat();
  const entry = fmt.resolvePrettierEntry();
  if (!entry) {
    /* 与门禁本体同一条 fail-closed：取不到 prettier = 判据没跑成，不是「干净」。 */
    log(
      "[format-fixup] × 找不到 prettier 入口 —— 修不了也判不了，转 2（不冒充任何结论）。",
    );
    return { exitCode: 2, action: "no-prettier-entry", lines };
  }
  if (!write(files, entry)) {
    log("[format-fixup] × prettier --write 失败 —— 照旧红，不提交不推送。");
    return { exitCode: 1, action: "write-failed", lines };
  }

  // ③ 再判：结论永远来自第二次判定；清不掉就是修不明白，必须红。
  // 「修不明白」里有一类要说得更准：HEAD 已经是 bot 的修复提交（上一轮就是它推的）
  // ⇒ 连环 —— 报 loop-guard 而不是笼统的 unfixable（区分「新文件修不动」与
  // 「修过了还红」：后者再推一百次也一样，人要去看的是那个文件本身）。
  const after = listUnformatted();
  if (after === null || after.length > 0) {
    if (baseSubject.startsWith(FIXUP_SUBJECT_PREFIX)) {
      log(
        "[format-fixup] × HEAD 已是 bot 的修复提交而 --write 后仍红 ⇒ 连环，停。\n" +
          "[format-fixup]   上一轮修的就是这份树 —— 再推也不会变绿；要看的是那个文件本身" +
          "（版本 / 配置 / 编辑器格式化差异）。",
      );
      return { exitCode: 1, action: "loop-guard", lines };
    }
    log(
      `[format-fixup] × --write 之后仍有 ${after?.length ?? "?"} 个文件未过 —— 修不明白，` +
        "照旧红（§13.5.19：修不好时必须红，不许「跑过写入模式就当我赢了」）。",
    );
    return { exitCode: 1, action: "unfixable", lines };
  }
  log(`[format-fixup] 已就地修复 ${files.length} 个文件，复判全绿。`);

  // ④ 回写。四道护栏（见文件头）。
  if (!platformUser) {
    log(
      "[format-fixup] 本地形态：工作区已修好 —— 不提交不推送（回写只发生在平台 PR 流水线上）。",
    );
    return { exitCode: 0, action: "local-fixed", lines };
  }
  /* 回写目标 = **源分支**（PR 事件下 CNB_BRANCH 是目标分支，不能用它 —— 见
   * resolveSourceTarget 的平台事实段）。判不出唯一目标 = 可读地红。 */
  const target = deps.resolveSource
    ? deps.resolveSource()
    : resolveSourceTarget(git);
  if (target.kind !== "ok") {
    log(
      `[format-fixup] × 判不出回写目标：${target.reason} —— 照旧红（不猜目标）。`,
    );
    return { exitCode: 1, action: "source-unresolved", lines };
  }
  const { branch, baseSha } = target;
  log(`[format-fixup] 回写目标：${branch}（基提交 ${baseSha.slice(0, 8)}…）`);
  if (branch === "master") {
    log("[format-fixup] × 分支是 master —— 永不回写主干（硬规则 6）。照旧红。");
    return { exitCode: 1, action: "master-refused", lines };
  }
  /* 防连环：baseSubject 在编排开头已按「源分支头（CNB_COMMIT）」取好。 */
  if (baseSubject.startsWith(FIXUP_SUBJECT_PREFIX)) {
    log(
      "[format-fixup] × 源分支头已是 bot 的修复提交 ⇒ 连环，停（再推也不会变绿；" +
        "要看的是那个文件本身：版本 / 配置 / 编辑器格式化差异）。",
    );
    return { exitCode: 1, action: "loop-guard", lines };
  }

  /* 用 plumbing 只把修复文件建在源分支 head 之上（不碰工作区与 merge 检出，
   * 见 buildFixCommit）。 */
  const message = `${FIXUP_SUBJECT_PREFIX}prettier 自动修复（bot · ISSUE #2342）· ${files.length} 个文件`;
  const fixSha = buildFixCommit(git, files, { baseSha, message });
  if (!fixSha) {
    log("[format-fixup] × 构建修复提交失败（plumbing 某一步非零）—— 照旧红。");
    return { exitCode: 1, action: "commit-failed", lines };
  }
  const push = git(["push", "origin", `${fixSha}:refs/heads/${branch}`]);
  if (push.status !== 0) {
    log(
      `[format-fixup] × push 被拒（${fixSha.slice(0, 8)}… → refs/heads/${branch}）—— ` +
        "修复留在工作区但没有落回分支。\n" +
        "[format-fixup]   常见成因：PR 类事件令牌 scope 只有 repo-code:r（官方权限表）。\n" +
        "[format-fixup]   业主动作：给流水线配可回写的 bot 凭据；或本地 prettier --write 重推。\n" +
        "[format-fixup]   失败必须可读，不许静默（自动修的失效形态就是「看不见」）。",
    );
    return { exitCode: 1, action: "push-failed", lines };
  }
  log(
    `[format-fixup] ✓ 已向 ${branch} 推 format-only 修复提交 ${fixSha.slice(0, 8)}…` +
      `（${FIXUP_AUTHOR_NAME}）—— 流水线将在新提交上重跑。`,
  );
  return { exitCode: 0, action: "pushed", lines };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const r = runFormatFixup();
  for (const line of r.lines) process.stdout.write(`${line}\n`);
  process.exit(r.exitCode);
}
