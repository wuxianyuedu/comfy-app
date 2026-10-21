/**
 * 平台侧自动触发的流水线配置：**要么没有，要么必须是「自托管 + 已登记」的那一份**。
 *
 * 这条判据经历过一次**决策反转**（ISSUE #623 → #1229 → #1959），反转的是结论、
 * 不是「要不要有判据」这件事本身，所以本文件改名不改职责。
 *
 * ── 三代形态（读这份文件前先看懂它为什么长这样）─────────────────────────
 *
 * 1. **#623**：额度约束下删掉 `.cnb.yml`（160 核时/月，`cpus: 8` 一个月约二十次
 *    PR 就吃光）→ 结论是「本仓不该有平台侧配置」；
 * 2. **#1229**：一份新的 `.cnb.yml` 被加了回来，却因为顶层直接写 `stages:` /
 *    `jobs:`（而非 CNB 的 `分支: { 事件: [流水线] }` 形态）**匹配不到任何事件**
 *    —— 静默失效，比删掉还糟。于是本文件把「别再补回从不触发的 CI 配置」做成机器判据；
 * 3. **#1959（当前）**：根组织接入了**自托管 Windows 构建节点**（标签 `win`）。
 *    官方文档「限制」一节写明自托管 Runner **不参与核时计费**，于是 #623 的全部
 *    推理（建立在计费上）**对这条件路径不再成立**，配置按完整流程回来了。
 *
 * ── 反转之后判据守什么（三类）─────────────────────────────────────────
 *
 * 反转不等于把守门拆掉 —— 恰恰因为 `.cnb.yml` 现在**真的在跑**，那份配置的形态
 * 变成了一条需要被判据钉住的事实（写错了会静默失效或静默花回核时）：
 *
 * 1. **形态**：顶层必须是 `分支: { 事件: [流水线] }`（#1229 的根因）；
 *    必须声明 `runner.namespace: group` + 非空 `tags`（漏掉 = 静默回落到计费的平台池）；
 *    必须声明 `pull_request` 与 `push` 两个事件。
 * 2. **反向注销**：`scripts/doc-facts.cjs` 现在**必须**把 `.cnb.yml` 登记成 path 类
 *    事实（它真的存在了），而规范正文**必须**留下「为什么这次能回来」的锚点句 ——
 *    缺了说明决策被悄悄推翻、文件面判据还没跟着变（与 #1229 那次同形，只是方向相反）。
 * 3. **不许等于「平台侧没有兜底」的旧口径**：仓库里任何地方再写「本仓没有 CI」
 *    都会与现状矛盾，所以那条旧锚点句必须已被改写（`scripts/check-doc-references.cjs`
 *    与本文档引用判据各自覆盖一半，这里只钉住最容易被抄的一句）。
 *
 * 扫描面本身由「判据不是空转」那组用例复算：掏空清单或把匹配逻辑改坏时，
 * 前面几条用例会一起变成恒绿，那是本文件最坏的失效形态。它守的是全库级不变量，
 * 因此登记在 `scripts/affected-tests.mjs` 的固定清单里，每次提交都跑。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/* 每个 stage 现在都以 `node scripts/ci-cp936-exit.mjs -- <真命令>` 起（ISSUE #1977），
 * 而下面那条「这一步点名的入口在不在盘上」判据抓的是 `scripts/…` —— 不剥外壳就会
 * 抓到外壳自己（它当然在盘上），判据从「接线对不对」退化成「外壳在不在」。 */
import { unwrapCp936 } from "../scripts/ci-cp936-exit.mjs";
import { HEAVY_GATES } from "../scripts/ci-heavy-gates.mjs";
/* 预算这一格的判据要拿**脚本自己那份预算**当基准，而不是在测试里再抄一个常数：
 * 抄一份的话「改了脚本预算、忘了改配置」两种漂移里只会看见一种。 */
import { FULL_SUITE_TIMEOUT_MS } from "../scripts/full-suite-run.mjs";
import { FRESHNESS_TRACKS } from "../scripts/freshness-ledger.mjs";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 自动触发型 CI 配置的仓库相对路径（确切名字，文件形态）。
 *
 * 只收「平台一读就无条件跑」的那些；`.cnb.yml` 是本仓库的当前形态，其余是
 * 「顺手换个平台」的等价形态 —— 判据要拦的是**这件事**，不是某一个文件名。
 * **本仓此刻允许存在的只有 `.cnb.yml` 一项**，多出来的任何一项仍是违规。
 */
const CI_CONFIG_FILES = [
  ".cnb.yml",
  ".cnb.yaml",
  ".gitlab-ci.yml",
  "azure-pipelines.yml",
  ".drone.yml",
  ".woodpecker.yml",
  "Jenkinsfile",
];

/** 目录形态的 CI 配置位。 */
const CI_CONFIG_PATHS = [".github/workflows", ".buildkite/pipeline.yml"];

/**
 * 本仓当前**登记在册**的平台侧配置（其余任何 CI 形态都不许出现）。
 *
 * 收成具名常量而不是 `[0]` 下标：本文件在提交门槛的固定清单里、每次提交都跑，
 * 而 `noUncheckedIndexedAccess` 下每个下标访问都是一次「可能 undefined」——
 * 那会把「这份配置叫什么」这件事摊成满文件的可选链，反而看不出意图。
 */
const REGISTERED_CI_CONFIG = ".cnb.yml";
const REGISTERED_CI_CONFIGS: readonly string[] = [REGISTERED_CI_CONFIG];

const CI_NAMES = new Set([...CI_CONFIG_FILES, ...CI_CONFIG_PATHS]);

/** 从一组仓库相对路径里挑出「是 CI 配置」的那些（匹配逻辑，可复算）。 */
export function ciConfigsAmong(entries: string[]): string[] {
  return entries.filter((rel) => CI_NAMES.has(rel));
}

/** 仓库根的一层目录项 + 已知 CI 目录位（判据的真实扫描面）。 */
function repoTopLevel(): string[] {
  const top = readdirSync(ROOT, { withFileTypes: true }).map((e) => e.name);
  const nested = CI_CONFIG_PATHS.filter((rel) =>
    existsSync(path.join(ROOT, ...rel.split("/"))),
  );
  return [...top, ...nested];
}

/**
 * 平台侧配置的**形态契约** —— 每一条都是「写错了不报错、只是静默不干该干的事」
 * 的那一类，所以必须由判据而不是由注释守。
 *
 * 以文本形态核对（不引 YAML 解析器：本文件在提交门槛的固定清单里，每次提交都跑，
 * 加依赖的代价与收益不成比例；下面每条的匹配面都窄到不会误伤注释里的措辞）。
 */
const CONFIG_SHAPE: Array<{ mustMatch: RegExp; why: string }> = [
  {
    mustMatch: /^master:\s*$/m,
    why: "顶层必须是「分支: { 事件: [流水线] }」形态（#1229 的根因是顶层直接写 stages:/jobs:，匹配不到任何事件）",
  },
  {
    mustMatch: /namespace:\s*group\b/,
    why: "必须声明 runner.namespace: group，否则会静默回落到计费的平台公共池",
  },
  {
    mustMatch: /^\s*tags:\s*\n\s+-\s*\S+/m,
    why: "必须声明非空 tags（「与」关系，每个 tag 都要出现在节点标签上）",
  },
  {
    mustMatch: /^\s*pull_request:\s*$/m,
    why: "必须挂 pull_request（质量门禁不合并就该拦住）",
  },
  {
    mustMatch: /^\s*push:\s*$/m,
    why: "必须挂 push（master 合并形态复核）",
  },
  {
    mustMatch:
      /^ {2}"crontab: [0-9*,\/-]+ [0-9*,\/-]+ [0-9*,\/-]+ [0-9*,\/-]+ [0-9*,\/-]+":\s*$/m,
    why:
      "必须挂一条 crontab（生产构建每天一次，ISSUE #2010）：定时任务的分支键只认**明确的单一分支名**，" +
      '而事件键必须写成 `"crontab: <5 段 POSIX cron>"` —— 写成 `crontab:` 映射或 `schedule` 都不会报错，只是永远不触发',
  },
];

/**
 * **stage script 用的 PowerShell 语法必须与宿主 5.1 兼容**。
 *
 * 为什么这条要有判据：`.cnb.yml` 的 stage script 在自托管 Windows 节点上默认由
 * **Windows PowerShell 5.1** 执行（与 `scripts/entry-common.ps1` 的
 * `#Requires -Version 5.1` 同一口径 —— 仓库两侧都支持，所以配置里不许只用 7 的语法）。
 * 而 PS 7 的好几种写法在 5.1 里是**解析期错误**：整段脚本**一行都不执行**就非零退出，
 * 报错还停在语法上，与这一步要回答的问题毫无关系。
 *
 * 实测栽过一次（#1959 第三次首跑）：`$winget = (Get-Command winget …)?.Source`
 * 里的 `?.`（null 条件运算符，PS 7 才有）让这一步在 **0.9 秒**就红，读数
 * `工具链自证 error [0.9s]`，连开头的 `== OS ==` 都没打出来 —— 形态与「宿主缺
 * 工具链」逐字同形，而真因是运算符不属于这个语言版本。
 *
 * 判据按**码位**扫 script 块的代码行（先剥行内注释），只认那几种「7 有、5.1 没有」
 * 的形状；每一条都是解析期错误、不会有「其实 5.1 也认」的中间态。
 */
const PS7_ONLY: Array<{ pattern: RegExp; what: string; instead: string }> = [
  {
    pattern: /\?\./,
    what: "`?.` null 条件运算符（PS 7+）",
    instead:
      "先 `$o = Get-Command X -ErrorAction SilentlyContinue` 再 `if ($o) { $o.Source }`",
  },
  {
    pattern: /\?\?/,
    what: "`??` null 合并运算符（PS 7+）",
    instead: "`if ($null -eq $x) { … } else { $x }`",
  },
  {
    pattern: /::new\(/,
    what: "`::new()` 构造简写（PS 5 才有，5.1 无）",
    instead: "`New-Object <类型>` 或 `[<类型>]::new()` 的 5.1 可用形态",
  },
  {
    pattern: /-AsHashtable\b/,
    what: "`ConvertFrom-Json -AsHashtable`（PS 7+）",
    instead: "`ConvertFrom-Json` 后按 `PSCustomObject` 取属性",
  },
];

/**
 * 扫 `.cnb.yml` 的任务脚本块，回读「哪些行用了 PS 7 才有的语法」。
 *
 * `script: |` 之后的正文按**缩进**收口（回到同级或更浅的缩进即结束），
 * 这样只扫代码、不碰同一文件里别的键。行内注释先剥掉 —— 本文件的判据说明里
 * 正当地会写出这些形状（那条 ⚠️ 注释就是），把说明判成违规等于逼人删注释。
 *
 * @returns 每条违规的 `行号: 说明`
 */
export function ps7OnlySyntaxIn(text: string): string[] {
  const lines = text.split("\n");
  const found: string[] = [];
  /* 正文缩进：`script: |` 自己的列 + 默认 2（块标量必须比键更深）。
   * 键可能写成 `script: |` 也可能写成列表项 `- script: |`，两种都收。 */
  let bodyIndent: number | null = null;
  lines.forEach((raw, i) => {
    const scriptStart = /^(\s*)(?:-\s+)?script:\s*\|\s*$/.exec(raw);
    if (scriptStart) {
      bodyIndent = (scriptStart[1] ?? "").length + 2;
      return;
    }
    if (bodyIndent === null) return;
    // 块结束：出现缩进不比正文深的非空行。
    if (raw.trim() !== "" && raw.length - raw.trimStart().length < bodyIndent) {
      bodyIndent = null;
      return;
    }
    const code = raw.replace(/#.*$/, "");
    for (const { pattern, what, instead } of PS7_ONLY) {
      if (pattern.test(code)) {
        found.push(`第 ${i + 1} 行：${what}（改用 ${instead}）`);
      }
    }
  });
  return found;
}

/**
 * `.cnb.yml` 的 `env` 里登记的 **stage 名有序清单**（`COMFYAPP_CI_GATES`）。
 *
 * 为什么把顺序做成**事实**而不是留在注释里：这条序有一条真的读错了会出事的约束
 * —— `单元测试` 必须排在 `Python 可用性` 之后。理由是实测出来的，
 * 不是风格偏好：`cnb-jt3-1k5071kou` 上 `单元测试` 一步跑到 **2h24m** 被平台
 * 8640s 的墙钟上限掐断（整条流水线只留下 `timeout of 8640000ms exceeded`，
 * 一条失败原因都读不到）；而缺 Python 时那一步**照旧往下跑**（相关的用例按既有
 * 口径走 `env` 档跳过并登记，不会红）—— 也就是说排在它后面的 stage 是
 * 「要么永远看不到，要么在最贵的位置才看到」。
 *
 * 解析：`>-
` 折叠标量，缩进正文按 `,` 切成名字。返回 `[]` = 键不在，
 * 调用方据此判红（键被删掉同样属于「这条约束没人守了」）。
 *
 * @param text `.cnb.yml` 原文
 * @returns stage 名（已 trim）
 */
export function registeredGateOrder(text: string): string[] {
  const m =
    /^[ \t]*COMFYAPP_CI_GATES:[ \t]*>?-?[ \t]*\r?\n((?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
      text,
    );
  const body = m?.[1];
  if (body === undefined) return [];
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * `.cnb.yml` 的 `env` 里登记的**临时停用** stage 清单（`COMFYAPP_CI_DISABLED_GATES`）。
 *
 * 为什么它非有不可：屏蔽一个 stage 的两半 —— `.gates` 里把条目注释掉、从
 * `COMFYAPP_CI_GATES` 摘掉名字 —— **两半都不报错**（前者是 YAML 注释、后者只是数组
 * 少一项），于是「临时停用」与「永久删除」在配置里长得一模一样，而下一次评审的人
 * 只能靠猜。这一键把停用变成一句读得出来的事实：名字在这儿 = 它是**被停用的**，
 * 不在 `GATES` 也不在这儿 = 它是**被删掉的**（那条判据当场点名）。
 *
 * 与 `registeredGateOrder` 同一份解析形态（同一种折叠标量），只是键名不同。
 * 返回 `[]` = 键不在或为空 —— 调用方不能据此推断「没有停用的」（键被删掉本身就
 * 是要判的形态，见「停用登记」那两条用例）。
 *
 * @param text `.cnb.yml` 原文
 * @returns 被停用的 stage 名（已 trim）
 */
export function registeredDisabledGates(text: string): string[] {
  /* 正文行不许是注释（YAML 折叠标量的正文里不会出现 `#` 开头的行），
   * 否则后面紧跟的说明注释会被一起吞进来 —— 那个坑 `registeredGateOrder` 侥幸没踩到
   * 只是因为它的 `GATES` 后面没有注释而已。 */
  const m =
    /^[ \t]*COMFYAPP_CI_DISABLED_GATES:[ \t]*>?-?[ \t]*\r?\n((?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
      text,
    );
  const body = m?.[1];
  if (body === undefined) return [];
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * 定时那一跑的清单（与 `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES` 同一份，顺序即执行序）。
 *
 * ⚠️ 最后一条是 `每日单元测试` —— 那是刻意的（业主口径「最容易出问题的放最后」：
 * 它是这条上唯一会因本机负载而单条超时的格子，排在中间就把后面三格一起 skip 掉）。
 * 「它必须是最后一条」由下面那条判据钉住，不是这里的一份巧合。
 */
const DAILY_GATES = [
  "每日工具链自证",
  "每日安装依赖",
  "每日 Python 可用性",
  "每日 Python 探针读数",
  "每日同步数据库表结构",
  "每日生产构建",
  "每日 ESLint 零警告",
  "每日浏览器安装",
  "每日全量E2E",
  "每日单元测试",
];

/**
 * 2026-10-19 从 **PR 那一条撤到每日档**的几格：
 * `[PR 上的旧名, 每日档里的名字, 每日块必须点名的入口, 必须带的旗标]`。
 *
 * 业主口径是「只判断环境的那些不要每次都判断 —— 这个环境不会经常改动」（逐格代价：
 * `工具链自证` 13.8s、`Python 可用性` 2.8s、`Python 探针读数` 3.0s、`浏览器安装` 3.0s）。
 * 而**撤的是节奏，不是账**：这四个名字从此只出现在每日清单里，且每日那一格里
 * 必须真有一个格、点的仍是**同一个入口脚本与同一个旗标** ——
 * 少了这条判据，「从 PR 撤下」与「谁都不判了」在配置文件里逐字同形，
 * 而那正是本仓最不能有的形态（清单看着完整、执行面是空的）。
 *
 * ⚠️ 每日名是**写出来的**，不是拼出来的：真实名字是 `每日 Python 可用性`（中间有空格），
 * 用 `` `每日${旧名}` `` 拼会得到 `每日Python 可用性`，那条判据于是恒红 ——
 * 而它红的原因与配置对不对毫无关系（第一版就是这么错的）。
 */
const PR_MOVED_TO_DAILY: [string, string, string, string][] = [
  ["工具链自证", "每日工具链自证", "scripts/ci-toolchain-selfcheck.mjs", ""],
  [
    "Python 可用性",
    "每日 Python 可用性",
    "scripts/ci-toolchain-selfcheck.mjs",
    "--python-only",
  ],
  ["Python 探针读数", "每日 Python 探针读数", "scripts/python-probe.mjs", ""],
  [
    "浏览器安装",
    "每日浏览器安装",
    "scripts/ci-toolchain-selfcheck.mjs",
    "--playwright-only",
  ],
  /* `ESLint 零警告` 是**另一条理由**（不是「节点事实」而是「起一堆子进程」：
   * 它挂满过 8640s 与 20m 两次，且红的地方从来不是这次改动违规，而是这台机当时
   * 腾不出核）。同一张表接住它，是因为要判的东西**逐字相同**：PR 清单里不许再有、
   * 每日清单里必须有一格、那一格点的仍是同一条命令（`pnpm run lint` —— 扫描范围与
   * `--max-warnings 0` 都在 `package.json` 的 `lint` 脚本里，见 `eslint.config.js`
   * 顶部那节「命令口径只有一处」）。 */
  ["ESLint 零警告", "每日 ESLint 零警告", "pnpm run lint", ""],
];

/**
 * 「每日」那一跑里应当与 PR 那一跑**逐字同形**的几格（定时名 → PR 名）。
 *
 * 名字不同是刻意的（按名字取块的解析器会撞车），所以「同一件事」只能由 script 相同来保证。
 *
 * ⚠️ 这一列**只留两边都还在的**。`Python 可用性` 与 `浏览器安装` 在 2026-10-19 撤出了
 * PR 清单（见上面 `PR_MOVED_TO_DAILY`），拿一个不存在的 PR 块来比相同性，得到的不是
 * 「两边漂了」而是「一边根本不在场」—— 那种红会教会人忽略红。它们由那条判据接住。
 */
const DAILY_SCRIPT_MIRRORS: [string, string][] = [
  // 多行块也在内：这一格是 `script: |` 的三行体，只比第一行会漏掉「第二行改了」这种漂移。
  ["每日安装依赖", "Install dependencies"],
  /* 浏览器那一格比的不只是命令行：它背着**两行 env**（下载根 + 连接超时），那是四次
   * 取证读数换来的（`cnb-gt1-1k513ill4` 那一族）。只比命令行的话，「一边改了根、
   * 另一边没改」会逐字通过，而红只在第二天 02:00 出现 —— 比这个正是最贵的一种漂。
   * `每日全量E2E` **不在这一列**：它带的参数与 PR 那格**必须不同**（子集不记账），
   * 那一条由下面单独的判据按「不许带收窄参数」判，而不是拿相同性判。 */
  ["每日同步数据库表结构", "同步数据库表结构"],
];

/**
 * 两格 env 之间**唯一被登记过的差别**：`每日安装依赖` 那一格不接槽（ISSUE #2081）。
 *
 * ⚠️ 这份名单**不是**「这几个键允许随便漂」，它钉的是一个更窄的形状：
 *  · 名单里的键，PR 那一侧必须**正好置着一行** `KEY: "1"`；
 *  · 每日那一侧必须**一个字都不出现** —— 写成 `COMFY_CI_SLOT: "0"` 也算违规，那是一条
 *    谁都不读「关掉的开关」，而下一次会有人把它当「这里本来就该有它」读回去；
 *  · 除此之外两侧的全部行仍**逐字相同**（下面那条 `toEqual` 一字未松）。
 *
 * 为什么不干脆让配置自己表达「这里可以不一样」：那样判据只能判「不相同」，判不出
 * 「不相同的那一行正是被允许的那一行」—— 第一次故意改与第一次手滑在账面上同形。
 */
const DAILY_ENV_ONLY_ON_PR: Record<string, string[]> = {
  "每日安装依赖": ["COMFY_CI_SLOT"],
};

/** 一行 env 赋值的键名；不是赋值形状（如脚本行 `$enc=…` / `node …`）回 `null`。 */
function envAssignmentKey(line: string): string | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line.trim());
  return m?.[1] ?? null;
}

/** 判「PR-only 例外」的形状；回 `null` = 合法，回一句字符串 = 下一动作。 */
function checkPrOnlyEnvExceptions(
  dailyEnv: string[],
  prEnv: string[],
  onlyOnPr: string[],
): string | null {
  for (const key of onlyOnPr) {
    const onPr = prEnv.filter((l) => envAssignmentKey(l) === key);
    const onDaily = dailyEnv.filter((l) => envAssignmentKey(l) === key);
    if (onPr.length !== 1) {
      return `登记为「只在 PR 那一格」的 ${key}，在 PR 那格读到 ${onPr.length} 行 —— ${
        onPr.length === 0
          ? "名单过期了：要么把键从 DAILY_ENV_ONLY_ON_PR 里删掉，要么把配置改回去"
          : "同一个键写两遍是 YAML 的静默覆盖，谁都不知道生效的是哪一行"
      }`;
    }
    const prLine = onPr[0] ?? "";
    if (!/:\s*"?1"?\s*$/.test(prLine)) {
      return `PR 那一格的 ${key} 不再是「置着」的形状（原文：${prLine}）—— 这条例外钉的是「PR 接槽、每日不接」，不是「这几行可以随便漂」`;
    }
    if (onDaily.length > 0) {
      return `每日那一格又写上了 ${key}（原文：${onDaily[0] ?? ""}）—— 接槽把作业里的 node_modules 接成指向项目根之外的链，而每日档后面背着 next build（两臂读数与因果见 ISSUE #2081、规范 §13.5.3.4.3）`;
    }
  }
  return null;
}

/** 剥掉登记为 PR-only 的那几行，剩下的才拿去逐字比。 */
function dropPrOnlyEnvLines(env: string[], onlyOnPr: string[]): string[] {
  return env.filter((l) => !onlyOnPr.includes(envAssignmentKey(l) ?? ""));
}

/** `45m` / `30m` / `3h` → 分钟。解析不出时回 0（调用方的断言会把它读成「没预算」）。 */
function stageBudgetMinutes(raw: string | undefined): number {
  const m = /^(\d+)([smh])$/.exec(String(raw ?? "").trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === "h" ? n * 60 : m[2] === "s" ? n / 60 : n;
}

/**
 * 某一格里**真正会执行**的那些命令行（丢掉空行与 shell 注释）。
 *
 * 为什么不比整块：两格的散文解释本来就该不同（PR 那一格要讲「为什么这一步是前提」、
 * 定时那一格要讲「为什么每天一次」），要求逐字相同只会逼人删注释 —— 而漂移能藏的地方
 * 只有命令行。返回数组而不是拼好的字符串，红的时候两边的差是哪一行一眼可见。
 */
function executableScriptLines(text: string, name: string): string[] {
  return stageScriptLine(text, name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * 取某一格 `env:` 下的**赋值行**（丢注释与空行），给镜像判据当第二条腿。
 *
 * 为什么要它：`浏览器安装` 那两行 env（下载根 + 连接超时）与它的命令行是一件事的两半 ——
 * 「从哪儿取那 120 MiB」写在 env 里，不在 script 里。只比 script 时，改了 PR 那格的根
 * 而没改每日那格（或反过来）是**逐字通过**的，而这条漂移的可见形态是「第二天 02:00 红」，
 * 离它最后一次被读已经隔了一整晚。
 *
 * 收的是 `KEY: value` 那种形状（`-` 开头的列表项与更深一层的结构一律不当赋值行），
 * 所以它不会把注释或下一格的键吞进来；`env:` 缺席时回空数组 = 两格都不许有 env。
 */
function stageEnvAssignments(text: string, name: string): string[] {
  const block = stageBlock(text, name);
  if (!block) return [];
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*env:\s*$/.test(l));
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (
      /^\s*(script|timeout|ifModify|name|retries|jobs|runs_on|image):/.test(
        line,
      )
    )
      break;
    const t = line.trim();
    if (t === "" || t.startsWith("#") || t.startsWith("-")) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 取某一格的 `script` 原文（去掉行首缩进与尾部空白）。
 *
 * 多行块（`script: |`）取整块 —— 只取第一行的话，「两格第一行相同、第二行不同」
 * 这种恰好是最坏形态的漂移会读成相同。
 */
function stageScriptLine(text: string, name: string): string {
  const block = stageBlock(text, name);
  if (!block) return "";
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*script:/.test(l));
  if (at < 0) return "";
  const first = lines[at]?.replace(/^\s*script:[ \t]*/, "") ?? "";
  if (first && !/^[|>][-+]?\s*$/.test(first)) return first.trim();
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(timeout|env|ifModify|name|retries):/.test(line)) break;
    if (line.trim() === "") continue;
    body.push(line.replace(/^\s+/, "").trimEnd());
  }
  return body.join("\n");
}

/**
 * `.cnb.yml` 里的**定时任务事件键**（`"crontab: 0 2 * * *"`）原文清单。
 *
 * 为什么它要有判据：定时任务的键与 `push:` / `pull_request:` 不同 —— 它是**带引号的
 * 字符串键**，而且必须包含完整的五段 cron。写成 `crontab:`（映射）、`schedule:`、
 * 或段数不对时，平台侧**不会报任何错**，只是这条流水线永远不触发；
 * 而它在本地唯一的痕迹就是这份 YAML，没有任何一步会跑它（同 `pull_request` 键那一族
 * 的失效形态：写错了不报错、只是静默不干该干的事）。
 *
 * 同时把**分支键**带出去：官方 `zh/build/crontab.md` 明写定时任务不支持 glob、
 * 必须挂明确的单一分支名 —— 父键是 `master:` 才成立，挂在 `**` / `$` 下是配置错误。
 *
 * @param text `.cnb.yml` 原文
 * @returns {{branch: string, event: string, cron: string}[]} 顶层分支键 + 事件键 + cron 表达式
 */
export function crontabEvents(
  text: string,
): Array<{ branch: string; event: string; cron: string }> {
  const out: Array<{ branch: string; event: string; cron: string }> = [];
  let branch = "";
  for (const line of text.split("\n")) {
    /* 顶层分支键：顶格、以 `:` 结尾（`master:` / `"dev/*":` / `$:`）。 */
    const top = /^([^\s#][^:]*):\s*$/.exec(line);
    if (top?.[1] !== undefined && !top[1].includes(":")) {
      branch = top[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    /* 事件键：两格缩进、带引号。**只有**引号形态能被平台当成 crontab 事件 ——
     * 裸的 `crontab:` 是映射键，不是事件名。 */
    const ev = /^ {2}"(crontab: [^"]*)":\s*$/.exec(line);
    if (ev?.[1] === undefined) continue;
    out.push({
      branch,
      event: ev[1],
      cron: ev[1].slice("crontab:".length).trim(),
    });
  }
  return out;
}

/**
 * `.cnb.yml` 的 `env` 里登记的**定时那一跑的 stage 名有序清单**
 * （`COMFYAPP_CI_DAILY_GATES`）。
 *
 * 为什么两条流水线的清单要分开登记：`COMFYAPP_CI_GATES` 答的是「PR 上跑什么」，
 * 而定时那一跑答的是「每天跑什么」—— 两者的差别正是 ISSUE #2010 要的答案
 * （生产构建每天一次）。混成一份之后，「今天这一跑该跑哪几格」就再也读不出来：
 * 把定时那格写进 PR 清单会让每个 PR 多跑一次构建，反过来则让每天那一跑跑满全套。
 *
 * 与 `registeredGateOrder()` 同一份折叠标量解析（同一个坑、同一种写法），只是键名不同。
 *
 * @param text `.cnb.yml` 原文
 * @returns stage 名（已 trim）；`[]` = 键不在（调用方据此判红）
 */
export function registeredDailyGateOrder(text: string): string[] {
  const m =
    /^[ \t]*COMFYAPP_CI_DAILY_GATES:[ \t]*>?-?[ \t]*\r?\n((?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
      text,
    );
  const body = m?.[1];
  if (body === undefined) return [];
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * 某个**流水线**块里 `stages:` 的直接子项名字（按出现顺序）。
 *
 * 为什么要单独一个解析器：`registeredGateOrder()` 读的是 `env` 里那份**声明**，
 * 而「这一条流水线真的跑哪几格」是配置里的**事实**。两者需要双向核对 ——
 * 只读声明时，有人把 stage 从流水线里删掉、却把名字留在清单里，判据会全绿，
 * 而那一格其实没跑（正是本仓最不能有的形态：清单看着完整、执行面是空的）。
 *
 * 只在给定流水线名之后找（`- <<: *common` 那一行之后的 `name:` 与 `stages:`），
 * 且不接受注释行 —— 停用的条目是 `#` 形态，扫全文会把它当成在跑。
 *
 * @param text `.cnb.yml` 原文
 * @param pipelineName 流水线的 `name:` 值（如「每日生产构建」）
 * @returns stage 名；`[]` = 那条流水线没找到 / 没有 stages
 */
export function pipelineStageNames(
  text: string,
  pipelineName: string,
): string[] {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    /* 只认**流水线项**的 `name:`（`- <<: *anchor` 之后那一行），不认 stage 自己的
     * `- name:` —— 两边同名时（定时那条的流水线与它唯一那格就叫同一个名字）挑错了
     * 起点，解析会从「stage 的 name 行」往下走，结论变成「这条流水线一格都没有」。 */
    const m = /^\s+name:[ \t]*(\S.*?)[ \t]*$/.exec(lines[i] ?? "");
    if (m?.[1] === pipelineName && (lines[i - 1] ?? "").includes("<<")) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  /* 流水线项的缩进 = 它 `name:` 那一行的缩进；`stages:` 的键在它**下一层**。 */
  const itemIndent =
    (lines[start] ?? "").length - (lines[start] ?? "").trimStart().length;
  const out: string[] = [];
  let stageIndent: number | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (stageIndent === null) {
      /* 还没见到 `stages:`：缩进**比流水线项更浅** ⇒ 这一条结束了。
       * 同级的 `- <<: *anchor` / `name:` 仍在同一条里，不能当成收尾（`push` 那条的
       * `- <<:` 就在这一层）。 */
      if (indent < itemIndent) break;
      /* `stages: *daily_gates` 这种**引用形态**：清单在锚点里，去那儿读。
       * 每日那七格现在是两个触发口共用一份（02:00 定时 + 页面上的手点按钮），写成两份
       * 的那一刻就是它俩开始各漂的那一刻。解析器必须认得引用，否则「手点那条跑的是不是
       * 同一份」这件事根本没有判据能问。 */
      const alias = /^stages:[ \t]*\*(\S+)[ \t]*$/.exec(body);
      if (alias?.[1] !== undefined) return anchorStageNames(text, alias[1]);
      if (body.startsWith("stages:")) stageIndent = indent;
      continue;
    }
    /* 已在 `stages:` 里：更浅或同级的键 ⇒ 这一条流水线结束了。 */
    if (indent <= stageIndent && !body.startsWith("- ")) break;
    const item = /^- name:[ \t]*(\S.*?)[ \t]*$/.exec(body);
    if (item?.[1] !== undefined) out.push(item[1]);
  }
  return out;
}

/**
 * 读一个顶层锚点（`.daily-gates: &daily_gates`）里的 stage 名单。
 *
 * 收尾按「**顶格**的一行」判：锚点块的正文一律带缩进，遇到第一条顶格行（下一个
 * `.keys:` / `master:`）就是块结束。注释行与空行跳过 —— 块里那些注释正当地要解释每一格。
 *
 * @param text `.cnb.yml` 原文
 * @param anchor `&` 后面那个名字
 * @returns stage 名；`[]` = 锚点不存在（调用方要把它当成「没找到」，不是「清单为空」）
 */
export function anchorStageNames(text: string, anchor: string): string[] {
  const lines = text.split("\n");
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const def = new RegExp(`^\\.[^:]*:[ \\t]*&${escaped}[ \\t]*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (def.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (/^\S/.test(raw)) break;
    const item = /^-\s+name:[ \t]*(\S.*?)[ \t]*$/.exec(raw.trim());
    if (item?.[1] !== undefined) out.push(item[1]);
  }
  return out;
}

/**
 * 一个 stage 名在 `.gates` 里是否**以注释形态**留着（停用的可恢复性依据）。
 *
 * 停用不等于删除 —— 恢复动作是「取消注释」而不是「重写一遍」。所以判据要求被停用的
 * 条目仍能在配置里 grep 回原文（`- name: <stage>` 那一行，允许被 `#` 注释掉）。
 * 少了这一条，「等测试流程好了再加回来」就只剩下一句注释里的话。
 *
 * @param text `.cnb.yml` 原文
 * @param name stage 名
 */
export function stageKeptAsComment(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^[ \t]*#+[ \t]*-[ \t]+name:[ \t]*${escaped}[ \t]*$`,
    "m",
  ).test(text);
}

/**
 * **合并键解析**（`<<: *anchor`）：`runner` 挂在锚点里、由两个事件各引用一次。
 *
 * 这一层单独判，是因为上面那组文本判据**答不了它**：文本里有 `namespace: group`，
 * 而 YAML 规范在 1.2 里把 `<<` 移出了核心（变成「可选类型」）——
 * 一个**不认合并键**的解析器会把 `<<: *common` 静默丢掉，得到一份「有 runner 键的
 * 文本、却解析不出 runner 的运行配置」。那正是本判据要拦的失效形态（配置看着对、
 * 实际回落到计费的平台池），且它在文本层面完全看不出来。
 *
 * 判法：自己把那份文本解析一遍（带合并键语义），断言这**两条**流水线都真的解析出了
 * `runner.namespace === "group"` 与非空 `tags`。不引第三方 YAML 解析器 ——
 * 本文件在提交门槛的固定清单里，每次提交都跑，加依赖不划算；这里只需要回答
 * 「锚点展开后那份配置里有没有 runner」这一个问题。
 */
export function resolveAnchoredRunner(
  text: string,
): Array<{ namespace?: string; tags?: string[] }> {
  // 抽出 `.common` 锚点块里的 runner（缩进两层：`  runner:` 下跟两键）。
  const anchor = /^\.common:\s*&\w+\s*$([\s\S]*?)(?=^\S)/m.exec(text);
  const body = anchor?.[1];
  if (body === undefined) return [];
  const runnerNS = /^\s+namespace:\s*(\S+)\s*$/m.exec(body);
  const tagLines = body.match(/^\s+-\s*(\S+)\s*$/gm) ?? [];
  return [
    {
      namespace: runnerNS?.[1],
      tags: tagLines.map((l) => l.replace(/^\s*-\s*/, "").trim()),
    },
  ];
}

/**
 * `.cnb.yml` 的 stage 级 `timeout` 预算（stage 名 → 原文里的写法）。
 *
 * 为什么这件事必须有判据：`.cnb.yml` 里的**每一个 stage 默认都能跑满 2 小时**
 * （平台默认 Job 上限），而自托管节点只有一台。实测（ISSUE #1961）同一台机上
 * 三条流水线互相挤压时，`ESLint 零警告` 与 `单元测试` 各自挂到 **8640s（2h24m）**
 * 才被掐断，留下的只有一句 `timeout of 8640000ms exceeded` —— **一条失败原因都
 * 读不到**，人拿到的信息量是零，而成本是两小时机时。
 *
 * 所以「慢 stage 要有量级余量的预算」是一条真的会读错的约束（漏掉它，红法就从
 * 「20 分钟拿到一句可读的超时」退化成「两小时后拿到一句看不懂的超时」），
 * 且它是**增删 stage 时最容易忘**的那一条。
 *
 * 解析：只认 stage 列表项自己那一层（`  - name: X` 起、到下一个同级项为止），
 * 因此 `env` 里的东西不会被误当成预算。
 *
 * @param text `.cnb.yml` 原文
 * @returns stage 名 → timeout 写法（没写的不出现在结果里）
 */
/**
 * 摘出某个 stage 那一项的原文（从它的 `- name:` 到下一项 / 下一个更浅的键）。
 *
 * 按**缩进收口**而不是正则一次匹配到底：stage 项里嵌着 `script: |` 块（里面有缩进
 * 更深的任意文本）与 `env:` 子映射，一次匹配很容易多吃或少吃。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} name stage 名
 * @returns {string | null}
 */
export function stageBlock(text: string, name: string): string | null {
  const lines = text.split("\n");
  let start = -1;
  /** 命中那一项的列表项缩进 —— 收尾按它判（`push` 那条的 stage 在外层 `stages:` 下是
   *  8 空格、锚点那条直接挂在流水线下是 4 空格，两种都得收得住）。 */
  let itemIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^( *)-\s+name:\s*(\S.*?)\s*$/.exec(lines[i] ?? "");
    if (item?.[2] === name) {
      start = i;
      itemIndent = (item[1] ?? "").length;
      break;
    }
  }
  if (start < 0) return null;
  const out: string[] = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 下一个**同级或更浅**的列表项 / 更浅的键都算收尾（空行不算 —— 配置里正文之间有空行）。 */
    const nextItem = /^( *)-\s/.exec(raw);
    if (nextItem && (nextItem[1] ?? "").length <= itemIndent) break;
    const key = /^( *)\S/.exec(raw);
    if (key && (key[1] ?? "").length < itemIndent) break;
    out.push(raw);
  }
  return out.join("\n");
}

/**
 * 摘出**被注释掉的** stage 那一项的原文（停用形态：`# - name: X` 起）。
 *
 * 停用的恢复动作是「取消注释」，所以原文必须还 grep 得回来；而 `stageBlock()` 只认
 * 活的 `  - name: X`，停用之后它回 `null` —— 于是「那一项里写了什么」在停用期间没有
 * 任何判据看得见。这个辅助把 `# ` 前缀剥掉之后按同一套缩进口径收口，
 * 让「停用期间那两个键还在不在」仍然判得出来（与 `stageBlock` 同一口径，不造第二轮子）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} name stage 名
 * @returns {string | null}
 */
export function commentedStageBlock(text: string, name: string): string | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^#\s+-\s+name:\s*(\S.*?)\s*$/.exec(lines[i] ?? "");
    if (item?.[1] === name) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const strip = (l: string) => l.replace(/^#\s?/, "");
  const out: string[] = [strip(lines[start] ?? "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 收尾：下一个同级（注释态）stage 项，或**回到未注释的顶格键**（`master:` 那一层）。
     * ⚠️ 判据不能写成「`^\S` 就收尾」—— 注释块里的每一行都以 `#` 开头，那也是 `\S`，
     * 于是块内容会被切在第一行之后（`- name: X` 一行）。 */
    if (/^#\s+-\s+name:/.test(raw) || (/^\S/.test(raw) && !raw.startsWith("#")))
      break;
    out.push(strip(raw));
  }
  return out.join("\n");
}

export function stageTimeouts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split("\n");
  let current: string | null = null;
  /** 当前 stage 项的缩进；`null` = 还没遇到 stage 项。 */
  let currentIndent: number | null = null;
  /** 当前子 Job 的缩进；`null` = 这一项没有 `jobs:`（键直接挂在 stage 上）。 */
  let jobIndent: number | null = null;
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    // stage 列表项：`- name: X`（`stages:` 的直接子项，缩进按原文计 —— 不在正则里
    // 写死空格数：`^ {n}` 那一族在这台机的 V8 上会漏回溯，本仓已有多处记着）。
    if (body.startsWith("- name:")) {
      const name = body.slice("- name:".length).trim();
      if (currentIndent === null || indent <= currentIndent) {
        /* 新的 stage 项。 */
        current = name;
        currentIndent = indent;
        jobIndent = null;
      } else {
        /* 子 Job（`jobs:` 下）：预算的**唯一**有效位置是 Job 那一层 ——
         * Job 级 `image:` 的容器格里，`env` / `timeout` 跟着 `image` 一起下移，
         * stage 那一层只剩 `name` 与 `jobs:`（见 `.cnb.yml` 那两段的注释）。 */
        jobIndent = indent;
      }
      continue;
    }
    // 回到顶层键（`master:` 等）= 这一族结束了。
    if (indent === 0) {
      current = null;
      currentIndent = null;
      jobIndent = null;
      continue;
    }
    if (current === null || currentIndent === null) continue;
    const ownIndent = jobIndent ?? currentIndent;
    /* 这一项自己的键：比它自己那一层深一层（Job 项深一层；没有 `jobs:` 的项就是
     * stage 项深一层）。更深的是 `env:` 里的同名键，不算。 */
    if (indent !== ownIndent + 2 || !body.startsWith("timeout:")) continue;
    out.set(current, body.slice("timeout:".length).trim());
  }
  return out;
}

/**
 * `.cnb.yml` 的**流水线级 `lock`** 是否声明了 `cancel-in-progress: true`。
 *
 * 为什么这条也要判：自托管这一档是**一台**机器，而一次 PR 上连着推几个提交就会
 * 起几条**全量**流水线，全落到同一台机上（实测 `cnb-jt3-1k5071kou` /
 * `cnb-did-1k50659np` / `cnb-s61-1k50eo6p1` 三条并行，三条各自冻结）。
 * `lock.cancel-in-progress` 是唯一能把这堆重复运行收成一条的开关，而它
 * **漏掉时配置看起来与有它时一模一样** —— 典型的「写错了不报错」形态。
 *
 * 判法用锚点展开后的形态（与 `resolveAnchoredRunner` 同一层）：
 * `.common` 锚点块里必须出现 `lock:` 与其下的 `cancel-in-progress: true`。
 *
 * @param text `.cnb.yml` 原文
 * @returns 锚点块里有没有那两件
 */
export function hasPipelineLockCancelInProgress(text: string): boolean {
  /* 收口到「下一个更浅缩进的键」或**文本末尾** —— 少了后半句，末尾没跟别的键的
   * 夹具会解析不出来（真 `.cnb.yml` 里 `.common` 后面还有 `.gates`，看不出来）。 */
  const anchor = /^\.common:\s*&\w+\s*$([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(
    text,
  );
  const body = anchor?.[1];
  if (body === undefined) return false;
  // `lock:` 块内出现 `cancel-in-progress: true`（同一块里的 `timeout`/`key` 不算）。
  return /^\s+lock:\s*$[\s\S]*?^\s+cancel-in-progress:\s*true\s*$/m.test(body);
}

/**
 * `.cnb.yml` 的流水线级 `lock.key` 原文（`null` = 没写，即吃平台默认值）。
 *
 * ⚠️ 这一格**不是风格**：平台默认 key 是 `分支名-流水线名`，而 `pull_request` 事件下
 * `CNB_BRANCH` 取的是**目标分支名**（官方 `build-in-env.md` §CNB_BRANCH）—— 于是
 * 「分支名」这一半在 PR 上恒等于 `master`，全仓所有 PR 共用一把锁。
 * `cancel-in-progress: true` 于是从「同分支只留最新那一跑」退化成
 * 「全仓只留最新那一跑」：任意两条并行 PR 互相掐停（现场：PR #1980 掐了 #1982）。
 * 代价不是「慢」，是**白跑一整条**。
 *
 * 判法用锚点展开后的形态（与 `hasPipelineLockCancelInProgress` 同一层）。
 *
 * @param text `.cnb.yml` 原文
 * @returns key 原文（未做变量替换）；没写 `key` 时回 `null`
 */
export function pipelineLockKeyTemplate(text: string): string | null {
  const anchor = /^\.common:\s*&\w+\s*$([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(
    text,
  );
  const body = anchor?.[1];
  if (body === undefined) return null;
  const lock = /^(\s+)lock:[ \t]*\r?\n([\s\S]*?)(?=^\1\S|\s*$(?![\s\S]))/m.exec(
    body,
  );
  const block = lock?.[2];
  if (block === undefined) return null;
  const key = /^\s+key:[ \t]*(\S.*?)[ \t]*$/m.exec(block);
  return key?.[1] ?? null;
}

/**
 * `lock.key` 里允许出现的内置变量（**白名单**，缺一个就判红）。
 *
 * 收成白名单而不是黑名单，是因为这一格的失效形态是「代入了一个看起来对、实际被
 * 平台解析成别的东西的变量」—— 黑名单只能拦住已知的那一个。
 */
const LOCK_KEY_ALLOWED_VARS = ["CNB_PULL_REQUEST_IID"] as const;

/**
 * 把 `lock.key` 原文按一次「事件 + 上下文」跑出**平台会算出来的那个 key**。
 *
 * 这是本条判据的核心：只看原文判不出「两条 PR 会不会撞」，必须把变量代进去。
 * 替换规则与官方 `build/env.md` §变量替换逐字同义 —— `$NAME` 与 `${NAME}` 都会替换，
 * 变量无值时替换成空字符串；**查不到的变量按空串算**，这样「用了一个平台不认识的
 * 变量」会表现为「key 退化成两档共用一个」，判据当场点名。
 *
 * @param template `pipelineLockKeyTemplate()` 的返回值
 * @param vars 这次构建里哪些变量有值（没列出的 = 无值）
 * @returns 平台算出来的锁键
 */
export function resolveLockKey(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(
    /\$\{?([A-Za-z0-9_]+)\}?/g,
    (_whole, name: string) => vars[name] ?? "",
  );
}

/** 规范里必须留痕的口径；缺失 = 决策被悄悄推翻、而文件面判据还没跟着变。 */
const DOC_ANCHORS: Array<{ file: string; mustContain: string[] }> = [
  {
    file: "docs/standards/13-提交与-code-review.md",
    mustContain: [
      "`.cnb.yml` 重新启用（跑在根组织自托管节点上，不参与核时计费）",
      "为什么这次不被 160 核时约束卡住",
    ],
  },
  {
    file: "docs/standards/11-测试与可观测性.md",
    mustContain: ["质量门禁（平台侧**已重新启用**）"],
  },
];

/** 文档里缺哪些锚点句（跨行断句不算缺失，故整篇去换行后再比）。 */
export function missingAnchors(
  file: string,
  needles: string[],
  root: string = ROOT,
): string[] {
  const text = readFileSync(path.join(root, file), "utf8");
  const flat = text.replace(/\r\n/g, "\n").replace(/\n/g, "");
  return needles.filter((needle) => !flat.includes(needle.replace(/\n/g, "")));
}

/**
 * 读登记在册的平台侧配置原文。
 *
 * 它**不存在时直接抛**：本文件所有调用点都建立在「这份配置在」这个前提上，
 * 回 `null` 只会把「文件没了」摊成每个调用点各自的一次 `!` 断言（那正是
 * 让 `tsc` 与评审都看不出意图的写法）。抛出去的信息里带上文件名。
 */
function readRegisteredConfig(): string {
  const rel = REGISTERED_CI_CONFIG;
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) {
    throw new Error(
      `登记在册的平台侧配置不存在：${rel}（它缺席时这套判据全都无从谈起）`,
    );
  }
  return readFileSync(p, "utf8");
}

describe("平台侧流水线配置：形态必须是「自托管 + 已登记」（§13.5.3 / §13.5.4）", () => {
  it("仓库根只允许出现登记在册的那一份，别的 CI 形态一律不许", () => {
    const present = ciConfigsAmong(repoTopLevel());
    expect(
      present.filter((rel) => !REGISTERED_CI_CONFIGS.includes(rel)),
    ).toEqual([]);
  });

  it("登记在册的那一份必须满足形态契约（漏掉哪条都是静默失效）", () => {
    const text = readRegisteredConfig();
    const missing = CONFIG_SHAPE.filter((c) => !c.mustMatch.test(text));
    expect(missing.map((c) => c.why)).toEqual([]);
  });

  it("runner 是**锚点展开后**真的落在流水线上的（文本里有 ≠ 解析得到）", () => {
    const text = readRegisteredConfig();
    const runners = resolveAnchoredRunner(text);
    expect(
      runners.length,
      "没解析出 .common 锚点里的 runner —— 锚点被删了或换了形状",
    ).toBe(1);
    const runner = runners[0];
    if (runner === undefined) throw new Error("锚点里的 runner 解析不出来");
    expect(runner.namespace).toBe("group");
    expect(runner.tags?.length ?? 0).toBeGreaterThan(0);
    // 五条流水线都必须引用那个锚点：少引用一条 = 那一条悄悄回落到计费的平台池
    // （`runner.namespace: group` + `tags` 就在这个锚点里）。
    // 引用形态 = 分支键下、事件键下的那一层 `- <<: *anchor`。
    // 五个事件：`pull_request` / `push` / `crontab`（ISSUE #2010）/
    //   `web_trigger_daily`（每日档的手动触发口，按钮在 `.cnb/web_trigger.yml`）/
    //   `api_trigger_daily`（同一件事的 CLI / API 形态，理由与判据见下面那条三向对照）。
    const refs = text.match(/^\s+-\s*<<:\s*\*\w+/gm) ?? [];
    expect(
      refs.length,
      "锚点引用数与流水线数对不上（五个事件各要 <<: 一次）",
    ).toBe(5);
  });

  it("定时 / 手点 / API 三个触发口跑的是同一份清单，而按钮与事件键两两对上", () => {
    /* 手动触发那一口解决的是「想知道答案的人不该等到早上四点」；它必须与定时那一条
     * 是**同一件事**，否则「手点一遍每日档」这句话就没有确定含义（两种漂法各自都有过：
     * 复制一份 stage 清单 ⇒ 加格子时只加一边；按钮指到一个 PR 清单 ⇒ 手点的根本不是每日档）。
     * API 那一口同理 —— 它存在的理由恰恰是「按钮要一双手」，见下面那条事件名前缀的判据。 */
    const text = readRegisteredConfig();
    const viaCron = pipelineStageNames(text, "每日生产构建");
    const viaButton = pipelineStageNames(text, "每日档（手动触发）");
    const viaApi = pipelineStageNames(text, "每日档（API 触发）");
    const declared = registeredDailyGateOrder(text);
    expect(
      declared.length,
      "每日清单解析为空 —— 后面的比较就没有对象了",
    ).toBeGreaterThan(0);
    expect(
      viaCron,
      "定时那一条的 stage 名单与 `COMFYAPP_CI_DAILY_GATES` 不一致",
    ).toEqual(declared);
    expect(
      viaButton,
      "手点那一条与定时那一条跑的**不是同一份**清单 —— 它应当引用同一个 `*daily_gates` 锚点",
    ).toEqual(declared);
    expect(
      viaApi,
      "API 那一条与定时那一条跑的**不是同一份**清单 —— 同一个锚点，不另抄一份",
    ).toEqual(declared);

    /* 事件名必须是 `api_trigger` 或其前缀 —— 这是**服务端**的硬要求（实测 400
     * `Event must be 'api_trigger' or start with 'api_trigger_'.`）。写成 `daily_api`
     * 那一类名字，这条流水线在配置解析期一个字都不报，而永远没人能触发它 ——
     * 判前缀不判整串：后缀是自由命名的（官方口径），把它钉成字面量等于把实现细节当判据。 */
    const apiEvents = [...text.matchAll(/^ {2}(api_trigger\w*):$/gm)].map(
      (m) => m[1],
    );
    expect(
      apiEvents,
      "API 触发口的事件键丢了，或不再是 `api_trigger` 前缀（服务端会直接 400）",
    ).toContain("api_trigger_daily");
    const badApi = [...text.matchAll(/^ {2}(\w+):$/gm)]
      .map((m) => m[1] ?? "")
      .filter((k) => /api.?trigger|trigger.?api/i.test(k))
      .filter((k) => !k.startsWith("api_trigger"));
    expect(
      badApi,
      `有触发口用了服务端不收的事件名（必须 ^api_trigger）：${badApi.join(" / ")}`,
    ).toEqual([]);

    /* 事件键与按钮：**两个方向**都要有对象。这里的失效形态都是「按了没反应」或
     * 「永远没人按」，而两种都不会让任何一边自己变红。 */
    const events = [...text.matchAll(/^ {2}(web_trigger_\w+):$/gm)].map(
      (m) => m[1],
    );
    expect(
      events.length,
      ".cnb.yml 里没有 `web_trigger_*` 事件键",
    ).toBeGreaterThan(0);
    const triggerFile = path.join(ROOT, ".cnb", "web_trigger.yml");
    expect(
      existsSync(triggerFile),
      "缺 `.cnb/web_trigger.yml` —— 官方把按钮定义放在这个文件里，没有它就没有按钮可点",
    ).toBe(true);
    const buttons = readFileSync(triggerFile, "utf8");
    const bound = [
      ...buttons.matchAll(/^[ 	]*event:[ 	]*(web_trigger_\w+)[ 	]*$/gm),
    ].map((m) => m[1]);
    expect(
      bound.length,
      "`.cnb/web_trigger.yml` 里一个 `event:` 都没有",
    ).toBeGreaterThan(0);
    for (const ev of bound) {
      expect(
        events,
        `按钮事件「${ev}」在 .cnb.yml 里没有对应的流水线键 —— 按下去什么都不跑`,
      ).toContain(ev);
    }
    for (const ev of events) {
      expect(
        bound,
        `.cnb.yml 里有事件键「${ev}」却没有对应按钮 —— 这条流水线永远等不到人点`,
      ).toContain(ev);
    }
    /* 按钮只在 master 的页面上显示：`reg` 是**正则**，写 `master` 会前缀匹配到
     * `master-anything`，那种分支上按下去跑的是那条分支的 HEAD。 */
    expect(
      buttons,
      "按钮的 `reg` 必须锚定到 master（正则要带 ^ 与 $）—— 否则每日档能在别的分支上被点",
    ).toMatch(/^ {2}- reg: \^\S+\$[ 	]*$/m);
  });

  it("规范正文确实写着这次的决策反转（反向锚点）", () => {
    const drifted: string[] = [];
    for (const { file, mustContain } of DOC_ANCHORS) {
      const missing = missingAnchors(file, mustContain);
      if (missing.length > 0)
        drifted.push(`${file} 缺：${missing.join(" / ")}`);
    }
    expect(drifted).toEqual([]);
  });

  it("doc-facts **必须**把 .cnb.yml 登记成 path 类事实（它真的存在了）", () => {
    const facts = readFileSync(
      path.join(ROOT, "scripts/doc-facts.cjs"),
      "utf8",
    );
    /* `source:` 在文件里有两种排版（独占一行 / 跟在 `kind` 后面同一行），
     * 所以扫的是「含 `source:` 的行」而不是「以 `source:` 开头的行」。 */
    const sourceLines = facts
      .split("\n")
      .filter((line) => /(^|[{,]\s*)source:\s*["']/.test(line));
    // 先确认扫描面没跑偏（事实表里一定有 `source:` 行，否则下面的断言是空转）。
    expect(sourceLines.length).toBeGreaterThan(0);
    expect(
      facts,
      "scripts/doc-facts.cjs 里连事实表都没读出来，扫描面指错了地方",
    ).toContain("kind:");
    // path 类事实的语义是「文档指向的文件必须存在」——文件回来了，就该有登记。
    const registered = sourceLines.some((line) =>
      /source:\s*["']\.cnb\.yml["']/.test(line),
    );
    expect(
      registered,
      "scripts/doc-facts.cjs 没有把 .cnb.yml 登记成 path 类事实",
    ).toBe(true);
    // 反向：别的 CI 形态不许被登记（登记一个刻意不存在的文件会让 doc:check 恒红）。
    const offenders = sourceLines.filter((line) =>
      CI_CONFIG_FILES.filter((n) => n !== ".cnb.yml").some((n) =>
        line.includes(n),
      ),
    );
    expect(offenders.map((line) => line.trim())).toEqual([]);
  });

  it("stage script 只用宿主 Windows PowerShell 5.1 认的语法", () => {
    const found = ps7OnlySyntaxIn(readRegisteredConfig());
    expect(
      found,
      "`.cnb.yml` 的 script 块里用了 PS 7 才有的语法 —— 宿主是 PS 5.1，" +
        "这类写法是**解析期**错误，整段脚本一行都不执行就退非零，#1959 实测红在 0.9s",
    ).toEqual([]);
  });

  it("Python 探测入口被登记在 env 里，且真的在盘上", () => {
    const text = readRegisteredConfig();
    const m = /^\s*COMFYAPP_CI_PYTHON_PROBE:\s*(\S+)\s*$/m.exec(text);
    const declared = m?.[1];
    expect(
      declared,
      "`.cnb.yml` 的 env 里没有 COMFYAPP_CI_PYTHON_PROBE —— 缺 Python 时「跳过的是哪几条」" +
        "又变成只能靠人自己拼（`scripts/python-probe.mjs` 因此没有调用方）",
    ).toBeTruthy();
    if (!declared) throw new Error("解析不出探测入口");
    /* 它必须是**盘上真有的**文件：`env` 的值不经过 shell，写错了不会报任何错，
     * 只会在真要用的那一刻答「文件不存在」—— 那时候人正在查「为什么少判了几格」。 */
    expect(
      existsSync(path.join(ROOT, declared)),
      `env 点名的 Python 探测入口不在盘上：${declared}`,
    ).toBe(true);
  });

  it("`E2E 那一格已离开 PR（撤档，不是停用），而它的序约束整套挪到每日那一条", () => {
    const text = readRegisteredConfig();
    /* 立案（`cnb-ob4-1k5828a36`，本 PR 自己那一跑）：撤掉 PR 上的 `生产构建` 之后，
     * `E2E 关键流程` 红在 `[WebServer] Could not find a production build` ⇒
     * `Timed out waiting 180000ms from config.webServer`。病根是 `playwright.config.ts`
     * 旧那句 `CI || PNPM_START ⇒ pnpm start` 把「是不是 CI」与「工作区里有没有产物」
     * 绑成了一件。两条出路里选了「整格挪到每日档」而不是「PR 改跑现场编译档」，
     * 理由与那份实测读数写在 `.cnb.yml` 那段撤档说明里（dev 档在这台节点上从来没有读数，
     * 而它历史形态是「冒烟集体超时」）。 */
    const order = registeredGateOrder(text);
    const disabled = registeredDisabledGates(text);
    expect(
      order,
      "`E2E 关键流程` 又回到 `COMFYAPP_CI_GATES` 了 —— 它需要 `next build` 的产物，" +
        "而 PR 那一条上 2026-10-19 起没有构建那一格。要恢复 PR 的端到端，先同批恢复构建",
    ).not.toContain("E2E 关键流程");
    /* 「不在 GATES、也不在 DISABLED」在这里是**允许**的，与 `生产构建` 同一条理由：
     * 撤档不是停用 —— 停用要留原文（下面「停用登记」那两条判它），而这一格的原文与
     * 顺序约束整体搬到了每日那一条，搬去的落点由本条后半判住。 */
    expect(
      disabled,
      "`E2E 关键流程` 出现在停用清单里 —— 它不是「临时屏蔽、等环境好了加回来」，" +
        "而是**已经在每日档上每天跑着**（`每日全量E2E`）。登进停用清单等于同时说两句假话",
    ).not.toContain("E2E 关键流程");

    /* 顺序约束搬到每日那一条：浏览器缺件时整档只红在 launch 那一跳，而产物不在时
     * 红在 webServer 的 180s 超时上 —— 两者都指不到真正缺的那一格。 */
    const daily = registeredDailyGateOrder(text);
    const e2eAt = daily.indexOf("每日全量E2E");
    expect(
      e2eAt,
      "「每日全量E2E」不在每日清单里 —— 上面那条搬家的断言失去落点",
    ).toBeGreaterThan(-1);
    for (const prerequisite of ["每日浏览器安装", "每日生产构建"]) {
      expect(
        daily.indexOf(prerequisite),
        `「${prerequisite}」必须排在「每日全量E2E」之前 —— ` +
          (prerequisite === "每日生产构建"
            ? "这一格的 webServer 起的是 `pnpm start`，产物来自它"
            : "缺件时整档会以「每条都报同一个 launch 失败」的形态红"),
      ).toBeLessThan(e2eAt);
    }
    /* 产物前提要**写在配置里**，不能只靠顺序推断：这一格显式声明 `COMFY_E2E_SERVER: start`。
     * 少了这一行，它对产物的依赖就回到「因为它是 CI」那种推论 —— 而这次的红正是推论错了。 */
    expect(
      stageEnvAssignments(text, "每日全量E2E"),
      "「每日全量E2E」没有显式声明 `COMFY_E2E_SERVER: start` —— 它起的是生产服务器，" +
        "这件事必须由配置自己说出来，而不是由「它是 CI」推出来（`cnb-ob4-1k5828a36` 的教训）",
    ).toContain("COMFY_E2E_SERVER: start");
  });

  it("`每日浏览器安装` 的入口在盘上（2026-10-19 起它是唯一的执行者）", () => {
    const text = readRegisteredConfig();
    /* 那一步点名的入口必须真在盘上（同 `Python 探测入口` 那条口径：`script` 里的
     * 路径写错了不会在配置解析期报错，只在真要用的那一刻答「文件不存在」）。
     * **两种形态都要读得出来**：活的（锚点里那一项，`script:` 带缩进）
     * 与被注释掉的（`# ` 前缀让 `- name:` 那一行不再是 stage 项，剥掉前缀后顶格）。
     * ⚠️ 正则**必须容忍前导空白** —— ISSUE #1966 恢复这一格时，只认顶格的
     * `^(?:#\s*)?script:` 把活的形态判成「解析不出 script」，而它要判的是
     * 「入口在不在盘上」，不是那一行在第几列。
     * 不从原文里做「紧邻下一行」的匹配：停用块在 `- name:` 与 `script:` 之间插了
     * 一段说明，紧邻匹配会当场落空。
     *
     * 名字带「每日」是 2026-10-19 那次挪档的结果（PR 那一格撤到每日档，撤的是节奏
     * 不是账）—— 下面那条「PR 撤掉的每一格必须在每日清单里有同名执行者」判的就是
     * 这件事，所以这里不再回到 PR 那一份。 */
    const blockText =
      stageBlock(text, "每日浏览器安装") ??
      commentedStageBlock(text, "每日浏览器安装");
    const scriptLine = /^[ \t]*(?:#\s*)?script:[ \t]*(\S.*)$/m.exec(
      blockText ?? "",
    );
    const command = scriptLine?.[1]?.trim();
    expect(command, "解析不出「每日浏览器安装」那一步的 script").toBeTruthy();
    /* ⚠️ 入口**不一定在第一个字符上**：每个 stage 的脚本现在都以一句
     * `[Console]::OutputEncoding=…;` 开头（平台 stage shell 是 PowerShell，
     * 不设它平台侧的中文日志全是乱码，见 `.cnb.yml` 头注第 6 条），外面还包着
     * `ci-cp936-exit.mjs`（ISSUE #1977 的 CP936 出口）。`unwrapCp936()` 剥掉后者 ——
     * 判的是「这一段命令点到的是哪个入口」，不是「中间隔了几层壳」。 */
    const entry = /(?:^|;)\s*(?:node\s+)?(scripts\/[^\s;]+)/.exec(
      unwrapCp936(command ?? ""),
    )?.[1];
    expect(
      entry,
      `「每日浏览器安装」那一步指向的不是 scripts/ 下的入口：${command}`,
    ).toBeTruthy();
    expect(
      existsSync(path.join(ROOT, entry ?? "")),
      `「每日浏览器安装」点名的入口不在盘上：${entry}`,
    ).toBe(true);
  });

  it("`每日浏览器安装` 那一步把下载的套接字超时放宽了（180 MiB 撞 30s 是「没量完」）", () => {
    const text = readRegisteredConfig();
    /* 现场（`cnb-rkr-1k510rsgg` 的 `浏览器安装` stage）：180 MiB 的包撞上 Playwright
     * 默认的 30s **套接字**超时（`NET_DEFAULT_TIMEOUT`）被按时掐断：
     *
     *     （原文）Request to https://cdn.playwright.dev/…/win64/chrome-win64.zip
     *     （原文）timed out after 30000ms
     *
     * 那不是「CDN 不通」的结论，是「这一次没量完」—— 两者的处置相反（换镜像 vs 放宽），
     * 而日志里此前一个字都分不开它们。
     *
     * 这个键是本档**唯一**能碰到「下载」这件事的地方，而 `env` 的键写错了不会在配置
     * 解析期报任何错，只会在下一次下载时以同一个形态再红一次 —— 所以这里按「块内必须
     * 有这个键」判，而不是靠人记得。顺序/入口那一条在上面，这条只管下载预算。 */
    /* **停用时读注释块**（`commentedStageBlock`）：那两个键仍在原文里，恢复时照抄
     * 的就是它们。停用不该让「下载预算配置得对不对」这件事失去判据 —— 否则停用
     * 期间有人把镜像那一行删掉，谁也不会知道，恢复时又回到「只调超时数字」那条错路。 */
    const active = stageBlock(text, "每日浏览器安装");
    const stage = active ?? commentedStageBlock(text, "每日浏览器安装");
    if (active === null) {
      expect(
        registeredDisabledGates(text),
        "「每日浏览器安装」既不在清单里、也没在 `DISABLED_GATES` 里登记 —— " +
          "这一段判据会失去扫描对象，先补登记",
      ).toContain("每日浏览器安装");
    }
    expect(
      stage,
      "解析不出「每日浏览器安装」这一步 —— 名字被改了？",
    ).toBeTruthy();
    expect(
      stage,
      "「每日浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` —— 默认的 30s 是" +
        "**套接字**超时，180 MiB 的包在慢链路上会被它按时掐断",
    ).toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT");
    expect(stage).toMatch(
      /PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:\s*"[1-9]\d*"/,
    );

    /* 光放宽预算不够 —— 放宽到 120s 之后**照旧超时**（`cnb-gt1-1k513ill4` 的原文是
     * `timed out after 120000ms`），那时结论就变了：这台节点真的到不了
     * `cdn.playwright.dev`。所以镜像那一行也要在块里 —— 它才是让下载**到得了**的那一件，
     * 少了它，这一步会以「超时」的形态一直红下去，而人只会不断去调那个超时数字。
     *
     * 而这一行之所以**推不出来、只能由这里给**：Playwright 自己那三个内置镜像
     * **全是同一族**（`cdn.playwright.dev` / `playwright.download.prss.microsoft.com`），
     * 它 `retryCount = 5` 的「回退」在同一张网里等于没有 —— 实测逐字打了 5 次同一个
     * 域名，然后 `Download failure, code=1`（`runPlaywrightInstall` 侧对应的读数与
     * 判据见 `tests/ci-toolchain-selfcheck.test.ts` 的「下载根由外面给」那一组）。 */
    expect(
      stage,
      "「每日浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_HOST` —— 自托管节点到不了 " +
        "`cdn.playwright.dev`（120s 也超时），只放宽那个超时数字是没用的",
    ).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST:\s*"https:\/\/[^"]+"/);
  });

  it("`每日单元测试` 排在 `每日 Python 可用性` 之后（声明清单那一份）", () => {
    /* 这条原来是 PR 那一份的顺序判据（`单元测试` vs `Python 可用性`）。2026-10-19
     * 两格一起挪到每日档之后，PR 清单里两个名字都没有了 ⇒ 顺序约束本身**没有消失**，
     * 它换了一份清单：缺解释器时单测照旧往下跑（相关用例走 `env` 档跳过、不会红），
     * 而它要跑到 2h24m 才可能被平台墙钟掐断（实测 `cnb-jt3-1k5071kou`）——
     * 「要么看不到、要么在最贵的位置才看到」这个形态与挂在哪条流水线无关。
     * 这里判的是**声明的那份清单**（`COMFYAPP_CI_DAILY_GATES`），而
     * 「定时流水线里事实的 stage 顺序」由下面那条前提格判据判 —— 声明与事实两份，
     * 只读一份时另一份漂了没人红（本仓一贯的双向核对）。 */
    const order = registeredDailyGateOrder(readRegisteredConfig());
    expect(
      order.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 键被删了或换了形状，这条顺序约束就没有执行者了",
    ).toBeGreaterThan(0);
    const probeAt = order.indexOf("每日 Python 可用性");
    const testAt = order.indexOf("每日单元测试");
    /* 两个名字都必须取到：取不到就是**这一格被从清单里删了**，而顺序判据会退化成
     * 「-1 比 -1 小」那种永远成立的空判（解析失败伪装成结论）。 */
    expect(
      probeAt,
      "`每日 Python 可用性` 不在每日清单里了",
    ).toBeGreaterThanOrEqual(0);
    expect(testAt, "`每日单元测试` 不在每日清单里了").toBeGreaterThanOrEqual(0);
    expect(
      probeAt,
      "`每日 Python 可用性` 必须排在 `每日单元测试` 之前：缺解释器时那一格照旧往下跑，" +
        "红的形态是几十分钟之后一句 `timeout of 8640000ms exceeded`，读不到原因",
    ).toBeLessThan(testAt);
  });

  it("`每日单元测试` 是每日那一跑的**最后**一条（最不稳的那一格不许挡住其它格）", () => {
    /* 业主口径：「将每日单元测试放最后，最容易出问题的放最后，然后执行过的就不用重复执行了」。
     * 这不是排序偏好，是**覆盖面**：CNB 的 stage 串行且**失败即停**，而这一格是这条
     * 流水线上唯一会因**这台机器的负载**而红的格子 —— 实测 `cnb-b0l-1k59op66t`：
     * 775 份里只 1 份红，红在 `Test timed out in 30000ms`（同一时刻另有两份检出在这台
     * 16 核机上跑全量 vitest 与全量 eslint），而它后面三格的状态是 `skipped`。
     * 也就是说：它排在中间时，一单条抖动就决定 `每日生产构建` / `每日浏览器安装` /
     * `每日全量E2E` 这一天跑不跑 —— 那三格此前还没有任何一次执行记录。
     *
     * 判的是**事实**（流水线里 stage 的实际顺序），不是那份声明清单：声明与事实的
     * 逐条相等由上面「跑的就是 `COMFYAPP_CI_DAILY_GATES` 那几格」那条判住，
     * 这里再钉一次「最后」，两边就都动不了了。 */
    const stages = pipelineStageNames(readRegisteredConfig(), "每日生产构建");
    const last = stages[stages.length - 1];
    expect(
      stages.length,
      "crontab 那条流水线里解析不出 stage —— 这条判据没有对象了",
    ).toBeGreaterThan(0);
    expect(
      last,
      `每日那一跑现在排在最后的是「${last}」。把 ` +
        "`每日单元测试` 挪回中间 = 让一单条负载超时决定后面几格跑不跑；" +
        "要动这条顺序，先把「超时指纹 ⇒ 隔离复跑」那一档补上（任务里记着）",
    ).toBe("每日单元测试");
  });

  it("被停用的 stage 在 `COMFYAPP_CI_DISABLED_GATES` 里登记了，且原文以注释形态留着", () => {
    const text = readRegisteredConfig();
    const disabled = registeredDisabledGates(text);
    /* 反向：`DISABLED_GATES` 里登记了的名字，`GATES` 里就不许再有它 ——
     * 两边同时挂着等于「既跑又停」，两个判据各说各话（本仓反模式表那条）。 */
    const order = registeredGateOrder(text);
    const both = disabled.filter((n) => order.includes(n));
    expect(
      both,
      "这些 stage 同时出现在 COMFYAPP_CI_GATES 与 COMFYAPP_CI_DISABLED_GATES 里 —— " +
        "既跑又停，清单自己就矛盾了",
    ).toEqual([]);
    /* 停用 ≠ 删除：原文要 grep 得回来，恢复动作才是「取消注释」。 */
    for (const name of disabled) {
      expect(
        stageKeptAsComment(text, name),
        `\`${name}\` 被停用了，但 .gates 里找不到它以注释形态留着的 \`- name: ${name}\` ` +
          "—— 那就没有原文可恢复，停用退化成删除",
      ).toBe(true);
    }
  });

  it("`单元测试` 仍是**停用**而不是被删掉（ISSUE #1959 的临时屏蔽）", () => {
    /* 这条把「本仓此刻真的把单元测试停用了」钉成事实，并给出恢复判据的入口。
     * 它**故意不判**「永远停用」—— 停用是临时的，加回来时这条用例会因
     * `单元测试` 回到 GATES 而走另一支（此时它必须不再出现在 DISABLED 里）。 */
    const text = readRegisteredConfig();
    const order = registeredGateOrder(text);
    const disabled = registeredDisabledGates(text);
    const inGates = order.includes("单元测试");
    const inDisabled = disabled.includes("单元测试");
    expect(
      inGates !== inDisabled,
      inGates
        ? "`单元测试` 回到了 COMFYAPP_CI_GATES，但还在 COMFYAPP_CI_DISABLED_GATES 里 —— " +
            "恢复时要把它从停用清单里删掉"
        : "`单元测试` 既不在 GATES、也不在 DISABLED_GATES 里 —— 停用必须留痕（见上一条）",
    ).toBe(true);
    if (inDisabled) {
      expect(
        stageKeptAsComment(text, "单元测试"),
        "`单元测试` 被停用了，但 .gates 里没有它的注释原文 —— 恢复时无原文可依",
      ).toBe(true);
    }
  });

  it("`prettier 格式` 是**在跑**的那一档，不是停用（ISSUE #2010 改变了它的来路）", () => {
    /* 这条 stage 的名字在停用清单里躺过一阵（2026-10-16 临时让位给 E2E 调试，
     * 恢复条件是「E2E 一绿 + 平台日志中文可读」）。ISSUE #2010 把它从本地钩子
     * **挪过来接管**：判据一字未改，改变的是「判据 ⇄ 执行者」的关系 —— 从此它在这里
     * 是**唯一**执行者。于是那份停用清单里的同名条目必须出网，否则两句话对不上：
     * 一边说「这一步不许跑」，一边说「这一步是那条判据的唯一执行者」。
     *
     * 为什么这条要单独判（`单元测试` 那条同款理由）：判据与 stage 的**在场**是两件事，
     * 而「钩子撤掉 + 平台侧还在停用」组合起来的结果是「谁都没跑它」，且不会有
     * 任何别的判据变红 —— 失效形态正是「谁都没跑它」。 */
    const text = readRegisteredConfig();
    const order = registeredGateOrder(text);
    const disabled = registeredDisabledGates(text);
    expect(
      order,
      "`prettier 格式` 不在 COMFYAPP_CI_GATES 里 —— 它已随 ISSUE #2010 从本地钩子" +
        "挪到平台侧，钩子里那一步同时撤掉了；两边都没有 = 这条判据一个执行者都没有",
    ).toContain("prettier 格式");
    expect(
      disabled,
      "`prettier 格式` 还在 `COMFYAPP_CI_DISABLED_GATES` 里 —— 那一项是 2026-10-16 的" +
        "临时让位（恢复条件是 E2E 一绿 + 日志中文可读），与 ISSUE #2010 的「挪执行者」" +
        "不是同一件事；此刻它是这条判据的唯一执行者，停用等于把它关掉",
    ).not.toContain("prettier 格式");
  });

  it("慢 stage 带着量级余量的 `timeout` 预算（不然卡死要等满 2h 才有人知道）", () => {
    const text = readRegisteredConfig();
    const timeouts = stageTimeouts(text);
    /* 为什么是「点名这几个」而不是「所有 stage 都要有」：其余 stage 都是秒级
     * （`node scripts/check-*.cjs` 一族），给它们加预算只是噪音；真正的成本
     * 集中在下面这四个上，而它们恰好也是**实测挂过或最可能挂**的那几个。
     *
     * `单元测试` 被**临时停用**（`DISABLED_GATES`，ISSUE #1959）时它不在清单里，
     * 于是这里也不要求它有预算 —— 预算跟着 stage 走。它一旦被加回来（不再出现在
     * 停用清单里），这条要求**自动恢复**，不需要有人记得改回来。
     *
     * `生成态文档与源同步` 曾是那个名单的第五个（ISSUE #1981）：`--check --autofix`
     * 红了要就地重渲染再判一次，不是一个 stage 能在秒级里做完的。2026-10-19 它收进了
     * 聚合档 `重档静态判据`（理由见 `scripts/ci-heavy-gates.mjs` 头注），预算跟着搬到
     * 那一格上 —— 而那一格的预算在下面被**单独**要求（`重档静态判据` 同在这份名单里，
     * 这里不再点一个已经不存在的 stage 名，那只会是一句空话）。 */
    const disabled = registeredDisabledGates(text);
    /* ⚠️ `生产构建`（2026-10-18）与 `E2E 关键流程`（2026-10-19）**都从这一列摘掉了**，
     * 而且不是因为预算可以不要：那两格离开了 PR 那一条，现在只在每日档
     * （`每日生产构建` / `每日全量E2E`）。它们的预算由下面那条「定时那一跑」的判据钉，
     * 入口是不是跑法脚本也由同一条钉 —— 这里再留两个不存在的名字只会变成一句空话。
     * 「谁把它们加回 PR 却不给预算」由 `MUST_ALWAYS_RUN`（`ci-incremental-gates`）与
     * `.gates` 里那两段撤档说明看着。 */
    const required = [
      "ESLint 零警告",
      "单元测试",
      "重档静态判据",
      /* 2026-10-20 新增的增量档：它起 vitest 子进程，卡死的形态与 `单元测试` 同族
       * （实测本地 forks worker 调度超时），所以预算跟着那一族走，不因为「跑得快」
       * 就省掉 —— 预算回答的是「卡死多久有人知道」，不是「通常跑多久」。 */
      "受影响用例",
    ].filter((name) => !disabled.includes(name));
    const missing = required.filter((name) => !timeouts.has(name));
    expect(
      missing,
      "这些 stage 没有 `timeout` 预算：平台默认 Job 上限是 2 小时，卡死时要等满才有人知道 " +
        "（实测 cnb-jt3-1k5071kou 的 `ESLint 零警告` 与 cnb-did-1k50659np 的 `单元测试` " +
        "各挂 8640s，只留下 `timeout of 8640000ms exceeded`）",
    ).toEqual([]);
    // 预算必须是**分钟量级**：写成 `2h` 等于没写（平台默认就是这个数）。
    for (const name of required) {
      const raw = timeouts.get(name) ?? "";
      const m = /^(\d+)([smh])$/.exec(raw);
      expect(m, `${name} 的 timeout 写法认不出：${raw}`).not.toBeNull();
      if (!m) continue;
      const minutes =
        Number(m[1]) * (m[2] === "h" ? 60 : m[2] === "s" ? 1 / 60 : 1);
      expect(
        minutes,
        `${name} 的 timeout=${raw} 是小时量级 —— 那与平台默认的 2h 上限没有区别，` +
          "起不到「卡死要早报」的作用",
      ).toBeLessThanOrEqual(60);
      expect(
        minutes,
        `${name} 的 timeout=${raw} 太紧（真跑得完的形态会被误杀）`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("流水线级 `lock` 声明了 `cancel-in-progress`（一台节点上别堆几条全量流水线）", () => {
    expect(
      hasPipelineLockCancelInProgress(readRegisteredConfig()),
      "`.common` 锚点里没有 `lock.cancel-in-progress: true` —— 自托管只有一台节点，" +
        "一次 PR 上连推几个提交就会把几条全量流水线堆到同一台机上互相挤压" +
        "（实测 cnb-jt3-1k5071kou / cnb-did-1k50659np / cnb-s61-1k50eo6p1 三条一起冻结）。" +
        "旧的那几条对应的是已被取代的修订号，它们的读数本来就没有意义",
    ).toBe(true);
  });

  it("流水线级 `lock.key` 显式写了，且**不按目标分支**分锁（并行 PR 会互相掐停）", () => {
    const text = readRegisteredConfig();
    const template = pipelineLockKeyTemplate(text);
    expect(
      template,
      "`.common` 锚点里没有 `lock.key` —— 平台默认 key 是 `分支名-流水线名`，" +
        "而 `pull_request` 下 `CNB_BRANCH` 是**目标分支名**，于是全仓所有 PR " +
        "共用一把锁、`cancel-in-progress` 退化成「全仓只留最新那一跑」：" +
        "任意两条并行 PR 互相掐停（现场：PR #1980 掐了 #1982）。" +
        "代价不是「慢」，是白跑一整条",
    ).not.toBeNull();
    if (template === null) return;
    // ① 代入的变量必须在白名单里 —— `CNB_BRANCH` 正是那个会退化成目标分支的。
    const used = [...template.matchAll(/\$\{?([A-Za-z0-9_]+)\}?/g)].map(
      (m) => m[1] ?? "",
    );
    const stray = used.filter(
      (name) => !LOCK_KEY_ALLOWED_VARS.includes(name as never),
    );
    expect(
      stray,
      `\`lock.key\` 用了白名单外的变量 ${stray.join(" / ")}：` +
        "`CNB_BRANCH` 在合并类事件下是**目标分支名**（全仓 PR 撞同一把锁），" +
        "`CNB_PULL_REQUEST_ID` 是跨仓全局 ID（粒度比这里需要的粗），" +
        "两者的取舍写在 .cnb.yml 那段注释里",
    ).toEqual([]);
    // ② 语义：把变量真代进去，两条不同 PR 的 key 必须不同。
    const prKey = (iid: string) =>
      resolveLockKey(template, {
        CNB_PULL_REQUEST_IID: iid,
        CNB_PULL_REQUEST: "true",
      });
    expect(
      prKey("1982"),
      "两条并行 PR 解析出同一把锁 —— 后到的那条会把先跑的掐掉（正是要修的形态）",
    ).not.toBe(prKey("1980"));
    // ③ 同一 PR 内连着推提交仍要落回同一把锁（否则「只留最新那一跑」就没了）。
    expect(prKey("1982")).toBe(prKey("1982"));
    /* ④ 非 PR 事件（`push`）不能与任何一条 PR 撞锁：那里 `CNB_PULL_REQUEST_IID`
     * 无值，代进去之后必须与 `prKey()` 的结果不同。 */
    const pushKey = resolveLockKey(template, {
      CNB_PULL_REQUEST_IID: undefined,
    });
    expect(pushKey).not.toBe(prKey("1982"));
    /* ⑤ 未替换的原文不许留下裸 `$`（平台不认的写法会**原样**进 key，看起来像
     * 「生效了」而实际是所有人共用一把名字里带 `$` 的锁）。 */
    expect(template).not.toMatch(/\$[^{A-Za-z0-9_]/);
  });

  it("覆盖率上报那一档接回了上报链，且**没报告时不判红**（ISSUE #1990）", () => {
    /* 这一条守的是一个已经发生过两次的形态：上报是 #623 删旧版流水线时被一起拿走的，
     * #1959 按完整流程重建时没被带回来 —— 于是「洞察 → 单元测试覆盖率」永远是
     * 「无 / 无」，而没有任何一步会红（页面读的是平台侧读数，配置里少一条执行者
     * 与「还没跑过」长得一模一样）。
     *
     * 2026-10-19 起它不再是独立 stage，而是聚合档 `重档静态判据` 的一个条目
     * （理由见 `scripts/ci-heavy-gates.mjs` 头注：平台单 stage 20m 与每格一次的
     * job 开销）。两半仍然分开判：
     *   ① 它在**条目表里**、点名的入口在盘上（不然接回去也只是一句注释）；
     *   ② 它**必须**自己判「有没有报告」—— 缺 `coverage/lcov.info` 时只跳过。
     *      理由不是「宽容」：`单元测试` 此刻是临时停用的，报告本来就不存在，
     *      把它判红等于让停用这件事连带把整条流水线拦死。 */
    const gate = HEAVY_GATES.find((g) => g.name === "覆盖率上报");
    expect(
      gate,
      "聚合档 `重档静态判据` 的条目表里没有 `覆盖率上报` —— 平台侧的覆盖率读数又没人写了" +
        "（「洞察 → 单元测试覆盖率」会退回「无 / 无」）",
    ).toBeDefined();
    const entry = "scripts/ci-coverage-report.mjs";
    expect(gate?.argv.join(" "), `\`覆盖率上报\` 没有点名 ${entry}`).toContain(
      entry,
    );
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 这一档会静默什么都不做（cnb 自己不存在时同理，` +
        "但那条至少会在日志里说出来）",
    ).toBe(true);
    /* ② 「有没有报告」这件事必须由那个脚本自己答，不能交给平台插件的缺省值
     * （`breakIfNoCoverage` 缺省即报错退出 —— 那正是旧版在 1~2s 内红掉的那一格）。
     * 判据读**脚本原文**而不是命令行：跳过这一跳是它的实现，不是它的一条参数。 */
    const script = readFileSync(path.join(ROOT, entry), "utf8");
    expect(
      script,
      "`覆盖率上报` 必须自己判报告在不在（`coverage/lcov.info` 缺席时跳过而不是判红）——" +
        "`单元测试` 此刻被临时停用，报告本来就不存在",
    ).toContain("coverage/lcov.info");
    expect(
      script,
      "那个脚本必须有一个「没有报告」的出口，且在缺报告时**不退非零**",
    ).toMatch(/没有报告/);
  });

  it("定时那一跑（crontab）挂在 master 下、每天一次，且跑的就是 `COMFYAPP_CI_DAILY_GATES` 那七格（ISSUE #2010 / #2018）", () => {
    /* 用户的要求是「生产构建改为定时任务，每天 1 次」。这句话在配置里落成三件
     * 互相独立的事实，缺任一件都会**静默失效**（不会报错，只是那条流水线不按
     * 人想的那样跑）：
     *
     *   ① 事件键的形态：定时任务只认 `"crontab: <五段 cron>"` 这种**带引号的字符串键**
     *      （官方 `zh/build/crontab.md`）。写成 `crontab:` 映射 / `schedule:` 时平台
     *      不会报错，只是永远不触发 —— 与 #1229 那次「顶层写 stages: 匹配不到事件」同形。
     *   ② 分支键：定时任务**不支持 glob**，必须挂明确的单一分支名。这里要求 `master`：
     *      每天要证的是「master 的 HEAD 今天能不能构建出来」，挂到别的分支上是另一件事
     *      （而且别的分支不会有这条配置被解析的机会）。
     *   ③ 频率：**每天 1 次**。cron 的第 3 段是「日」、第 2 段是「时」—— 第 2 段一旦写成
     *      `*`（每小时）或列表（`0 4,16 * * *`），「每天一次」就变成了「每天 N 次」，
     *      而配置看起来仍然像一条正常的定时任务。判据只认「单一小时 + 单一分钟」。 */
    const text = readRegisteredConfig();
    const events = crontabEvents(text);
    expect(
      events.length,
      '`.cnb.yml` 里没有 `"crontab: …"` 事件键 —— 生产构建又只剩 PR 那一条了' +
        "（`pull_request` 上那条答的是「这次改动能不能构建」，「今天能不能构建」没人答）",
    ).toBe(1);
    const event = events[0];
    if (!event) throw new Error("解析不出 crontab 事件键");
    expect(
      event.branch,
      "定时任务的分支键必须是明确的单一分支名（官方：不支持 glob）—— 这里要的是 master",
    ).toBe("master");
    const cron = event.cron.split(/\s+/);
    expect(cron, `cron 表达式不是五段：${event.cron}`).toHaveLength(5);
    const [minute, hour, dom, month, dow] = cron;
    /* 每天一次 = 分钟固定、小时固定，日 / 月 / 周都是通配。 */
    for (const [field, name] of [
      [minute, "分钟"],
      [hour, "小时"],
    ] as const) {
      expect(
        /^\d+$/.test(field ?? ""),
        `cron 的${name}段（"${field}"）不是单值 —— 「每天 1 次」要求它固定到一个点上；` +
          `写成 \`*\` / 列表 / 区间都意味着一天跑多次`,
      ).toBe(true);
    }
    for (const [field, name] of [
      [dom, "日"],
      [month, "月"],
      [dow, "周"],
    ] as const) {
      expect(field, `cron 的${name}段应当是 \`*\`：${event.cron}`).toBe("*");
    }

    /* ③ 那一跑跑的是每日清单那七格（四格前提 + 三档重档），每一格都是**跑法脚本**
     * （不是裸 `pnpm run build` / 裸 vitest）。全跑门禁不是定时任务要做的事（那是
     * `pull_request` 那条流水线的差事），而裸跑 = 跑了不记账
     * （`scripts/.artifact-freshness.json` 一个字不变）。 */
    const daily = pipelineStageNames(text, "每日生产构建");
    expect(
      daily,
      "crontab 那条流水线里解析不出 stage —— 名字被改了，或者 stages 的形状变了",
    ).toEqual(registeredDailyGateOrder(text));
    expect(
      registeredDailyGateOrder(text),
      "`COMFYAPP_CI_DAILY_GATES` 与定时流水线里的 stage 对不上 —— 那一跑跑什么就没有事实源了",
    ).toEqual(DAILY_GATES);
    const stage = stageBlock(text, "每日生产构建");
    expect(stage, "`.cnb.yml` 里找不到「每日生产构建」那一项").toBeTruthy();
    expect(
      stage,
      "「每日生产构建」跑的还是裸 `pnpm run build` —— 那样这一次的绿只落在日志里、" +
        "账面上一个字不变。入口要写 `node scripts/ci-daily-build.mjs`",
    ).not.toContain("pnpm run build");
    const entry = "scripts/ci-daily-build.mjs";
    expect(stage, `「每日生产构建」没有点名 ${entry}`).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在平台侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 预算：一天的预算只有这一条，卡满 2h 墙钟等于当天这一跑没有结论。
     * 判据用的是 `stageTimeouts()`（与 PR 那条同一份解析），不在这里另抄一份 glob。 */
    const budget = stageTimeouts(text).get("每日生产构建");
    expect(
      budget,
      "「每日生产构建」没有 `timeout` 预算 —— 平台默认 Job 上限是 2 小时，卡死要等满才有人知道",
    ).toBeTruthy();
  });

  it("每日单元测试：整档 + 跑法脚本 + 预算大于脚本自己的墙钟预算", () => {
    const text = readRegisteredConfig();
    const entry = "scripts/full-suite-run.mjs";
    /* 只扫 `script` 那一串，不扫整块：这一档的注释正当地要写出「不许带 `--grep`」这句话，
     * 把说明判成违规等于逼人删注释（与 PS 5.1 那条形制判据「注释里同形文本放过」同一条口径）。 */
    const script = stageScriptLine(text, "每日单元测试");
    expect(
      script,
      "「每日单元测试」没有 `script` —— 那一格根本不会跑任何命令",
    ).toBeTruthy();
    expect(
      script,
      "「每日单元测试」跑的应是**跑法脚本** —— 裸 vitest 的绿只落在日志里，" +
        "`scripts/.full-suite-freshness.json` 一个字不变，本地「当天跑过」那条判据照旧拦人",
    ).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在平台侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 整档：`isWholeTrackRun` 把「透传了参数」判成不构成凭证、当场不记账。
     * 所以这里判的不是风格 —— 加了 `--grep` 的那一跑会**绿着不记账**，
     * 而账面看起来与真跑过一模一样。 */
    for (const forbidden of ["--grep", "--coverage=false", "tests/"]) {
      expect(
        script,
        `「每日单元测试」带了 ${forbidden} —— 那不是整档，跑绿也不记账`,
      ).not.toContain(forbidden);
    }
    /* 预算必须**大于**脚本自己的墙钟预算：否则先被掐的是 stage，而那一刀不带
     * 「被预算砍 vs 判据红」的分流话术（`classifyOutcome`），读起来就像判据红。 */
    const minutes = stageBudgetMinutes(stageTimeouts(text).get("每日单元测试"));
    expect(
      minutes,
      "「每日单元测试」没有 `timeout` 预算（一天的量级，卡死要早报）",
    ).toBeTruthy();
    expect(
      minutes * 60_000,
      `stage 预算必须大于 FULL_SUITE_TIMEOUT_MS（${FULL_SUITE_TIMEOUT_MS}ms）—— ` +
        "否则先被平台掐的是 stage，那一刀没有分流话术",
    ).toBeGreaterThan(FULL_SUITE_TIMEOUT_MS);
  });

  it("每日全量E2E：整档（不许带任何收窄参数）+ 排在浏览器之后 + 有分钟量级预算", () => {
    const text = readRegisteredConfig();
    const entry = "scripts/e2e-run.mjs";
    const script = stageScriptLine(text, "每日全量E2E");
    expect(
      script,
      "「每日全量E2E」没有 `script` —— 那一格根本不会跑任何命令",
    ).toBeTruthy();
    expect(
      script,
      `「每日全量E2E」应点名 ${entry} —— 它是 \`FRESHNESS_TRACKS.e2e\` 现在唯一的执行者，` +
        "裸 `playwright test` 的绿不记账，而本地自证已经从钩子里撤掉（§11.8）",
    ).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在平台侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 收窄参数 = 跑绿也**不构成整档凭证**（`isWholeTrackRun`）。这一条比「风格」重：
     * PR 那一格带的正是 `--grep=@critical`，抄过来会得到一格「每天绿、账面永远不动」
     * 的档 —— 与「这一档三个月没人跑」在账面上逐字同形。
     * 只扫 `script`：这一档的注释正当地要写出「不许带 `--grep`」这句话。 */
    for (const forbidden of ["--grep", "tests/", "e2e/"]) {
      expect(
        script,
        `「每日全量E2E」带了 ${forbidden} —— 那不是整档，跑绿也不记账`,
      ).not.toContain(forbidden);
    }
    /* 顺序与产物前提**不在这里判**：`每日生产构建` / `每日浏览器安装` 必须排在前、
     * 以及这一格显式声明 `COMFY_E2E_SERVER: start`，都写在上面那条「E2E 已离开 PR」的
     * 判据里 —— 那三件与「为什么这一格非搬不可」是同一个故事，拆成两处各自半条，
     * 读者两边都看不全（而同一件事判两遍正是 §12.12 要拦的形状）。
     * 这一格只管**跑法形状**：点名整档入口、不带任何收窄参数、带分钟量级预算。 */
    const minutes = stageBudgetMinutes(stageTimeouts(text).get("每日全量E2E"));
    expect(
      minutes,
      "「每日全量E2E」没有 `timeout` 预算 —— 平台默认 Job 上限是 2 小时，卡死要等满才有人知道",
    ).toBeTruthy();
    expect(
      minutes,
      `「每日全量E2E」的预算 ${minutes}m 不在分钟量级那一档（10~60）`,
    ).toBeGreaterThan(9);
  });

  it("本地撤掉自证要求的三档，每一档的 `ciStage` 都必须在定时清单里（撤拦 ≠ 没人跑）", () => {
    /* 这一条是 `FRESHNESS_TRACKS[*].ciStage` 那格豁免的**唯一前提**：
     * `freshness-gate.mjs` 看到非空 `ciStage` 就不再要求本地当天自证，
     * 于是「本地不拦」成立的条件全在「平台侧那一格真的每天在跑」上。
     * 没有这条判据时，删掉一个每日 stage（或把名字打错）会让那一档变成
     * **谁都不跑**，而本地照样绿 —— 那是本仓最不能有的静默形态（§11.23 那一族）。 */
    const text = readRegisteredConfig();
    const daily = registeredDailyGateOrder(text);
    expect(
      daily,
      "定时清单解析不出来 —— 这条判据一旦取不到清单就会恒放行，先看解析器",
    ).toBeTruthy();
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      const stage = String(track.ciStage ?? "").trim();
      expect(
        stage,
        `\`${kind}\` 没有登记 ciStage，而本地又不拦 —— 那一档现在没有任何执行者`,
      ).toBeTruthy();
      expect(
        daily,
        `「${stage}」不在 \`COMFYAPP_CI_DAILY_GATES\` 里 —— ${track.label} 这一档` +
          "本地不拦的前提没了。要么把那一格加回定时清单，要么把 ciStage 清空让本地重新拦",
      ).toContain(stage);
    }
  });

  it("定时那一跑的前提格：安装与 Python 必须先于单测，且 script 与 PR 那格逐字相同", () => {
    const text = readRegisteredConfig();
    const order = registeredDailyGateOrder(text);
    const suite = order.indexOf("每日单元测试");
    expect(suite, "「每日单元测试」不在定时清单里").toBeGreaterThan(-1);
    /* 顺序不是风格：每次构建都是全新 job 目录（`工作区复用读数` 两跑实测），没有
     * `node_modules` 与库表时，那一跑会以「找不到 next / 连不上库」的形态红，
     * 而那种报错指不到真正缺的那一格。 */
    expect(
      order.indexOf("每日安装依赖"),
      "「每日安装依赖」必须排在「每日单元测试」之前 —— 否则整档跑在没有 node_modules 的检出上",
    ).toBeLessThan(suite);
    expect(
      order.indexOf("每日 Python 可用性"),
      "「每日 Python 可用性」必须排在「每日单元测试」之前 —— 缺解释器时相关用例只走 env 档跳过（静默少判）",
    ).toBeLessThan(suite);
    expect(
      order.indexOf("每日同步数据库表结构"),
      "「每日同步数据库表结构」必须排在「每日单元测试」之前 —— 没库时读库的用例报的是「连不上」",
    ).toBeLessThan(suite);
    /* 两跑之间**不许各漂一份**：这些格子的名字带「每日」前缀（不共用名字是为了让
     * 按名字取块的解析器不撞车），所以「同一件事」这件事只能由 script 逐字相同来保证。
     * 比的是**真正会执行的那些行**：块脚本里的 `#` 注释与空行不算 —— 两格各自要解释的
     * 事情不一样（PR 那一格背着一整段「为什么这一步是前提」），把散文也要求逐字相同
     * 只会逼人删解释，而漂移恰恰藏在命令行里。 */
    for (const [daily, pr] of DAILY_SCRIPT_MIRRORS) {
      const dailyScript = executableScriptLines(text, daily);
      const prScript = executableScriptLines(text, pr);
      const dailyEnv = stageEnvAssignments(text, daily);
      const prEnv = stageEnvAssignments(text, pr);
      expect(
        [...dailyScript, ...dailyEnv],
        `定时那一跑里找不到「${daily}」的 script`,
      ).toBeTruthy();
      expect(
        [...prScript, ...prEnv],
        `PR 那一跑里找不到「${pr}」的 script —— 镜像判据两边都要取得到，否则它是空转`,
      ).toBeTruthy();
      /* 例外那一半先按**形状**判（名单里的键必须只在 PR 侧、且必须是「置着」的形状），
       * 再把那几行剥掉 —— 剩下的仍然走同一条逐字相同。顺序要紧：先判形状，
       * 「每日那一格被人补回了开关」才会被读成那句，而不是被 toEqual 报成一堆行的差。 */
      const onlyOnPr = DAILY_ENV_ONLY_ON_PR[daily] ?? [];
      expect(
        checkPrOnlyEnvExceptions(dailyEnv, prEnv, onlyOnPr),
        `${daily} 与 ${pr} 之间的 PR-only env 例外形状不成立`,
      ).toBeNull();
      expect(
        [...dailyScript, ...dropPrOnlyEnvLines(dailyEnv, onlyOnPr)],
        `「${daily}」与 PR 那一格的**命令行与 env 赋值**不再逐字相同 —— 判据是同一份脚本、` +
          "取字节的根也是同一个，改一边不改另一边就是两条流水线各自漂（§12.12 的孪生形态，" +
          "只是它长在配置里）。唯一的例外登记在 DAILY_ENV_ONLY_ON_PR，它只豁免那一行",
      ).toEqual([...prScript, ...dropPrOnlyEnvLines(prEnv, onlyOnPr)]);
    }
  });

  it("PR-only env 例外不是空转：四种坏形状都要被点名，而现役形状必须过", () => {
    const keys = ["COMFY_CI_SLOT"];
    const healthyPr = ['COMFY_CI_SLOT: "1"'];
    // 对照组：现役那份形状（PR 置着、每日一个字都没有）必须判成合法 ——
    // 否则这条判据就成了恒红，而恒红的判据与没有判据在账面上同形。
    expect(checkPrOnlyEnvExceptions([], healthyPr, keys)).toBeNull();
    // ① 每日那一格被人补回了开关（这正是本次要挡回去的那一步）。
    expect(
      checkPrOnlyEnvExceptions(['COMFY_CI_SLOT: "1"'], healthyPr, keys),
    ).toContain("每日那一格又写上了");
    // ② 写成「关掉的开关」同样不行：它读起来像「这里本来就该有一行」。
    expect(
      checkPrOnlyEnvExceptions(['COMFY_CI_SLOT: "0"'], healthyPr, keys),
    ).toContain("每日那一格又写上了");
    // ③ PR 那一格被摘干净 ⇒ 名单过期，必须点名而不是静默放行。
    expect(checkPrOnlyEnvExceptions([], [], keys)).toContain("名单过期了");
    // ④ PR 那一格还在，但不再是「置着」的形状 ⇒ 例外被改成了「随便漂」。
    expect(
      checkPrOnlyEnvExceptions([], ['COMFY_CI_SLOT: "0"'], keys),
    ).toContain("不再是「置着」的形状");
    // 同一个键写两遍（YAML 静默覆盖）也要被抓住。
    expect(
      checkPrOnlyEnvExceptions(
        [],
        ['COMFY_CI_SLOT: "1"', 'COMFY_CI_SLOT: "0"'],
        keys,
      ),
    ).toContain("同一个键写两遍");
    // 名单为空时不误伤：形状检查一条都不该响。
    expect(checkPrOnlyEnvExceptions(["A: 1"], ["A: 1"], [])).toBeNull();
    // 剥行那一步只剥名单里的键，其余一字不动（否则「逐字相同」会被悄悄放宽）。
    expect(
      dropPrOnlyEnvLines(
        ['COMFY_CI_SLOT: "1"', 'PLAYWRIGHT_DOWNLOAD_HOST: "x"'],
        keys,
      ),
    ).toEqual(['PLAYWRIGHT_DOWNLOAD_HOST: "x"']);
    expect(dropPrOnlyEnvLines(['B: "1"'], [])).toEqual(['B: "1"']);
    // 脚本行不会被误认成 env 赋值（`$enc=…` / `node …` 都没有 `KEY:` 那个形状）。
    expect(envAssignmentKey("$enc=[Text.Encoding]::UTF8")).toBeNull();
    expect(envAssignmentKey("node scripts/db-push.mjs")).toBeNull();
    expect(envAssignmentKey('  COMFY_CI_SLOT: "1"')).toBe("COMFY_CI_SLOT");
  });

  it("从 PR 撤下来的环境格，每一格在每日那一跑里都有同名执行者（撤拦 ≠ 撤账）", () => {
    /* 2026-10-19 的口径：只判**节点**的那几格不必每个 PR 都判（`工具链自证` 13.8s /
     * `Python 可用性` 2.8s / `Python 探针读数` 3.0s / `浏览器安装` 3.0s，逐格读数来自
     * 合并前那一跑的 stage 表）。**撤的是节奏，不是账** —— 这条判据就是那一句的机器形式：
     * 四个名字必须①不在 PR 清单里（否则它同时是两份执行者，镜像判据失去对象），
     * ②在每日清单里有 `每日<名>` 那一格，③那一格点的仍是**同一个入口脚本**、
     * 共用脚本时还带着**那个分档旗标**。
     *
     * 少了③，「撤到每日档」与「悄悄删掉」在配置文件里逐字同形：名字还在清单上、
     * 块被换成一条别的命令，两边都是绿的 —— 而那一格其实谁都不判了。 */
    const text = readRegisteredConfig();
    const prOrder = registeredGateOrder(text);
    const dailyOrder = registeredDailyGateOrder(text);
    expect(
      prOrder.length,
      "解析不出 COMFYAPP_CI_GATES —— 这条判据就没有对象了",
    ).toBeGreaterThan(0);
    expect(
      dailyOrder.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 这条判据就没有对象了",
    ).toBeGreaterThan(0);
    for (const [former, dailyName, entry, flag] of PR_MOVED_TO_DAILY) {
      expect(
        prOrder,
        `「${former}」又回到 PR 清单里了 —— 那意味着它同时是两份执行者，` +
          "`DAILY_SCRIPT_MIRRORS` 必须同批把它加回相同性判据，两处不能各说一套",
      ).not.toContain(former);
      expect(
        dailyOrder,
        `「${former}」从 PR 撤下来之后，每日清单里没有「${dailyName}」—— ` +
          "这一格如今谁都不判，而清单上看着仍在",
      ).toContain(dailyName);
      const lines = executableScriptLines(text, dailyName);
      expect(
        lines,
        `每日档里取不到「${dailyName}」的 script —— 名字改了，还是整块没了`,
      ).toBeTruthy();
      const command = lines.join(" ");
      expect(
        command,
        `「${dailyName}」点的入口不是 ${entry}：撤档不等于换判据`,
      ).toContain(entry);
      if (flag !== "") {
        expect(
          command,
          `「${dailyName}」丢了 ${flag} —— 它与别的格共用同一份脚本，是这一面旗标把它分成另一格`,
        ).toContain(flag);
      }
    }
  });

  it("判据不是空转：喂进 CI 配置名时必须判成违规", () => {
    // ① 匹配逻辑认得这批名字，且不误收别的。
    expect(
      ciConfigsAmong([
        ".cnb.yml",
        ".github",
        "pnpm-workspace.yaml",
        "package.json",
        "playwright.config.ts",
      ]),
    ).toEqual([".cnb.yml"]);
    expect(ciConfigsAmong([".github/workflows"])).toEqual([
      ".github/workflows",
    ]);
    // ② 反向锚点判据在缺文案时确实会红。
    expect(missingAnchors("package.json", ["不可能出现的句子"])).toEqual([
      "不可能出现的句子",
    ]);
    // ③ 形态契约真的会拒绝坏形态（#1229 那种顶层写 stages: 的）。
    const bad = "stages:\n  - name: x\n    script: echo hi\n";
    expect(CONFIG_SHAPE.filter((c) => c.mustMatch.test(bad)).length).toBe(0);
    // ④ 扫描面清单本身不许被悄悄掏空 —— 掏空了上面几条用例就恒绿。
    expect(CI_CONFIG_FILES.length).toBeGreaterThanOrEqual(7);
    expect(CI_CONFIG_PATHS.length).toBeGreaterThanOrEqual(2);
    expect(DOC_ANCHORS.length).toBeGreaterThanOrEqual(2);
    expect(CONFIG_SHAPE.length).toBeGreaterThanOrEqual(5);
    // ⑤ 锚点解析器在锚点被删时要答「解析不出」，而不是给一个空壳蒙混过关。
    expect(resolveAnchoredRunner("master:\n  push:\n    - x\n")).toEqual([]);
    /* ⑥ PS 5.1 兼容判据：喂进真语法要红、喂进**注释里**的同形文本要放过。
     * 后者不是宽容 —— 判据的说明里正当地会写出这些形状（那条 ⚠️ 就是），
     * 把说明判成违规等于逼人删注释。 */
    expect(
      ps7OnlySyntaxIn(
        "master:\n  push:\n    - script: |\n        $x = $o?.Source\n",
      ),
    ).toHaveLength(1);
    expect(
      ps7OnlySyntaxIn(
        "master:\n  push:\n    - script: |\n        # 不许写 ?. （PS 7 only）\n        $x = 1\n",
      ),
    ).toEqual([]);
    // 块外的同形文本不许被算进来（缩进收口真在起作用）。
    expect(
      ps7OnlySyntaxIn(
        "master:\n  name: a?.b\n    - script: |\n        $x = 1\n",
      ),
    ).toEqual([]);
    expect(PS7_ONLY.length).toBeGreaterThanOrEqual(4);
    /* ⑦ stage 顺序判据与探测入口判据都要能红：喂进一份「单元测试 排在 Python 后面」
     * 的配置时必须点名，喂进**没有那个键**的配置时必须答「解析不出」。 */
    const badOrder =
      "x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      单元测试, Python 可用性\n";
    const badOrderParsed = registeredGateOrder(badOrder);
    expect(badOrderParsed.indexOf("Python 可用性")).toBeGreaterThan(
      badOrderParsed.indexOf("单元测试"),
    );
    expect(registeredGateOrder("master:\n  push:\n    - x\n")).toEqual([]);
    /* ⑦′ **停用清单**的解析器与两条新判据都要能真红（不然「停用 ≠ 删除」是空话）：
     *  · 解析器认得那份折叠标量、键不在时答空、不误收 `GATES` 的内容；
     *  · 注释形态那条对**行内 `#`** 与**行尾注释**都判得出来。 */
    const disabledFixture =
      "x:\n  env:\n    COMFYAPP_CI_DISABLED_GATES: >-\n      单元测试, 别的东西\n";
    expect(registeredDisabledGates(disabledFixture)).toEqual([
      "单元测试",
      "别的东西",
    ]);
    expect(registeredDisabledGates("master:\n  push:\n    - x\n")).toEqual([]);
    // `GATES` 的内容不许被 `DISABLED_GATES` 的解析器收走（两个键的正则不能互相命中）。
    expect(
      registeredDisabledGates(
        "x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      单元测试\n",
      ),
    ).toEqual([]);
    expect(
      registeredGateOrder(
        "x:\n  env:\n    COMFYAPP_CI_DISABLED_GATES: >-\n      单元测试\n",
      ),
    ).toEqual([]);
    // 注释形态：整行被 `#` 注释掉才算「留了原文」；没注释的不算、名字不同的不算。
    expect(
      stageKeptAsComment(
        "x:\n  stages:\n  #   - name: 单元测试\n  #     script: x\n",
        "单元测试",
      ),
    ).toBe(true);
    expect(
      stageKeptAsComment(
        "x:\n  stages:\n  - name: 单元测试\n    script: x\n",
        "单元测试",
      ),
    ).toBe(false);
    expect(
      stageKeptAsComment("x:\n  stages:\n  #   - name: 别的\n", "单元测试"),
    ).toBe(false);
    /* ⑧ 预算与流水线锁两条判据都要能红：喂进不带 timeout 的 stage 块、
     * 喂进不带 lock 的锚点，都必须答「没有」。 */
    // 夹具按**真实缩进**写：`stages:` 的直接子项是 2 空格、键在 4 空格。
    const noBudget = "x:\n  stages:\n  - name: 单元测试\n    script: x\n";
    expect(stageTimeouts(noBudget).has("单元测试")).toBe(false);
    const withBudget =
      "x:\n  stages:\n  - name: 单元测试\n    script: x\n    timeout: 45m\n";
    expect(stageTimeouts(withBudget).get("单元测试")).toBe("45m");
    /* 子 Job 那一层（Job 级 `image:` 的容器格）：预算跟着 `image` 一起下移，
     * 而 stage 名照旧取**外层**那一个 —— 判据与账里用的都是它。 */
    expect(
      stageTimeouts(
        "x:\n  stages:\n  - name: E2E\n    jobs:\n      - name: E2E\n        image: node:24\n        timeout: 30m\n",
      ).get("E2E"),
    ).toBe("30m");
    /* 更深的 `env:` 里出现 `timeout:` 不算（那是另一个东西）。 */
    expect(
      stageTimeouts(
        "x:\n  stages:\n  - name: a\n    env:\n      timeout: 99m\n",
      ).has("a"),
    ).toBe(false);
    // 同级下一项开始后，上一项的 timeout 不许被算到它头上。
    expect(
      stageTimeouts(
        "x:\n  stages:\n  - name: a\n    timeout: 20m\n  - name: b\n    script: x\n",
      ).has("b"),
    ).toBe(false);
    expect(
      hasPipelineLockCancelInProgress(
        ".common: &common\n  runner:\n    namespace: group\n",
      ),
    ).toBe(false);
    expect(
      hasPipelineLockCancelInProgress(
        ".common: &common\n  lock:\n    cancel-in-progress: true\n  runner:\n    namespace: group\n",
      ),
    ).toBe(true);
    // 只有 `lock:`、没有那一个键 ⇒ 仍判「没有」（漏掉它正是要拦的形态）。
    expect(
      hasPipelineLockCancelInProgress(
        ".common: &common\n  lock:\n    key: something\n  runner:\n    namespace: group\n",
      ),
    ).toBe(false);
    /* ⑨ `lock.key` 这一族：解析器认得出原文、没写时回 null、`lock` 块内
     * `key` 不会从别的键里误收；而替换语义要能真把「两条 PR 撞锁」照出来。 */
    expect(
      pipelineLockKeyTemplate(
        ".common: &common\n  lock:\n    cancel-in-progress: true\n  runner:\n    namespace: group\n",
      ),
    ).toBeNull();
    const keyFixture =
      ".common: &common\n  lock:\n    key: pr-$CNB_PULL_REQUEST_IID\n    cancel-in-progress: true\n";
    expect(pipelineLockKeyTemplate(keyFixture)).toBe(
      "pr-$CNB_PULL_REQUEST_IID",
    );
    // 默认口径的那种写法（`$CNB_BRANCH`）也能被解析出来 —— 由调用方判它违规，
    // 不是靠「解析不出来」蒙过去。
    expect(
      pipelineLockKeyTemplate(
        ".common: &common\n  lock:\n    key: $CNB_BRANCH-质量门禁\n",
      ),
    ).toBe("$CNB_BRANCH-质量门禁");
    // 替换：两种花括号都认、无值替换成空串、不认识的变量按空串算。
    expect(resolveLockKey("a-$X-${Y}-$Z", { X: "1", Y: "2" })).toBe("a-1-2-");
    // 撞锁的形态必须能被照出来：只按目标分支写的 key，两条 PR 代入后逐字相同。
    const branchKey = resolveLockKey("$CNB_BRANCH-质量门禁", {
      CNB_BRANCH: "master",
      CNB_PULL_REQUEST_IID: "1982",
    });
    expect(branchKey).toBe(
      resolveLockKey("$CNB_BRANCH-质量门禁", {
        CNB_BRANCH: "master",
        CNB_PULL_REQUEST_IID: "1980",
      }),
    );
  });

  it("crontab 那几条判据不是空转：坏形态必须被它们判出来", () => {
    /* 反向自检（同 `判据不是空转` 那一组的第 ④ 条）：上面那条判据的三半各喂一组坏样本，
     * 每一组都必须真的被拦下 —— 否则「每天一次」这件事就只剩注释里的一句话。 */
    // ① 事件键的形态：`crontab:` 裸映射 / `schedule:` / 段数不对，都解析不出事件。
    expect(crontabEvents("master:\n  crontab:\n    - x\n")).toEqual([]);
    expect(crontabEvents("master:\n  schedule: 0 4 * * *\n")).toEqual([]);
    // 正确的形态认得出来，且把父分支键带出来（定时任务只认单一分支名）。
    expect(
      crontabEvents('master:\n  "crontab: 0 4 * * *":\n    - x\n'),
    ).toEqual([
      { branch: "master", event: "crontab: 0 4 * * *", cron: "0 4 * * *" },
    ]);
    // ② 频率那三段的判据：每小时 / 一天多次 / 分钟也散开的形态，判定都必须是「不是单值」。
    for (const cron of ["0 * * * *", "0 4,16 * * *", "*/30 2 * * *"]) {
      const [minute, hour] = cron.split(" ");
      expect(/^\d+$/.test(minute ?? ""), `${cron} 的分钟段应当不是单值`).toBe(
        cron === "0 * * * *" ? true : cron === "0 4,16 * * *" ? true : false,
      );
      expect(/^\d+$/.test(hour ?? ""), `${cron} 的小时段应当不是单值`).toBe(
        cron === "0 4,16 * * *"
          ? false
          : cron === "*"
            ? false
            : cron === "0 * * * *"
              ? false
              : true,
      );
    }
    // ③ 清单解析器：键在 / 键不在 / 不误收 `GATES`（两个键的正则不能互相命中）。
    expect(
      registeredDailyGateOrder(
        "x:\n  env:\n    COMFYAPP_CI_DAILY_GATES: >-\n      每日生产构建\n",
      ),
    ).toEqual(["每日生产构建"]);
    expect(registeredDailyGateOrder("master:\n  push:\n    - x\n")).toEqual([]);
    expect(
      registeredDailyGateOrder(
        "x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      每日生产构建\n",
      ),
    ).toEqual([]);
    expect(
      registeredGateOrder(
        "x:\n  env:\n    COMFYAPP_CI_DAILY_GATES: >-\n      每日生产构建\n",
      ),
    ).toEqual([]);
    /* ④ 「流水线里真的跑哪几格」：从 `name:` 之后按缩进收，别把停用行算进来。 */
    const fixture = [
      "master:",
      '  "crontab: 0 4 * * *":',
      "    - <<: *common",
      "      name: 每日生产构建",
      "      stages:",
      "        # - name: 注释掉的",
      "        - name: 每日生产构建",
      "          script: x",
      "  push:",
      "    - <<: *common",
      "      name: 别的流水线",
      "      stages:",
      "        - name: 别的格",
      "",
    ].join("\n");
    expect(pipelineStageNames(fixture, "每日生产构建")).toEqual([
      "每日生产构建",
    ]);
    expect(pipelineStageNames(fixture, "别的流水线")).toEqual(["别的格"]);
    expect(pipelineStageNames(fixture, "不存在的流水线")).toEqual([]);
    /* **引用形态**（`stages: *daily_gates`）：两个触发口共用一份清单之后，判据读得到的
     * 必须还是那七格。这一支此前根本没被解析器支持 —— 不是缺功能，是缺一条会红的判据：
     * 遇到引用它回 `[]`，于是「这条流水线一格都没有」看起来像事实，而它其实是解析失败。 */
    const aliased = [
      ".daily-gates: &daily_gates",
      "  - name: 每日安装依赖",
      "    script: x",
      "  # 注释行不算一格",
      "  - name: 每日全量E2E",
      "    script: y",
      ".other: &other",
      "  - name: 别的锚点",
      "master:",
      '  "crontab: 0 4 * * *":',
      "    - <<: *common",
      "      name: 每日生产构建",
      "      stages: *daily_gates",
      "  web_trigger_daily:",
      "    - <<: *common",
      "      name: 每日档（手动触发）",
      "      stages: *daily_gates",
      "",
    ].join("\n");
    expect(pipelineStageNames(aliased, "每日生产构建")).toEqual([
      "每日安装依赖",
      "每日全量E2E",
    ]);
    expect(
      pipelineStageNames(aliased, "每日档（手动触发）"),
      "两个触发口读出来不一样 —— 引用解析在某一侧走岔了",
    ).toEqual(pipelineStageNames(aliased, "每日生产构建"));
    // 锚点不存在时是「没找到」，不是「清单为空」：调用方要能分开这两件事。
    expect(anchorStageNames(aliased, "no_such_anchor")).toEqual([]);
    expect(anchorStageNames(aliased, "other")).toEqual(["别的锚点"]);
  });

  it("扫描面真的收到了仓库根（不是空数组假装通过）", () => {
    const top = repoTopLevel();
    // 仓库根一定存在的锚点文件：缺了说明 readdirSync 指错了地方。
    for (const anchor of ["package.json", "vitest.config.ts", ".githooks"]) {
      expect(top).toContain(anchor);
    }
  });
});
