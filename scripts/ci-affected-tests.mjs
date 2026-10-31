#!/usr/bin/env node
/**
 * ci-affected-tests.mjs — 「受影响用例」在**平台侧**的执行入口（跑法脚本）。
 *
 * ── 这一格是哪来的（2026-10-20）────────────────────────────────────────
 *
 * 「固定清单 + 受影响用例」这一档原本有两个本地执行者：`.githooks/pre-commit` 的
 * C 组，与 2026-10-19 从那里搬来的 `.githooks/pre-push`（`premerge-check.mjs` 的
 * `unitTests` 段）。两个都被撤了，合成这一格 —— 原因不是「想省本地时间」，是
 * **本地这一跳在最需要它给出结论的机器上给的恰是最不可信的读数**：
 *
 *   它会起 vitest 子进程，而共享机（另一条检出并发推自己的分支 + 多个 dev server
 *   抢核）上的失效形态不是用例红，是 `Failed to start forks worker /
 *   Timeout waiting for worker to respond`。实测：pre-push 的那一档被这种调度超时
 *   拦下，隔离复跑 88 个用例文件 / 1116 条**全绿** —— 也就是说拦与放都和代码无关。
 *
 * 判决链一个字没改：本脚本只做三件事（算改动面 → 起 `run-affected-tests.mjs` →
 * 把退出码转出去），判据与启动逻辑仍是那一份（§12.18 / §12.12：不发明第二套编排）。
 *
 * ── 四件口径，都与既有机制逐字同源 ─────────────────────────────────────
 *
 *   ① **改动面**：PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`（官方
 *      `build-in-env.md`；`.cnb.yml` 的分支守卫一格早已在用同一族变量），按
 *      **三点** diff（`<target>...HEAD` = 与目标的 merge-base 之差，正是「这个 PR
 *      改了什么」）取改动清单。读法 `--name-status -M`：改名的 **R 行两侧都进面**
 *      （只给新路径时，按旧路径读文件的用例会随改名整条漏跑，ISSUE #2226）。没有它
 *      （非 PR 事件 / 手工触发）时退回 `<remote>/master` 或本地 `master` 的
 *      merge-base 两点 diff —— 与撤掉的 `premerge-check.mjs#pushBatchFiles` 同一个口径。
 *   ② **拿不到改动面 ⇒ 退 2**，不是退 0：这一格没判 = 没有证据（§13.6.2）。
 *      清单为空（diff 为空）同样退 2 —— 空清单若放行，`vitest run` 会跑成全量，
 *      而「全量绿」在 PR 这一跳上是被 §13.5.21 明确否掉的那个读数。
 *   ③ **并发按现场核数收敛**：`scripts/ci-load.mjs` 的 `resolveCiWorkers()`
 *      （§13.5.21 的唯一出处）折算后经 `COMFY_PRECOMMIT_MAX_WORKERS` 交给启动器 ——
 *      这个变量只调并发、不碰任何判据（`resolveMaxWorkers()` 的注释写明）。
 *      超时形态的「等待负载回落 → 隔离复跑 → 仍超时则点名未校验」话术仍由
 *      `run-affected-tests.mjs` 自己负责，本脚本不重写一遍。
 *   ④ **分文件读数的落点由本脚本造**（ISSUE #2074）：`$LOGD` 此前只有钩子 export，
 *      所以平台这一格从来不写 junit ⇒ 超时形态的复跑永远退回整块串行，而「清单 ⇄
 *      实到」的对账根本没做成。现在这里造一份同布局的目录（`makeLedgerDir`），
 *      经 `LOGD` 交给子进程，跑完删掉；收尾那行复述会念出「分文件读数 N 份」——
 *      「第一遍到底有没有写出读数」从日志读得回来。造不出来时**明说退回整块**，
 *      而不是让那 170s 长得像一次普通的复跑原因。
 *
 * 退出码与 `base-check` / `premerge` 逐字同口径：0 全绿（或未校验但已点名）/
 * 1 有档红 / 2 没跑起来。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { resolveChangedFiles } from "./changed-scope.mjs";
import { resolveCiWorkers } from "./ci-load.mjs";
import { describeWorktreeDeps, worktreeDepsProblem } from "./ci-worktree-deps.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";

/* 「改动面怎么算」那一跳已经搬进 `scripts/changed-scope.mjs` —— 桌面壳门禁
 * （`scripts/shell-gate.mjs` 的 `--base` 形态）也要问同一个问题，两边各算一次
 * 就会在某一次改动里漂开（改名的旧路径算不算？三点 diff 还是两点？）。
 * 这里是**转出**，不是复制一份实现（§12.12 / §12.18）。 */
export { resolveChangedFiles };

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 造一份**这一次跑**的分文件读数目录（与钩子 `$LOGD` 同一个布局）。
 *
 * 为什么平台这一格也要有：`run-affected-tests.mjs` 只在「账本目录存在」时才让 vitest
 * 写 junit，而 junit 是**复跑面**（只重跑失败的那几份）与「清单 ⇄ 实到」对账的唯一
 * 来源。此前 `LOGD` 只由钩子 export，平台这一格一个都没有 ⇒ 超时形态的复跑永远退化成
 * 整块串行（实测 170~178s，买不到任何新证据），而对账那一格根本没做成（ISSUE #2074）。
 *
 * 落点选**仓库内**的 `node_modules/.cache/`（已被 gitignore、随 job 目录一起消失），
 * 与 `full-suite-run.mjs` 同一条理由：宿主是 PowerShell，`--outputFile.junit=C:\…`
 * 那种「破折号 + `=` + 值里带冒号」会在第一个冒号处被切成两个参数（§13.5.8.3）。
 * 造不出来就回 `null`：这一跑照旧，只是退回整块复跑 —— 调用点会把它**说出口**，
 * 「拿不到测量」不许长得像「没有这一格」。
 *
 * @param {string} [root] 检出根（用例注入临时根，不碰真 repo）
 * @returns {string | null}
 */
export function makeLedgerDir(root = ROOT) {
  try {
    const cache = path.join(root, "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    return mkdtempSync(path.join(cache, "comfy-affected-"));
  } catch {
    return null;
  }
}

/**
 * 账本里这一跑写出了几份 junit。
 *
 * 读不到回 `null`（「取不到」），**不是 0** —— 0 份是一个可读的结论（这一遍没写出读数），
 * 而读不到目录说明这一跑压根没有落点（§13.6.4.1 那条「拿不到测量 ≠ 测量结果是 0」）。
 *
 * @param {string} dir
 * @returns {number | null}
 */
function countJunitFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".xml")).length;
  } catch {
    return null;
  }
}

/**
 * 这一次要判的改动面（仓库相对路径清单）。
 *
 * 实现搬进 `scripts/changed-scope.mjs`（桌面壳门禁共用同一份口径）；这里保留
 * 它的转出，调用方的形状与行为一字未变。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, files: string[], renamedFrom: string[], via: string} | {ok: false, reason: string}}
 */

/**
 * 主流程。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null, spawn?: (script: string, env: NodeJS.ProcessEnv) => {status: number}, writeOut?: (text: string) => void, writeErr?: (text: string) => void, installed?: boolean, ledgerDir?: string | null, makeLedgerDir?: () => string | null}} [deps]
 *   `ledgerDir` / `makeLedgerDir` 是账本目录的注入面（用例给临时目录、或显式 `null`
 *   表示这条用例不关心账本）；不注入就自己造一份，跑完删掉 —— 见 `makeLedgerDir`。
 *   `installed` 是依赖面体检的输入（`node_modules/.modules.yaml` 在不在）。注入面是给
 *   单测的：判据本身不读盘（读盘那一句在下面一行，缺省就地读），而**「读没读到」不许
 *   被用例进程自己那棵树解释掉**（§11.17 那条「判据与宿主绑死」的同族）。
 * @returns {number} 退出码（0 / 1 / 2，与 base-check、premerge 同口径）
 */
export function main(deps = {}) {
  const env = deps.env ?? process.env;
  /* 依赖面那两道体检（`ci-worktree-deps.mjs` 的头注记着它补的是哪一格）：
   * 依赖没装上时 `vitest` 起不来，输出是几条 `Error:` 加一段 `AggregateError`，
   * 退出码非零 —— 于是一个**前提不成立**的环境被读成「这次改动有回归」。
   * 这里把它分开：前提不成立 ⇒ 退 2（没判 ≠ 绿），并说出下一动作。
   * 判据与 `ci-install-deps.mjs` / 启动器同一份口径（`pnpm` 自己写的
   * `node_modules/.modules.yaml`），不是「目录在不在」。 */
  const installed = deps.installed ?? existsSync(path.join(ROOT, "node_modules", ".modules.yaml"));
  /** 两件读数走可注入的通道 —— 平台截日志后要能在**尾部**读到它们（ISSUE #2317）。 */
  const writeOut = deps.writeOut ?? ((t) => process.stdout.write(t));
  const writeErr = deps.writeErr ?? ((t) => process.stderr.write(t));
  /* 依赖面那两道体检的输出也走同一对通道：`main` 里**不许有第二个写 stdout 的出口**，
   * 否则「平台截日志后尾部还读得到什么」会因为注入面覆盖不到而少一半。 */
  const depsReadout = worktreeDepsProblem({ installed, env });
  const depsText = describeWorktreeDeps(depsReadout);
  if (!depsReadout.ok) {
    writeErr(depsText);
    return 2;
  }
  writeOut(depsText);
  const changed = resolveChangedFiles(deps);
  if (!changed.ok) {
    writeErr(`[ci-affected] ✗ ${changed.reason}（退 2 —— 这一格没判，不构成证据）\n`);
    return 2;
  }
  if (changed.files.length === 0) {
    writeErr(
      `[ci-affected] ✗ 改动面为空（${changed.via}）—— 退 2。空清单若放行，` +
        "启动器会把 vitest 跑成全量，而全量绿在 PR 这一跳上是被 §13.5.21 否掉的读数。\n",
    );
    return 2;
  }
  const { workers, cores, source } = resolveCiWorkers({ env });
  writeOut(
    `[ci-affected] 改动面：${changed.files.length} 个文件（${changed.via}）；` +
      `并发 --maxWorkers=${workers}（${cores} 核，${source}）\n`,
  );
  if (changed.renamedFrom.length > 0) {
    writeOut(
      `[ci-affected] 其中 ${changed.renamedFrom.length} 处是改名：旧路径也进了改动面` +
        `（${changed.renamedFrom.join(" ")}）—— 按旧路径引用那个文件的用例靠这一条才选得中\n`,
    );
  }
  /* 分文件读数目录（ISSUE #2074）：不造它，`run-affected-tests.mjs` 就不会让 vitest
   * 写 junit ⇒ 超时形态的复跑面每次都退回整块串行、「清单 ⇄ 实到」对账也没做成。
   * 造不出来不阻断（档位不变），但必须说出口 —— 那一跑的代价与对账面都变了。 */
  const ownLedger = deps.ledgerDir === undefined;
  const ledgerDir = ownLedger
    ? (deps.makeLedgerDir ?? (() => makeLedgerDir(ROOT)))()
    : deps.ledgerDir;
  if (ledgerDir) {
    writeOut(`[ci-affected] 分文件读数落点 ${ledgerDir}（junit + 清单；随本次跑清理）\n`);
  } else {
    writeErr(
      "[ci-affected] ⚠ 造不出分文件读数目录 ⇒ 这一跑没有 junit：" +
        "超时形态的复跑会退回整块串行（档位不受影响，代价与对账面受影响）\n",
    );
  }
  const spawn =
    deps.spawn ??
    ((/** @type {string} */ script, /** @type {NodeJS.ProcessEnv} */ e) => {
      const r = spawnSync(process.execPath, [script], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...e, CI: "1" },
      });
      return { status: typeof r.status === "number" ? r.status : 2 };
    });
  /* 子进程 env：以进程环境为底，补三件（改动面 + 并发 + 分文件读数落点），注入的 env
   * 覆盖同名项。`LOGD` 那一格**显式写空串**：没有落点时若只做「不加这个键」，从进程环境
   * 继承来的旧 `LOGD`（钩子 export 的那份）会漏进子进程，读数就落去一个这一跑不知道的目录。
   * （.mjs 里写不了 `as`，收窄成 ProcessEnv 用 JSDoc 声明 —— spawnSync 的形参要它。） */
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {
    ...process.env,
    ...env,
    ...(ledgerDir ? { LOGD: ledgerDir } : { LOGD: "" }),
    COMFY_AFFECTED_CHANGED: changed.files.join("\n"),
    COMFY_PRECOMMIT_MAX_WORKERS: String(workers),
  };
  /** 这一跑写出的 junit 份数（收尾读数；`null` = 取不到）。 */
  let junitCount = null;
  /* 跑完就清账本（注入目录时由用例自己清）—— 收尾读数必须在删之前取，所以清理挂在
   * `finally` 里、计数写在里面。 */
  const r = (() => {
    try {
      return spawn(path.join(HERE, "run-affected-tests.mjs"), childEnv);
    } finally {
      if (ledgerDir) {
        junitCount = countJunitFiles(ledgerDir);
      }
      if (ownLedger && ledgerDir) {
        rmSync(ledgerDir, { recursive: true, force: true });
      }
    }
  })();
  /* 同一件读数在**收尾**再念一次：平台会把超长的 stage 日志截掉中间偏前那一段
   * （实测某跑的日志第 2 行就是 `The log length exceeds the limit(102400)`），
   * 而上面那行打在开头 —— 正好落在被截掉的那一段里，于是「这一跑开了几个并发」
   * 在页面上根本读不回来（ISSUE #2317）。只补一行转述，不改退码。 */
  writeErr(
    `[ci-affected] 收尾复述：并发 --maxWorkers=${workers}（${cores} 核，${source}）` +
      `· 子进程原值退出码 ${r.status}· 分文件读数 ` +
      `${junitCount === null ? (ledgerDir ? "取不到" : "没有落点") : `${junitCount} 份`}\n`,
  );
  /* 原值透传，**不改写**（三档：0 通过/已确认全是超时，1 真红，2 未判定）。
   * 平台把非零读成 stage 失败，所以 2 这一档在这一侧**不会被算进绿** —— 那正是
   * ISSUE #2225 要的：旧实现里「同块里一份超时 + 一份真断言红」被块级指纹读成退 0，
   * stage 报 success，那次真红没有任何一格会看见。
   * ⚠️ 这一档在本地钩子里**没有落点**：`run_group C` 早在档位开关之前 `return 0`
   * （2026-10-20 起本地不跑这一档，§13.5.25），所以本地只有手工 / `pnpm check:all`
   * 那一跳会读到 2 —— 按「未判定」念，不是绿也不是红。 */
  return r.status;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
