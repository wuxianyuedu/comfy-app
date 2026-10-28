#!/usr/bin/env node
/**
 * ci-format-fixup.mjs — `oxfmt 格式` 一格的**自动修复 + 回写 PR 分支**执行者
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
 *      完整流水线，PR 跑绿才合并（硬规则 7）。**谁有资格推**见下面「委托」一节。
 *
 * ## 委托：`pull_request` 只判不推，回写走 `api_trigger`（ISSUE #2362 / #2365）
 *
 * 平台按「事件 + ref」给令牌，`pull_request` 整族在「不可信事件」名单里 ⇒ 只有
 * `repo-code:r`，**没有任何 YAML 开关**能翻（OIDC 同样拒签发）。红路径实测（#2362 的
 * `cnb-1mr` 那跑）走到最后一格才撞上这件事：`488837a1` 建好了，push 被拒。
 *
 * 出路不是要权限、也不是配一套长期 bot 凭据，而是**换执行口**：`api_trigger` 是可信事件、
 * 令牌 `rw`（同一轮里用一条临时流水线实测 `git push --dry-run` 得 `PUSH_RC=0`）。于是：
 *
 *   · `pull_request` 那一格**只做判 / 修 / 复判**（这份工作区就是 PR 的预合并树，读得对），
 *     然后把「谁 / 哪条分支 / 哪个 sha」交给 `cnb build start-build --event
 *     api_trigger_formatfix`；
 *   · `api_trigger_formatfix` 那一格（`.cnb.yml`）带 `--delegate`：它**是**回写口，
 *     自己跑判 / 修 / 复判并直推。
 *
 * 三件与「凑一个能跑的形态」有关的事实：
 *
 *   ① **参数走参数，不走环境变量**：`CNB_BRANCH` 在那条事件上是「流水线所在分支」，
 *      指望它等于 PR 源分支就会推错地方（正是 #2358 首跑认成 master 的同一个根因）。
 *      委托口从 `--delegate`（谁有资格推）、`--ref`（回写目标）、`--sha`（必须与之相等的
 *      实时头）三处取值。
 *   ② **幂等闸是传进来的 sha，不是 `CNB_COMMIT`**：后者是触发那一刻的快照，会一直对得上
 *      ⇒ 白推一次非 fast-forward。真正的闸是 `git ls-remote` 那一问：实时头 ≠ `--sha`
 *      就说明已经有人推过（`--sha` 那一路的 push 会自己核对），退 0 不推。
 *   ③ **master 是安全网**：回写目标仍是 `master` 时拒绝（硬规则 6），不管哪条口来的。
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

import { buildSnFromOutput, cnbSpawn } from "./ship-exec.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** bot 提交的固定身份（blame 可辨：这一族的提交都是机器写的格式修复）。 */
export const FIXUP_AUTHOR_NAME = "comfy-format-bot";
export const FIXUP_AUTHOR_EMAIL = "comfy-format-bot@noreply.cnb.cool";
/** 修复提交的标题前缀 —— 也是防连环护栏认的形状。 */
export const FIXUP_SUBJECT_PREFIX = "style(format): ";

/**
 * 委托口的两个事件名。`api_trigger` 前缀是**服务端**的硬要求（`start-build --event`
 * 只认 `api_trigger` 或其前缀，实测 400 `Event must be 'api_trigger' or start with
 * 'api_trigger_'.`）；写成别的形状配置解析期一个字都不报、而那条流水线永远没人能触发。
 *
 * ⚠️ 这一串与 `.cnb.yml` 的事件键**同一个字面量**，两处各有判据：这里由
 * `tests/ci-format-fixup.test.ts` 判 `.cnb.yml` 里真有这个键，那边由
 * `tests/no-platform-ci-config.test.ts` 判前缀形状。改一处不改另一处 = 委托发出去的事件
 * 没人接（`start-build` 照退 0，读数是「起了一条什么都不跑的流水线」）。
 */
export const DELEGATE_EVENT = "api_trigger_formatfix";
/** 委托口自己怎么认出「我是被委托的那一格」—— 由 `.cnb.yml` 显式传 `--delegate`。 */
export const DELEGATE_FLAG = "--delegate";

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
  const entry = fmt.resolveOxfmtEntry();
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
      // oxfmt 默认就是写盘（不带 --check 即写），没有 --cache / --cache-location
      // 这一档（全量 ~1s，缓存键不划算）；分片仍为 50 个一块（Windows 命令行长度上限）。
      [entry, ...chunk],
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
/**
 * 本进制的命令行参数（只认三个，其余一律不认识 —— 多认一个旗标就多一处藏着绕过通道）。
 *
 *   · `--check` / `--autofix`：`AUTOFIX_DUTIES` 登记的那对旗标，本脚本按字面被核对，
 *     语义上不改变任何判断（判 / 修 / 复判的顺序是固定的）；
 *   · `--ref <分支>`：回写目标。**委托口专用** —— 那一刻环境里没有可信的分支名（`CNB_BRANCH`
 *     是流水线所在分支），所以只能由调用方代入；
 *   · `--sha <40 位>`：委托口要求与之相等的**实时**分支头。既是幂等闸（对不上 = 有人推过了），
 *     也是「推给谁」的锚点。
 *
 * @param {readonly string[]} [argv] 默认取 `process.argv.slice(2)`
 * @returns {{delegate: boolean, ref: string, sha: string}}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { delegate: false, ref: "", sha: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === DELEGATE_FLAG) out.delegate = true;
    else if (arg === "--ref") out.ref = String(argv[(i += 1)] ?? "").trim();
    else if (arg === "--sha") out.sha = String(argv[(i += 1)] ?? "").trim();
  }
  return out;
}

/**
 * 委托口（`api_trigger_formatfix`）的回写目标 —— `resolveSourceTarget` 的**另一条分支**。
 *
 * 为什么不能与它并成一份：那一条的两个输入（`CNB_PULL_REQUEST_IID` / `CNB_BRANCH`）在
 * 这一口上恰好都**没有意义** —— 前者无值、后者是「流水线所在分支」（`.cnb.yml` 头注那条
 * 平台语义）。合在一处就会让「哪一步认错了谁」重新变得不可读，而认错一次的后果是推错分支。
 * 所以这里只读 args、只做一件事：把「必须与之相等的实时头」定成 baseSha。
 *
 * @param {{delegate: boolean, ref: string, sha: string}} args {@link parseArgs} 的结论
 * @param {(args: string[], env?: Record<string, string>) => { status: number, stdout: string }} gitFn
 * @returns {{ kind: "ok", branch: string, baseSha: string } | { kind: "error", reason: string }}
 */
export function resolveDelegateTarget(args, gitFn) {
  const { ref, sha } = args;
  if (!ref || !sha) {
    return {
      kind: "error",
      reason:
        "委托口缺 --ref / --sha（回写目标与必须相等的实时头都得由调用方代入）",
    };
  }
  const ls = gitFn(["ls-remote", "origin", `refs/heads/${ref}`]);
  if (ls.status !== 0) {
    return { kind: "error", reason: `ls-remote 失败（exit ${ls.status}）` };
  }
  /* 输出形如 `<sha>\trefs/heads/<ref>`；空输出 = 这条分支在远端不存在。 */
  const live = /^([0-9a-f]{40})\t/.exec(ls.stdout.trim())?.[1] ?? "";
  if (!live) {
    return { kind: "error", reason: `远端没有 refs/heads/${ref}` };
  }
  if (live !== sha) {
    return {
      kind: "error",
      reason:
        `refs/heads/${ref} 的实时头是 ${live.slice(0, 8)}…，而委托时传的是 ${sha.slice(0, 8)}…` +
        " —— 中间有人推过了，这一轮不推（幂等：下一次 prettier 红时会重新委托）",
    };
  }
  return { kind: "ok", branch: ref, baseSha: sha };
}

/**
 * 把回写委托给 `api_trigger_formatfix`（`cnb build start-build`）—— `pull_request` 那一格
 * 唯一的回写路线（见文件头「委托」一节：那类事件的令牌只有 `repo-code:r`）。
 *
 * ⚠️ 三处刻意：
 *   · **`--branch` 是那条流水线要检出的分支**（必须显式给：缺省取主分支，而缺省值正是
 *     「在 master 上跑一遍、判不出目标」的形态），`--sha` 钉在委托那一刻的分支头上，
 *     让被委托那一跑复盘出的就是**判红的同一棵树**；`--env` 把「回写哪条分支、哪张 PR」
 *     原样传下去 —— 被委托那一口的环境里没有可信的等价物（头注事实 ①）；
 *   · **返回码不是结论**：它退非零 ⇒ 委托没发出去（照旧红）；退 0 也**不**说明
 *     「发出去了」—— 403 / scope 不足那一族 cnb 照旧退 0（ISSUE #2378 的现场），
 *     调用方必须用 `buildSnFromOutput()` 回读到 `sn` 才算数（与 `ship-exec.mjs`
 *     那句「退出码 0 不读成写成功」同一条纪律）。回写成功的另一半结论在被委托
 *     那一跑的日志里。把 0 读成「已修好」是本格最贵的误读，所以话术里逐字写明。
 *   · **不起 shell**：`cnb` 在 Windows 上是三个垫片，直接 `spawnSync` 会 ENOENT / EINVAL
 *     （ISSUE #2347 那族）—— 走 `ship-exec.mjs` 的 `cnbSpawn`，它已经解决过同一件事。
 *
 * @param {{slug: string, ref: string, sha: string, iid: string}} params
 * @returns {{ status: number, output: string }}
 */
export function delegatePush(params) {
  const args = [
    "build",
    "start-build",
    "--repo",
    params.slug,
    "--branch",
    params.ref,
  ];
  if (params.sha) args.push("--sha", params.sha);
  args.push(
    "--event",
    DELEGATE_EVENT,
    "--title",
    `format-fixup 委托回写 ${params.ref}`,
  );
  /* 三个环境变量与 `.cnb.yml` 的 `*format_fixup_delegate` 成对：那里读
   * `COMFYAPP_ACTING_REF` / `COMFYAPP_ACTING_SHA` 拼 `--ref` / `--sha`。
   * 名字两边改一处不改另一处 = 委托口拿不到 `--ref`（它没有可信的等价物），
   * 于是被委托那一跑停在「缺 --ref / --sha」而退 1 —— 可读，但白跑一遍。 */
  args.push("--env", `COMFYAPP_ACTING_REF=${params.ref}`);
  if (params.sha) args.push("--env", `COMFYAPP_ACTING_SHA=${params.sha}`);
  if (params.iid) args.push("--env", `COMFYAPP_ACTING_IID=${params.iid}`);
  const inv = cnbSpawn(args);
  if (!inv) {
    return {
      status: -1,
      output: "[format-fixup] × 找不到 cnb 命令 —— 委托发不出去。",
    };
  }
  const r = spawnSync(inv.command, inv.args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { status: r.status ?? 1, output };
}

/**
 * @param {(args: string[], env?: Record<string, string>) => { status: number, stdout: string }} gitFn
 * @returns {{ kind: "ok", branch: string, baseSha: string } | { kind: "error", reason: string }}
 */
export function resolveSourceTarget(gitFn) {
  /* 「哪条口」只有 `CNB_PULL_REQUEST_IID` 能答（它只在 PR 事件上有值）。但要注意：
   * **本地环境里也可能有它**（人导出过、或某个包装脚本带进来），而那种场合
   * 「我不推、替你去发一条 start-build」是错的 —— 委托的目标是平台上的那条流水线，
   * 本地既没有它要的 sha 也没有权限面。所以委托这一支还要求 `platformUser`（本地形态
   * 已经在上面 return 了，这里再点名一次，让「谁有资格委托」不必读者自己推）。 */
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

/** 委托要用到的 repo slug：`CNB_REPO_SLUG` 优先，其次从 `CNB_REPO_URL` 尾段取。 */
function repoSlug(env = process.env) {
  const direct = String(env.CNB_REPO_SLUG ?? "").trim();
  if (direct) return direct;
  const url = String(env.CNB_REPO_URL ?? "").trim();
  const m = /([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m?.[1] ?? "";
}

/** 有没有 slug 可用（没有 = 委托发不出去，主流程据此可读地红）。 */
function delegateSupportsSlug() {
  return repoSlug() !== "";
}

/**
 * `pull_request` 那一格的回写出口：**不推，委托**（文件头「委托」一节）。
 *
 * 退 0 的含义只有一个：**委托发出去了**。回写成没成在那条被委托的流水线上，
 * 这里连一个字节都没推 —— 所以话术里逐字写「不代表已修好」，别让读者把绿读成结论。
 *
 * @param {{
 *   delegate: (params: { slug: string, ref: string, sha: string, iid: string }) => { status: number, output: string },
 *   git: (args: string[], env?: Record<string, string>) => { status: number, stdout: string },
 *   log: (s: string) => void,
 *   PR_number: string,
 *   lines: string[],
 * }} ctx
 * @returns {{ exitCode: number, action: string, lines: string[] }}
 */
function delegateRun(ctx) {
  const { delegate, git, log, PR_number: iid, lines } = ctx;
  const sha = String(process.env.CNB_COMMIT ?? "").trim();
  /* 委托那一刻的分支头就是 `CNB_COMMIT`（PR 事件下它是源分支 head —— 同一个事实让
   * `resolveSourceTarget` 敢用 ls-remote 反查分支名）。缺它就无法钉住「判的是哪棵树」。 */
  if (!sha) {
    log(
      "[format-fixup] × 委托缺 CNB_COMMIT（判不出源分支头）—— 照旧红，不猜目标。",
    );
    return { exitCode: 1, action: "delegate-failed", lines };
  }
  const slug = repoSlug();
  /* 分支名仍由「哪个远端头 = 这个 sha」反查 —— 与直推那一支同一份实现（§12.18）。 */
  const resolved = resolveSourceTarget(git);
  if (resolved.kind !== "ok") {
    log(
      `[format-fixup] × 委托前判不出源分支：${resolved.reason} —— 照旧红（不猜目标）。`,
    );
    return { exitCode: 1, action: "delegate-failed", lines };
  }
  log(
    `[format-fixup] PR #${iid} 这一类事件的令牌只有 repo-code:r（只读）⇒ 不直推，` +
      `委托 ${DELEGATE_EVENT}：${resolved.branch} @ ${sha.slice(0, 8)}…`,
  );
  const r = delegate({ slug, ref: String(resolved.branch), sha, iid });
  if (r.status !== 0) {
    log(
      `[format-fixup] × 委托没发出去（start-build 退出码 ${r.status}）—— 照旧红。`,
    );
    if (r.output) log(`[format-fixup]   平台读数：${r.output.slice(0, 800)}`);
    return { exitCode: 1, action: "delegate-failed", lines };
  }
  /* 退出码 0 不读成「发出去」（ISSUE #2378 的现场：start-build 撞 403 时 cnb
   * 照旧退 0，这一格念着「委托已发出」退 0，工作区留脏、红移到六格之后）。
   * 「发出去」的唯一证据是回读到 `sn`；读不到 ⇒ 按没发出去收（fail-closed）。 */
  const sn = buildSnFromOutput(`${r.output ?? ""}`);
  if (!sn) {
    log(
      "[format-fixup] × start-build 退了 0 但读不回 sn —— 委托没发出去（403 / " +
        "scope 不足那一族），照旧红。修复留在工作区，不冒充「已处理」。",
    );
    if (r.output) log(`[format-fixup]   平台读数：${r.output.slice(0, 800)}`);
    return { exitCode: 1, action: "delegate-failed", lines };
  }
  log(
    "[format-fixup] ✓ 委托已发出 —— 回写发生在那条流水线上，**这一格看见的绿不代表已修好**" +
      "（去看被委托那一跑的读数）。",
  );
  if (r.output) log(`[format-fixup]   平台读数：${r.output.slice(0, 400)}`);
  return { exitCode: 0, action: "delegated", lines };
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
 *   delegate?: (params: { slug: string, ref: string, sha: string, iid: string }) => { status: number, output: string },
 *   args?: { delegate: boolean, ref: string, sha: string },
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
  const args = deps.args ?? parseArgs();
  const delegate = deps.delegate ?? delegatePush;
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
   * 提交，HEAD 的标题不是任何一分支的事实）。不需要分支名，读 sha 就够。
   * 委托口的锚点换成调用方代入的 `--sha`：那一口没有 CNB_COMMIT 可信（它是触发那一刻的
   * 快照），而真正的回写锚点就是 `--sha`。 */
  const guardShaOf = () =>
    args.delegate && args.sha
      ? args.sha
      : String(process.env.CNB_COMMIT ?? "").trim() || null;
  const guardSha = deps.baseSubject !== undefined ? null : guardShaOf();
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
  const entry = fmt.resolveOxfmtEntry();
  if (!entry) {
    /* 与门禁本体同一条 fail-closed：取不到 prettier = 判据没跑成，不是「干净」。 */
    log(
      "[format-fixup] × 找不到 oxfmt 入口 —— 修不了也判不了，转 2（不冒充任何结论）。",
    );
    return { exitCode: 2, action: "no-oxfmt-entry", lines };
  }
  if (!write(files, entry)) {
    log("[format-fixup] × oxfmt 写盘失败 —— 照旧红，不提交不推送。");
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
  const iid = String(process.env.CNB_PULL_REQUEST_IID ?? "").trim();
  /* 这两条口的分工只有一处出处：文件头「委托」一节。
   *   · `--delegate`（`api_trigger_formatfix` 那一格）⇒ **它就是回写口**，自己推；
   *   · PR 事件 ⇒ 令牌只有 `repo-code:r`，不推 —— 委托给上面那一条；
   *   · `push` 事件 ⇒ 令牌 `rw`，与委托口同一套直推。 */
  if (iid && platformUser && !args.delegate) {
    if (!delegateSupportsSlug()) {
      log(
        "[format-fixup] × 委托发不出去：CNB_REPO_SLUG / CNB_REPO_URL 都不在场（判不出 repo）。\n" +
          "[format-fixup]   本地想验证这一支：直接把工作区 prettier --write 一遍即可 —— " +
          "回写只在平台上发生。",
      );
      return { exitCode: 1, action: "delegate-failed", lines };
    }
    return delegateRun({ delegate, git, log, PR_number: iid, lines });
  }

  /* 回写目标 = **源分支**。两条口各有一份解析器（理由见 resolveDelegateTarget 的头注）：
   * 委托口只认 `--ref` / `--sha`，PR / push 口才读那两个环境变量。
   * ⚠️ `args.delegate` 排在 `deps.resolveSource` **之前**：委托口的目标只能来自参数，
   * 而 `resolveSource` 是「PR / push 口那份」的注入点 —— 合成一处会让「哪条口认了什么」
   * 重新变得不可读（认错一次的后果是推错分支）。 */
  const target = args.delegate
    ? resolveDelegateTarget(args, git)
    : deps.resolveSource
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
  /* 防连环：baseSubject 在编排开头已按「源分支头」取好（委托口 = `--sha`）。 */
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
  /* 推的时候把期望头钉在 baseSha 上（`--force-with-lease` 的语义）：幂等闸判过之后
   * 若又有人推了一笔，这里会被拒而不是把人家那笔盖掉。 */
  const push = git([
    "push",
    `--force-with-lease=refs/heads/${branch}:${baseSha}`,
    "origin",
    `${fixSha}:refs/heads/${branch}`,
  ]);
  if (push.status !== 0) {
    log(
      `[format-fixup] × push 被拒（${fixSha.slice(0, 8)}… → refs/heads/${branch}）—— ` +
        "修复留在工作区但没有落回分支。\n" +
        "[format-fixup]   常见成因：令牌 scope 不够（PR 类事件恒只有 repo-code:r ⇒ 那一口" +
        "必须走委托，见文件头「委托」），或期间有人推过（lease 保护）。\n" +
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
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const r = runFormatFixup({ args: parseArgs() });
  for (const line of r.lines) process.stdout.write(`${line}\n`);
  process.exit(r.exitCode);
}
