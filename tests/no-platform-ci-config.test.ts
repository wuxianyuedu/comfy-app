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
/* 那两份清单的解析**搬进 `scripts/ci-gate-names.mjs`** 了 —— 判据脚本
 * `scripts/check-gate-name-executors.mjs` 也要读同一份清单，两边各写一遍就会漂开。
 * 这里保留转出（三个消费方 import 的是这个文件的导出）。 */
import {
  registeredDisabledGates as disabledGatesImpl,
  registeredGateOrder as gateOrderImpl,
} from "../scripts/ci-gate-names.mjs";
/* 单跑那三档的前提集与「单跑名 ⇄ 每日名」的对照是**数据**，一份出处在
 * `scripts/ci-oneshot-gates.mjs`。这里 import 它而不是在测试里重抄一遍 ——
 * 重抄就成了「判据自己就是第二份事实」。 */
import {
  ONESHOT_TARGETS,
  oneshotGates,
  oneshotPairs,
} from "../scripts/ci-oneshot-gates.mjs";
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
/**
 * 探针流水线（ISSUE #2363）的**有期限例外** —— 与上面 `CONFIG_SHAPE` 那条
 * 「每条流水线都要引用 `*common`」的判据配成一对，理由写在用到它的那条用例里。
 *
 * 两条都是字面量：名单不许泛化成「自带 runner 的都放行」（那等于把判据关掉），
 * 日期不许省（省了它，「临时」就只剩注释里的一句话）。
 */
const PROBE_PIPELINES = [
  "api_trigger_probe_a",
  "api_trigger_probe_b",
  "api_trigger_probe_c",
] as const;

/** 探针的到期日：过了这一刻，本文件的用例当场要求把那三条与这段例外一起删掉。 */
const PROBE_BY = "2026-11-09T00:00:00Z";

/**
 * 探针里**被测的锁形态**逐条点名放过哪条规则（与 `PROBE_PIPELINES` 同一天到期）。
 *
 *   · `api_trigger_probe_a` —— `cancelFalse`: 那把锁要的正是 `cancel-in-progress: false`
 *     （问「第二条到达时是排队还是被掐掉」），而 R2 默认把「漏写」判红；
 *   · `api_trigger_probe_b` / `api_trigger_probe_c` —— `noLock`: 对照组**一条锁都不写**
 *     才是它的条件，写上一把就量不到「没有锁时会不会并行」。
 *
 * ⚠️ 这两件事都不是「放宽 R1/R2」：名单是字面量、逐条写明放过哪一条规则，
 * 且**判据仍然会问**另外那几条（key 字面量 / 不撞退化形状 / 一把锁只给一份清单）。
 */
const PROBE_LOCK_EXEMPT: Array<{
  event: string;
  /** 这一条的锁**故意**不写 `cancel-in-progress`，锚点名写在这里（其余一条都不许借）。 */
  cancelFalse?: string;
  /** 这一条**故意**一条锁都不写（对照组）。 */
  noLock?: boolean;
}> = [
  { event: "api_trigger_probe_a", cancelFalse: "lock_probe_a" },
  { event: "api_trigger_probe_b", noLock: true },
  { event: "api_trigger_probe_c", noLock: true },
];

/** 取某个事件键下那一段原文（到下一个 2 空格事件键为止）；取不到给空串。 */
function configEventBlock(text: string, event: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${event}:`);
  if (start < 0) return "";
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break;
    out.push(line);
  }
  return out.join("\n");
}

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
/* 实现见 `scripts/ci-gate-names.mjs`（判据脚本与三处消费它的测试共用同一份解析，
 * 不各写一遍 —— §12.12 / §12.18）。 */
export function registeredGateOrder(text: string): string[] {
  return gateOrderImpl(text);
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
/* 实现见 `scripts/ci-gate-names.mjs`（同一份解析，三处消费共用）。 */
export function registeredDisabledGates(text: string): string[] {
  return disabledGatesImpl(text);
}

/**
 * 定时那一跑的清单（与 `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES` 同一份，顺序即执行序）。
 *
 * ⚠️ 第一条是 `每日失败立案` —— 它立案的是**上一跑**，所以必须排在任何可能红的格之前；
 * 写在后面就会被前面那次红一起 `skipped`，而那正是它要治的形态（ISSUE #2274）。
 * ⚠️ 最后一条是 `每日单元测试` —— 那是刻意的（业主口径「最容易出问题的放最后」：
 * 它是这条上唯一会因本机负载而单条超时的格子，排在中间就把后面三格一起 skip 掉）。
 * 「它必须是最后一条」由下面那条判据钉住，不是这里的一份巧合。
 */
const DAILY_GATES = [
  "每日失败立案",
  "每日工具链自证",
  "每日安装依赖",
  "每日 Python 可用性",
  "每日 Python 探针读数",
  "每日同步数据库表结构",
  "每日新鲜度账",
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
  /* `新鲜度账` 是**第三种理由**（ISSUE #2300 主体分权）：PR 上下文读的是**主干的账**
   * （`FRESHNESS_TRACKS[*].subject` 三档都是 `master`，权威副本在机器分支
   * `ci/freshness-ledger` 上），判的是「这台机器 / 主干怎么被调度」，不是任何一次
   * PR 的缺陷 ⇒ 留在 PR 上只会把主干的红算到这次 PR 头上。
   * 第四元组（旗标）留空：这一格**不共用**别的格的脚本，也没有任何分档参数；
   * 每日那一格与它的差别在 **env**（`COMFY_CI_SUBJECT: "master"`），
   * 而 env **不在这条判据的比较面里**（它只比 `script:` 那几行）。 */
  ["新鲜度账", "每日新鲜度账", "scripts/freshness-gate.mjs", ""],
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
  每日安装依赖: ["COMFY_CI_SLOT"],
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

/** `.lock-*` 那几把**类锁**的定义：锚点名 → `{ key 原文, cancel-in-progress 原文 }`（`null` = 没写）。 */
export function lockAnchorDefinitions(
  text: string,
): Map<string, { key: string; cancelInProgress: boolean | null }> {
  const out = new Map<string, { key: string; cancelInProgress: boolean | null }>();
  const def =
    /^\.lock-[\w-]+:[ \t]*&(lock_\w+)[ \t]*$([\s\S]*?)(?=^\S|$(?![\s\S]))/gm;
  for (const m of text.matchAll(def)) {
    const name = m[1];
    const body = m[2] ?? "";
    const key = /^[ \t]+key:[ \t]*(\S.*?)[ \t]*$/m.exec(body)?.[1];
    if (name === undefined || key === undefined) continue;
    /* `null` = 这一行**没写**；`false` 是「写了、值是 false」—— 两者不同：
     * 漏写会让同一件事重复排队，而 `false` 是有意的取舍（逐笔留读数，见 R2）。 */
    const rawCancel = /^[ \t]+cancel-in-progress:[ \t]*(true|false)[ \t]*$/m.exec(
      body,
    )?.[1];
    out.set(name, {
      key,
      cancelInProgress:
        rawCancel === undefined ? null : rawCancel === "true",
    });
  }
  return out;
}

/**
 * `master:` 块里每条流水线的**锁归属**与它引用的那份 stage 清单。
 *
 * 为什么按文本解析而不是 `js-yaml`：本文件的其余判据全是文本形状（同一口径），
 * 而且 `js-yaml` 不是本仓的直接依赖（它在 `.pnpm` 里是传递依赖，用例不该倚它）。
 *
 * 形状前提与 `resolveAnchoredRunner` 那族一致：分支键 2 空格、事件键下那条流水线项
 * 的 `name:` / `lock:` / `stages:` 都在 6 空格那一层。
 *
 * @param text `.cnb.yml` 原文
 * @returns 每条流水线一项（`lockRef === null` = 吃 `.common` 那条 = 要么真是 PR，要么忘了写覆盖）
 */
export function pipelineLockAssignments(text: string): Array<{
  event: string;
  name: string;
  lockRef: string | null;
  stagesRef: string | null;
}> {
  const out: Array<{
    event: string;
    name: string;
    lockRef: string | null;
    stagesRef: string | null;
  }> = [];
  let inMaster = false;
  let event = "";
  let name = "";
  let lockRef: string | null = null;
  let stagesRef: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^master:[ \t]*$/.test(raw)) {
      inMaster = true;
      continue;
    }
    /* 下一个顶层键 ⇒ `master:` 块结束。 */
    if (inMaster && /^\S/.test(raw) && !raw.startsWith("#")) inMaster = false;
    if (!inMaster) continue;
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;
    const eventKey = /^ {2}(\S.*):[ \t]*$/.exec(raw);
    if (eventKey?.[1] !== undefined) {
      event = eventKey[1].replace(/^"|"$/g, "").trim();
      continue;
    }
    /* 新的一项从**它自己的 `name:`** 起 —— 「判定换了一条流水线」认的是 `name:`，
     * 而 `lock:` / `stages:` 只在**当前这一项之内**算数。少了这句，上一条流水线的
     * `lock:` 会被带进下一条（探针那三条自己写 `runner`、不吃锚点，并且都带 `lock:`，
     * 于是它们会各自继承**上一条**的锁归属 —— ISSUE #2363 那段注释早就点了这个
     * 坏形态，判据这一侧到 2026-10-26 才算真的堵上）。
     * 显式清空之后，「没写 `lock:` 的项」落到 R1 该有的读数上，不再看上一项的运气。 */
    const itemStart = /^ {4}-[ \t]*(?:<<:)?[ \t]*/.exec(raw) !== null;
    if (itemStart) {
      name = "";
      lockRef = null;
      stagesRef = null;
      continue;
    }
    const nameKey = /^ {6}name:[ \t]*(.+?)[ \t]*$/.exec(raw);
    if (nameKey?.[1] !== undefined) {
      name = nameKey[1];
      lockRef = null;
      stagesRef = null;
      continue;
    }
    const lockKey = /^ {6}lock:[ \t]*\*(\w+)[ \t]*$/.exec(raw);
    if (lockKey?.[1] !== undefined) {
      lockRef = lockKey[1];
      continue;
    }
    const stagesKey = /^ {6}stages:[ \t]*(\*\w+)?[ \t]*$/.exec(raw);
    if (stagesKey !== null) {
      /* 一份 `stages:` 收尾一项；内联清单（没有 `*ref`）当作**只属于这一条**，
       * 于是「同一把锁只许给同一份工作清单」那条规则对它天然要求独占。 */
      stagesRef = stagesKey[1] ?? `inline:${name}`;
      out.push({ event, name, lockRef, stagesRef });
    }
  }
  return out;
}

/**
 * 锁按触发类分开之后要成立的五件事，返回**违规清单**（空 = 都成立）。
 *
 * 判的不是风格。ISSUE #2114 记下的第二条死因是「所有非 PR 流水线共用一把退化成
 * `pr-` 的锁」，现场两次：`cnb-5j9-1k5bc4p4u`（每日最后一格与两笔 push 相差 3 秒被
 * `cancel`）与 `cnb-lm1-1k5h1otqt`（一次 `api_trigger_build` 跑到 244.06 秒被一次
 * 无关 push 掐掉，与那条 push 的 `createTime` 差 0.2 秒）。所以这里要钉住的是：
 *
 *  · **R1** 非 PR 的每条都显式写 `lock:` —— 靠 `<<: *common` 继承就是那次退化的入口；
 *  · **R2** 引用的那把类锁在场、**显式写了** `cancel-in-progress`、且 key 是**字面量**
 *    （带变量 = 又一次「某个事件上它无值就退化」，正是 #1981 那条教训）。
 *    「显式写了」与「值是 true」是两件事（ISSUE #2396）：`push` 那一档要的是
 *    **排队而不是终止**，它的判据是下面那条 R6；
 *  · **R3** 同一把锁只许给**同一份工作清单**（`stages:` 引用相同）——
 *    这条把「互掐」限制在「同一件事被重复排队」上：三条每日触发口允许（同一份
 *    `*daily_gates`），而「单跑构建」与「单跑 E2E」共用一把就是本条要拦的形态；
 *  · **R4** 任何一条非 PR 的 key 都不许等于退化后的那个 `pr-`，也不许等于 `pr-<iid>`；
 *  · **R5** PR 那一条仍然用带 `CNB_PULL_REQUEST_IID` 的模板（PR 粒度不许回退成
 *    「全仓一把」，那是 #1981 修掉的第一个 bug）；
 *  · **R6** `push` 那把锁必须是 `cancel-in-progress: false`（ISSUE #2396）。
 *    这一档守的是「落到 master 的是不是 PR 合并形态」，读数**逐提交**给：终止旧的一跑
 *    = 把前一笔的结论删掉，而重跑它的成本整条只有 20~35 秒。若哪天它扩成多格、
 *    成本上去了，先改这一条与规范 §13.5.3.10，而不是把 `true` 悄悄写回来。
 *
 * @param text `.cnb.yml` 原文
 * @param prIid 用来模拟一次 PR 事件的编号（默认任取一个，只用于比对形状）
 * @returns 每条违规的一句人话
 */
export function lockClassViolations(text: string, prIid = "1982"): string[] {
  const bad: string[] = [];
  const defs = lockAnchorDefinitions(text);
  const commonTemplate = pipelineLockKeyTemplate(text);
  if (commonTemplate === null) {
    return ["`.common` 锚点里没有 `lock.key` —— 全部流水线回落到平台默认 key"];
  }
  const rows = pipelineLockAssignments(text);
  if (rows.length === 0) {
    return [
      "解析不出 `master:` 块里的任何流水线 —— 判据在这一份配置上恒转（要修解析器）",
    ];
  }
  const prKey = resolveLockKey(commonTemplate, {
    CNB_PULL_REQUEST_IID: prIid,
    CNB_PULL_REQUEST: "true",
  });
  /* 非 PR 事件上那个变量无值 ⇒ 这就是那份退化后的形状本身。 */
  const degenerateKey = resolveLockKey(commonTemplate, {});

  /** 同一把工作清单 → 允许共用它的那些锁；反过来锁 → 它只能给一份清单。 */
  const lockToWork = new Map<string, Set<string | null>>();

  /* 探针（ISSUE #2363）里**被测的就是锁本身**：A 的 `cancel-in-progress: false` 是它要问的
   * 那个问题、B/C 的「一条锁都不写」是它的对照组 —— 两者都不是漏写的配置。所以 R1（必须
   * 显式写 `lock:`）与 R2 的「必须显式写 `cancel-in-progress`」这一半对它们不成立。
   *
   * 但豁免是**逐条点名**的，不是「探针都放行」：
   *   · `PROBE_PIPELINES` 是**到期日**与**不许吃锚点**那一半的名单（见下面那条用例）；
   *   · `PROBE_LOCK_EXEMPT` 是**这一层**的名单，逐条写清「放过哪一条规则」。
   * 探针仍然要过「key 是字面量」「不撞退化形状」「一把锁只给一份清单」。
   *
   * ⚠️ `cancel-in-progress: true` 在 A 那把锁上**不会**被本函数点名，而这是刻意的：
   * 「写了 `true` 就等于终止旧的一跑」这条判据（R6）只对 `push` 那把锁成立，因为它
   * 守的是「逐提交给读数」那一档。A 要的是 `false`，写成 `true` 等于把问题掐掉 ——
   * 那一半由**下面那条用例**守着（它直接读配置原文断言 `cancel-in-progress: false`），
   * 不在这里重复一遍。
   *
   * 两份名单都是字面量而不是 `PROBE_PIPELINES` 的投影：B/C 不吃锚点却也不该拿到
   * 「A 那把 `false` 的锁」那张通行证 —— 投影会让「C 有了锁」与「A 的锁错了」在读数上
   * 变成同一件事。 */
  const probeExempt = new Map(
    PROBE_LOCK_EXEMPT.map((e) => [e.event, e]),
  );

  for (const row of rows) {
    if (row.event === "pull_request") {
      /* R5：PR 那一条的 key 必须随 PR 编号变。用两个编号各代一次、比结果 ——
       * 只看原文里有没有那个变量名是不够的（#1981 那个 bug 的原文里也有变量，
       * 只是代进去之后两条 PR 逐字相同）。 */
      const template =
        row.lockRef === null
          ? commonTemplate
          : (defs.get(row.lockRef)?.key ?? commonTemplate);
      const a = resolveLockKey(template, { CNB_PULL_REQUEST_IID: "1980" });
      const b = resolveLockKey(template, { CNB_PULL_REQUEST_IID: "1982" });
      if (a === b) {
        bad.push(
          `PR 流水线「${row.name}」的 key 与 PR 编号无关（两代都是「${a}」）—— 并行 PR 会互相掐停，这是 #1981 修掉的形态回潮`,
        );
      }
      continue;
    }
    /* R1：非 PR 的一条都不许靠继承拿锁 —— 那次退化就是从继承进来的。
     * 例外只有「对照组」那一形（探针 C：一条锁都不写才是它的对照条件）。 */
    if (row.lockRef === null && probeExempt.get(row.event)?.noLock === true) {
      continue;
    }
    if (row.lockRef === null) {
      bad.push(
        `非 PR 流水线「${row.name}」（事件 ${row.event}）没有显式的 lock 覆盖 —— 它会继承 .common 那条模板，而该模板在非 PR 事件上退化成一把共用锁`,
      );
      continue;
    }
    const def = defs.get(row.lockRef);
    if (def === undefined) {
      bad.push(`「${row.name}」引用了不存在的锁锚点 *${row.lockRef}`);
      continue;
    }
    /* R2 的「必须显式写」这一半：`cancel-in-progress: false` 与「漏写」在配置里长得
     * 一样，所以漏写默认判红；只有**点名要 `false`** 的那一把（探针 A）放过。 */
    const exemptCancel =
      probeExempt.get(row.event)?.cancelFalse === row.lockRef;
    if (def.cancelInProgress === null && !exemptCancel) {
      bad.push(
        `锁 *${row.lockRef} 没有显式写 cancel-in-progress —— 漏写与「有意排队」在配置里长得一样，重复排队就收不成一条（要排队的那一档写 false 并说明理由）`,
      );
    }
    /* R2：类锁的 key 必须是字面量。 */
    if (def.key.includes("$")) {
      bad.push(
        `锁 *${row.lockRef} 的 key「${def.key}」带变量 —— 变量在某个事件上无值就退化成共用一把（#1981 那条教训的另一面）`,
      );
    }
    /* R4：不许等于退化形状，也不许等于 PR 那把的形状。 */
    if (def.key === degenerateKey || def.key === prKey) {
      bad.push(
        `「${row.name}」的 key「${def.key}」与非 PR 退化 / PR 那把逐字相同 —— 跨事件互掐回来了`,
      );
    }
    const seen = lockToWork.get(def.key);
    if (seen === undefined) lockToWork.set(def.key, new Set([row.stagesRef]));
    else seen.add(row.stagesRef);
  }
  /* R6：`push` 那一档逐提交卖读数，「只留最新那一笔」等于删掉前一笔的结论。
   * 判的是**代出来的 key**，不是锚点名 —— 改名 / 换锚点都逃不掉。 */
  for (const row of rows) {
    if (row.lockRef === null) continue;
    const def = defs.get(row.lockRef);
    if (def?.key !== "push") continue;
    if (def.cancelInProgress !== false) {
      bad.push(
        `锁 *${row.lockRef}（key「${def.key}」）的 cancel-in-progress 不是 false —— ` +
          "「master 合并复核」的读数是逐提交给的，终止旧的一跑等于把前一笔的结论删掉（ISSUE #2396）",
      );
    }
  }
  for (const [key, works] of lockToWork) {
    if (works.size > 1) {
      const list = [...works]
        .map((w) => w ?? "(没收到 stages 引用)")
        .join(" / ");
      bad.push(
        `锁 key「${key}」被 ${works.size} 份不同的 stage 清单共用（${list}）—— 同一把锁只该挡「同一件事被重复排队」，不同事之间不该互掐`,
      );
    }
  }
  return bad;
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
 * `.cnb.yml` 的**顶层键**清单（缩进 0、非注释、非空行，取第一个 `:` 之前的部分）。
 *
 * 为什么要判这个：`master:` 这类事件容器出现**两次**时，YAML 不报错 —— 后一处静默
 * 覆盖前一处。而这份配置里 `master:` 下面挂着 `"crontab: 0 2 * * *"`，所以
 * 「新开一个 `master:` 好加几条流水线」这个动作会**当场让定时那一跑消失**，
 * 配置读起来却完全正常（与 ISSUE #2114 那句「账面认为有人判」同族的失效形态）。
 * 判据只判一件事：同一个顶层键不许出现第二行 —— 新事件一律作为已有 `master:` 的子键加。
 *
 * @param text `.cnb.yml` 原文
 * @returns 顶层键（按出现顺序，**允许重复**：重复就是要抓的东西）
 */
export function topLevelKeys(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw === "" || raw.startsWith("#")) continue;
    if (/^\S/.test(raw)) {
      const m = /^([^:]+):/.exec(raw.trimEnd());
      if (m?.[1] !== undefined) out.push(m[1].trim());
    }
  }
  return out;
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
    // 每条流水线都必须引用那个锚点：少引用一条 = 那一条悄悄回落到计费的平台池
    // （`runner.namespace: group` + `tags` 就在这个锚点里）。
    // 引用形态 = 分支键下、事件键下的那一层 `- <<: *anchor`。两个锚点合在一个合并键里
    // 也算（`- <<: [*common, *pr_fail_stage]`）—— 这条判据问的是「有没有哪条流水线漏接了
    // `*common`」，而 `<<:` 在同一层写两次是**非法 YAML**（`Map keys must be unique`），
    // 所以「一条流水线引用两个锚点」只有流式这一种合法写法。
    //
    // ⚠️ 这里**不再钉一个写死的条数**（过去钉的是 5，等于把「今天有几条流水线」当判据）：
    // 加一条流水线（单跑那六条就是）会让它红，而红的不是任何缺陷 —— 这条判据要问的是
    // 「有没有哪条流水线漏了引用」。基准改从文本里现推：一条流水线必然带且只带一个
    // 顶层 `stages:` 键（六空格那一层，引用形态 `stages: *x` 与内联形态都算），
    // 引用数与它对齐才算每条都接上了 runner。把某条的 `stages:` 删了同样红。
    const refs = text.match(/^\s+-\s*<<:\s*(?:\[\s*)?\*\w+/gm) ?? [];
    const stageLists = text.match(/^ {6}stages:/gm) ?? [];
    /* 有期限的探针例外（ISSUE #2363）从两边**同额**扣掉：探针不吃锚点、也不吃
     * `*common` 那条锁（理由见下面那条用例）。同额扣除必须两头都有 —— 只减一边
     * 会让「漏接锚点」与「探针在跑」在读数上变成同一个数字。 */
    const probing = PROBE_PIPELINES.filter((name) =>
      text.includes(`  ${name}:\n`),
    );
    expect(
      refs.length + probing.length,
      `锚点引用数（${refs.length}）与带 \`stages:\` 的流水线数（${stageLists.length}）对不上 —— ` +
        "有一条流水线没接上 `*common`，它会静默回落到计费的平台池",
    ).toBe(stageLists.length);
    expect(
      refs.length,
      "一条流水线都没引用锚点（`.common` 被删了或换了形状）",
    ).toBeGreaterThanOrEqual(5);
  });

  it("探针例外有期限：在册的探针流水线不许吃 `*common`，且过了 `PROBE_BY` 必须删掉", () => {
    /* 这一条是**有期限的例外**，不是放宽判据（ISSUE #2363 的探针）。
     *
     * 为什么那三条探针不许吃 `*common`：锚点自带的 `lock.key: pr-$CNB_PULL_REQUEST_IID`
     * 在 `api_trigger` 上无值 ⇒ 三条会落回同一把字面 `pr-` 并互相掐停，那正是探针要量
     * 的东西 —— 探针先得自己不成为变量。于是它们逐字写 `runner`，而上面那条
     * 「每条都要引用锚点」的判据就没法同时成立。
     *
     * 处置方式刻意选了「例外 + 自毁」，不是「把判据放宽」：
     *   · 例外的**名单**是字面量（`PROBE_PIPELINES`），不是「任何自带 runner 的都放行」；
     *   · 例外**有到期日**（`PROBE_BY`），过了那一刻本用例当场变红、要求把整段删掉 ——
     *     「临时」两个字不靠人的记性；
     *   · 现役配置里**这三条一旦消失**，本用例照样绿（名单里没有 = 没有例外要判）
     *     ⇒ 删掉探针不会留下一条只能靠改用例才能过的判据。
     */
    const text = readRegisteredConfig();
    const alive = PROBE_PIPELINES.filter((name) =>
      text.includes(`  ${name}:\n`),
    );
    if (alive.length === 0) return;
    expect(
      Date.parse(PROBE_BY),
      `探针已经过期（PROBE_BY=${PROBE_BY}）—— 读数早该取完了，把 .cnb.yml 里那三条探针` +
        `（${PROBE_PIPELINES.join(" / ")}）与这一段例外一起删掉`,
    ).toBeGreaterThan(Date.now());
    /* 例外只覆盖「不吃锚点」这一件事：探针仍然必须在自托管节点上跑、仍然必须有 tags ——
     * 少了它们，探针量到的是平台池的时序，与这件事无关。 */
    for (const name of alive) {
      const block = configEventBlock(text, name);
      expect(block, `探针 ${name} 在配置里但没有可解析的流水线体`).not.toBe("");
      expect(
        block,
        `探针 ${name} 没有 namespace: group（会回落到计费平台池）`,
      ).toMatch(/namespace:\s*group\b/);
      expect(block, `探针 ${name} 没有非空 tags`).toMatch(
        /^\s*tags:\s*\n\s+-\s*\S+/m,
      );
      expect(
        block,
        `探针 ${name} 引用了 \`*common\` —— 它会继承那条 PR 模板锁，三条互相掐停，探针自己成了变量`,
      ).not.toMatch(/<<:\s*(?:\[\s*)?\*\w+/);
    }
    /* 例外只覆盖「不吃锚点」与「A 那把锁刻意 `cancel-in-progress: false`」两件事：
     * 别的一条都不许借道。至少有一条探针必须留着那把 `false` 的锁 —— 它是被测对象本身，
     * 三条都删了就等于探针没在测任何东西，而用例会静静地全绿。 */
    const aBlock = configEventBlock(text, "api_trigger_probe_a");
    if (aBlock !== "") {
      expect(
        aBlock,
        "探针 A 的锁定义里没有 `cancel-in-progress: false` —— 它测的就是这个值，改成 `true` 等于把问题掐掉",
      ).toMatch(/cancel-in-progress:\s*false/);
    }
  });

  it("定时 / 手点 / API 三个触发口跑的是同一份清单，而按钮与事件键两两对上", () => {
    /* 手动触发那一口解决的是「想知道答案的人不该等到下一次定时那一跑」；它必须与定时那一条
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

  /* ── 锁按**触发类**分开（ISSUE #2114 的第二条死因）───────────────────────
   *
   * 上面那一条判的是「PR 之间不许互掐」（#1981，那个 bug 的现场是 PR #1980 掐了 #1982）。
   * 这一族判的是它的另一半：`CNB_PULL_REQUEST_IID` 在非 PR 事件上无值 ⇒ 所有非 PR
   * 流水线落回同一把字面 `pr-`，而这份配置的非 PR 流水线从**一条**长到了**九条**
   * （`master 合并复核` + 每日三条触发口 + 单跑六条），那句「这一档只有一条流水线，
   * 不带分支名也不丢语义」的前提就是这么被推翻的 —— 而没人回来改它，因为它写在注释里。
   * 两次现场读数：`cnb-5j9-1k5bc4p4u` 的 `每日单元测试` 被一次 push 掐掉（差 3 秒）、
   * `cnb-lm1-1k5h1otqt` 的一次按需复验跑到 244.06 秒被一次无关 push 掐掉（差 0.2 秒）。
   */
  it("非 PR 的每条流水线各有其类锁，且一把锁只挡「同一件事被重复排队」", () => {
    const text = readRegisteredConfig();
    expect(lockClassViolations(text), text).toEqual([]);
    /* 现推的基准，不写死条数（同 `runner 是锚点展开后…` 那一条的口径）：
     * 九条非 PR + 一条 PR。少解析出一条就是判据在空转，所以按 `stages:` 那一层对齐。 */
    const rows = pipelineLockAssignments(text);
    const stageLines = (text.match(/^ {6}stages:/gm) ?? []).length;
    expect(
      rows.length,
      `解析出的流水线数（${rows.length}）与带 stages: 的项（${stageLines}）对不上 —— 有一条被漏掉，它就没人判`,
    ).toBe(stageLines);
    expect(rows.filter((r) => r.event === "pull_request").length).toBe(1);
    expect(
      rows.filter((r) => r.event !== "pull_request").length,
    ).toBeGreaterThanOrEqual(9);
    /* 三条每日触发口仍然同一把（那份互斥是刻意保留的，不是被这次改动顺手拆掉的）。
     * 这里**不钉事件名清单** —— 时刻那一格由 crontab 那几条判据管，这里只管锁。 */
    const daily = rows.filter((r) => r.lockRef === "lock_daily");
    expect(daily.length).toBe(3);
    expect(new Set(daily.map((r) => r.stagesRef)).size).toBe(1);
    expect(daily.every((r) => r.event !== "pull_request")).toBe(true);
    /* 单跑：同一档的 web 与 api 各引用同一把、且引用同一份 stage 清单。 */
    for (const suffix of ["build", "e2e", "unit"] as const) {
      const same = rows.filter((r) => r.lockRef === `lock_oneshot_${suffix}`);
      expect(same.length, `单跑 ${suffix} 那两条应有一把共用的类锁`).toBe(2);
      expect(new Set(same.map((r) => r.stagesRef)).size).toBe(1);
    }
  });

  /**
   * 反向自检：这一族的五条规则各喂一个坏形状，都必须被抓到。
   *
   * 用一份**自带的最小配置**而不是去改现役 `.cnb.yml`：现役那份近两千行，
   * 在它上面做字符串替换会把「替换没命中」伪装成「判据过了」（本仓栽过一次那种）。
   * 这份夹具的五条流水线形状与现役一致（分支键 2 空格、项内 6 空格、`- <<: *common`），
   * 所以它同时是**解析器本身**的活体证据 —— 那 4 条收不齐，后面每一条断言都无从谈起。
   */
  it("锁按类分开那五条判据不是空转：五种坏形状各被点名，而现役配置一条都不被抓", () => {
    const fixture = [
      ".common: &common",
      "  lock:",
      "    key: pr-$CNB_PULL_REQUEST_IID",
      "    cancel-in-progress: true",
      ".lock-push: &lock_push",
      "  key: push",
      "  cancel-in-progress: false",
      ".lock-daily: &lock_daily",
      "  key: daily",
      "  cancel-in-progress: true",
      "master:",
      "  pull_request:",
      "    - <<: *common",
      "      name: 质量门禁",
      "      stages: *gates",
      "  push:",
      "    - <<: *common",
      "      name: master 合并复核",
      "      lock: *lock_push",
      "      stages: *push_stages",
      "  web_trigger_daily:",
      "    - <<: *common",
      "      name: 每日档（手动触发）",
      "      lock: *lock_daily",
      "      stages: *daily_gates",
      "  api_trigger_daily:",
      "    - <<: *common",
      "      name: 每日档（API 触发）",
      "      lock: *lock_daily",
      "      stages: *daily_gates",
      "",
    ].join("\n");

    /* 活体证据：解析器在这一份上收得出那 4 条流水线、锁锚点收得出 2 把。
     * 名单逐条列出来（只数条数的话，「漏了一条又把另一条错认成事件键」这类坏
     * 解析仍然看不出来）。 */
    expect(
      pipelineLockAssignments(fixture).map(
        (r) => `${r.event}|${r.name}|${r.lockRef ?? "(继承)"}|${r.stagesRef}`,
      ),
    ).toEqual([
      "pull_request|质量门禁|(继承)|*gates",
      "push|master 合并复核|lock_push|*push_stages",
      "web_trigger_daily|每日档（手动触发）|lock_daily|*daily_gates",
      "api_trigger_daily|每日档（API 触发）|lock_daily|*daily_gates",
    ]);
    expect([...lockAnchorDefinitions(fixture).keys()]).toEqual([
      "lock_push",
      "lock_daily",
    ]);
    expect(lockClassViolations(fixture)).toEqual([]);

    /* ⑦ 探针那三条**不吃锚点**、各自带 `runner`，而 `lock:` 只在**当前这一项之内**
     * 算数：解析器必须在它自己的 `name:` 上收口。少了这一句，上一条流水线的 `lock:`
     * 会被带进下一条 —— 探针 A/B/C 会各自继承**上一条**的锁归属，于是「B/C 故意
     * 一条锁都不写」这条例外根本没有对象，而探针 A 的 `false` 也测不到它自己要测的
     * 那把锁（`.cnb.yml` 那段注释早就点了这个坏形态，判据这一侧据此补上）。
     * 顺带钉住例外的**边界**：豁免只覆盖「漏写」与「一条都不写」，别的规则一条都不放过。 */
    const probeFixture = (o: {
      cancel?: string | null;
      probeB?: string;
      extra?: string;
    }) =>
      [
        ".common: &common",
        "  lock:",
        "    key: pr-$CNB_PULL_REQUEST_IID",
        "    cancel-in-progress: true",
        ".lock-push: &lock_push",
        "  key: push",
        "  cancel-in-progress: false",
        ".lock-probe-a: &lock_probe_a",
        "  key: probe-2363-a",
        ...(o.cancel === null ? [] : [`  cancel-in-progress: ${o.cancel ?? "false"}`]),
        ...(o.extra === undefined ? [] : o.extra.split("\n")),
        "master:",
        "  pull_request:",
        "    - <<: *common",
        "      name: 质量门禁",
        "      stages: *gates",
        "  push:",
        "    - <<: *common",
        "      name: master 合并复核",
        "      lock: *lock_push",
        "      stages: *push_stages",
        "  api_trigger_probe_a:",
        "    - name: 探针A",
        "      lock: *lock_probe_a",
        "      stages:",
        "        - name: 探针A-填满时间窗",
        "          script: echo a",
        "  api_trigger_probe_b:",
        "    - name: 探针B",
        ...(o.probeB === undefined ? [] : [o.probeB]),
        "      stages:",
        "        - name: 探针B-填满时间窗",
        "          script: echo b",
        "",
      ].join("\n");
    /* A 拿到的是**它自己**那把锁（不是上一条的 `lock_push`），B 落到「一条都不写」。 */
    expect(
      pipelineLockAssignments(probeFixture({})).map(
        (r) => `${r.event}|${r.lockRef ?? "(没写)"}`,
      ),
    ).toContain("api_trigger_probe_a|lock_probe_a");
    expect(
      pipelineLockAssignments(probeFixture({})).map(
        (r) => `${r.event}|${r.lockRef ?? "(没写)"}`,
      ),
    ).toContain("api_trigger_probe_b|(没写)");
    expect(lockClassViolations(probeFixture({}))).toEqual([]);
    expect(
      lockClassViolations(probeFixture({ cancel: null })),
      "A 漏写 `cancel-in-progress` 也该放过 —— 它就是被测的那把锁",
    ).toEqual([]);
    /* B 自己拿一把锁（还是**一把没写 `cancel-in-progress` 的**）就没在当对照组了：
     * 豁免只覆盖「一条都不写」，这一形照旧被 R2 点名。 */
    expect(
      lockClassViolations(
        probeFixture({
          extra: ".lock-probe-b: &lock_probe_b\n  key: probe-2363-b",
          probeB: "      lock: *lock_probe_b",
        }),
      ).join("\n"),
      "B 自己拿一把锁就没在当对照组了，而豁免的只是「一条都不写」",
    ).toContain("没有显式写 cancel-in-progress");
    expect(
      lockClassViolations(probeFixture({}).replace("  key: probe-2363-a", "  key: probe-$CNB_BRANCH")).join(
        "\n",
      ),
      "例外不覆盖 key 形态：带变量照旧点名",
    ).toContain("带变量");

    // ① R1：有人**忘了写覆盖** ⇒ 那条流水线静默回落到 `pr-`，正是被修掉的那个形态。
    const forgotten = fixture.replace("      lock: *lock_push\n", "");
    expect(lockClassViolations(forgotten).join("\n")).toContain(
      "没有显式的 lock 覆盖",
    );

    // ② R3：两个**不同的工作清单**被并进一把锁 ⇒ 单跑会掐掉每日（本条要拦的形状）。
    const merged = fixture.replace(
      ".lock-daily: &lock_daily\n  key: daily\n",
      ".lock-daily: &lock_daily\n  key: push\n",
    );
    expect(lockClassViolations(merged).join("\n")).toContain(
      "份不同的 stage 清单共用",
    );

    // ③ R2：类锁**漏写** `cancel-in-progress` ⇒ 重复排队收不成一条，而不报错。
    const noCancel = fixture.replace(
      ".lock-daily: &lock_daily\n  key: daily\n  cancel-in-progress: true\n",
      ".lock-daily: &lock_daily\n  key: daily\n",
    );
    expect(lockClassViolations(noCancel).join("\n")).toContain(
      "没有显式写 cancel-in-progress",
    );

    // ③′ R6：`push` 那把写回 `true` ⇒ 前一笔 push 的复核读数被销毁（ISSUE #2396 的形态）。
    const pushCancels = fixture.replace(
      "  key: push\n  cancel-in-progress: false",
      "  key: push\n  cancel-in-progress: true",
    );
    expect(lockClassViolations(pushCancels).join("\n")).toContain(
      "cancel-in-progress 不是 false",
    );

    // ④ R2 的后半：key 里放进变量 ⇒ 换个事件它就无值，退化这件事又回来了。
    const templated = fixture.replace(
      "  key: daily\n  cancel-in-progress: true",
      "  key: daily-$CNB_BRANCH\n  cancel-in-progress: true",
    );
    expect(lockClassViolations(templated).join("\n")).toContain("带变量");

    // ⑤ R4 / R5：R4 —— 类锁写成那个退化形状本身；R5 —— PR 那把不再随编号变。
    const degenerate = fixture.replace(
      "  key: push\n  cancel-in-progress: false",
      "  key: pr-\n  cancel-in-progress: false",
    );
    expect(lockClassViolations(degenerate).join("\n")).toContain(
      "与非 PR 退化 / PR 那把逐字相同",
    );
    const prCollapses = fixture.replace(
      "    key: pr-$CNB_PULL_REQUEST_IID\n",
      "    key: pr-$CNB_DEFAULT_BRANCH\n",
    );
    expect(lockClassViolations(prCollapses).join("\n")).toContain(
      "与 PR 编号无关",
    );

    /* ⑥ 解析器不许假装通过。两种「没有对象」是两件不同的事，都必须出声：
     *    · 没有 `.common.lock.key` ⇒ 全档回落到平台默认 key（#1981 那个 bug 的形状）；
     *    · 有 `.common` 但 `master:` 下一条流水线都收不出来 ⇒ 判据在空转。 */
    expect(lockClassViolations("master:\n").join("\n")).toContain(
      "没有 `lock.key`",
    );
    expect(
      lockClassViolations(
        [
          ".common: &common",
          "  lock:",
          "    key: pr-$CNB_PULL_REQUEST_IID",
          "    cancel-in-progress: true",
          "master:",
          "",
        ].join("\n"),
      ).join("\n"),
    ).toContain("解析不出");
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
     *      把它判红等于让停用这件事连带把整条流水线拦死。
     *
     * ⚠️ 2026-10-22 订正①：它**恢复成独立的活 stage**。理由与「文档面那三条」同款 ——
     * 2026-10-20 那一笔把它的原文注释掉了（理由是「收进聚合档」），而聚合档读的是
     * **钩子注册表**、它 2026-10-16 就已从钩子里撤走 ⇒ 那一格从来没跑它 ⇒
     * 「平台侧的覆盖率读数」从那天起没人写了，而两张登记表互核却全绿。
     * 现在它自己占一格（它是**报告型**，没有 `ifModify`：它读的不是「本次改动」，
     * 收窄它等于「只在某类改动上才记覆盖率」）。 */
    const stageName = "覆盖率上报";
    const block = stageBlock(readRegisteredConfig(), stageName);
    expect(
      block,
      `配置里没有「${stageName}」这一格（不是注释形态就是被删了）—— 平台侧的覆盖率读数又没人写了` +
        "（「洞察 → 单元测试覆盖率」会退回「无 / 无」）",
    ).toBeTruthy();
    const entry = "scripts/ci-coverage-report.mjs";
    expect(block, `\`${stageName}\` 没有点名 ${entry}`).toContain(entry);
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
      '`.cnb.yml` 里的 `"crontab: …"` 事件键应恰好两条：每日那 12 格 + 桌包那一档' +
        "（ISSUE #2503 要求它**独立成档**，既不进 `.daily-gates` 那张表，也不与每日档共用一把锁）。" +
        "少一条 = 生产构建又只剩 PR 那一条，或桌包档被并进了每日档；多一条 = 有第二条没人认领的定时任务",
    ).toBe(2);
    expect(
      new Set(events.map((e) => e.cron)).size,
      `两条定时任务的 cron 逐字相同（${events.map((e) => e.cron).join(" / ")}）—— 那一跑会同时起两条，` +
        "而桌包那一档要的是「与每日那一跑**错开**」（它会把这台机压到满载）",
    ).toBe(events.length);
    for (const event of events) {
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

  it("桌包那一档独立成档：自己的清单 + 自己的锁 + 两个触发口同一份（ISSUE #2503）", () => {
    /* 业主口径是「不与现有那 12 格混在 `.daily-gates` 那张表里」。这句话在配置里落成
     * 三件各自会静默失效的事实：
     *   ① 清单是**另一张锚点** —— 并进 `.daily-gates` 之后每日那一跑会多背一次 cargo 编译；
     *   ② 锁是**另一把** —— 共用 `*lock_daily` 会让「手点一次桌包」把当日那一跑的某一格
     *      掐停（#2114 记的那条死因换了个方向复发）；
     *   ③ 定时与手点两个触发口引用**同一个锚点** —— 抄第二份的那一刻就开始漂。 */
    const text = readRegisteredConfig();
    const stages = pipelineStageNames(text, "桌面成品包");
    expect(
      stages.length,
      "「桌面成品包」那条流水线解析不出 stage —— 锚点没接上，或者流水线名被改了",
    ).toBeGreaterThan(0);
    for (const name of stages) {
      expect(
        DAILY_GATES.includes(name),
        `桌包那一档的「${name}」同时出现在 \`COMFYAPP_CI_DAILY_GATES\` 里 —— 那就不叫独立一档了`,
      ).toBe(false);
    }
    const publish = stageBlock(text, "打包·发布到常驻目录");
    expect(publish, "`.cnb.yml` 里找不到「打包·发布到常驻目录」那一格").toBeTruthy();
    const entry = "scripts/publish-desktop-bundle.mjs";
    expect(publish, `发布那一格点的应是 ${entry}，不是第二份打包脚本`).toContain(entry);
    expect(existsSync(path.join(ROOT, entry)), `${entry} 不在盘上`).toBe(true);
    expect(
      stageBlock(text, "打包·桌面成品构建"),
      "打包那一格必须点既有的执行者 `pnpm tauri build`（本单只补发布那一格，不抄第二份打桌包脚本）",
    )?.toContain("pnpm tauri build");

    /* 工具预置那一格（ISSUE #2525）：它在不在、点的是谁、以及**排在真打包之前**。
     * 顺序是判据的一部分 —— 预置跑在 `pnpm tauri build` 之后等于没有：那一格的
     * `timeout: global` 已经先把 nsis 判红了，而这一格退的是「没有结论」。 */
    const prefetch = stageBlock(text, "打包·桌包工具预置");
    expect(prefetch, "`.cnb.yml` 里找不到「打包·桌包工具预置」那一格").toBeTruthy();
    const prefetchEntry = "scripts/tauri-tools-cache.mjs";
    expect(prefetch, `预置那一格点的应是 ${prefetchEntry}`).toContain(prefetchEntry);
    expect(existsSync(path.join(ROOT, prefetchEntry)), `${prefetchEntry} 不在盘上`).toBe(
      true,
    );
    const packageStages = pipelineStageNames(text, "桌面成品包");
    expect(
      packageStages.indexOf("打包·桌包工具预置"),
      "「打包·桌包工具预置」没在清单里 —— 那一格丢了就等于回到「构建期现下 GitHub release」",
    ).toBeGreaterThanOrEqual(0);
    expect(
      packageStages.indexOf("打包·桌包工具预置") <
        packageStages.indexOf("打包·桌面成品构建"),
      "工具预置排到了真打包之后 —— 那一刻 bundler 已经自己去撞那条下载预算了",
    ).toBe(true);

    const rows = pipelineLockAssignments(text).filter(
      (r) => r.stagesRef === "*package_gates",
    );
    expect(
      rows.map((r) => r.event).sort(),
      "桌包档应有两个触发口：`crontab` 与 `web_trigger_package`（按钮在 `.cnb/web_trigger.yml`）",
    ).toEqual(["crontab: 0 2 * * *", "web_trigger_package"]);
    expect(
      new Set(rows.map((r) => r.lockRef)).size,
      "两个触发口点的不是同一把锁 —— 同一件事会被排成两次互掐",
    ).toBe(1);
    expect(
      rows.every((r) => r.lockRef === "lock_package"),
      "桌包档的锁不是自己那把 `lock_package` —— 与每日档共用一把会互相掐停",
    ).toBe(true);
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

  it("主体=master 的档：它的执行者必须在每日清单里（判据主体分权，ISSUE #2300）", () => {
    /* `FRESHNESS_TRACKS[*].subject` 答的是「**这一次是谁在判**」：`"pr"` = 本 PR
     * （工作树那份账；PR 流水线与本地钩子都是它），`"master"` = 主干（每日档在
     * master HEAD 上跑出来的那一份；机器分支 `ci/freshness-ledger` 上是它的权威副本）。
     *
     * ⚠️ **主体=master ⇒ 那一档的账是主干的账** ⇒ 它的执行者必须落在**每日档**上：
     * 主干的账由每天 00:00 那一跑刷新，PR 流水线里没有、也不该有它的执行者。
     * 少了后半句，「那一档就没人判了」这件事无人回答，而失效形态是「PR 拿主干的账
     * 判红别人的提交」—— 那正是主体分权要治的那件事。
     *
     * ⚠️ 这里**不**断言「它不许出现在 PR 清单里」：`ciStage` 记的是**每日格名**
     * （`每日生产构建` 之类），它本来就从不在 PR 清单里 ⇒ 那条断言恒真 = 判据空转
     * （本仓最忌讳的形态）。PR 侧那个格名（`新鲜度账`）不许留在 PR 清单里这件事，
     * 由本文件 `PR_MOVED_TO_DAILY` 那条与 `tests/doc-check-hook-wiring.test.ts`
     * 的「每日侧有『每日新鲜度账』这一步」那条判。 */
    const text = readRegisteredConfig();
    const dailyOrder = registeredDailyGateOrder(text);
    expect(
      dailyOrder.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 这条判据就没有对象了",
    ).toBeGreaterThan(0);
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      const subject = String(track.subject ?? "").trim();
      expect(
        ["pr", "master"],
        `${kind}.subject 写成了「${subject}」—— 只认 pr / master（主体答的是「这一次是谁在判」）`,
      ).toContain(subject);
      const stage = String(track.ciStage ?? "").trim();
      expect(
        stage,
        `\`${kind}\` 没有登记平台侧执行者（ciStage）—— 那一档现在没有任何执行者`,
      ).toBeTruthy();
      if (subject !== "master") continue;
      expect(
        dailyOrder,
        `「${stage}」（${kind}，主体=master）不在 \`COMFYAPP_CI_DAILY_GATES\` 里 —— ` +
          "主干的账只能由每日档那一格刷新与判读；它不在那儿，这一档就没人判了",
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

  /**
   * 「每日档红 ⇒ 自动立案」这一格不能只在清单上有个名字（ISSUE #2274）。
   *
   * 上面那条判据管的是「从 PR 撤下来的格还在不在」，这条管的是**新加的那一格点的还是不是
   * 同一个入口**：名字还在、块被换成别的命令，两边都绿，而自动立案其实谁都不做了 ——
   * 那正是这一族（判据在场、执行者不在场）唯一的失效形态。
   * 位置也在这一条里钉：它必须排在所有可能红的格**之前**，因为写在后面就会被前面那次红
   * 一起 `skipped`（平台没有可依赖的条件语法，本文件里今天只有 `ifModify`）。
   */
  it("每日链里必须有一格点的是 `ci-daily-failure-issue.mjs --no-block`，且排在最前", () => {
    const text = readRegisteredConfig();
    const lines = executableScriptLines(text, "每日失败立案");
    expect(
      lines,
      "配置文件里没有「每日失败立案」这一格 ⇒ 自动立案没有执行者了",
    ).toBeTruthy();
    expect(lines.join(" ")).toContain("scripts/ci-daily-failure-issue.mjs");
    expect(lines.join(" ")).toContain("--no-block");
    expect(
      DAILY_GATES[0],
      "`每日失败立案` 必须排在每日清单最前 —— 写在任何红格之后都会被那次红一起 skipped",
    ).toBe("每日失败立案");
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

describe("单跑口：三档重档各自一条，前提格的正文必须与每日那格逐字相同", () => {
  /**
   * 某一格的**正文**（剥掉列表项自己那行 `name:`，再剥掉注释与空行，比的是
   * `script` / `env` / `timeout`）。
   *
   * 两处刻意：① **名字不参与比较** —— 单跑那格本来就要另起一个不重名的名字
   * （见下面那条判据），比名字等于比错的东西；② **注释不算漂移** ——
   * `stageBlock()` 会把下一格前面的说明注释一起收进来（那是 2 空格的正常正文宽度），
   * 而每日那几格带着大量取证注释、单跑那几格不该重抄一遍。要比的是命令、env、预算。
   */
  function stageBody(text: string, name: string): string | null {
    const block = stageBlock(text, name);
    if (block === null) return null;
    return block
      .split("\n")
      .slice(1)
      .filter((line) => {
        const body = line.trim();
        return body !== "" && !body.startsWith("#");
      })
      .join("\n")
      .trimEnd();
  }

  /**
   * 锚点列表里（恰好两空格缩进的 `- name:`）出现**两次以上**的格名。
   *
   * 只扫这一层是有范围的：`.daily-gates` / `.oneshot-*` / `.gates` 的 stage 项都在这一层，
   * 而 `jobs:` 下的 Job 与所属 stage **同名是刻意的**（容器那格的形态），更深缩进的写法
   * 因此不算违规。要防的是「两条流水线里有两个同名 stage」——那会让按名字取块的解析器
   * 读到哪一个变成运气（`.cnb.yml` 里 `每日安装依赖` 那段注释记着同一件事）。
   */
  function duplicatedStageNames(text: string): string[] {
    const seen = new Map<string, number>();
    for (const m of text.matchAll(/^ {2}- name: (\S.*?)[ \t]*$/gm)) {
      const name = m[1] ?? "";
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([k]) => k ?? "");
  }

  it("每档的 web 与 api 两条清单相同，且等于注册表的「最小前提 + 目标」", () => {
    const text = readRegisteredConfig();
    const daily = registeredDailyGateOrder(text);
    for (const target of ONESHOT_TARGETS) {
      const expected = oneshotGates(target);
      for (const pair of oneshotPairs(target)) {
        expect(
          daily,
          `注册表里的「${pair.daily}」不在每日档的清单里 —— 单跑口引用的是一个每日根本不跑的格`,
        ).toContain(pair.daily);
      }
      for (const [ev, pipeline] of [
        [target.eventWeb, target.pipelineWeb],
        [target.eventApi, target.pipelineApi],
      ] as const) {
        const got = pipelineStageNames(text, pipeline);
        expect(
          got,
          `${ev} 那一条跑的清单与注册表不一致：期望 ${expected.join(" → ")}，实际 ${got.join(" → ")}`,
        ).toEqual(expected);
      }
    }
  });

  it("每个单跑格的正文与它对应的每日格逐字相同（副本不许漂）", () => {
    const text = readRegisteredConfig();
    for (const target of ONESHOT_TARGETS) {
      for (const pair of oneshotPairs(target)) {
        const oneshotBody = stageBody(text, pair.oneshot);
        const dailyBody = stageBody(text, pair.daily);
        expect(
          oneshotBody,
          `${pair.oneshot} 在配置里找不到那一项`,
        ).not.toBeNull();
        expect(dailyBody, `${pair.daily} 在配置里找不到那一项`).not.toBeNull();
        expect(
          oneshotBody,
          `${pair.oneshot} 的正文与 ${pair.daily} 不再逐字相同 —— 这就是「同一份脚本长在两条流水线上各漂一份」（ISSUE #2081 那一族）`,
        ).toBe(dailyBody);
      }
    }
  });

  it("单跑的格名不许与每日格或彼此重名", () => {
    const text = readRegisteredConfig();
    expect(
      duplicatedStageNames(text),
      "锚点清单里出现了同名 stage：按名字取块的解析器会读错那一条流水线",
    ).toEqual([]);
  });

  it("顶层 `master:` 只许有一份：多开一份会让定时那一跑静默消失", () => {
    const text = readRegisteredConfig();
    const keys = topLevelKeys(text);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(
      dup,
      `顶层键重复（YAML 静默取后一份，前一份里的事件就此没有执行者）：${dup.join(" / ")}`,
    ).toEqual([]);
    /* 量具自己先自证：同一份文本里写两次就会被数出来，而注释里的 `master:` 不算。 */
    expect(topLevelKeys("a:\n  x: 1\na:\n  y: 2\n")).toEqual(["a", "a"]);
    expect(topLevelKeys("# c:\nx:\n  y: 1\n")).toEqual(["x"]);
  });

  it("反向自检：四种坏形状都要被各自的判据点名，而现役形状一条都不许被抓", () => {
    const text = readRegisteredConfig();
    const e2e = ONESHOT_TARGETS.find((t) => t.gate.daily === "每日全量E2E");
    if (!e2e)
      throw new Error("注册表里没有「每日全量E2E」那一行，这条自检没有基准");
    const pipeline = e2e.pipelineWeb;
    const live = pipelineStageNames(text, pipeline);

    /* ① 漏一格：整项删掉（改名不算删 —— 改名之后清单还是四格，那条判据要抓的是
     * 「这一档根本没跑」，所以变异必须真的少一格）。 */
    const browserAt = text.indexOf("  - name: 单跑E2E·浏览器安装");
    const e2eAt = text.indexOf("  - name: 单跑E2E·全量E2E", browserAt);
    if (browserAt < 0 || e2eAt < 0)
      throw new Error("单跑E2E 那张锚点表里找不到浏览器/目标那两格");
    const dropped = text.slice(0, browserAt) + text.slice(e2eAt);
    const droppedList = pipelineStageNames(dropped, pipeline);
    expect(droppedList, "① 漏一格必须让清单变短").not.toEqual(live);
    expect(droppedList).toHaveLength(live.length - 1);

    /* ② 顺序颠倒：把浏览器那一格挪到表首（条数不变 ⇒ 只有顺序判据抓得住）。 */
    const headAt = text.indexOf(".oneshot-e2e: &oneshot_e2e");
    const headEnd = text.indexOf("  - name:", headAt);
    const moved =
      text.slice(0, headEnd) +
      text.slice(browserAt, e2eAt) +
      text.slice(headEnd, browserAt) +
      text.slice(e2eAt);
    const movedList = pipelineStageNames(moved, pipeline);
    expect(movedList, "② 顺序颠倒必须被点名").not.toEqual(live);
    expect(movedList).toHaveLength(live.length);

    /* ③ 正文漂移：改一处 script，由「逐字相同」那条抓。 */
    const driftedBody = text.replace(
      "node scripts/ci-cp936-exit.mjs -- node scripts/db-push.mjs\n  - name: 单跑E2E·浏览器安装",
      "node scripts/db-push.mjs --force\n  - name: 单跑E2E·浏览器安装",
    );
    expect(stageBody(driftedBody, "单跑E2E·同步数据库表结构")).not.toEqual(
      stageBody(driftedBody, "每日同步数据库表结构"),
    );
    expect(
      stageBody(driftedBody, "单跑E2E·同步数据库表结构"),
      "③ 正文漂移必须改得到那一项",
    ).not.toBe(stageBody(text, "单跑E2E·同步数据库表结构"));

    /* ④ 名字撞车：把单跑那格改成每日的名字，由「不许重名」那条抓。 */
    const collided = text.replace(
      "  - name: 单跑E2E·安装依赖",
      "  - name: 每日安装依赖",
    );
    expect(duplicatedStageNames(collided), "④ 重名必须被点名").toContain(
      "每日安装依赖",
    );

    /* 现役形状：四条判据一条都不许抓到东西（否则上面的「会变」是自证的假象）。 */
    expect(live).toEqual(oneshotGates(e2e));
    expect(duplicatedStageNames(text)).toEqual([]);
    for (const pair of oneshotPairs(e2e)) {
      expect(stageBody(text, pair.oneshot)).toBe(stageBody(text, pair.daily));
    }

    /* ⑤ 决定必须在规范正文里有原文（只长在配置里的决定等于没有决定）。 */
    expect(
      missingAnchors("docs/standards/13-提交与-code-review.md", [
        "单跑那一跑不是每日档的出勤",
      ]),
    ).toEqual([]);
  });
});
