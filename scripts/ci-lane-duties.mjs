#!/usr/bin/env node
/**
 * ci-lane-duties.mjs — 「同一批 stage 可以在哪几条构建机上跑」的**唯一登记表**（ISSUE #1993）。
 *
 * ## 立案现场：不是「再加一条流水线」，是「一台机器上跑两套」
 *
 * 用户的原话是两半：①「在 WSL2 里重建一条 Linux 门禁链 —— **跑的不是同一套判据**，
 * 绿了为什么也不算证据」；②「能否一个机器跑 2 套 CI，一个处理 Linux 的（利用 WSL2 的
 * 高速），一个处理 Windows 独有的内容」。前一半是**结论**，后一半是**问法**。
 *
 * 前一半对 `.cnb.yml` 这条路**只对一半**：
 *
 *   · 平台侧那条自托管流水线（`.cnb.yml`）现在跑在**一台 Windows 节点**上，
 *     它的判据是**跨平台**的 Node 脚本（`scripts/check-*.cjs` 一族）；
 *   · 而 WSL2 上那条**本地**链（`.githooks/pre-commit`）跑的是**同一批**脚本
 *     （AGENTS 硬规则 7 与 §13.5.8 那张分工表：两边编排放得不一样，判据是同一份）。
 *
 * 所以「WSL2 里重跑一遍 = 换了一个执行者、判据一字未改」—— 它买到的是**速度**
 * （WSL2 的 ext4 比 Windows 侧跨 9p/DrvFs 快得多），**不是覆盖面**。有一条硬约束
 * （`tests/no-platform-ci-config.test.ts` 的「仓库根只允许出现登记在册的那一份 CI 形态」）
 * 正是为了挡住「再造一条只跑一部分判据的链」—— 那种链绿了确实不算证据：**缺的那几档
 * 不会红**。
 *
 * 后一半（Windows 独有的内容）在这台机器上**已经全在 Windows 节点上**：入口层是
 * `.ps1`、壳是 Rust + WebView2、打包是 MSI/NSIS。所以这张表要回答的不是「要不要加
 * 第二条流水线」（不），而是**「同一批 stage 里，哪些在 Linux 侧真的能跑、哪些只能在
 * Windows 上跑」** —— 因为这件事没有判据的话，下一个人会按直觉各写一份 `script`，
 * 而其中一半是错的（`$enc=[Text.Encoding]::UTF8` 是 PowerShell；`GetEncoding(936)`
 * 在 Linux 上会抛；`node_modules/.bin/tsc` 在新检出里是 `.cmd` 垫片）。
 *
 * ## 这张表怎么配 `.cnb.yml`（一一对应，不是第二份清单）
 *
 * 每条 `stage` 必须与 `.cnb.yml` 里的 stage 同名，且**落在正确的分支键下**：
 *
 *   · `master.pull_request`（事件 `pull_request`）—— 现行的**全量门禁**，跑在
 *     `runner.tags: [win]` 上。这条件路径没有 docker（§13.5.3.4.1），stage shell 是
 *     Windows PowerShell 5.1，日志编码那一套（§13.5.3.5 第 6 条）也只为它成立。
 *   · `linux.pull_request`（事件 `pull_request`）—— 同一条流水线的 **Linux 分身**，
 *     `runner.tags: [linux]`，stage shell 是 POSIX sh。它跑的是**同一批判据脚本、
 *     逐字相同的参数**，差别只有两处：外层外壳（`ci-sh-exit.mjs`，与 PowerShell 侧
 *     `ci-cp936-exit.mjs` 同职责：转码 + 转退出码）与宿主前提（`ci-toolchain-posix.mjs`）。
 *
 * 判据（`tests/ci-lanes.test.ts`）双向核对：配置里每个 stage 名在本表里有且只有一条，
 * 且声明的 `lanes` 与它**实际所在的分支键**一致。少任一半都会退化成「看着两条链，
 * 其实有一半 stage 只在一边跑，而没有任何东西会说」。
 *
 * ## 与 §13.5.18 / §13.5.19 两条登记表的关系
 *
 * 不重叠、也不互相替代：那两张回答「**什么时候**跳过」（`ifModify`）与「红了**能不能
 * 自动修**」（`--autofix`），这张回答「**在哪跑**」。一个 stage 可以同时是
 * 「Linux 也跑」+「按改动触发」+「不许自动修」，三份登记各写各的那一半。
 */

/** 两条构建机（`runner.tags` 的标签）。名字同时也是 `.cnb.yml` 的分支键名。 */
export const LANES = /** @type {const} */ ({
  win: "win",
  linux: "linux",
});

/**
 * 一条 stage 的链路归属。
 *
 * @typedef {object} LaneDuty
 * @property {string} stage `.cnb.yml` 里的 stage 名（字面比对）
 * @property {readonly ("win" | "linux")[]} lanes 它应该出现在哪几条链路上
 * @property {string} why 为什么是这几条（**不是**「为什么这条判据好」，是「为什么这条
 *   链路跑得起来 / 跑不起来」）
 */

/** @type {ReadonlyArray<LaneDuty>} */
export const LANE_DUTIES = [
  /* ── 两条链路都跑：判据是纯 Node，且它的域是两个宿主都有的东西 ───────────── */
  {
    stage: "工具链自证",
    lanes: ["win", "linux"],
    why:
      "两侧的判据都是 `scripts/ci-toolchain-selfcheck.mjs`（同一份：git / node / pnpm / Python），" +
      "差别只在**外壳** —— Windows 侧是 PowerShell 的编码纠正，Linux 侧**多跑一段** " +
      "`ci-toolchain-posix.mjs`（`bash` 在不在、coreutils 齐不齐、`python3` 有没有：那三格在 " +
      "PowerShell 上根本不存在，而「答不出来」与「没有装」在日志里逐字同形）。" +
      "两边都跑，是因为「这台机器够不够跑门禁链」这件事在两侧都必须先被回答。",
  },
  {
    stage: "Python 可用性",
    lanes: ["win", "linux"],
    why:
      "`findPython()` / `installPython()` 两平台各有一套（POSIX 侧只认 apt / dnf / apk / brew，" +
      "不替人 sudo —— 见 `ci-toolchain-python.mjs` 的 `installPythonPosix`）。Linux 节点必须自己判一次：" +
      "缺解释器时那几条实证用例会**静默少判**（§13.5.3.5），少判与「判了且通过」在日志里同形。",
  },
  {
    stage: "Python 探针读数",
    lanes: ["win", "linux"],
    why:
      "同一份 `python-probe.mjs`，它打印两套解析链各自的结论（`findPython` 起裸名字 vs " +
      "`resolvePython` 扫 PATH），而这两条链在 Linux 上的差异与 Windows 上**不一样**" +
      "（POSIX 有执行位、没有 PATHEXT）—— 恰恰更需要两侧的读数摆在一起才分得出是谁错。",
  },
  {
    stage: "环境前提",
    lanes: ["win", "linux"],
    why:
      "三格里有两格跨平台（解释器版本下限、浏览器落点与下载根通不通），第三格" +
      "（`.cnb.yml` 的 PowerShell 5.1 语法面）在 Linux 上**退化成一条读数**而不是判据 —— " +
      "那一格本来就是 Windows 宿主的，Linux 侧只打印、不判红。共用一个脚本，正是因为" +
      "「哪一格在哪个宿主上算判据」只有一处决定（`ci-env-probe.mjs` 的平台分档）。",
  },
  {
    stage: "Install dependencies",
    lanes: ["win", "linux"],
    why:
      "同一份 `ci-install-deps.mjs` 的判定（依赖面没动就不装），差别只在它调 `pnpm` 的形态 —— " +
      "那一条走 `launcher-core/shell.mjs` 的 `pnpmInvocation()`（唯一出口，两平台都收口在那里）。" +
      "原生依赖（better-sqlite3）两侧各编各的，所以两侧都必须真装一次。",
  },
  {
    stage: "分支守卫",
    lanes: ["win", "linux"],
    why:
      "`check-branch-guard.cjs` 判的是 git 拓扑（HEAD 父提交数 / `--pr-check` / `--merge-commit`），" +
      "与宿主无关。两侧都跑是**冗余**，但冗余在这条上是好事：`--pr-check` 在平台侧只有一份，" +
      "而它是 master 那三层防线里本地看不到的那一层（§13.6.1）。",
  },
  {
    stage: "新鲜度账",
    lanes: ["win", "linux"],
    why:
      "`freshness-gate.mjs` 读的是三份 `scripts/.*-freshness.json` 与 git 日期，纯文本 + git 调用。" +
      "⚠️ 两侧的账文件**不是同一份事实**：它记的是「上一次被实证跑绿」的时刻，而两侧" +
      "跑绿的时刻天然不同。这条在两侧都跑是为了让「源分支上的账是不是旧的」在合并之前" +
      "被机器说出来（§13.5.17），不是为了省时间。",
  },
  {
    stage: "同步数据库表结构",
    lanes: ["win", "linux"],
    why:
      "`db-push.mjs` 走 drizzle + better-sqlite3，两侧各编各的原生模块 —— 而「表结构同步不过去」" +
      "在两侧的成因不同（Windows 上是文件锁、POSIX 上是权限），所以两侧都得真跑一次。" +
      "后面的 E2E 要真读到库，故它必须排在前面（两侧同序）。",
  },
  {
    stage: "类型检查",
    lanes: ["win", "linux"],
    why:
      "`tsc --noEmit` 的判据是同一份 `tsconfig`，但**入口的解析面**在两侧不同：" +
      "新检出的 Linux 上是 `node_modules/.bin/tsc` 的符号链接，Windows 上是 `.cmd` 垫片。" +
      "两侧都跑，才验得到「这条运行时解析面在每个宿主上都成立」。",
  },
  {
    stage: "标题行让位",
    lanes: ["win", "linux"],
    why: "扫描面是 `src/components` + `src/app` 的源码文本，零平台判据 —— 两侧跑的是同一个结论。",
  },
  {
    stage: "文件结构硬规则",
    lanes: ["win", "linux"],
    why: "纯文本扫描（+ 一次 `git ls-files`），零平台判据。它是硬闸，所以两侧都必须在 —— 只在一侧跑等于让另一侧没有这条闸。",
  },
  {
    stage: "跨平台动作对照",
    lanes: ["win", "linux"],
    why:
      "它判的恰恰就是「跨平台动作两侧都在」这件事 —— 让它在**两个宿主上都跑**，" +
      "这条判据自己才不是「只在一个平台上被验过的跨平台承诺」。",
  },
  {
    stage: "import 别名统一",
    lanes: ["win", "linux"],
    why: "读的是静态模块说明符（`.ts` / `.tsx` / `.e2e` 里的 import 写法），零平台判据。",
  },
  {
    stage: "ComfyUI 端口口径",
    lanes: ["win", "linux"],
    why: "读的是几份端口来源文件与常量（`src/lib/comfyui/**` 与 `endpoints.ts`），零平台判据。",
  },
  {
    stage: "内联样式注入",
    lanes: ["win", "linux"],
    why: "读的是渲染层的源码文本（`<style>` 只可能写在 `src/**` 里），零平台判据。",
  },
  {
    stage: "跨文件重复块",
    lanes: ["win", "linux"],
    why: "读的是 `src/**` 的源码文本（孪生对只在应用代码里找），零平台判据。",
  },
  {
    stage: "函数长度 TS",
    lanes: ["win", "linux"],
    why: "读的是源码文本（符号表与函数边界都由文本算），零平台判据。",
  },
  {
    stage: "函数长度 Rust",
    lanes: ["win", "linux"],
    why:
      "它扫的是 `src-tauri/src/**` 的**文本**（不编译 Rust），所以 Linux 上跑得起来。" +
      "⚠️ 别把它读成「Linux 上验得了壳」—— 壳的编译与 `cargo test` 只在 Windows 上跑" +
      "（见下面 `生产构建` 那条与 §13.5.3.5）。",
  },
  {
    stage: "模块循环依赖",
    lanes: ["win", "linux"],
    why: "读的是静态 import 图（不执行任何模块），零平台判据。",
  },
  {
    stage: "端口推导跨语言一致性",
    lanes: ["win", "linux"],
    why:
      "四侧（Node / PowerShell / Python / Rust）共用同一份校验向量，而 Python 那一侧" +
      "在 Linux 上是**真跑**的（POSIX 一定有 python3），Windows 上反而常常 `missing`" +
      "（§13.5.3.5 那张表）。两侧都跑，四侧比对才真的四侧。（§1.1 的口径不变：别在文档里写死端口号。）",
  },
  {
    stage: "CHANGELOG 碎片",
    lanes: ["win", "linux"],
    why: "读的是 `changelog.d/**` 的文件名与首行，零平台判据。",
  },
  {
    stage: "主题色扫描",
    lanes: ["win", "linux"],
    why: "读的是源码文本里的颜色字面量（不解析 CSS 引擎），零平台判据。",
  },
  {
    stage: "UI/逻辑分离",
    lanes: ["win", "linux"],
    why: "读的是视图层源码文本。它是硬闸，两侧都必须在 —— 只在一侧跑等于让另一侧没有这条闸。",
  },
  {
    stage: "lib Node-only 声明",
    lanes: ["win", "linux"],
    why: "跑的是 vitest 的单文件档（纯 Node，不起浏览器），与宿主无关。",
  },
  {
    stage: "格式化提交分离",
    lanes: ["win", "linux"],
    why: "读的是暂存 / 提交的 diff 形态（git 拓扑 + 行类型），零平台判据。",
  },
  {
    stage: "生成态文档与源同步",
    lanes: ["win", "linux"],
    why:
      "`render-doc-placeholders.cjs --check --autofix` 是跨平台 Node 脚本；产物是文本。" +
      "⚠️ 它带自动修（§13.5.19），而在 Linux 上自动修的文件**回不去**任何分支" +
      "（CI 工作区是只读检出）—— 与 Windows 侧逐字同一条边界，不因为换宿主而变。",
  },
  {
    stage: "API 文档生成物与源同步",
    lanes: ["win", "linux"],
    why:
      "typedoc 跨平台，产物是文本 —— 而**它恰恰是最该在 Linux 上跑的那一档**：" +
      "201.8s / 整条流水线 27.5%（§13.5.20），而 WSL2 的 I/O 比 Windows 侧快得多。",
  },
  {
    stage: "覆盖率上报",
    lanes: ["win", "linux"],
    why:
      "`ci-coverage-report.mjs` 读 `coverage/lcov.info`；没有报告时只跳过、不判红" +
      "（ISSUE #1990）。两侧都挂，是因为哪一侧跑出了报告取决于 `单元测试` 在哪一侧被启用。",
  },
  {
    stage: "文档引用与权威源一致",
    lanes: ["win", "linux"],
    why: "读的是全库文档与权威源文本（含 AGENTS 那份台账），零平台判据。",
  },
  {
    stage: "core 骨架单一事实源",
    lanes: ["win", "linux"],
    why: "跑的是 vitest 的单文件档（纯 Node，不起浏览器），与宿主无关。",
  },
  {
    stage: "零消费导出",
    lanes: ["win", "linux"],
    why: "读的是静态导出与引用图（`src/lib` + `src/trpc` 的零消费值导出），零平台判据。",
  },
  {
    stage: "core 出口纪律与基类纯度",
    lanes: ["win", "linux"],
    why: "跑的是 vitest 的单文件档（纯 Node，不起浏览器），与宿主无关。",
  },
  {
    stage: "生产构建",
    lanes: ["win", "linux"],
    why:
      "`next build` + 数产物 + 冒烟，两侧都要跑 —— **理由不是冗余**：这条链里有几格" +
      "只在某一侧才暴露（`standalone` 产物的符号链接与可执行位、`check-standalone-contents` " +
      "按形状数的顶层清单）。而它**也不是**「Linux 上验得了桌面包」：壳要 Rust + WebView2，" +
      "那部分只在 Windows 上（AGENTS 硬规则 5，两侧都不跑 `cargo build`）。",
  },
  {
    stage: "浏览器安装",
    lanes: ["win", "linux"],
    why:
      "`--playwright-only` 自取 + 复验；两侧的落点与下载根不同（Windows 是 " +
      "`ms-playwright\\…\\chrome-headless-shell.exe`，Linux 是 `ms-playwright/…/`），" +
      "而「自取」那条通道两侧共用。E2E 依赖它，故两侧都要先答。",
  },
  {
    stage: "E2E 关键流程",
    lanes: ["win", "linux"],
    why:
      "`--grep=@critical` 那条主链路。⚠️ 页面级运行时读数**按平台各自一份基线**" +
      "（`e2e/runtime-budget.spec.ts`：win32 与 posix 差 2.2×）—— 所以这条在 Linux 上" +
      "跑的是 posix 那一档基线，不是「同一份数字换个宿主」。",
  },

  /* ── 只有 Windows 侧有的一条：合并形态复核（`push` 事件）─────────────────────── */
  {
    stage: "合并形态复核",
    lanes: ["win"],
    why:
      "`check-branch-guard.cjs --merge-commit` 挂在 **`push` 事件**上（「落到 master 的必须是 " +
      "PR 合并形态」）。它按拓扑判（HEAD 父提交数），本身跨平台 —— 只给 Windows 是因为" +
      "**同一件事不该挂两条链**：两条链各跑一遍 merge-commit 复核，红的时候人会以为是" +
      "两处不同的问题。要迁到 Linux，改这一行 `lanes` 并同批挪 `.cnb.yml` 的键，判据会拦住漏改。",
  },
];

/** 表里登记过的 stage 名（判据与自测共用）。 */
export const LANE_DUTY_NAMES = new Set(LANE_DUTIES.map((d) => d.stage));

/**
 * 挂在某条 stage **内部**、只有某一侧才跑的那几段（stage 级登记表达不了它们）。
 *
 * 为什么单列一张：`LANE_DUTIES` 按 stage 名索引，而「Linux 侧多跑一段 POSIX 宿主自证」
 * 不是一条独立 stage —— 它就在 `工具链自证` 的脚本第 1 行。把它挤进 `LANE_DUTIES`
 * （同名两条）会让 `LANE_DUTY_NAMES` 少一个名字、判据跟着错位；不给它任何登记，
 * 「某一侧悄悄多跑了一段、或者某天被删掉了」就没有任何东西看得见。
 *
 * 判据（`tests/ci-lanes.test.ts`）要求：`entry` 出现在 `stage` 那一步的脚本里、
 * **且只出现在它声明的那条链路上**（win 侧不许出现 `ci-toolchain-posix.mjs`）。
 *
 * @typedef {object} LaneOnlyStep
 * @property {string} stage 它挂在哪个 stage 里
 * @property {"win" | "linux"} lane 它只在哪条链路上跑
 * @property {string} entry 脚本里必须出现的入口（仓库相对路径）
 * @property {string} why 为什么只有这一侧需要它
 */

/** @type {ReadonlyArray<LaneOnlyStep>} */
export const LANE_ONLY_STEPS = [
  {
    stage: "工具链自证",
    lane: "win",
    entry: "scripts/ci-console-encoding.mjs",
    why:
      "把控制台输出编码钉成 UTF-8（`chcp` + `[Console]::OutputEncoding`）只在**中文 Windows** 上" +
      "有意义：POSIX 上抓取端与子进程都是 UTF-8，没有那一跳要纠正（实测：这一跳在 Linux 上" +
      "恒退 0、什么都不改）。它留在 Windows 侧不是可选项 —— §13.5.3.5 记着不钉它的后果是" +
      "**红的时候最该读的那几行正好是乱码**。",
  },
  {
    stage: "工具链自证",
    lane: "linux",
    entry: "scripts/ci-toolchain-posix.mjs",
    why:
      "Windows 侧的前提由 `工具链自证`（corepack 三个形态）+ `Install dependencies` " +
      "（`check-pnpm-available.mjs`）的语言原生形态答完了；POSIX 侧有三格在那两份里" +
      "**根本不存在**：`bash`（stage shell 本身就是它，缺了后面每一步的失败都与判据无关）、" +
      "coreutils（`mktemp` / `sha256sum` / `timeout`，门禁链里有子进程要它们）、" +
      "`python3`（处置归 `Python 可用性`，这里只留读数）。",
  },
];

/**
 * 从 `.cnb.yml` 原文里解析出**每个分支键下有哪些 stage**。
 *
 * 解析口径与 `scripts/ci-incremental-gates.mjs` 的 `parseStageIfModify()` /
 * `scripts/ci-autofix-duties.mjs` 的 `parseStageScripts()` 同构（stage 列表项 =
 * 恰好两空格缩进的 `- name: X`）—— 三处都在回答「配置里写了什么」，同一份缩进口径，
 * 别各自发明一套。
 *
 * 与那两份的唯一差别：本函数要**按顶层分支键分组**（`master:` / `linux:`），
 * 因为「在哪条链路上」正是靠这个分组的。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Map<string, string[]>} 分支键 → stage 名（按配置顺序，**所有事件合并**）
 */
export function parseLaneStages(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  /* 先收「锚点里的 stage 名」：`.gates: &gates` 那一份是**两条链路共用的**正文，
   * 而两条链路都写成 `stages: *gates`（引用锚点）。只看 `- name:` 那一列会让
   * 「哪条链路跑了哪些 stage」对一个真配置**一条都答不出来** —— 实测：只认直写的
   * 列表项时 `win` 与 `linux` 各 0 条，而配置里明明各有 35 条。
   * 所以这里要按**合并语义**读：`名字: &anchor` 收集正文，`名字: *anchor` 展开。 */
  /** @type {Map<string, string[]>} */
  const anchors = new Map();
  const lines = text.split("\n");
  /**
   * 从 `from` 起按缩进收口，收出这一块里的 stage 名。
   *
   * @param {number} from
   * @param {number} indent 这一块的键缩进（正文比它更深）
   * @returns {string[]}
   */
  const namesUnder = (from, indent) => {
    /** @type {string[]} */
    const got = [];
    for (let i = from; i < lines.length; i += 1) {
      const raw = lines[i] ?? "";
      if (raw.trim() === "") continue;
      const depth = raw.length - raw.trimStart().length;
      if (depth <= indent) break;
      const item = /^\s{2,}-\s+name:\s*(\S.*?)\s*$/.exec(raw);
      if (item?.[1] !== undefined) got.push(item[1]);
    }
    return got;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const def = /^([A-Za-z_.][\w.-]*):\s*&(\w+)\s*$/.exec(lines[i] ?? "");
    /* 锚点定义（`.gates: &gates`）：正文就是**紧接着的那一串 stage 列表项**，
     * 缩进比 0 深，所以 `namesUnder(i + 1, 0)` 正合适 —— 遇到下一个零缩进的顶层键
     * 就收口（那正是锚点的边界）。 */
    if (def?.[2] !== undefined) anchors.set(def[2], namesUnder(i + 1, 0));
  }
  /** @type {string | null} */
  let lane = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 顶层键（零缩进、`名字:`）—— `win:` / `linux:` 是链路键，`.common:` / `.gates:`
     * 是锚点，也落进 `lane`；它们下面的 stage 由调用方按登记表筛掉。 */
    const top = /^([A-Za-z_.][\w.-]*):\s*(?:&\w+)?\s*$/.exec(raw);
    if (top?.[1] !== undefined) {
      lane = top[1];
      if (!out.has(lane)) out.set(lane, []);
      continue;
    }
    /* 链路里的 `stages:` —— 两档：`stages: *anchor`（引用）与 `stages:` 后跟列表。 */
    const ref = /^(\s*)stages:\s*\*(\w+)\s*$/.exec(raw);
    if (ref && lane !== null) {
      const got = anchors.get(ref[2] ?? "") ?? [];
      out.set(lane, [...(out.get(lane) ?? []), ...got]);
      continue;
    }
    const literal = /^(\s*)stages:\s*$/.exec(raw);
    if (literal && lane !== null) {
      out.set(lane, [
        ...(out.get(lane) ?? []),
        ...namesUnder(i + 1, (literal[1] ?? "").length),
      ]);
      continue;
    }
  }
  return out;
}

/**
 * 校验 `.cnb.yml` 与登记表是否双向同源 —— 判据本体。
 *
 * 三个方向，缺一条都会退化成「看着两条链，其实有一半没跑」：
 *
 *   ① 表里每条 ⇒ 配置里**确实**在它声明的那几条分支键下出现（漏写 = 该跑没跑）；
 *   ② 配置里每个 stage ⇒ 表里有它（`linux:` 下凭空多一个 stage 也是漂）；
 *   ③ 表里声明的 `lanes` 与配置里实际所在的键**逐字一致**（把一条只该在 Windows 上
 *      跑的东西挪到 Linux 上，或者反过来，都红）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 逐条不一致（人读的话术）
 */
export function checkLaneDuties(text) {
  const actual = parseLaneStages(text);
  /** @type {string[]} */
  const problems = [];

  for (const duty of LANE_DUTIES) {
    for (const lane of duty.lanes) {
      const stages = actual.get(lane);
      if (stages === undefined) {
        problems.push(
          `\`${duty.stage}\` 登记为在 \`${lane}\` 链路上跑，但 .cnb.yml 里没有 \`${lane}:\` 这个分支键`,
        );
        continue;
      }
      if (!stages.includes(duty.stage)) {
        problems.push(
          `\`${duty.stage}\` 在登记表里写着要跑在 \`${lane}\` 链路上，配置里却没有它 —— ` +
            `要么补上那一步，要么把 \`${lane}\` 从 scripts/ci-lane-duties.mjs 的 LANE_DUTIES 里删掉` +
            `（为什么它会在这条链路上：${duty.why}）`,
        );
      }
    }
    /* 反向：配置里出现了它、而 lanes 里没写那条 —— 只有 `master:` / `linux:` 两组
     * 分支键算「链路」（`.common` / `.gates` 是锚点，不是链路）。 */
    for (const lane of [LANES.win, LANES.linux]) {
      if (duty.lanes.includes(/** @type {never} */ (lane))) continue;
      if ((actual.get(lane) ?? []).includes(duty.stage)) {
        problems.push(
          `\`${duty.stage}\` 出现在 \`${lane}:\` 下，但登记表里它的 lanes 是 [${duty.lanes.join(", ")}] —— ` +
            `「在哪条链路上跑」必须只有一处出处`,
        );
      }
    }
  }

  for (const lane of [LANES.win, LANES.linux]) {
    for (const name of actual.get(lane) ?? []) {
      if (!LANE_DUTY_NAMES.has(name)) {
        problems.push(
          `\`${lane}:\` 下的 \`${name}\` 不在登记表里 —— 新增一条 stage 时要同批回答` +
            `「它该在哪几条链路上跑、为什么」（scripts/ci-lane-duties.mjs）`,
        );
      }
    }
  }

  return problems;
}

/**
 * 按**事件**分的解析（`分支键 → 事件 → stage 名`）。
 *
 * 为什么要多这一份：`win:` 有两个事件（`pull_request` 的全套门禁与 `push` 的合并形态
 * 复核），合在一起读会让「两条链路的 stage 名单逐字相同」那条判据拿 win 的 `push`
 * 专属那一条去和 linux 比 —— 那是个**假红**（人以为要补 stage，其实要比的是同一个事件）。
 *
 * 复用 `parseLaneStages()` 的结果再按事件切一遍**是错的**（合并后已经丢了归属），
 * 所以这里按同一套缩进口径自己走一遍。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} lane 分支键名
 * @param {string} event 事件键名（`pull_request` / `push`）
 * @returns {string[]} 该分支该事件下第一条流水线的 stage 名（锚点已展开）
 */
export function parseLaneEventStages(text, lane, event) {
  /** @type {Map<string, string[]>} */
  const anchors = new Map();
  const lines = text.split("\n");
  /**
   * @param {number} from
   * @param {number} indent
   * @returns {string[]}
   */
  const namesUnder = (from, indent) => {
    /** @type {string[]} */
    const got = [];
    for (let i = from; i < lines.length; i += 1) {
      const raw = lines[i] ?? "";
      if (raw.trim() === "") continue;
      if (raw.length - raw.trimStart().length <= indent) break;
      const item = /^\s{2,}-\s+name:\s*(\S.*?)\s*$/.exec(raw);
      if (item?.[1] !== undefined) got.push(item[1]);
    }
    return got;
  };
  lines.forEach((raw, i) => {
    const def = /^([A-Za-z_.][\w.-]*):\s*&(\w+)\s*$/.exec(raw);
    if (def?.[2] !== undefined) anchors.set(def[2], namesUnder(i + 1, 0));
  });

  /* 找 `lane:` 那一块，把它按 `  event:` 再切一层。 */
  const laneAt = lines.findIndex((l) => l === `${lane}:`);
  if (laneAt < 0) return [];
  const block = [];
  for (let i = laneAt + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\S/.test(raw)) break;
    block.push(raw);
  }
  const eventAt = block.findIndex((l) => l === `  ${event}:`);
  if (eventAt < 0) return [];
  /** @type {string[]} */
  const got = [];
  for (let i = eventAt + 1; i < block.length; i += 1) {
    const raw = block[i] ?? "";
    if (/^ {2}[A-Za-z_]/.test(raw) || /^\S/.test(raw)) break;
    const ref = /^\s*stages:\s*\*(\w+)\s*$/.exec(raw);
    if (ref?.[1] !== undefined) {
      got.push(...(anchors.get(ref[1]) ?? []));
      continue;
    }
    const literal = /^(\s*)stages:\s*$/.exec(raw);
    if (literal) {
      /* 直写列表：从下一行起按缩进收口（注意这里是**块内**，用绝对行号不方便，
       * 就地收够即可）。 */
      const base = (literal[1] ?? "").length;
      for (let k = i + 1; k < block.length; k += 1) {
        const row = block[k] ?? "";
        if (row.trim() === "") continue;
        if (row.length - row.trimStart().length <= base) break;
        const item = /^\s{2,}-\s+name:\s*(\S.*?)\s*$/.exec(row);
        if (item?.[1] !== undefined) got.push(item[1]);
      }
    }
  }
  return got;
}
