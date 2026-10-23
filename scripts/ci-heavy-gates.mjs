#!/usr/bin/env node
/**
 * `ci-heavy-gates.mjs` — 平台侧「重档静态判据」那一格的**条目执行者**。
 *
 * ## 它替掉了什么，以及为什么（2026-10-19 的现场）
 *
 * 原来这多条判据各占一个平台 stage。`cnb-hpl-1k5a0s6ss` 上 `ESLint 零警告` 撞到平台
 * 的 **20m 单 stage 硬上限**被强杀（`任务超过最大执行时间而被强制关闭：20m0s`，脚本
 * 一行输出都没有），后面三十格整片 skipped；而同一台机、同一份工作区，
 * `cnb-smq-1k59vlk3l` 上同一步是 305s 跑过的。差的不是 ESLint 变慢了，是**前面每一格
 * 都在各付一次 job 开销与盘上扫描**，一台 16 核机被十几份同时开着的进程吃干净。
 *
 * 于是把它们收进**一格**：本次 job 只付一次开销，条目在进程内串行。红了照样知道是
 * 哪一条（每条自己一段日志，带墙钟与退出码），也不再是「一条红、后面全跳过」。
 *
 * ⚠️ 2026-10-22 订正：**收进这一格的前提是「它们都在钩子里」**。其中三条
 * （文档面）在 2026-10-16 就从钩子里撤走了，2026-10-20 又被从配置里注释掉 ⇒
 * 它们从未被这一格跑过，且一个执行者都没有（`覆盖率上报` 从没进过钩子 ——
 * 它是 10-19 才被收进条目表的，而条目表不执行任何东西）。
 * 现在它们**恢复成各自的活 stage**（收窄挂在各自那一格上），这一格只留
 * **钩子里真有的那几条**。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改成并行**：这些条目本身就是 CPU 密集型（prettier / vitest），
 *     并行只会把节点压成上面那种「谁都不推进」的形态 —— 那正是本次要治的病。
 *   · **不给整格挂 `ifModify`**：`.cnb.yml` 的 `ifModify` 是按**整格**跳过的，
 *     一格装多条时它只能表达「一起跑」或「一起不跑」，而那些条目的扫描面并不相同
 *     —— 后者正是本仓最不能有的形态（判据在场、结论静默变成放行）。
 *   · **格内逐条按面收窄**（ISSUE #2255，2026-10-23 加）：整格不能收窄，**格内可以**
 *     —— 收窄面由**收窄登记表**（`scripts/ci-incremental-gates.mjs` 的
 *     `INCREMENTAL_GATES`）给出，与平台那一格的 `ifModify` **同一份 glob**
 *     （`checkIncrementalGates()` 已在核「表 ⇄ `.cnb.yml`」的双向一致）。
 *     ⇒ 现场：那 13 条判据在平台那一格被 `ifModify` 跳过，在这一格却照跑全量
 *     （本机实测 22.9s / 复合档逐条墙钟的 10.5%）—— 收窄白做。
 *     ⚠️ 收窄的两条边界：**改动面取不到 ⇒ 一条都不跳**（“不知道” ≠ “没改”）、
 *     **跳过的逐条点名且不计入「绿」**（跳过不是判过）。
 *   · **不改判据**：每一条都是原来那份脚本、那份参数，本文件只负责「起它、转述它」。
 *
 * ## 收窄面的唯一出处仍然是登记表
 *
 * `scripts/ci-incremental-gates.mjs` 与 `scripts/ci-autofix-duties.mjs` 里，原来按
 * stage 名登记的那几条现在按**条目名**登记（`stage: "重档静态判据"`）。两份判据
 * （`tests/ci-incremental-gates.test.ts` / `tests/ci-autofix-duties.test.ts`）都改读
 * 本文件的 `HEAVY_GATES`，双向核对「登记过的条目 ⇒ 这里真有那一行」「这里带
 * `--autofix` 的条目 ⇒ 登记过」，所以「哪一档会自己改工作区」「哪一格被收窄」这两件
 * 事依然各只有一处出处。
 *
 * ## 执行面：钩子注册表（合并后口径）
 *
 * 本文件里有两件事，此前混在一起，现在分开：
 *
 *   · **登记面** = 下面的 `HEAVY_GATES` 条目表。它回答「这一格里到底有哪些条目」，
 *     是 `scripts/ci-autofix-duties.mjs` 与 `scripts/ci-incremental-gates.mjs` 的唯一出处
 *     （「哪一档会自己改工作区」「哪一格被收窄」都按条目名登记）。
 *   · **执行面** = `.githooks/pre-commit` 里那些 `run "<标签>" <命令>` 步骤行。
 *     这也是 `scripts/check-gate-executors.cjs` 认的执行者出处之一。所以「把步骤从钩子里
 *     删掉」从来不是挪档的正确形态（那等于删执行者），正确形态是**步骤留在钩子里、
 *     由档位决定谁执行** —— 平台这一格读的就是同一份注册表。
 *
 * 两条主干的两种做法在这里合流：一边把多条 stage 收成一格（治的是「每格各付一次 job
 * 开销」），一边让这一格读钩子注册表（治的是「清单抄成第二份」）。合起来仍然只有
 * 一处执行面，条目表只作为登记面保留。
 *
 * ## ⚠️ 登记面与执行面必须**对得上**（2026-10-22 加的自证）
 *
 * 上面那句「条目表只作为登记面保留」有一个前提：表里的每一条**真的会被这一格跑**。
 * 2026-10-20（`0c6c8897`）那个前提不成立了 —— 原来的表里写着 9 条，而这一格**只跑其中
 * 3 条**：另 6 条在钩子里没有（文档面三条 + 覆盖率上报 + `core` 那两条），而其中 4 条
 * （文档面三条 + 覆盖率上报）在 `.cnb.yml` 里的原文**也被注释掉了** ⇒ 那 4 条
 * **一个执行者都没有**，而两张登记表互核全绿（它们互核的是「表 ⇄ 表」，缺的是
 * 「表 ⇄ 执行面」这一对）。`docs/api/**` 随后漂了 32 份。
 *
 * ⇒ `heavyGateRegistryProblems()` 判的就是这一对，且 `main()` **先自证、后跑**：
 * 对不上就判红、什么都不跑（那种红必须发生在跑之前）。
 *
 * 用法：`node scripts/ci-heavy-gates.mjs [--only 条目名 …] [--no-narrow]`
 *   （`--only` 与 `--no-narrow` 都只给人手工排查用；`.cnb.yml` 里不带它们 ——
 *   平台侧按**改动面**收窄，见上面「边界」那一节）
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CHANGED_SCOPED, readHookSteps, runGate } from "./base-check/hook-steps.mjs";
import { resolveBaseRef, resolveChangedFiles } from "./changed-scope.mjs";
import { faceTouched, narrowingEntryForScript } from "./ci-incremental-gates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 条目表 —— 「这一格里到底跑哪些判据」的唯一出处。
 *
 * ## 这张表**只能**收这一格真会跑的条目（2026-10-22 订正）
 *
 * 原来的表里写着 9 条，而这一格**只跑其中 3 条** —— 2026-10-20（`0c6c8897`）把
 * `生成态文档与源同步` / `API 文档生成与自检` / `文档引用与权威源一致` / `覆盖率上报`
 * 在 `.cnb.yml` 里的原文注释掉了（理由是「收进聚合档」），而**这一格读的是钩子注册表**
 * ——那几条在 2026-10-16（`8d0d0b23`）就已经从钩子里撤走 ⇒ 两次搬动方向相反、在中间
 * 对穿 ⇒ 从 2026-10-20 起那 4 条**一个执行者都没有**，而表上写着它们在。
 *
 * 代价是实打实的：`docs/api/**` 在无人看管下漂了 32 份（本地
 * `node scripts/check-docs-api.cjs --check` 现在退 1，墙钟 491.2s）。
 *
 * ⇒ **表里每一条都必须能被这一格真跑**，而「能不能真跑」只有一件事能回答：
 * **它的 `argv` 逐字出现在钩子的 `run` 步骤行里**。`heavyGateRegistryProblems()`
 * 判的就是这件事，且**这一格在跑之前先自证**（对不上 ⇒ 判红、什么都不跑）。
 * 表与执行面互核而执行面缺席的那次（2026-10-20）就是这么溜过去的 ——
 * 登记表之间互核全绿，缺的是「表 ⇄ 执行面」这一对。
 *
 * ⚠️ 改这张表 = 改钩子（条目必须与钩子那一步逐字一致），**或者**改执行者（把它挪到
 * 自己的 stage 那一格，见 `.cnb.yml` 的「文档面与上报这几格」那段）。
 *
 * ## 每条 `argv` 的形态
 *
 * 都是**仓库相对**的入口 + 参数（`node` 与 `node_modules/.bin/*` 两种形态都原样保留：
 * 本地 node 起 `.bin` 下的垫片在 Windows 上起不来，那是 `ci-cp936-exit.mjs` 文件头
 * 记着的老坑，这里不重蹈），且与 `.githooks/pre-commit` 里那一步**逐字相同** ——
 * 含 `--staged`（跑的时候由 `fullTreeArgv()` 剥掉：平台侧没有暂存区，留着它判的是
 * 「空提交」= 一条**恒绿**的判据）。
 *
 * @typedef {{name: string, argv: readonly string[], why: string}} HeavyGate
 * @type {ReadonlyArray<HeavyGate>}
 */
export const HEAVY_GATES = [
  {
    name: "地基层零消费导出(硬闸)",
    argv: ["node", "scripts/check-dead-exports.cjs", "--staged"],
    why: "判地基层的零消费导出；面是 src/** + scripts/**，属于全仓不变量。",
  },
  {
    name: "格式化提交与行为改动分离",
    argv: ["node", "scripts/check-reformat-only.cjs", "--staged"],
    why: "判「这次改动里有多少个文件只是被 prettier 重排过」；判据本体逐文件跑 prettier，面上有源文件才动手。",
  },
  {
    name: "CP936 字形登记（没字形的字符不许悄悄变问号）",
    argv: ["node", "scripts/check-cp936-glyphs.cjs"],
    why: "判「会进 CI 日志的面里，没有 CP936 字形的字符是不是都登记了替代写法」；那一跳会把没字形的字符写成问号，于是连「这一条过了」都会变成问号（规范 §13.5.3.5 的日志乱码那一族）。",
  },
];

/**
 * 把注册表里的步骤变成「全量档」的命令：只剥 `--staged` 这一个旗标。
 *
 * 刻意不做别的改写 —— 每条步骤的参数就是它自己的判据口径，改一个参数就是改判据。
 * 平台侧没有暂存区，留着 `--staged` 判的是「空提交」= 一条**恒绿**的判据
 * （本仓最恨的那一型）。
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function fullTreeArgv(argv) {
  return argv.filter((a) => a !== "--staged");
}

/**
 * 这一步在**这一档**（平台侧、干净快照、没有暂存区）该怎么跑。
 *
 * 两族的分界在**能不能剥**：
 *
 *   · 带 `--staged` / `--changed` 的 ⇒ 剥掉那个旗标（`fullTreeArgv()`），它判的是
 *     **全仓**，判决面还在 ⇒ 照跑。
 *   · `CHANGED_SCOPED` 那一族（`shell-gate`）⇒ **判决面只在「本次改动」上**，而
 *     这一档没有暂存区 ⇒ 它恒绿且**一个字都不打**（ISSUE #2224 的现场：平台上
 *     「改了壳必须重编」与壳内那批 `#[test]` 一个执行者都没有，账面全绿）。
 *     处置是**换判决面**：给它一条基线，让它按「相对基线改了什么」判
 *     （`shell-gate --base <ref>`）；拿不到基线 ⇒ 这一条**没判**，单列退 2，
 *     **不许计入「绿」**（§13.5.25 的三态口径：没判 ≠ 绿）。
 *
 * @param {string[]} argv 钩子那一步的命令
 * @param {{cwd?: string, env?: Record<string, string | undefined>}} [deps]
 * @returns {{ok: true, argv: string[], via: string, notRunCodes: number[]} | {ok: false, reason: string}}
 */
export function heavyGateArgv(argv, deps = {}) {
  const joined = argv.join(" ");
  if (!CHANGED_SCOPED.some((p) => joined.includes(p))) {
    return {
      ok: true,
      argv: fullTreeArgv(argv),
      via: "全量档（剥掉本次改动旗标）",
      notRunCodes: [],
    };
  }
  const base = resolveBaseRef({ cwd: deps.cwd, env: deps.env });
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }
  return {
    ok: true,
    argv: [...argv, "--base", base.ref],
    via: `以基线为判决面（${base.via}）`,
    /* 这一族自己把「没跑起来」报成 **2**（仓库三态：0 绿 / 1 红 / 2 没跑起来），
     * 而这一档的既有约定是 **127**（命令找不到）。两个码都归「没跑起来」——
     * 否则「拿不到基线」会被读成「判红」。 */
    notRunCodes: [2],
  };
}

/**
 * 这一步跑的是哪份判据脚本（收窄表按**判据**查，不按标签查）。
 *
 * 取**第一个** `scripts/…` 路径：`node scripts/x.cjs …` 里那个 `x.cjs` 才是判据本身，
 * 后面的参数与包装器都不是。取错了就会拿包装器的名字去查表 ⇒ 查不到 ⇒ 永不收窄
 * （那个方向是安全的，但白费一次收窄的机会）。
 *
 * @param {readonly string[]} argv
 * @returns {string | null}
 */
export function judgmentScriptOf(argv) {
  const m = String((argv ?? []).join(" ")).match(
    /scripts\/[A-Za-z0-9._-]+\.(?:cjs|mjs)/,
  );
  return m ? m[0] : null;
}

/**
 * 这一步在复合档里该不该**按面跳过**（ISSUE #2255）。
 *
 * ## 它治的是哪一件事
 *
 * 平台侧那 13 个 stage 带 `ifModify` 收窄（面没被本次改动碰到 ⇒ 那一格不执行），
 * 而**同一份判据**在复合档里照跑全量 ⇒ 收窄白做（本机实测 22.9s / 10.5%）。
 *
 * ## 口径（三条，逐条都有出处）
 *
 *   ① **面取自收窄登记表**（`scripts/ci-incremental-gates.mjs` 的 `INCREMENTAL_GATES`），
 *      与平台那一格的 `ifModify` **同一份 glob** —— `checkIncrementalGates()` 已经在核
 *      「表 ⇄ `.cnb.yml`」的双向一致 ⇒ 两处收窄的口径逐字相同。
 *   ② **「不知道」不等于「没改」**：改动面取不到（`null`）或**清单为空** ⇒
 *      **一条都不跳过**。把「不知道」读成「没改」会让整批判据静默消失 ——
 *      那正是本仓最贵的形态（判据在场、结论静默变成放行）。
 *   ③ **跳过的必须被点名**：跳过的那几条**不计入「绿」**，单独一档逐条念出来
 *      （`main()` 里那一段）。静默跳过与静默放行是同一族病。
 *
 * @param {{label: string, argv: readonly string[]}} step 钩子那一步
 * @param {{files: readonly string[]} | null} changed 改动面；`null` = 不知道
 * @returns {{skip: false} | {skip: true, stage: string, globs: readonly string[], script: string}}
 */
export function narrowingDecision(step, changed) {
  if (!changed) return { skip: false };
  const files = changed.files ?? [];
  if (files.length === 0) return { skip: false };
  const script = judgmentScriptOf(step?.argv ?? []);
  if (!script) return { skip: false };
  const entry = narrowingEntryForScript(script);
  if (!entry) return { skip: false };
  if (faceTouched(entry, files)) return { skip: false };
  return { skip: true, stage: entry.name, globs: entry.globs, script };
}

/**
 * 跑完整张注册表。
 *
 * @param {{cwd?: string, only?: string | null, env?: Record<string, string | undefined>, changedFiles?: {files: readonly string[]} | null}} [io]
 * @returns {{runs: {label: string, code: number, output: string, ms: number, notRunCodes: number[]}[], skipped: {label: string, stage: string, globs: readonly string[]}[], notJudged: {label: string, reason: string}[], unreadable: boolean}}
 *   `unreadable` = 注册表本身没读出来（钩子文件不在 / 解析零条）—— 那是
 *   「本档不构成证据」，不是「没有档要跑」。
 *   `notJudged` = **没有判决面**的那些步骤（它们在这一档恒绿且无声）——
 *   单独一档、退 2，不计入「绿」。
 *   `skipped` = **按面未触及**的那些（ISSUE #2255）—— 单独一档、逐条点名，
 *   **不计入「绿」**（跳过不是判过）。
 *   `ms` = 那一条的墙钟（毫秒）—— 这一格此前只打「ok / 红」，**没有任何计时**，
 *   而文件头承诺过「每条的墙钟」⇒ 48s 那一堆只有总数没有分布，无从判断该优化谁。
 */
export function runHeavyGates(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const only = io.only ?? null;
  /* 注册表按**这个 cwd** 取，不写成模块自己的 ROOT：否则注入的目录（用例给的那个没有
   * 钩子的临时目录）照样读到真仓库的 50 条 ⇒ 「没跑起来」那一档在测试里永远命中不了，
   * 而它正是这条判据唯一有牙的地方。 */
  const all = readHookSteps(path.join(cwd, ".githooks", "pre-commit"));
  if (all.length === 0) {
    return { runs: [], skipped: [], notJudged: [], unreadable: true };
  }
  const steps = only
    ? all.filter(
        (s) =>
          s.label === only ||
          s.label.includes(only) ||
          s.argv.join(" ").includes(only),
      )
    : all;
  /** @type {{label: string, code: number, output: string, ms: number, notRunCodes: number[]}[]} */
  const runs = [];
  /** @type {{label: string, stage: string, globs: readonly string[]}[]} */
  const skipped = [];
  /** @type {{label: string, reason: string}[]} */
  const notJudged = [];
  for (const step of steps) {
    /* 按面跳过（ISSUE #2255）：面取自收窄登记表，与平台那一格同一份 glob。 */
    const decision = narrowingDecision(step, io.changedFiles ?? null);
    if (decision.skip) {
      skipped.push({
        label: step.label,
        stage: decision.stage,
        globs: decision.globs,
      });
      continue;
    }
    const resolved = heavyGateArgv(step.argv, { cwd, env: io.env });
    if (!resolved.ok) {
      notJudged.push({ label: step.label, reason: resolved.reason });
      continue;
    }
    const started = Date.now();
    const r = runGate(resolved.argv, cwd);
    runs.push({
      label: step.label,
      code: r.code,
      output: r.output,
      ms: Date.now() - started,
      notRunCodes: resolved.notRunCodes,
    });
  }
  return { runs, skipped, notJudged, unreadable: false };
}

/**
 * **自证**：条目表里每一条，这一格都真会跑它吗？
 *
 * 判据只有一件事：**条目的 `argv` 逐字出现在钩子的 `run` 步骤行里**。
 * 这一格跑的就是钩子的步骤（`runHeavyGates()` 读的是同一份注册表），所以
 * 「表里有、钩子里没有」= 「表上说它跑、实际没人跑」—— 那正是 2026-10-20 让
 * 4 条判据**整整两天没有执行者**、而两张登记表互核却全绿的那个形态。
 *
 * 反方向也判：**钩子里带自动修旗标（`--autofix`）的步骤**必须在表里 ——
 * 「哪一档会自己改工作区」只有一处出处（`scripts/ci-autofix-duties.mjs` 的登记表），
 * 而那一档的读数来自这一格的成员表。
 *
 * @param {{label: string, argv: readonly string[]}[]} hookSteps 钩子的步骤行
 * @returns {string[]} 逐条不一致（人读的话术）；空数组 = 自证通过
 */
export function heavyGateRegistryProblems(hookSteps) {
  /** @type {string[]} */
  const problems = [];
  const stepArgvs = new Set(hookSteps.map((s) => s.argv.join(" ")));
  for (const gate of HEAVY_GATES) {
    const argv = gate.argv.join(" ");
    if (stepArgvs.has(argv)) continue;
    problems.push(
      `条目表里的「${gate.name}」（${argv}）在钩子的步骤行里找不到同一条命令 —— ` +
        "这一格跑的就是钩子的步骤，表上有而钩子里没有 = 这一格**不会跑它**，那条判据就此没有执行者。" +
        "要么把这一步加回 `.githooks/pre-commit` 的 `run` 步骤行（执行面在那里），" +
        "要么把它从表里删掉并给它自己的 stage",
    );
  }
  const tableArgvs = new Set(HEAVY_GATES.map((g) => g.argv.join(" ")));
  for (const step of hookSteps) {
    const argv = step.argv.join(" ");
    if (!argv.includes("--autofix")) continue;
    if (tableArgvs.has(argv)) continue;
    problems.push(
      `钩子里的「${step.label}」带着自动修旗标，却不在条目表里 —— ` +
        "「哪一档会自己改工作区」必须只有一处出处（scripts/ci-autofix-duties.mjs 的登记表）",
    );
  }
  return problems;
}

/**
 * 入口：跑 + 打 + 定退出码。
 *
 * 三态退出码与 `premerge-check.mjs` / `base-check.mjs` **逐字同口径**：
 *   `0` = 全绿；`1` = 有档红了；`2` = 有档**没跑起来**（`runGate` 的 127 哨兵）。
 * 「没跑起来」与「跑了且红」必须在退出码上分开，否则前者会被读成后者。
 *
 * @param {{cwd?: string, argv?: string[], log?: (line: string) => void, env?: Record<string, string | undefined>, changedFiles?: {files: readonly string[]} | null}} [io]
 *   `changedFiles` 不给 ⇒ 自己按环境算（`resolveChangedFiles()`）；给 `null` ⇒
 *   **不收窄**（全部照跑）。给一份清单 ⇒ 按那份清单判面（ISSUE #2255）。
 * @returns {number}
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  const cwd = io.cwd ?? ROOT;

  /* **三态的次序**：读不出来 → 退 2；读出来了但表与它对不上 → 退 1；全绿 → 退 0。
   * 「读不出来」必须排在自证**前面** —— 注册表整个读不到时，自证会报「表里有、钩子里
   * 没有」，而那其实是同一个根因（注册表没读出来）的另一种说法；让它退 1 就是把
   * 「没跑起来」说成「判据判出失败」（§13.5.25 的三态口径：两者必须分开）。 */
  const hookSteps = readHookSteps(path.join(cwd, ".githooks", "pre-commit"));
  if (hookSteps.length === 0) {
    log(
      "[重档] 没跑起来：读不到 `.githooks/pre-commit` 的步骤注册表（0 条）—— " +
        "本档不构成证据，不是「没有判据要跑」",
    );
    return 2;
  }

  /* **先自证、后跑**：条目表与执行面对不上时，这一格跑的每一格都是「判据在场、
   * 结论静默变成放行」—— 那种红必须发生在跑之前，而不是跑完之后没人看见。 */
  const registryProblems = heavyGateRegistryProblems(hookSteps);
  if (registryProblems.length > 0) {
    for (const p of registryProblems) log(`[重档] 注册表自证不通过：${p}`);
    log(
      "[重档] 本档**不构成证据**（成员表与执行面对不上）—— 判据在场、结论静默变成放行，" +
        "那种红必须先修这张表或钩子",
    );
    return 1;
  }

  /* 收窄面（ISSUE #2255）：这一格按**收窄登记表**判「本次改动碰没碰到那条判据的面」。
   * 拿不到改动面 ⇒ **一条都不跳过**（“不知道” ≠ “没改”），并把这件事念出来。 */
  let changedFiles = io.changedFiles;
  if (changedFiles === undefined) {
    if (argv.includes("--no-narrow")) {
      /* 手工排查要**全量**：这一格默认按面收窄（ISSUE #2255），而「手工复现一条红」
       * 时拿到一份收窄过的读数会让人误判（"它怎么是绿的"）。 */
      changedFiles = null;
      log("[重档] `--no-narrow` ⇒ 这一格**不收窄**（全部照跑）");
    } else {
      const got = resolveChangedFiles({ cwd: io.cwd ?? ROOT, env: io.env });
      changedFiles = got.ok ? { files: got.files } : null;
      if (!got.ok) {
        log(
          `[重档] 取不到改动面 ⇒ 这一格**不收窄**（全部照跑）：${got.reason}`,
        );
      } else if (got.files.length === 0) {
        log(
          "[重档] 改动面是空的 ⇒ 这一格**不收窄**（全部照跑）—— 空清单是「不知道」，不是「没改」",
        );
      } else {
        /* 念出「按哪份 diff 收窄」：收窄是**这一格**少判一些的理由，读者必须能核对它。 */
        log(
          `[重档] 改动面：${got.via}（${got.files.length} 个文件）⇒ 这一格按面收窄`,
        );
      }
    }
  }

  const { runs, skipped, notJudged } = runHeavyGates({
    cwd: io.cwd,
    only,
    env: io.env,
    changedFiles,
  });

  /* 「没跑起来」有两族：127（命令找不到，这一档的既有约定）与**那一步自己声明的**
   * 退出码（`shell-gate` 报「没跑起来」用 2 —— 仓库三态 0 绿 / 1 红 / 2 没跑起来）。
   * 两个码都必须归「没跑起来」：把 2 读成「判红」是把「没判」说成「判出失败」。 */
  /** @param {{code: number, notRunCodes: number[]}} r */
  const isNotRun = (r) => r.code === 127 || r.notRunCodes.includes(r.code);
  const red = runs.filter((r) => r.code !== 0 && !isNotRun(r));
  const missing = runs.filter(isNotRun);
  if (argv.includes("--json")) {
    log(
      JSON.stringify(
        {
          total: runs.length + skipped.length,
          red: red.map((r) => r.label),
          notRun: missing.map((r) => r.label),
          /* 「没有判决面」那一档：它们在这一档恒绿且无声 ⇒ 单独列出来，
           * 不许混进 `total` 里冒充「跑过」。 */
          notJudged: notJudged.map((n) => ({ label: n.label, reason: n.reason })),
          /* 「按面未触及」那一档（ISSUE #2255）：跳过**不是**判过 ⇒ 单独列出来，
           * 不许混进「绿」里冒充「跑过」。 */
          skipped: skipped.map((s) => ({
            label: s.label,
            stage: s.stage,
            globs: s.globs,
          })),
          ms: runs.map((r) => ({ label: r.label, ms: r.ms })),
        },
        null,
        2,
      ),
    );
  } else {
    /* 「按面未触及」的那些**逐条点名**（ISSUE #2255）：静默跳过与静默放行是同一族病 ——
     * 平台那一格以同一组 glob 收窄，这一格也收窄，但**跳过了哪几条必须说出来**。 */
    for (const s of skipped) {
      log(
        `[重档] 按面未触及 ⇒ 跳过：${s.label}` +
          `（面 ${s.globs.join(" / ")}；平台那一格：${s.stage}）`,
      );
    }
    runs.forEach((r, i) => {
      const tag = r.code === 0 ? "ok" : r.code === 127 ? "没跑起来" : "红";
      log(`[重档] ${i + 1}/${runs.length} ${tag} ${r.label}（${r.ms}ms）`);
      if (r.code !== 0) {
        const tail = String(r.output ?? "")
          .trim()
          .split(/\r?\n/)
          .slice(-12);
        for (const line of tail) log(`        ${line}`);
      }
    });
    /* 「没判」的那些**逐条点名**：恒绿且无声是这一族最贵的形态（判据在场、
     * 结论静默变成放行）—— 名字不念出来，就等于它还在绿里。 */
    for (const n of notJudged) {
      log(`[重档] ? ${n.label} —— 这一条**没判**：${n.reason}`);
    }
  }
  const totalMs = runs.reduce((sum, r) => sum + r.ms, 0);
  log(
    `[重档] 合计 ${runs.length + skipped.length} 条：红 ${red.length}、没跑起来 ${missing.length}、` +
      `没判 ${notJudged.length}、按面未触及 ${skipped.length}、` +
      `绿 ${runs.length - red.length - missing.length}；墙钟合计 ${totalMs}ms`,
  );
  if (red.length > 0) {
    for (const r of red) log(`[重档] ✗ ${r.label}`);
    return 1;
  }
  if (missing.length > 0) {
    // 127 单列一档并退 2：把它并进「红」就等于宣布「判据判出失败」，而事实是它没判。
    for (const r of missing) log(`[重档] ? ${r.label} —— 没跑起来，不等于通过`);
    return 2;
  }
  if (notJudged.length > 0) {
    /* 「没判」与「没跑起来」同列（都是「没有结论」，都不是「通过」）——
     * 这一档原先是恒绿且无声（ISSUE #2224 的现场）。 */
    return 2;
  }
  return 0;
}

/* 只在被直接执行时跑 main。被 import 时（`tests/ci-autofix-duties.test.ts` 要读
 * `HEAVY_GATES`）只暴露纯数据与函数 —— 否则 `process.exit()` 会当场把测试进程杀掉，
 * 而那件事的形态是「用例一条都没跑、套件却红了」，读起来与真红完全两样。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
