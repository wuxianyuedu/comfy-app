#!/usr/bin/env node
/**
 * ci-workspace-provenance.mjs — 「这一跑跑的是**哪份源码**、工作区被**谁**写脏过」的自证档。
 *
 * ## 为什么现在就要这一档（ISSUE #2022）
 *
 * 这条路径上「热态」的真正门槛不是缓存技术，是**稳定的工作区**：`node_modules` 之外的那
 * 三格（`tsconfig.tsbuildinfo`、`node_modules/.cache/eslint`、`.next`）的键里都带着**绝对
 * 路径**，而 runner 每个作业新建一个带流水线 id 的目录（形态由 `工作区复用读数` 定死：
 * `…\cnb-<id>-001~<rand>\workspace`，作业结束 `Remove-Item` 删掉）。路径每跑都换 ⇒ 缓存
 * 逐条 miss ⇒ 只有把树常驻下来才热得起来。
 *
 * 而「常驻」一词在评审桌上天然带着一个反问：**这棵树凭什么是可信的**。本仓对这句话的
 * 回答口径一直是「环境必须是可见的」（`镜像身份` 那一档存在的全部理由，见 §13.5.3.4.1.2
 * 末段），所以这一步的次序是：**先做出处判据，再谈常驻目录**。这一档今天跑在 ephemeral
 * 工作区上，② 那一格就已经有牙（见下）；等树常驻了，它就是「这棵树干净且就是声明的那一份」
 * 那句承诺的唯一执行者。
 *
 * ## 判的三格，以及每一格凭什么判成红或判成读数
 *
 * | 那一格 | 结论档位 | 为什么是这个档 |
 * | --- | --- | --- |
 * | ① `HEAD` 是不是平台声明的那份提交（`CNB_COMMIT`） | **判红**（拿不到声明时退成「未校验」，不红） | 「跑的是哪份源码」不可追时，后面所有门禁的结论都不属于这次 PR —— 那是本仓最不能有的形态。而「不知道」不等于「不一致」：拿不到 `CNB_COMMIT` 时打红会把平台的注入问题变成 PR 的缺陷 |
 * | ② tracked 面上出现的改动，是不是**登记过的写者**干的 | **判红** | 会自己改工作区的档只许是 `AUTOFIX_DUTIES` 里那几档（唯一出处在 `scripts/ci-autofix-duties.mjs`，本文件从它派生允许名单，**不另抄一份前缀**）。出现名单外的 tracked 改动 = 有一档门禁改了**要提交的源码面**却没人登记过 —— 今天它也可能是「autofix 之外谁动了文件」，而那种事一旦发生，`docs/**` 的产物与源就开始各说各话 |
 * | ③ 冒出来的未跟踪文件（`.gitignore` 之外的） | **读数**，不判红 | 此刻的形态里它应当恒空，一条恒真的断言不是判据而是装饰（它只会教会人忽略红）。等树常驻，这一格升级为判据：常驻树上多出一份未登记的未跟踪文件，正是「上一个作业留下的东西被下一个作业当事实」的第一现场。现在先取数，是为了让那一次升级有对照可查 |
 *
 * ## 为什么不顺手把「热态」那一格也做了
 *
 * 因为它是**动作**而不是判定：建缓存槽、拿锁、`git clone` 到槽里、`mklink /J` 把
 * `node_modules` 联过去。三格实测已经把它的前提钉住（穿过 junction 从零装会得到一份
 * 「同一份声明经两条路径解析成两个身份」的坏树，`tsc` 当场红 `TS2339 children`；
 * 而 runner 收尾那句 `Remove-Item -Recurse -Force` 实测**不穿链**），那些落在
 * `ci-workspace-cache.mjs`，与本档分开：本档出错要拦下这次 PR，缓存出错只该退回正常安装。
 *
 * ## 退出码与账本
 *
 * 退出码：② 或 ① 命中 ⇒ 1，其余 ⇒ 0。账本追加在 `工作区复用读数` **同一个目录**下
 * （`ledgerRoot()`，跨检出存活），留最近若干条 —— 「这一格以前是不是从没红过」这件事
 * 只有历史能答，而单次观测猜不出来（同 §13.5.3.4.1 那条口径）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AUTOFIX_DUTIES } from "./ci-autofix-duties.mjs";
import {
  jobLabel,
  ledgerRoot,
  readLedger,
  run as defaultRun,
  writeLedger,
} from "./ci-workspace-probe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 本档的账文件名（与 `comfyapp-ci-workspace-probe.json` 同目录、不同本）。 */
export const LEDGER_FILE = "comfyapp-ci-workspace-provenance.json";
/**
 * 平台注入的「这次要跑哪份提交」—— 按事件形态取第一个非空者，全取不到就走「未校验」。
 *
 * 顺序是这条判据的**内容**而不是风格问题（§13.5.3.4.2 第二跑那段早就记过这件事，本档
 * 第一次上线却把它犯了）：`pull_request` 事件上工作区的 HEAD 是一枚**临时合并提交**
 * （源 head 合上 target 当时的事实），它逐字**不等于** `CNB_COMMIT`（那是源分支 head）。
 * 只拿 `CNB_COMMIT` 去断言 ⇒ 每一跑 PR 都假红，而假红会教会所有人绕过这一档 ——
 * 比没有判据更坏。实测：本档前两条构建（`cnb-bkm-1k59gdkro` / `cnb-7rd-1k59j1mc4`）
 * 各红在此，两次 HEAD 互不相同（`7776cc6bfb1f` / `aa0a02578300`）且都不在任何远程引用上。
 *
 * 于是三层：先按 merge 面对（PR 事件的正解）→ 再按源 head 面（push / 分支事件）→
 * 都不等时问「**含不含**」（祖先关系），那才是「这一跑有没有跑到这份码」这句话本身。
 */
export const DECLARED_SHA_ENVS = ["CNB_PULL_REQUEST_MERGE_SHA", "CNB_COMMIT"];

/**
 * 被登记为「会写工作区」的路径前缀 —— **从 `AUTOFIX_DUTIES` 派生**，不在这里重抄。
 *
 * 抄一份的后果是具体的：给一档门禁加自动修时，人改的是登记表（那一档的判据会核对配置
 * 里的 `--autofix`），而忘了改这里 ⇒ 它写出的产物被本档判成「未登记的写者」。两处各说各话
 * 里错的那一侧永远是自己。
/**
 * 一条「会写工作区」的登记里，本档只用到 `stage` 与 `outputs` 两格。
 *
 * 写成结构类型而不是直接import `AutofixDuty`：判据的夹具只需要给它真正关心的那两格，
 * 要求补齐 `entry` / `args` / `why` 等于让用例去伪造与本格无关的事实（那类字段一改，
 * 用例就成片红在无关处）。现役那份 `AUTOFIX_DUTIES` 是它的超集，结构上可直接代入。
 *
 * @typedef {{stage: string, outputs?: readonly string[]}} WriterDuty
 */

/**
 * 前缀派生。**只声明用到那一格**（`outputs`），不把整份 `AutofixDuty` 当参数类型：
 * 这一层的职责是「从登记处取前缀」，要求调用点补齐 `entry` / `args` / `why` 等于让
 * 判据的夹具去伪造无关的事实。
 *
 * @param {ReadonlyArray<WriterDuty>} [duties]
 * @returns {string[]} 仓库相对、正斜杠、以 `/` 结尾的前缀
 */
export function writerPrefixes(duties = AUTOFIX_DUTIES) {
  const out = [];
  for (const duty of duties) {
    for (const prefix of duty.outputs ?? []) out.push(prefix);
  }
  return [...new Set(out)];
}

/**
 * 一个仓库相对路径是否落在登记过的写者前缀下。
 *
 * 路径形态不做归一化：`git status` 一律输出正斜杠（反斜杠那一份是 Windows API 的事，
 * 不是它的），在这里写一条 `replace(/\\\\/g, "/")` 是「为不可能发生的形状加处理」，
 * 而那类代码的本领正是让自己永远不被测到。
 *
 * @param {string} file 仓库相对的改动路径
 * @param {string[]} prefixes `writerPrefixes()` 给的那份名单
 * @returns {boolean}
 */
export function underWriter(file, prefixes) {
  return prefixes.some(
    (p) => file === p.replace(/\/$/, "") || file.startsWith(p),
  );
}

/**
 * 解析 `git status --porcelain -z` 的记录。
 *
 * 为什么走 `-z` 而不是按行切：路径里出现换行或空格时按行切会把一条记录读成两条，
 * 而这一档要的恰恰是「一条都不漏」（漏掉的那条正是没被点名的写者）。重命名/复制是
 * `XY new\0orig` 双段形态，只认 `new`（被改动的结果是它，原判据也按结果面判）。
 *
 * @param {string} raw
 * @returns {{trackedDirty: string[], untracked: string[]}}
 */
export function parseStatus(raw) {
  const records = raw.split("\0").filter((s) => s !== "");
  const trackedDirty = [];
  const untracked = [];
  for (let i = 0; i < records.length; i++) {
    /* 上面的 filter 已经保证非空，`?? ""` 只是 `noUncheckedIndexedAccess` 的惯用法，
     * 不另开一条「空记录」分支 —— 那条在本档里永远跑不到，写了就是不可测的枝。 */
    const entry = records[i] ?? "";
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    /* 重命名 / 复制是 `R  new\0orig` 与 `C  new\0orig`：`XY` 两个字符里任一个可能是
     * 那个字母（`R ` 暂存、` R` 未暂存、`D R` 之类），所以按「含 R/C」判而不是等值比。
     * 源路径那一段不需要 —— 要登记的是**结果**（被改动的面是它，判据也按结果面判）。 */
    if (xy.includes("R") || xy.includes("C")) i++;
    if (xy === "??") untracked.push(file);
    else trackedDirty.push(file);
  }
  return { trackedDirty, untracked };
}

/**
 * 三格判定。**纯函数**：不碰 fs、不碰 git，全部输入由调用方给（判据据此能注入夹具）。
 *
 * 出处那一格问的是「**这一跑有没有含这次事件声明的那份源码**」，不是「HEAD 逐字等于
 * 它」—— 平台对 `pull_request` 事件检出的是一枚**临时合并提交**（head 合上 target 当时
 * 的样子），它本来就不等于任何推送出去的 SHA，也不在任何引用上。实测（ISSUE #2022）：
 * 本档第一次上线就连着两跑红在这一格，两次的 HEAD 各不相同（`7776cc6bfb1f` /
 * `aa0a02578300`）而声明面分别是 `202c7524` / `c87f48c7`，两个 HEAD 都取不到于任何
 * 远程引用 —— 逐字相等是一个从一开始就不成立的形状。
 *
 * 所以三档：相等 ⇒ ok；声明 SHA 是 HEAD 的祖先 ⇒ ok 并把父提交与树一起打出来（这才是
 * 「跑的是这份码 + master」的证据）；都不是 ⇒ 红（跑错源码 / 陈旧工作区）。祖先关系
 * **算不出来**（声明对象在本检出里取不到）⇒ 未校验 —— 拿不到测量不等于测量结果是红。
 *
 * @param {{declared?: string | null, declaredFrom?: string | null, head?: string | null, contains?: boolean | null, shape?: {parents: string[], tree: string | null}, trackedDirty: string[], untracked: string[], prefixes: string[]}} input
 * @returns {{red: boolean, lines: string[], offenders: string[]}}
 */
export function provenanceVerdict(input) {
  const {
    declared,
    declaredFrom = DECLARED_SHA_ENVS[0],
    head,
    contains = null,
    shape = { parents: [], tree: null },
    trackedDirty,
    untracked,
    prefixes,
  } = input;
  const lines = [];
  let red = false;

  /** @param {string | null | undefined} s */
  const norm = (s) => (s ?? "").trim().toLowerCase().slice(0, 12);
  const want = norm(declared);
  const have = norm(head);
  const shapeReadout =
    `父提交 ${shape.parents.length} 个（${shape.parents.slice(0, 3).join(" ") || "无 —— 根提交"}）` +
    `·树 ${norm(shape.tree) || "取不到"}`;
  if (!want || !have) {
    lines.push(
      `出处·未校验 声明 SHA=${want || "拿不到"} / HEAD=${have || "拿不到"} —— ` +
        `「不知道」不等于「不一致」，也不等于「一致」`,
    );
  } else if (want === have) {
    lines.push(
      `出处·ok HEAD == ${have}（就是 ${declaredFrom} 声明的那一份）·${shapeReadout}`,
    );
  } else if (contains === true) {
    lines.push(
      `出处·ok HEAD=${have} **含**声明的那一份 ${want}` +
        `（来自 ${declaredFrom} ⇒ 这一跑确实跑到了这份码；它为何不等于该 SHA 看同一行的形状）` +
        `·${shapeReadout}`,
    );
  } else if (contains === null) {
    lines.push(
      `出处·未校验 HEAD=${have} ≠ 声明的 ${want}，而祖先关系算不出来` +
        `（声明对象在本检出里取不到）——${shapeReadout}`,
    );
  } else {
    red = true;
    lines.push(
      `出处·红 HEAD=${have} 既不是声明的 ${want}，也**不含**它 ⇒ 这一跑的树里没有这份码` +
        `（形态上指向工作区陈旧 / 被复用 / 检出错分支，但本档只判「含不含」，不替它认原因）` +
        `·${shapeReadout}`,
    );
  }

  const offenders = trackedDirty.filter((f) => !underWriter(f, prefixes));
  if (offenders.length > 0) {
    red = true;
    lines.push(
      `写脏·红 ${offenders.length} 处 tracked 改动不在登记过的写者名单里：` +
        offenders.slice(0, 10).join(", ") +
        (offenders.length > 10 ? ` …另 ${offenders.length - 10} 处` : ""),
    );
    lines.push(
      `  允许名单（派生自 AUTOFIX_DUTIES 的 outputs）：${prefixes.join(", ") || "（空）"}`,
    );
  } else if (trackedDirty.length > 0) {
    lines.push(
      `写脏·ok ${trackedDirty.length} 处 tracked 改动，全部落在登记过的写者前缀下`,
    );
  } else {
    lines.push("写脏·ok tracked 面干净");
  }

  /* ③ 读数档：恒空的断言不是判据。先取数，等常驻树落地再升级（见文件头那张表）。 */
  lines.push(
    untracked.length > 0
      ? `未跟踪·读数 ${untracked.length} 处（.gitignore 之外）：${untracked.slice(0, 8).join(", ")}` +
          `${untracked.length > 8 ? ` …另 ${untracked.length - 8} 处` : ""}`
      : "未跟踪·读数 0 处",
  );

  return { red, lines, offenders };
}

/**
 * 注入面的两个形状（用例据此给假的进来，不碰真 git、不碰真盘）。
 *
 * `SpawnLike` 只声明本档用到的三格而不是 `SpawnSyncReturns`：把 `pid` / `output` /
 * `signal` 一起要进来，用例的替身就得伪造四个与判定无关的字段，那正是「注入面写成
 * `typeof fs`」那一格的同一个病（见 `ci-workspace-probe.mjs` 里 `FsLike` 那段）。
 *
 * @typedef {{status: number | null, stdout?: string | null, error?: {message?: string}}} SpawnLike
 * @typedef {(cmd: string, args: string[], options: {cwd: string, encoding: "utf8", windowsHide: boolean}) => SpawnLike} SpawnFn
 * @typedef {(cmd: string, args: string[], options?: {cwd?: string}) => {ok: boolean, out: string}} RunFn
 */

/**
 * `git status --porcelain -z` 的**原样** stdout。
 *
 * 为什么不复用 `ci-workspace-probe.mjs` 那个 `run()`：它按「读一句话」的形态把
 * stdout+stderr 一起 `trim()` 了 —— 而 `-z` 的第一条记录**以空格开头**（未暂存修改的
 * `XY` 是 `" M"`），trim 会把那个空格连同 `X` 一起削掉，于是第一条记录的路径**少一个字符**
 * （实测 `scripts/…` 读成 `cripts/…`，前缀比对当场失效）。这一档要的正是「一条不漏、一字
 * 不错」，错的那一条恰好是名单外的那个写者。`rev-parse` 那一格照旧用会 trim 的 `run()`。
 *
 * @param {string} cwd
 * @param {SpawnFn} [spawn]
 * @returns {string | null} `null` = 没跑起来（调用方按「未校验」办，不冒充「干净」）
 */
function gitStatus(cwd, spawn = defaultSpawn) {
  const r = spawn("git", ["status", "--porcelain", "-z"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout ?? "");
}

/** 默认注入点：`spawnSync` 本身，返回值结构上满足 `SpawnLike`。 @type {SpawnFn} */
function defaultSpawn(cmd, args, options) {
  return spawnSync(cmd, args, options);
}

/** @param {string} cwd @param {RunFn} runCmd @returns {string | null} */
function headSha(cwd, runCmd) {
  const r = runCmd("git", ["rev-parse", "HEAD"], { cwd });
  return r.ok ? r.out : null;
}

/**
 * 声明的那一份是不是 HEAD 的祖先？三值：`true` / `false` / `null`（算不出来）。
 *
 * 先单独验对象在不在：`merge-base --is-ancestor` 对「不存在的对象」与「存在但不是祖先」
 * 都退非零，直接把它的退出码当结论会把**取不到测量**读成**测量结果为假**（本仓反复钉的
 * 那一类静默失效，见 §13.6.4.1）。
 *
 * @param {string} cwd @param {string | null} declared @param {RunFn} runCmd
 * @returns {boolean | null}
 */
function declaredContainedInHead(cwd, declared, runCmd) {
  const sha = (declared ?? "").trim();
  if (!sha) return null;
  const exists = runCmd(
    "git",
    ["rev-parse", "--verify", "--quiet", `${sha}^0`],
    {
      cwd,
    },
  );
  if (!exists.ok) return null;
  return runCmd("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
    cwd,
  }).ok;
}

/** HEAD 的形状：父提交列表 + 树。只作读数（红不红由上面那三档定）。
 * @param {string} cwd @param {RunFn} runCmd @returns {{parents: string[], tree: string | null}} */
function headShape(cwd, runCmd) {
  const p = runCmd("git", ["log", "-1", "--format=%P", "HEAD"], { cwd });
  const t = runCmd("git", ["log", "-1", "--format=%T", "HEAD"], { cwd });
  return {
    parents: p.ok ? p.out.split(/\s+/).filter(Boolean) : [],
    tree: t.ok ? t.out : null,
  };
}

/**
 * 入口：判 + 打 + 记账。
 *
 * @param {{cwd?: string, env?: Record<string, string | undefined>, run?: RunFn, spawn?: SpawnFn, readJunit?: (file: string, enc: string) => string, ledgerDir?: string, nowMs?: number}} [io]
 * @returns {number} 退出码
 */
export function main(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const env = io.env ?? process.env;
  const runCmd = io.run ?? defaultRun;
  const prefixes = writerPrefixes();

  const status = gitStatus(cwd, io.spawn);
  const parsed =
    status === null ? { trackedDirty: [], untracked: [] } : parseStatus(status);
  /* 按形态取第一个非空者（顺序的理由见 `DECLARED_SHA_ENVS` 那段）：PR 事件先认 merge 面，
   * push / 每日档没有那个键 ⇒ 退回源 head。 */
  const declaredFrom =
    DECLARED_SHA_ENVS.find((key) => (env[key] ?? "").trim() !== "") ?? null;
  /** @type {string | null} */
  const declared = declaredFrom ? (env[declaredFrom] ?? null) : null;
  const head = headSha(cwd, runCmd);
  const verdict = provenanceVerdict({
    declared,
    declaredFrom,
    head,
    contains: declaredContainedInHead(cwd, declared, runCmd),
    shape: headShape(cwd, runCmd),
    trackedDirty: parsed.trackedDirty,
    untracked: parsed.untracked,
    prefixes,
  });

  /* `git status` 自己没跑起来：三格全部失去依据，按「未校验」说出口，不冒充结论。 */
  if (status === null) {
    verdict.lines.unshift(
      "出处·未校验 `git status --porcelain -z` 没跑起来 —— 本档没有结论",
    );
  }

  for (const line of verdict.lines)
    process.stdout.write(`[工作区出处] ${line}\n`);

  const file = path.join(io.ledgerDir ?? ledgerRoot(env), LEDGER_FILE);
  try {
    writeLedger(file, {
      at: new Date(io.nowMs ?? Date.now()).toISOString(),
      job: jobLabel(cwd),
      red: verdict.red,
      offenders: verdict.offenders.length,
      untracked: parsed.untracked.length,
    });
  } catch {
    /* 账本写不动不影响判定（它只在红的时候承重：那时行号与名单都已经在正文里）。 */
    process.stdout.write("[工作区出处] 账本没能落盘（不影响上面那条结论）\n");
  }
  const history = readLedger(file);
  process.stdout.write(
    `[工作区出处] 跨构建对照：账本里 ${history.length} 条，本档第一次红会在这里看得见形态\n`,
  );

  return verdict.red ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
