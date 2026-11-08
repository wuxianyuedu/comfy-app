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
 * ## 输出策略：绿步的读数**也要有出口**（ISSUE #2256，2026-10-23 加）
 *
 * 此前只有**红步**的输出被转述 ⇒ 「exit 0、但自己说了『我没有判任何东西』」的那类形状
 * 在平台日志里**一个字都不打** —— 那一格与「真的判过了」逐字同形。
 * 最实的一例是 `文档源 ⇄ 生成态镜像同批`：平台那一格跑在干净快照上（索引里没有本次改动），
 * 而那份判据「不带 `--staged` 那一档」判的**仍是暂存集** ⇒ 它打印「暂存区是空的」
 * 并把这一格计成绿，而那句话被丢掉。
 * （⚠️ 这里过去写的是「平台上没有暂存区」——那句是错的：ISSUE #2344 实测平台的索引
 * **可以非空**，上一格的账回写失败就会往里留东西。要说的从来是「平台拿不到本次改动面」。）
 *
 * ⇒ 现在绿步也转述它的**最后一行非空行**（结论都在末尾，与红步取尾部的口径同源）。
 * 这一条只解决「**无声**」；「平台上那一格到底判没判」是另一件事（形态档那一步在平台上
 * 仍然没有真实输入面 —— 单独立单跟进，不在这里混着改）。
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

import { CHANGED_SCOPED, readHookSteps, runGate } from "./base-check/hook-steps.mjs";
import { resolveBaseRef, resolveChangedFiles } from "./changed-scope.mjs";
import { syntheticMergeRange } from "./reformat-preview-range.mjs";
import { faceTouched, narrowingEntryForScript } from "./ci-incremental-gates.mjs";
import {
  COLORS,
  colorEnabled,
  gateFail,
  gatePass,
  gateSkip,
  looksSkipped,
  paintLine,
} from "./ci-log.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

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
  {
    /* 名称与 argv 必须与 `.githooks/pre-commit` 里那一步**逐字一致** ——
     * `heavyGateRegistryProblems()` 在开跑前就核这件事（对不上 ⇒ 判红、一条都不跑）。 */
    name: "脚本档类型检查(tsc 的 .mjs 全量面)",
    argv: ["node", "scripts/check-scripts-typecheck.cjs"],
    why: "判未被 import 的 `**/*.mjs` 脚本（主 tsconfig 收不到那一格；ISSUE #2524 / 规范 §13.5.14）。它判的是**全仓不变量**（脚本档全量面 + 一份只降不升的基线；面的份数由判据自己从 `git ls-files` 现算（账本里没有那一格），这里不抄一个会过期的数），与「这次改了什么」无关 ⇒ 不收窄；代价是它自己起一次 tsc（本机实测 12.5–17.9s）。",
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
 *   · `CHANGED_SCOPED` 那一族 ⇒ **判决面只在「本次改动」上**，而
 *     这一档没有暂存区 ⇒ 它恒绿且**一个字都不打**（ISSUE #2224 的现场：平台上
 *     「改了壳必须重编」与壳内那批 `#[test]` 一个执行者都没有，账面全绿）。
 *     处置是**换判决面**：给它一条基线，让它按「相对基线改了什么」判
 *     （`shell-gate --base <ref>`）；拿不到基线 ⇒ 这一条**没判**，单列退 2，
 *     **不许计入「绿」**（§13.5.25 的三态口径：没判 ≠ 绿）。
 *
 * ⚠️ **这一族里有一条「剥旗标对它无效」**（ISSUE #2265）：`check-doc-mirror-pairing.cjs`
 * 带 `--staged`，但**剥掉那个旗标之后它判的仍是暂存集**（镜像与源是否**同批**是提交的
 * 属性，不是仓库的属性）⇒ 剥旗标这一手对它**不成立**，它会自认「暂存区是空的 ——
 * 没有什么可判」并退 0，被计成绿。
 * ⇒ 这一族**连 `--staged` 一起剥掉**再挂 `--base <ref>`：判据只该看到**一个**
 * 判决面来源（`--base` 优先于暂存区），两个都挂着会让「到底按哪个面判」变成读代码的事。
 *
 * ⚠️ **曾经还有第二支 `--range <基线>..HEAD`**（ISSUE #3032 给 `check-reformat-only.cjs`
 * 加的），现已撤销（ISSUE #3038）：那条路的判决面来自平台给的基线，而**基线是不是
 * 分叉点取决于平台的合并拼法** ⇒ 一种拼法上对、另一种上又错回来（同一格连红三轮）。
 * 同一个问题收口在判据那一侧（它自己按合成提交的父关系取区间），那条判据因此退出了
 * `CHANGED_SCOPED`。**不留一张只为一条目的存在的表** —— 再出现同族时按那张单子的口径重立。
 *
 * ⚠️ **但「退出 CHANGED_SCOPED」不等于「在平台上判得对」**（ISSUE #3048，PR #2990 的
 * `cnb-o9p-1k6d5ohhj` 现场）：那一支走下来，这一档只剥 `--staged`、**不给任何判决面**，
 * 而平台侧没有暂存区 ⇒ 判据回落到「判 HEAD 这一次提交」，那里的 `HEAD` 是**检出**而不是
 * 平台合成的合并预览 —— `HEAD~1..HEAD` 于是只含检出自己的最后一笔，读数是
 * `170 个源文件里 118 个纯格式化`（那 118 份散在 27 笔里，没有一笔独占）。
 * 判据本体是对的，错的是**没人把判决面递给它**。
 * ⇒ 合成提交的形态这一档自己看得见（`HEAD` 的父提交 + `CNB_COMMIT`），递过去的判决面
 *    就是那两个父：`--range <第一父>..<第一父名下的那个 sha>`（见 `syntheticMergeRange()`）。
 *    认不出合成提交 / 父关系对不上 ⇒ 这一条**没判**（`notRunCodes` 收 2，单列退 2，
 *    不计入「绿」）—— 不给判决面就等于恒绿，那是本仓最贵的形态。
 *
 * ⚠️ 下面这两个 `@param` 与 `@returns` **必须贴着函数本体**：ISSUE #3032 的落地笔把两个
 * doc 块次序写反了 —— 标签落在另一条 `@type` 上，函数自己一个参数类型都
 * 没有 ⇒ 参数全是 implicit any，`tsc --noEmit` 与脚本档类型检查在 master 上当场红。
 * 挪任何一块之前先确认标签仍贴着它要描述的那个声明。
 *
 * @param {string[]} argv 钩子那一步的命令
 * @param {{cwd?: string, env?: Record<string, string | undefined>}} [deps]
 * @returns {{ok: true, argv: string[], via: string, notRunCodes: number[]}
 *   | {ok: false, reason: string, notRunCodes?: number[]}}
 */
export function heavyGateArgv(argv, deps) {
  const joined = argv.join(" ");
  /* ⚠️ `check-format.cjs --staged` 在这一档**换发 `--changed`**，不剥旗标进全库
   * （ISSUE #2729，printWidth 80 → 100 迁移期，#2710）：全库档对还没迁到 100 列的
   * 存量**恒红**（本机实测 1352 份未过）——剥旗标进全库等于让聚合档判一个
   * 「迁移完成前必红」的面，每条 PR 都被它挡住。专设的 `.cnb.yml` stage 判的是
   * **改动面**（`--changed`），聚合档与它判**同一个面**：同一格不许两条执行者
   * 两个答案（§13.5.12）。迁移完成、全库档重新可绿之后，这一条换发自然等价。 */
  if (joined.includes("check-format.cjs") && argv.includes("--staged")) {
    return {
      ok: true,
      argv: argv.map((a) => (a === "--staged" ? "--changed" : a)),
      via: "改动面（printWidth 迁移期：全库档对存量恒红，#2710）",
      notRunCodes: [],
    };
  }
  /* ⚠️ `check-reformat-only.cjs` 的 `--staged` 在这一档**换发成它唯一的另一个判决面**
   * （`--range <起>..<止>`，ISSUE #3048）：剥掉旗标之后它回落到「判 HEAD 这一次提交」，
   * 而平台侧没有暂存区、又没有合并预览的父关系 ⇒ `HEAD~1..HEAD` 只是**检出**的最后一笔，
   * 读数（`170 个源文件里 118 个纯格式化`）与「这个 PR 是什么」毫无关系。
   * 区间两端取合成提交的两个父（`syntheticMergeRange()`）—— 不给面就**不许**跑，
   * 那是「剥旗标判全仓」这个默认口径唯一的例外。 */
  if (joined.includes("check-reformat-only.cjs") && argv.includes("--staged")) {
    const face = syntheticMergeRange({ cwd: deps?.cwd, env: deps?.env });
    if (!face.ok) {
      /* `notRunCodes` 收 2：那一条判据自己用 2 表示「拿不到判决面」。两个码都归「没判」，
       * 于是它不会被读成「判红」（§13.5.25 的三态口径）。 */
      return { ok: false, reason: face.reason, notRunCodes: [2, 127] };
    }
    return {
      ok: true,
      argv: [...fullTreeArgv(argv), "--range", face.range],
      via: `以合并预览的两个父为判决面（${face.range}）`,
      notRunCodes: [2],
    };
  }
  /* ⚠️ `check-deps-freshness.mjs --staged` 在这一档**换发 `--offline`**（只判 ③ 本地
   * 安装自洽，不判 ② 基线依赖 ⇄ 远端）。剥旗标进全量会把钩子那句「只在本次提交
   * 动了依赖面时判」变成「每次 CI 都判 ②」—— §13.5.13 逐字说过那是「天天红的闸」。
   * 而这里检出的是平台构造的**合成 merge 预览**：第一父是派发那刻的 master 快照，
   * master 在 PR 存活期间继续前进并可能改依赖面 ⇒ ② 把「分叉点 vs 领先后的远端」
   * 读成「你的基线旧了」，出口却是「git pull / 把远端合进来」—— 开发者无从 pull
   * 一个平台造出来的落后 base。② 的执行者是 `pnpm check:deps-freshness`（开工前 /
   * PR 评审前）与钩子 `--staged` 那一档；复合档里只留 ③，判据脚本一字不改
   * （`--offline` 是它既有形态）。 */
  if (joined.includes("check-deps-freshness.mjs") && argv.includes("--staged")) {
    return {
      ok: true,
      argv: [...fullTreeArgv(argv), "--offline"],
      via: "只判 ③ 本地安装自洽（合成 merge 态不判 ② 远端基线，§13.5.13）",
      notRunCodes: [],
    };
  }
  if (!CHANGED_SCOPED.some((p) => joined.includes(p))) {
    return {
      ok: true,
      argv: fullTreeArgv(argv),
      via: "全量档（剥掉本次改动旗标）",
      notRunCodes: [],
    };
  }
  /* `deps` 可缺 ⇒ 这里读不到时给 `undefined`，由 `resolveBaseRef()` 自己回落到
   * `process.env` 与仓库根（它本来就是这么写的）。**不给形参挂 `= {}`**：那会让
   * TS 把整个形参推成 `{}`，`checkJs` 下 `deps.cwd` 直接 TS2339（平台那一跑实测）。 */
  const base = resolveBaseRef({ cwd: deps?.cwd, env: deps?.env });
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }
  return {
    ok: true,
    /* `fullTreeArgv()` 先剥掉 `--staged`：这一族**只认一个判决面来源**，
     * 而 `--base` 是这一档唯一拿得到的那一个（平台侧没有暂存区）。 */
    argv: [...fullTreeArgv(argv), "--base", base.ref],
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
 * @param {readonly string[] | null | undefined} argv
 * @returns {string | null}
 */
export function judgmentScriptOf(argv) {
  const m = String((argv ?? []).join(" ")).match(/scripts\/[A-Za-z0-9._-]+\.(?:cjs|mjs)/);
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
 * `step` 与 `changed` 都按**可缺**写：两个都来自钩子文本与 `git diff` 的解析结果，
 * 缺字段就是「不知道 ⇒ 不跳过」那一支（这个方向是安全的，但必须写得出来）。
 *
 * @param {{label?: string, argv?: readonly string[]} | null | undefined} step 钩子那一步
 * @param {{files?: readonly string[]} | null | undefined} changed 改动面；`null` = 不知道
 * @returns {{skip: false} | {skip: true, stage: string, globs: readonly string[], script: string}}
 */
export function narrowingDecision(step, changed) {
  if (!changed) {
    return { skip: false };
  }
  const files = changed.files ?? [];
  if (files.length === 0) {
    return { skip: false };
  }
  const script = judgmentScriptOf(step?.argv ?? []);
  if (!script) {
    return { skip: false };
  }
  const entry = narrowingEntryForScript(script);
  if (!entry) {
    return { skip: false };
  }
  if (faceTouched(entry, files)) {
    return { skip: false };
  }
  return { skip: true, stage: entry.name, globs: entry.globs, script };
}

/**
 * 跑完整张注册表。
 *
 * @param {{cwd?: string, only?: string | null, env?: Record<string, string | undefined>, changedFiles?: {files: readonly string[]} | null}} [io]
 * @returns {{runs: {label: string, code: number, output: string, ms: number, notRunCodes: number[], noJudgement?: boolean}[], skipped: {label: string, stage: string, globs: readonly string[]}[], notJudged: {label: string, reason: string, notRunCodes?: number[]}[], unreadable: boolean}}
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
        (s) => s.label === only || s.label.includes(only) || s.argv.join(" ").includes(only),
      )
    : all;
  /** @type {{label: string, code: number, output: string, ms: number, notRunCodes: number[], noJudgement: boolean}[]} */
  const runs = [];
  /** @type {{label: string, stage: string, globs: readonly string[]}[]} */
  const skipped = [];
  /** @type {{label: string, reason: string, notRunCodes?: number[]}[]} */
  const notJudged = [];
  for (const step of steps) {
    /* 按面跳过（ISSUE #2255）：面取自收窄登记表，与平台那一格同一份 glob。 */
    const decision = narrowingDecision(step, io.changedFiles ?? null);
    /* 「按面未触及」不是「没判」：这一条**本来就不该**在这次改动上跑（ISSUE #2255 的
     * 全部意义就是省掉它）⇒ 归 `skipped`，与「跳过」逐字同形。
     * 真正会「跳过了却该报没判」的形态在下一格：拿不到基线（`notJudged`）。
     * ⚠️ 平台那一格与这一格的收窄面必须**同一份** —— 面碰不到时它在平台上是被
     * `ifModify` 挡掉的，不是被跳过两次。 */
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
      notJudged.push({
        label: step.label,
        reason: resolved.reason,
        /* 判据自己的「2 = 拿不到判决面」码也归这一档（见 `main()`）。 */
        notRunCodes: resolved.notRunCodes ?? [],
      });
      continue;
    }
    const started = Date.now();
    const r = runGate(resolved.argv, cwd);
    const ms = Date.now() - started;
    /* 绿步**一个字都不打** ⇒ 这一格**没判**（ISSUE #2265 的机械兜底）。
     *
     * 「判据在场、退出码 0、而它自己什么都没说」——这一格与「真的判过了」逐字同形，
     * 而账面上它占着一条「绿」。此前那一步是 `已知基线失败登记·自证`：它在平台上
     * 恒绿且无声（改的是「暂存区是空的」那一族），账面全绿而判据没有执行者。
     *
     * 这一条把「有没有判决面」从**逐条核对**变成**机械判据**：任何一条判据将来
     * 在这个形态下丢掉判决面，账面上就再也混不进「绿」里。
     */
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- `r.output` 是注入面（用例会喂 null），规则读不到
    if (r.code === 0 && String(r.output ?? "").trim() === "") {
      notJudged.push({
        label: step.label,
        reason: "判据退 0 但一个字都没打 —— 这一格没有判决面（恒绿且无声）",
      });
      continue;
    }
    runs.push({
      label: step.label,
      code: r.code,
      output: r.output,
      ms,
      notRunCodes: resolved.notRunCodes,
      /* 「绿」还要再分一层：判据退 0、也打了字，而**它自己说的是「这一轮没判」**
       * （暂存区空 / 改动面不适用）。那是 `skip`，不是「判过了」——
       * 与 `notJudged` 分开：那一档是「一个字都没说」，这一档是「说了，说的是没判」。
       * 判法共用 `scripts/ci-log.mjs` 的 `looksSkipped()`（同一张说法表），
       * 并在打印时与判据自己的输出**并排**念出来。 */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上
      noJudgement: r.code === 0 && looksSkipped(String(r.output ?? "").trim()),
    });
  }
  return { runs, skipped, notJudged, unreadable: false };
}

/** 红步输出的取舍口径：头 5 行 + 尾 15 行（见 `main()` 里那段理由）。 */
const HEAD_LINES = 5;
const TAIL_LINES = 15;

/** 绿步引用判据自己的话时留多少字（一行判决要读得下去）。 */
const CONCLUSION_MAX = 90;

/**
 * 把判据的结论句压成**一行里读得完**的长度。
 *
 * 判据的结论常常是一整段（`[test-sleep] OK —— 裸 sleep 0 处 / 声明豁免 18 处。` 之后
 * 还有口径说明）。一行判决的价值就在于「一条一眼」，所以超长时截断并显式写
 * 「又 N 字」—— 省略必须被读出来，这是一整条链上反复的规矩。
 *
 * @param {string | null | undefined} line
 * @returns {string}
 */
export function compact(line) {
  const s = String(line ?? "").trim();
  if (s.length <= CONCLUSION_MAX) {
    return s;
  }
  return `${s.slice(0, CONCLUSION_MAX)}…（又 ${s.length - CONCLUSION_MAX} 字）`;
}

/**
 * 判据输出的**最后一行非空行** —— 也就是它自己那句结论。
 *
 * 判据的结论都在末尾（这是本仓所有 `check-*.cjs` 的既成写法，也是红步取尾部
 * 那一半的同一口径）。整段没有内容时回空串，由调用方决定拿什么兜。
 *
 * @param {string | undefined} output
 * @returns {string}
 */
export function lastLine(output) {
  return (
    String(output ?? "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "")
      .pop()
      ?.trim() ?? ""
  );
}

/**
 * 红步输出的取舍：头 `HEAD_LINES` 行 + 尾 `TAIL_LINES` 行，中间那段**报数不吞**。
 *
 * 按**位置**取而不是按词表猜「哪一行是结论」：本次现场的红行是一句普普通通的
 * `[deps-freshness] 有漂移`，任何词表都不会命中它，那就等于没念。判据的输出通常
 * 不到 20 行 ⇒ 一个字都不省。
 *
 * @param {string | undefined} output
 * @returns {{lines: string[], total: number, omitted: number}}
 */
export function clipOutput(output) {
  const all = String(output ?? "")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (all.length <= HEAD_LINES + TAIL_LINES) {
    return { lines: all, total: all.length, omitted: 0 };
  }
  return {
    lines: [...all.slice(0, HEAD_LINES), ...all.slice(-TAIL_LINES)],
    total: all.length,
    omitted: all.length - HEAD_LINES - TAIL_LINES,
  };
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
    if (stepArgvs.has(argv)) {
      continue;
    }
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
    if (!argv.includes("--autofix")) {
      continue;
    }
    if (tableArgvs.has(argv)) {
      continue;
    }
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
  /* 写盘与上色**分两层**（ISSUE #2748）：颜色只加在「真的往 stdout 写」的那一档。
   *
   * 这一格把每条判决转交给 `gatePass` / `gateSkip` / `gateFail` 时都带着自己的 `out`
   * （为了统一走一个出口），而 `ci-log.mjs` 的 `emit()` 见到 `out` 就整行原样透传 ——
   * 那条短路本意是给**抓文本**的调用方（子进程的管道、用例的断言），结果把转述型跑批
   * 一起短路了：一屏 `[ok]` / `[skip]` / `[重档]` 全是同一种灰，只有被转述的那份子进程
   * 自己带出的 ANSI 才显红。⇒ 补在这一层，用 `ci-log.mjs` 的同一个合成点。
   *
   * 三条边界：注入 `io.log`（用例、抓文本的调用方）拿到的仍是干净行；`--json` 那一路
   * 走 `writeLine`，一个字节都不许多；`NO_COLOR` / 非 TTY 不着色由 `colorEnabled()` 判。 */
  const writeLine = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  /* `--json` 那一档**整屏**都是机器可读的：前面那几行 `[重档]` 叙述与 JSON 走同一个
   * stdout，所以叙述行也不许多色号 —— 上色与这一档无关。 */
  const paintOn = io.log === undefined && !argv.includes("--json") && colorEnabled({ env: io.env });
  /**
   * 屏幕上的一行（上色 + 色带）。
   * @param {string} line
   * @param {string} [color] 只给合计那一行用（它自己不带三态前缀）
   */
  const log = (line, color) => {
    writeLine(paintLine(line, { enabled: paintOn, color }));
  };
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
    for (const p of registryProblems) {
      log(`[重档] 注册表自证不通过：${p}`);
    }
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
        log(`[重档] 取不到改动面 ⇒ 这一格**不收窄**（全部照跑）：${got.reason}`);
      } else if (got.files.length === 0) {
        log(
          "[重档] 改动面是空的 ⇒ 这一格**不收窄**（全部照跑）—— 空清单是「不知道」，不是「没改」",
        );
      } else {
        /* 念出「按哪份 diff 收窄」：收窄是**这一格**少判一些的理由，读者必须能核对它。 */
        log(`[重档] 改动面：${got.via}（${got.files.length} 个文件）⇒ 这一格按面收窄`);
      }
    }
  }

  const { runs, skipped, notJudged, unreadable } = runHeavyGates({
    cwd: io.cwd,
    only,
    env: io.env,
    changedFiles,
  });

  /* **注册表读不出来 ⇒ 这一档没有判决面**（ISSUE #2367）。
   *
   * `readHookSteps()` 回空数组，`runHeavyGates()` 交的是 `unreadable: true` —— 而
   * 上面那句解构此前**没把它接出来**，于是 `runs / skipped / notJudged` 三条全空，
   * 一路走到最后那句 `return 0`：账面上「合计 0 条、红 0」，读起来像「没有判据要跑」，
   * 而事实是**一条都没判**。这正是 `main()` 开头那段（`hookSteps.length === 0` ⇒ 退 2）
   * 要拦的形态，只是它只覆盖了「先自己读一遍」那条路。
   *
   * 放在这里而不是继续往上加分支：它是同一条判据的第二个入口，结论必须逐字相同。 */
  if (unreadable) {
    log(
      "[重档] 没跑起来：读不到 `.githooks/pre-commit` 的步骤注册表 —— " +
        "本档不构成证据，不是「没有判据要跑」",
    );
    return 2;
  }

  /* 「没跑起来」有两族：127（命令找不到，这一档的既有约定）与**那一步自己声明的**
   * 退出码（`shell-gate` 报「没跑起来」用 2 —— 仓库三态 0 绿 / 1 红 / 2 没跑起来）。
   * 两个码都必须归「没跑起来」：把 2 读成「判红」是把「没判」说成「判出失败」。 */
  /** @param {{code: number, notRunCodes: number[]}} r */
  const isNotRun = (r) => r.code === 127 || r.notRunCodes.includes(r.code);
  const red = runs.filter((r) => r.code !== 0 && !isNotRun(r));
  const missing = runs.filter(isNotRun);
  /* 「按面未触及」与「判据自己说没判」都是 `skip` 一档（判过 / 没判 / 红三态里
   * 中间那一档）：它们**都不是**「判过了」，也**都不是**「判出失败」。
   * 名字必须念出来 —— 静默跳过与静默放行是同一族病（ISSUE #2255 / #2256）。 */
  const noJudgement = runs.filter((r) => r.noJudgement);
  const green = runs.filter((r) => r.code === 0 && !noJudgement.includes(r));

  if (argv.includes("--json")) {
    /* 机器可读那一档走 `writeLine`：JSON 是要被 `JSON.parse` 回去的，
     * 上色与色带一个字节都不许多。 */
    writeLine(
      JSON.stringify(
        {
          total: runs.length + skipped.length,
          red: red.map((r) => r.label),
          notRun: missing.map((r) => r.label),
          /* 「没有判决面」那一档：它们在这一档恒绿且无声 ⇒ 单独列出来，
           * 不许混进 `total` 里冒充「跑过」。 */
          notJudged: notJudged.map((n) => ({
            label: n.label,
            reason: n.reason,
            notRunCodes: n.notRunCodes ?? [],
          })),
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
    /* ── 判决的打印**只有一条路**：`scripts/ci-log.mjs` 的三态出口 ──────────
     *
     * 此前这一档自己拼标签（`ok` / `红` / `没跑起来` 各在一处），于是同一个跑批里
     * 「这条算了数」与「这条其实没判」在屏幕上逐字同形（ISSUE #2506 的当场读数）。
     * 现在每条判决都过 `gatePass` / `gateSkip` / `gateFail`，三态用同一列前缀，
     * 而「没判」的那一档有自己的名字。 */
    /** @param {string} line */
    const say = (line) => {
      log(line);
    };
    for (const s of skipped) {
      gateSkip(s.label, `按面未触及：面 ${s.globs.join(" / ")}（平台那一格：${s.stage}）`, {
        out: say,
      });
    }
    runs.forEach((r) => {
      if (isNotRun(r)) {
        /* 「没跑起来」（127 / 判据自己声明的 2）既不是绿也不是红 —— 把它打成红
         * 就等于宣布「判据判出失败」，读的人会去修一条根本没执行过的判据。 */
        gateSkip(r.label, `没跑起来（退出码 ${r.code}），不等于通过`, {
          out: say,
        });
        return;
      }
      if (r.code === 0) {
        const conclusion = lastLine(r.output);
        if (r.noJudgement) {
          gateSkip(r.label, conclusion || "判据自己说这一轮没有要判的东西", {
            out: say,
          });
          return;
        }
        /* 绿步的读数从 `[ok]` 那一行的括号里读**判据自己的话**（ISSUE #2256：
         * 「exit 0 但自己说了什么都没判」曾经一个字都不打）。
         * 墙钟跟在读数后面：这一档的 24s 与逐条分布只有在同一行里才读得出来
         * （只给总数 ⇒ 无从判断该优化谁）。 */
        gatePass(r.label, compact(conclusion) || `判过 · ${r.ms}ms`, {
          out: say,
        });
        return;
      }
      /* 红步的输出**不许静默截断**（ISSUE #2367 的现场）：判据的输出常常几百行，
       * 而红的那一条结论**不一定在末尾**。取法按**位置**（前 5 行 + 后 15 行），
       * 不按词表猜「哪一行是结论」—— 本次现场的红行是一句普普通通的
       * `[deps-freshness] 有漂移`，词表里没有它就等于没念。 */
      const picked = clipOutput(r.output);
      gateFail(r.label, picked.lines, {
        detail: `退出码 ${r.code} · ${picked.total} 行输出 · ${r.ms}ms`,
        hint:
          picked.omitted > 0
            ? `上面是头 5 行 + 尾 15 行，中间省略 ${picked.omitted} 行（完整日志：${r.label}）`
            : "",
        max: 0,
        out: say,
      });
    });
    /* 「没判」的那些**逐条点名**：恒绿且无声是这一族最贵的形态（判据在场、
     * 结论静默变成放行）—— 名字不念出来，就等于它还在绿里。 */
    for (const n of notJudged) {
      gateSkip(n.label, `这一条没判：${n.reason}`, { out: say });
    }
  }
  const totalMs = runs.reduce((sum, r) => sum + r.ms, 0);
  const skippedTotal = skipped.length + notJudged.length + noJudgement.length + missing.length;
  /* 合计行按**同一套三态**措辞：「判过 / 没判 / 红」对得上上面逐条那三列前缀。
   * 条数是这几档之和 —— 谁都不许从总账里消失（少算一条就是「这一条没判」被
   * 静默地折成绿）。
   * 它自己不带三态前缀，却要跟着判决走（ISSUE #2748）：三态的取法与
   * `ci-log.mjs` 的 `renderTally()` 逐字同口径（红 > 没判 > 判过），不留第二份
   * 「什么时候算红」。 */
  const tallyState = red.length > 0 ? "red" : skippedTotal > 0 ? "skip" : "ok";
  log(
    `[重档] 合计：红 ${red.length}、没判 ${skippedTotal}、` +
      `判过 ${green.length}（共 ${green.length + skippedTotal + red.length} 条）；` +
      `墙钟合计 ${totalMs}ms`,
    COLORS[tallyState],
  );
  if (red.length > 0) {
    for (const r of red) {
      log(`[重档] 下一动作：先修「${r.label}」这一条（上面有证据）`);
    }
    return 1;
  }
  if (missing.length > 0) {
    // 127 单列一档并退 2：把它并进「红」就等于宣布「判据判出失败」，而事实是它没判。
    for (const r of missing) {
      log(`[重档] 下一动作：查「${r.label}」为什么没跑起来（不是通过）`);
    }
    return 2;
  }
  if (notJudged.length > 0) {
    /* 「没判」与「没跑起来」同列（都是「没有结论」，都不是「通过」）——
     * 这一档原先是恒绿且无声（ISSUE #2224 的现场）。
     * 结尾补一句**机器可认的结论行**（ISSUE #3102）：GitHub 侧的外壳
     * （`ci-step-verdict.mjs`）只在这一行出现时把 exit 2 折成非红 ——
     * 有红 / 有缺件（missing）都在这行之前各自 return，折不到它们。 */
    log(
      `[重档] 结论：没判（红 0、缺件 0、没判 ${notJudged.length}）—— ` +
        "这些条目的前提在本次触发形态下不存在；聚合层按没判不按红",
      COLORS.skip,
    );
    return 2;
  }
  return 0;
}

/* 只在被直接执行时跑 main。被 import 时（`tests/ci-autofix-duties.test.ts` 要读
 * `HEAVY_GATES`）只暴露纯数据与函数 —— 否则 `process.exit()` 会当场把测试进程杀掉，
 * 而那件事的形态是「用例一条都没跑、套件却红了」，读起来与真红完全两样。 */
// oxlint-disable-next-line typescript/no-unnecessary-condition -- process.argv[1] 在 node -e / REPL 形态下实为 undefined，@types/node 标成 string
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main());
}
