/**
 * ci-incremental-gates.mjs — 平台侧（`.cnb.yml`）门禁的**增量判据登记表**
 *
 * 干什么：回答「哪些 stage 可以在『本次改动没碰到它的扫描面』时跳过」，并把这件事
 * 变成 `.cnb.yml` 里的 `ifModify` 与这张表**双向同源**的一条机器判据。
 *
 * 为什么需要它（用户的诉求，ISSUE #1981）：平台侧流水线此前**任何**改动都跑满
 * 全部 stage —— 改一行 README 也要重跑「函数长度」「跨文件重复块」「ComfyUI 端口
 * 口径」这些**只扫 `src/**`** 的判据。本地钩子早就解决了同一件事
 * （`scripts/gate-scan-read.cjs` 的 `skipUnlessStagedTouches()`：暂存改动一点都没
 * 落在扫描面内就跳过），而那条通道**只在本地存在** —— 平台侧那条流水线不知道
 * 「扫描面」这回事，于是它把同一份判据在同一个文件上重跑了一遍。
 *
 * ── 复合执行者：`重档静态判据` 一格装多条，**整格不收窄、格内逐条收窄** ─────────
 *
 * 原先各自占一格的那批静态判据（`格式化提交分离` / `生成态文档与源同步` /
 * `API 文档生成与自检` / `覆盖率上报` / `文档引用与权威源一致` / `core` 那两条 /
 * `零消费导出`）现在收进一格 `重档静态判据`（`scripts/ci-heavy-gates.mjs`），理由是
 * 平台单 stage 的 20m 硬上限与「每一格各付一次 job 开销」——现场与逐条读数见那个文件
 * 的头注。
 *
 * **整格**不收窄：`.cnb.yml` 的 `ifModify` 是按**整格**跳过的，一格装十条时它只能
 * 表达「十条一起跑」或「十条一起不跑」，而那十条的扫描面并不相同，
 * 后者正是本仓最不能有的形态（判据在场、结论静默变成放行）。
 *
 * ⚠️ **但「整格不收窄」不等于「格内也不收窄」**（ISSUE #2255 的现场，2026-10-23 订正）：
 * 那 13 条判据**在平台那一格被 `ifModify` 收窄**，在复合档里却**照跑全量**
 * （本机实测 22.9s / 复合档逐条墙钟的 10.5%）⇒ 收窄白做。
 * ⇒ 复合档现在**逐条**按**这张表**判面（`narrowingEntryForScript()` / `faceTouched()`，
 * 本文件末尾那两个出口），与平台那一格用**同一份 glob** ⇒ 两处口径逐字一致。
 * 收窄的两条边界：**改动面取不到 ⇒ 一条都不跳**（“不知道” ≠ “没改”）、
 * **跳过的逐条点名且不计入「绿」**（跳过不是判过）。
 *
 * 这条边界有判据：`COMPOUND_EXECUTORS` 点名的 stage 一条 `ifModify` 都不许挂，
 * 而它们原来的那些收窄登记已经从本表**删掉**（登记表只收「一个执行者一条判据」的形态，
 * 这一点由下面那条双向核对保证 —— 表里每条都必须能在配置里找到同名 stage）。
 *
 * ── 为什么平台侧的机制是 `ifModify` 而不是复用 `--staged` ───────────────
 *
 * `.cnb.yml` 的 stage 支持 `ifModify: [glob…]`（CNB 官方语法手册
 * `zh/build/grammar.md` 的 `#stage-ifmodify`），语义与 `skipUnlessStagedTouches()`
 * **逐字同义**：变更文件一个都不落在给定 glob 内 ⇒ 这一步不执行。
 * 官方明确它支持 `PR` 触发的事件（「PR 触发的事件，统计 PR 中的变更文件」），
 * 正是本流水线要跑的那一类。**新建分支的 push 事件忽略 `ifModify`**（没有对比基准）
 * ⇒ 全部照跑 —— 那是「宁可多跑」的方向，安全。
 *
 * ── 谁可以跳过、谁绝对不行（这张表只收前者）─────────────────────────────
 *
 * 收进这张表的门槛是**它的扫描面是封闭的**：判据只读一个（或几个）能穷举的目录，
 * 而这个目录与 `.cnb.yml` 里写的 glob 是同一件事。三条必要条件：
 *
 *   ① **扫描面封闭且可穷举** —— 脚本里有 `SCAN_DIR` / `SCAN_DIRS` / `SCAN_ROOTS`
 *      这类常量（也就是它本地那一档 `skipUnlessStagedTouches()` 用的同一份根）；
 *   ② **没人能「从别处」把它弄红** —— 判据的违规只可能出现在扫描面内的文件里；
 *   ③ **它自己不判全库级不变量** —— 例如「日志实现只有一处」「仓储只有一种取用法」
 *      这类判的是**跨全仓的单一事实源**，任何一处改动都可能破坏它。
 *
 * 反过来说，下面这些**一律不进表**（它们的域要么是全仓、要么是本次流水线的前提）：
 *
 *   · 前提类（`工具链自证` / `镜像身份` / `Python 可用性` / `Python 探针读数` /
 *     `环境前提` / `Install dependencies` / `分支守卫` / `同步数据库表结构`）—— 后面
 *     每一步都依赖它们，跳过等于让「没跑」看起来像「过了」；`镜像身份` 是**读数**
 *     不依赖谁，但它描述的是「本次流水线跑在哪台机上」，收窄就等于「只在这几类改动
 *     上才记录环境身份」，那正是它要治的那一格（环境是隐形的，每一跑都该被看见）；
 *   · 全仓不变量（`类型检查` / `文件结构硬规则` / `UI/逻辑分离` / `零消费导出` /
 *     `lib Node-only 声明` / `core` 那三条 / `格式化提交分离`）—— 它们的扫描面是
 *     整个 `src/**` + `scripts/**` + `tests/**`，收窄成任何子集都是漏判；
 *   · 文档面三条 —— 判的是 `docs/**` 与 `docs/api/**`、`docs/generated/**` 生成物
 *     与源码同不同步，**源码与产物两边都要看**，域不是「改了 `src`」而是「两边都得对」；
 *     ⚠️ 这条曾经是「一律不进表」的依据，而那个依据**是错的**（2026-10-22 订正）：
 *     「两边都得看」说的是**判据要读两面**，不是「收窄只能按一面算」—— 面 = 源 ∪ 产物，
 *     两面**都没动**时结论逐字相同 ⇒ 它完全可收窄，而事实上它就是全流水线最贵的一格
 *     （201.8s），不收窄就没有资格常驻。三条里 `文档引用与权威源一致` 仍然**不进表**
 *     （它判的是全库文档里的引用与权威源，域不是某几个目录，收窄成任何子集都是漏判；
 *     它自己只要 0.42s，每跑必跑不贵）。
 *     ⚠️ **2026-10-23 订正（ISSUE #2231）**：`docs/api/**` 那一族的判据语义变了 ——
 *     产物不再进 git ⇒ 它不再判「源与产物同不同步」（那个问题**没有对象**了），
 *     改判「这一轮生成的产物可不可用」⇒ 它的面**只剩输入面**（产物面 `docs/api/**`
 *     已从收窄面里去掉，见下面那条登记项）。
 *   · `生产构建` / `浏览器安装` / `E2E 关键流程` —— 产物与端到端链路，任何改动都可能
 *     影响（`next build` 的失败可以由一个 import 引起），且它们判的正是「整仓能不能
 *     起来」；`浏览器安装` 是 E2E 的前提、`E2E` 依赖它。
 *
 * ── 这张表怎么被守（不许静默漂移）─────────────────────────────────────────
 *
 * `tests/ci-incremental-gates.test.ts` 双向核对：
 *   · 表里每一条 ⇒ `.cnb.yml` 里同名 stage **确实**带着那组 `ifModify`（写漏 / 写错
 *     glob 都红）；
 *   · `.cnb.yml` 里带 `ifModify` 的 stage ⇒ **必须在表里**（有人绕过登记表直接加一条
 *     `ifModify` 也红 —— 否则「谁被收窄了」这件事就没有唯一出处）。
 *
 * 顺带一个后果值得写清楚：**`.cnb.yml` 里没有 `ifModify` 的 stage 就是「任何改动都跑」**，
 * 这是默认档，也是这份表存在的意义 —— 它让「哪几条被收窄了」变成一份读得出来的清单，
 * 而不是散在 500 行 YAML 里的 10 处 `ifModify`。
 *
 * ── 能机械导出的就**不手抄**（ISSUE #1981 收尾）────────────────────────────
 *
 * 环境类的 globs 由上面的条件手写（「脚本里有 `SCAN_DIR`」正是它们的判据）；而
 * `生成态文档与源同步` 那一档的面由 `docs/**` 直接给出（源与产物都在它下面）。
 *
 * ⚠️ **2026-11-05：`API 文档生成与自检` 已从 push 撤到每日档**（ISSUE #2537）——
 * 那一档在每日档**不带 `ifModify`**（每跑必判），所以它的触发面**不再进这张表**。
 * 触发面本身没有收窄：`docsApiTriggerGlobs()` 仍从 typedoc 的解析根派生，供判据自己的
 * `--staged` 档与 `tests/docs-api-input-closure.test.ts` 使用（面照旧只有一处出处）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/* ⚠️ 这里原来还有两件东西：`API 文档生成与自检` 的 `INPUT_RES` 反推（`globFromInputRe`
 * + 上面那个 `createRequire`）与那一档的登记项。它们随 2026-10-19 的合并一起删掉了 ——
 * 那一档进了聚合执行者、不再有 `ifModify` 可反推。**别照着这段历史把它加回来**：
 * 「那一格还在跑、跑的仍是 `INPUT_RES` 认的那些输入」这件事现在由
 * `tests/ci-incremental-gates.test.ts` 直接对着 `HEAVY_GATES` 判（条目表还在、入口还在盘上、
 * 判定门是 `--check --autofix`），不再经过 glob 这一层。
 * 2026-11-05 它已从 push 撤到每日档（ISSUE #2537），那一档**不带 `ifModify`**（每跑必判），
 * 触发面本身仍由 `docsApiTriggerGlobs()` 派生、由 `tests/docs-api-input-closure.test.ts`
 * 双向对账 —— 只是不再喂给这张表。 */
/* 2026-11-05 薄化：原本登记在这张表里的 14 条 PR 静态判据（标题行让位 / 文件结构硬规则 /
 * import 别名统一 / ComfyUI 端口口径 / 内联样式注入 / 跨文件重复块 / 函数长度 TS /
 * 函数长度 Rust / 模块循环依赖 / 主题色扫描 / 跨平台动作对照 / CHANGELOG 碎片 /
 * 端口推导跨语言一致性 / oxfmt 格式）随各自 stage 一起搬到 `.github/workflows/pr-gate.yml`。
 * 那边**没有 `ifModify`**（每次 PR 都跑），所以「配置里的手写 glob ⇄ 判据面」这条对账
 * 没有对象了；仍要守的是判据自己的面（见 `tests/ci-incremental-gates.test.ts`）。
 * 别照着历史把 `file-structure-rules.cjs` 的 `TRIGGER_GLOBS` 再取一遍 —— 取回来只会是
 * 一份没人读的副本。 */

/* ── 文档面那两条的触发面：同样**不手抄** ──────────────────────────────────────
 *
 * 2026-10-20（`0c6c8897`）把这两格在 `.cnb.yml` 里的原文注释掉了，理由是「收进聚合档」。
 * 但聚合档 `重档静态判据` 读的是**钩子注册表**，而这两条在 2026-10-16（`8d0d0b23`）
 * 就已经从钩子里撤走 —— 两次搬动方向相反，在中间对穿，于是这两条**一个执行者都没有**
 * （实测：`docs/api/**` 随后在无人看管下漂了 32 份）。
 *
 * 处置：恢复成各自的活 stage，`ifModify` 挂在这一格上（平台的 `ifModify` 是**按格**的，
 * 而复合执行者一条都不许挂 —— 见下面 `COMPOUND_EXECUTORS`）。触发面从判据自己那份
 * 声明里取，不在本表抄第二份（**2026-11-05 起本表只剩后一条**；前一条的历史保留作背景）：
 *   · `API 文档生成与自检` ⇒ `check-docs-api.cjs` 的 `INPUT_GLOBS`（它自己的
 *     输入面）。**产物面 `docs/api/**` 已不在面里**（ISSUE #2231）：产物不再进 git ⇒
 *     它既不在变更文件清单里、也不会被谁改坏 ⇒ 留在面里只是白占一行。
 *     ⚠️ **2026-10-23 订正（ISSUE #2223）**：那份「输入面」原先被称作「**上界**形态」，
 *     而它**不是上界** —— typedoc 沿 import 走，三根之外的文件也会进产物
 *     （`BackupResult` 定义在 `scripts/db-backup-core.mjs`，它出现在 `docs/api/**` 里）。
 *     面判窄了 = **漏判**，而漏判是静默的（这一格被 `ifModify` 跳过，与「判过且通过」
 *     在读数上无差别）。
 * ⚠️ **2026-11-05 再订正（ISSUE #2537 / 事故 #2528）**：只按 `entryPoints` 走的闭包
 *     仍然偏窄 —— typedoc **解析**的是 TS 程序（`tsconfig.json` 展开的根 ∪ 沿 import
 *     走到的文件），`entryPoints` 只决定渲染哪几页。`scripts/publish-desktop-bundle.mjs`
 *     正是被 `tests/**` import 进程序、却不在旧面里的那类 ⇒ 那一格静默跳格。
 *     现在面由 `scripts/docs-api-input-closure.mjs` 的 `docsApiTriggerGlobs()` **从解析根
 *     派生**（tsconfig 展开 ∩ git 跟踪文件 → `dir/**` + 根级 `*.<ext>`），由
 *     `tests/docs-api-input-closure.test.ts` 双向对账（事实面罩不住 ⇒ 红；面被改窄 ⇒ 红）。
 *     **同日起这一档从 push 撤到每日档**（无 `ifModify`）⇒ 上面这份派生面不再写进本表，
 *     但仍保留在判据的 `--staged` 档与上面那条对账里。
 *   · `生成态文档与源同步` ⇒ `doc-facts.cjs` 的 `SCOPED_DOCS`（源）与 `docs/generated/**`
 *     （产物）；源与产物**都在 `docs/**` 下面**，故取上界 `docs/**`（逐条抄 32 个路径
 *     就是第二份会漂的副本 —— 抄一份的漂移形态是「新增一篇文档忘了加进收窄面」）。
 */
/** `生成态文档与源同步` 的面：源（`SCOPED_DOCS`）与产物（`docs/generated/**`）同在 `docs/**`。 */
const DOC_PLACEHOLDER_GLOBS = ["docs/**"];

/**
 * stage 名 → 它的扫描面（`ifModify` glob 列表）。
 *
 * `globs` 里每一条都必须是 **`.cnb.yml` 里原样出现**的字符串：判据做的是字面比对，
 * 写在这里与写在那里是同一份事实的两个副本，漂了当场红。`why` 是给下一个人看的
 * 「为什么这条收窄是安全的」——它指向那份判据脚本里的常量名（那才是扫描面的
 * 唯一权威），别在这儿复述成第二份会过期的定义。
 *
 * @type {ReadonlyArray<{name: string, globs: readonly string[], why: string, script: string}>}
 */ export const INCREMENTAL_GATES = [
  {
    name: "生成态文档与源同步",
    globs: DOC_PLACEHOLDER_GLOBS,
    script: "scripts/render-doc-placeholders.cjs",
    why:
      "它判的是「`docs/generated/**` 里的生成态镜像 ⇄ `doc-facts.cjs` 的 `SCOPED_DOCS` 那些源」" +
      "同不同步 —— **源与产物两面都要看**，所以面是 `docs/**`（源与产物都在它下面；" +
      "逐条抄 32 个 `SCOPED_DOCS` 路径就是第二份会漂的副本，漂的形态是「新增一篇文档忘了加进收窄面」）。" +
      "⚠️ 代价写在明处：`SCOPED_DOCS` 与 `docs/**` 的包含关系由" +
      "`tests/ci-incremental-gates.test.ts` 核（源与产物两面都必须在面内）。",
  },
];

/** 表里登记的名字集合（判据与自测都用它，避免各处重算）。 */
export const INCREMENTAL_GATE_NAMES = new Set(INCREMENTAL_GATES.map((g) => g.name));

/**
 * **复合执行者**：一格装多条判据的 stage 名（此刻只有 `重档静态判据`）。
 *
 * 它们一条 `ifModify` 都不许挂 —— 理由写在文件头「复合执行者」那一节：
 * `ifModify` 是按整格跳过的，一格装十条时任何收窄都只能表达成「十条一起不跑」，
 * 而那十条的扫描面并不相同。
 *
 * ⚠️ 2026-10-22 订正一件事：**「收进复合执行者」不等于「收窄登记从本表删掉」**。
 * 2026-10-19 的合并把 `生成态文档与源同步` / `API 文档生成与自检` 的收窄登记删了
 * （理由是「收进去之后它们的执行者换了，登记表只收『一个执行者一条判据』的形态」），
 * 而 2026-10-20 又把它们在 `.cnb.yml` 里的原文注释掉（理由是「收进聚合档」）——
 * 两次搬动方向相反、在中间对穿，于是那两条**一个执行者都没有**。
 *
 * 现在的口径：**复合执行者的成员一律不挂 `ifModify`（这条不变）**；
 * 而**需要收窄的判据不进复合执行者**（它要自己的 `ifModify`，平台的 `ifModify` 是按格的）。
 * 本表收的每一条都对应「一个执行者一条判据」—— 那条判据的执行者是**它自己那一格**。
 *
 * @type {ReadonlyArray<string>}
 */
export const COMPOUND_EXECUTORS = ["重档静态判据"];

/**
 * 从 `.cnb.yml` 原文里解析出**每个 stage 的 `ifModify` 清单**。
 *
 * 解析口径与 `tests/no-platform-ci-config.test.ts` 的 `stageTimeouts()` 同构
 * （那一条已经在解析 `.cnb.yml`）：stage 列表项 = 恰好两空格缩进的 `- name: X`，
 * 它下面的 `ifModify:` 与随后的列表项属于它. `ifModify` 既可能是单行字符串，
 * 也可能是 `- glob` 形态的列表 —— 两种都读。
 *
 * 本函数只回答「配置里写了什么」，判据（该不该写、写得对不对）在测试那一侧。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Map<string, string[]>} stage 名 → `ifModify` globs
 */
export function parseStageIfModify(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const lines = text.split("\n");
  let current = null;
  let mode = null; // "list" | "scalar"

  for (const raw of lines) {
    // stage 列表项：恰好两空格缩进的 `- name: X`（`stages:` 的直接子项）。
    const item = /^ {2}-\s+name:\s*(?<name>\S.*?)\s*$/.exec(raw);
    const itemName = item?.groups?.name;
    if (itemName !== undefined) {
      current = itemName;
      mode = null;
      continue;
    }
    // 同级或更浅的键 = 这一项结束了（`env:`、顶层 `master:` 等）。
    if (current !== null && /^\S/.test(raw)) {
      current = null;
    }
    if (current === null) {
      continue;
    }

    // `ifModify:` 开一行（缩进 4 空格，与 `script:` / `timeout:` 同级）。
    const head = /^ {4}ifModify:\s*(?<inline>.*?)\s*$/.exec(raw);
    if (head) {
      const inline = head.groups?.inline ?? "";
      if (inline && !inline.startsWith("#")) {
        // 单行标量形态（`ifModify: "src/**"`）—— 去掉可能有的引号。
        mode = null;
        out.set(current, [inline.replaceAll(/^["']|["']$/g, "")]);
      } else {
        // 列表形态，后续 6 空格缩进的 `- glob` 属于它。
        mode = "list";
        out.set(current, []);
      }
      continue;
    }
    if (mode === "list") {
      const li = /^ {6}-\s+(?<glob>\S.*?)\s*$/.exec(raw);
      const glob = li?.groups?.glob;
      if (glob !== undefined) {
        out.get(current)?.push(glob.replaceAll(/^["']|["']$/g, ""));
        continue;
      }
      /* 非列表项的行 = 这一段结束了（下一键 / 缩进变化 / 注释）。注释行不算结束 ——
       * 清单里的注释是说明，夹在中间很正常。 */
      if (!/^\s*#/.test(raw) && raw.trim() !== "") {
        mode = null;
      }
    }
  }
  return out;
}

/**
 * 读仓库根上的 `.cnb.yml`（判据与自测的唯一入口，别各自拼路径）。
 * @returns {string}
 */
export function readCnbConfig(root = ROOT) {
  return fs.readFileSync(path.join(root, ".cnb.yml"), "utf8");
}

/**
 * 校验 `.cnb.yml` 与登记表是否双向同源。
 *
 * 这一份是**判据本体**，`tests/ci-incremental-gates.test.ts` 与 `--check` 档
 * 共用同一次结论（不造第二轮子，§12.18）。返回空数组 = 一致。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 逐条不一致（人读的话术）
 */
export function checkIncrementalGates(text) {
  const actual = parseStageIfModify(text);
  /** @type {string[]} */
  const problems = [];

  // 方向一：表里每条 ⇒ 配置里必须有同名 stage 且 globs 逐字一致。
  for (const gate of INCREMENTAL_GATES) {
    const got = actual.get(gate.name);
    if (got === undefined) {
      problems.push(
        `\`${gate.name}\` 在登记表里，但 .cnb.yml 里没有它的 \`ifModify\` —— ` +
          `「收窄名单」与配置漂了：要么补上 \`ifModify\`（${gate.globs.join(", ")}），` +
          `要么把它从 scripts/ci-incremental-gates.mjs 的 INCREMENTAL_GATES 里删掉`,
      );
      continue;
    }
    const want = [...gate.globs];
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
      problems.push(
        `\`${gate.name}\` 的 \`ifModify\` 与登记表不一致：配置 [${got.join(", ")}] ` +
          `≠ 表 [${want.join(", ")}]（${gate.script}）`,
      );
    }
  }

  // 方向二：配置里带 `ifModify` 的 stage ⇒ 必须在表里（不许绕过登记表直接收窄）。
  for (const name of actual.keys()) {
    if (!INCREMENTAL_GATE_NAMES.has(name)) {
      problems.push(
        `\`${name}\` 在 .cnb.yml 里带着 \`ifModify\`，但不在登记表里 —— ` +
          `「哪几条被收窄了」必须只有一处出处：把它登记进 ` +
          `scripts/ci-incremental-gates.mjs（含「为什么这条收窄是安全的」），` +
          `或者去掉那条 \`ifModify\`（默认档 = 任何改动都跑，这是安全方向）`,
      );
    }
  }

  /* 方向三：**复合执行者一条 `ifModify` 都不许挂**（文件头「复合执行者」那一节）。
   * 一格装十条判据时，`ifModify` 只能表达「十条一起跑」或「十条一起不跑」，而那十条的
   * 扫描面并不相同 —— 后者是「判据在场、结论静默变成放行」，比不收窄坏得多。 */
  for (const name of COMPOUND_EXECUTORS) {
    if (actual.has(name)) {
      problems.push(
        `\`${name}\` 是**复合执行者**（一格装多条判据，见 scripts/ci-heavy-gates.mjs），` +
          `它不许挂 \`ifModify\`：整格跳过会让格内那几条扫描面不同的判据一起静默放行。` +
          `要省时间请从条目那一侧想办法（例如条目自己判扫描面），别按格收窄`,
      );
    }
  }

  return problems;
}

/**
 * `--check` 档：把上面那份结论转成退出码（CI / 本地随手跑）。
 * 逻辑只在 `checkIncrementalGates()` 一处，本函数不重写判据。
 */
function main() {
  const problems = checkIncrementalGates(readCnbConfig());
  if (problems.length === 0) {
    console.log(
      `[ci-incremental] ✓ .cnb.yml 与登记表一致：${INCREMENTAL_GATES.length} 条 stage 带 ifModify（其余任何改动都跑）`,
    );
    return 0;
  }
  console.error(`[ci-incremental] ✗ 平台侧门禁的增量登记与配置不一致（${problems.length} 条）：`);
  for (const p of problems) {
    console.error(`[ci-incremental]   · ${p}`);
  }
  return 1;
}

/* ── 收窄面的两个出口（ISSUE #2255）───────────────────────────────────────
 *
 * 这张表原来只服务**平台那一格**（`.cnb.yml` 的 `ifModify`）。ISSUE #2255 的现场是：
 * 复合档（`scripts/ci-heavy-gates.mjs`）跑的是**钩子注册表整张**，于是那 13 条
 * 「在平台那一格被 `ifModify` 收窄」的判据，在复合档里**照跑全量** ⇒ 收窄白做
 * （本机实测 22.9s / 复合档逐条墙钟的 10.5%）。
 *
 * ⇒ 复合档也要用**同一张表**判面。两处用同一份 glob ⇒ 收窄的口径逐字一致
 * （`checkIncrementalGates()` 已经在核「表 ⇄ `.cnb.yml`」的双向一致）。
 */

/** glob → 正则：**复用**别处那份（`scripts/vitest-projects.cjs` 导出的 `globToRe` /
 * `matchesAny`）—— 另写一份就会与 vitest 收集面那套 `**` 语义漂开（那份的头注记着
 * 一次真实事故：「双星号 + 斜杠」翻错会让整条面匹配不到任何路径）。 */
const { matchesAny } = createRequire(import.meta.url)("./vitest-projects.cjs");

/**
 * 按**判据脚本**找它的那条收窄登记。
 *
 * 为什么按脚本而不按 stage 名：stage 名是平台那一侧的说法（`.cnb.yml` 里的 `- name:`），
 * 而复合档那一侧看到的是**钩子的步骤行**（标签 + 命令）—— 两边唯一的共同点是
 * 「这条判据是哪份脚本」。按脚本查 ⇒ 一条判据与它的面**必然**是同一条登记。
 *
 * @param {string} script 仓库相对路径（`scripts/xxx.cjs`）
 * @returns {{name: string, globs: readonly string[], why: string, script: string} | null}
 *   找不到 = 这条判据**没有**收窄面（那是不许收窄的形态：全仓不变量 / 前提类）
 */
export function narrowingEntryForScript(script) {
  const s = String(script ?? "").replaceAll("\\", "/");
  if (s === "") {
    return null;
  }
  return INCREMENTAL_GATES.find((e) => e.script === s) ?? null;
}

/**
 * 这次的改动面有没有碰到这条登记的面。
 *
 * 语义与平台的 `ifModify` **逐字同义**：变更文件一个都不落在给定 glob 内 ⇒ 跳过。
 *
 * ⚠️ **空清单不等于「没改」**：那是「不知道」——所以本函数对**空清单**返回 `true`
 * （= 照跑）。把「不知道」读成「没改」会让整批判据静默消失，而那正是本仓最贵的形态。
 *
 * @param {{globs: readonly string[]}} entry 收窄登记
 * @param {readonly string[]} files 改动面（仓库相对路径）
 * @returns {boolean} true = 碰到了（照跑）；false = 没碰到（可按面跳过）
 */
export function faceTouched(entry, files) {
  const globs = entry?.globs ?? [];
  /* 没有面 ⇒ 不许收窄（宁可多跑）：全仓不变量与前提类都在这一档里。 */
  if (globs.length === 0) {
    return true;
  }
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return true;
  }
  return list.some((f) => matchesAny(String(f ?? "").replaceAll("\\", "/"), globs));
}

/* 「是不是被直接执行」按 Node 自己的口径判 —— 这条踩过（ISSUE #1961 最后一格：
 * `file://${path.resolve(...)}` 在 Windows 上恒不相等，main() 一次都不跑、进程退 0）。
 * 用 argv[1] 与当前文件的 realpath 比较，平台无关。 */
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main());
}
