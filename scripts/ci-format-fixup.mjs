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
 * 默认的 git 调用（测试注入 `deps.git` 替换）。
 *
 * @param {string[]} args
 * @returns {{status: number, stdout: string}}
 */
function defaultGit(args) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? "") };
}

/**
 * 当前分支名（平台侧优先读 CNB 注入的环境变量，回退问 git）。
 *
 * @param {(args: string[]) => { status: number, stdout: string }} gitFn
 * @returns {string}
 */
function currentBranch(gitFn) {
  const fromEnv = String(process.env.CNB_BRANCH ?? "").trim();
  if (fromEnv) return fromEnv;
  return gitFn(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
}

/**
 * HEAD 提交的标题（防连环护栏认 `style(format): ` 前缀用）。
 *
 * @param {(args: string[]) => { status: number, stdout: string }} gitFn
 * @returns {string}
 */
function headSubject(gitFn) {
  return gitFn(["log", "-1", "--pretty=%s"]).stdout.trim();
}

/**
 * 编排本体。全部 IO 可注入 —— 用例据此判「建了什么提交 / 推没推 / 为什么没推」。
 *
 * @param {{
 *   judge?: () => number,
 *   listUnformatted?: () => string[] | null,
 *   write?: (files: string[], entry: string | null) => boolean,
 *   git?: (args: string[]) => { status: number, stdout: string },
 *   branch?: string | null,
 *   platformUser?: string | null,
 *   headSubject?: string | null,
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
  const branch = deps.branch ?? currentBranch(git);
  const subject = deps.headSubject ?? headSubject(git);

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
    if (subject.startsWith(FIXUP_SUBJECT_PREFIX)) {
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
  if (branch === "master") {
    log("[format-fixup] × 分支是 master —— 永不回写主干（硬规则 6）。照旧红。");
    return { exitCode: 1, action: "master-refused", lines };
  }
  /* 防连环护栏的另一半：复判**全绿**但 HEAD 已是 bot 提交 —— 这意味着两个 bot
   * 提交背靠背（上一轮推的修复没让流水线变绿，或者与新提交赛跑）。同样停：
   * 正常回路里「bot 推完 → 新 CI 全绿」不需要第二个 bot 提交。 */
  if (subject.startsWith(FIXUP_SUBJECT_PREFIX)) {
    log(
      "[format-fixup] × HEAD 已是 bot 的修复提交且复判全绿 ⇒ 背靠背 bot 提交，停" +
        "（正常回路是「推完 → 新 CI 自己绿」，不需要第二个修复提交）。",
    );
    return { exitCode: 1, action: "loop-guard", lines };
  }

  const add = git(["add", "--", ...files]);
  if (add.status !== 0) {
    log("[format-fixup] × git add 失败 —— 照旧红。");
    return { exitCode: 1, action: "add-failed", lines };
  }
  const commit = git([
    "-c",
    `user.name=${FIXUP_AUTHOR_NAME}`,
    "-c",
    `user.email=${FIXUP_AUTHOR_EMAIL}`,
    "commit",
    "-m",
    `${FIXUP_SUBJECT_PREFIX}prettier 自动修复（bot · ISSUE #2342）· ${files.length} 个文件`,
  ]);
  if (commit.status !== 0) {
    log("[format-fixup] × git commit 失败 —— 照旧红。");
    return { exitCode: 1, action: "commit-failed", lines };
  }
  const push = git(["push", "origin", `HEAD:refs/heads/${branch}`]);
  if (push.status !== 0) {
    log(
      `[format-fixup] × push 被拒（branch=${branch}）—— 修复留在工作区但没有落回分支。\n` +
        "[format-fixup]   常见成因：PR 类事件令牌 scope 只有 repo-code:r（官方权限表）。\n" +
        "[format-fixup]   业主动作：给流水线配可回写的 bot 凭据；或本地 prettier --write 重推。\n" +
        "[format-fixup]   失败必须可读，不许静默（自动修的失效形态就是「看不见」）。",
    );
    return { exitCode: 1, action: "push-failed", lines };
  }
  log(
    `[format-fixup] ✓ 已向 ${branch} 推 format-only 修复提交（${FIXUP_AUTHOR_NAME}）—— ` +
      "流水线将在新提交上重跑。",
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
