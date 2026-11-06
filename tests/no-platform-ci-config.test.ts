/**
 * 平台侧自动触发的流水线配置：要么没有，要么必须是「自托管 + 已登记」的那一份（决策反转见 ISSUE #623 → #1229 → #1959，判据职责不变；本文件在每次提交都跑的固定清单里）。
 * 守三类形态：#1229 的 `分支: { 事件: [流水线] }`；`runner.namespace: group` + 非空 `tags`（漏掉 = 静默回落到计费平台池）；`pull_request` 与 `push` 两事件。
 * 反向注销：`scripts/doc-facts.cjs` 必须登记 `.cnb.yml`、规范留「为什么能回来」锚点；旧口径「本仓没有 CI」必须已改写（与 #1229 同形、方向相反）。
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
import { ONESHOT_TARGETS, oneshotGates, oneshotPairs } from "../scripts/ci-oneshot-gates.mjs";
/* 预算这一格的判据要拿**脚本自己那份预算**当基准，而不是在测试里再抄一个常数：
 * 抄一份的话「改了脚本预算、忘了改配置」两种漂移里只会看见一种。 */
import { FULL_SUITE_TIMEOUT_MS } from "../scripts/full-suite-run.mjs";
import { DAILY_LANE_PIPELINES } from "../scripts/check-daily-attendance.mjs";
import { FRESHNESS_TRACKS } from "../scripts/freshness-ledger.mjs";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 自动触发型 CI 配置的仓库相对路径（确切名字，文件形态）。
 * 只收「平台一读就无条件跑」的形态：`.cnb.yml` 与 `.github/workflows` 是当前形态（#2978 双远端镜像），其余只是「换个平台」的等价形态。
 * 判据拦的是这件事，不是某个文件名；多出来的任何一项仍是违规。
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
 * 本仓当前**登记在册**的 CI 配置（其余任何 CI 形态都不许出现）。
 * 具名常量而非 `[0]`：`noUncheckedIndexedAccess` 下每次下标访问都是「可能 undefined」，会把意图摊成满文件可选链。
 * `.github/workflows`（#2978）是旁路验证档：cnb 仍是合并守卫，GH 读数只对账不拦；与 `.cnb.yml` 并行，退役两处同批收。
 */
const REGISTERED_CI_CONFIG = ".cnb.yml";
const REGISTERED_CI_CONFIGS: ReadonlyArray<string> = [REGISTERED_CI_CONFIG, ".github/workflows"];

const CI_NAMES = new Set([...CI_CONFIG_FILES, ...CI_CONFIG_PATHS]);

/** 从一组仓库相对路径里挑出「是 CI 配置」的那些（匹配逻辑，可复算）。 */
export function ciConfigsAmong(entries: Array<string>): Array<string> {
  return entries.filter((rel) => CI_NAMES.has(rel));
}

/** 仓库根的一层目录项 + 已知 CI 目录位（判据的真实扫描面）。 */
function repoTopLevel(): Array<string> {
  const top = readdirSync(ROOT, { withFileTypes: true }).map((e) => e.name);
  const nested = CI_CONFIG_PATHS.filter((rel) => existsSync(path.join(ROOT, ...rel.split("/"))));
  return [...top, ...nested];
}

/**
 * 平台侧配置的**形态契约** —— 每一条写错了都不报错、只是静默不干该干的事，所以必须由判据守。
 * 以文本核对（不引 YAML 解析器：本文件每次提交都跑，加依赖不划算；匹配面窄到不误伤注释措辞）。
 */
/**
 * 探针流水线（ISSUE #2363）的**有期限例外** —— 与 `CONFIG_SHAPE` 的「每条流水线引用 `*common`」判据配对，理由见用它的用例。
 * 名单不许泛化成「自带 runner 的都放行」（等于关掉判据），日期不许省（省了「临时」就只剩一句话）。
 */
/* SAFETY: 类型断言已复核 */
const PROBE_PIPELINES = [
  "api_trigger_probe_a",
  "api_trigger_probe_b",
  "api_trigger_probe_c",
] as const;

/** 探针的到期日：过了这一刻，本文件的用例当场要求把那三条与这段例外一起删掉。 */
const PROBE_BY = "2026-11-09T00:00:00Z";

/**
 * 探针里**被测的锁形态**逐条点名放过哪条规则（与 `PROBE_PIPELINES` 同一天到期）。
 * `api_trigger_probe_a` → `cancelFalse`（要的正是 `cancel-in-progress: false`，而 R2 默认把漏写判红）。
 * `api_trigger_probe_b` / `c` → `noLock`（对照组一条锁都不写才量得到「没有锁时会不会并行」）；这不是放宽 R1/R2，其余规则仍会问。
 */
const PROBE_LOCK_EXEMPT: Array<{
  /** 这一条的锁**故意**不写 `cancel-in-progress`，锚点名写在这里（其余一条都不许借）。 */
  cancelFalse?: string;
  event: string;
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
  if (start === -1) {
    return "";
  }
  const out: Array<string> = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) {
      break;
    }
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
    mustMatch: /定时档的执行者已从这台机迁到 GitHub Actions/,
    why:
      "定时重档已迁 GitHub Actions：这条锚点句在配置里，说明「这里没有 crontab」是**被说明过的决策**，" +
      "不是谁顺手删了两行。定时是否真的不存在、GA 侧两条 schedule 是否真的在，" +
      "由「定时档不在本机、在 GA」那条反向用例逐项钉住 —— 不在这里用一条正则两头顾",
  },
];

/**
 * **stage script 的 PowerShell 语法必须兼容宿主 5.1**：`.cnb.yml` 在自托管 Windows 节点上默认由 Windows PowerShell 5.1 执行（与 `scripts/entry-common.ps1` 的 `#Requires` 同口径）。
 * PS 7 独有写法在 5.1 是**解析期错误**：整段脚本一行都不执行就非零退出，报错停在语法上；#1959 首跑 `?.` 让 `工具链自证` 0.9s 就红，形态与「宿主缺工具链」逐字同形。
 * 判据按码位扫 script 代码行（先剥行内注释），只认「7 有、5.1 没有」的形状，每条都是解析期错误。
 */
const PS7_ONLY: Array<{ instead: string; pattern: RegExp; what: string }> = [
  {
    pattern: /\?\./,
    what: "`?.` null 条件运算符（PS 7+）",
    instead: "先 `$o = Get-Command X -ErrorAction SilentlyContinue` 再 `if ($o) { $o.Source }`",
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
 * 扫 `.cnb.yml` 的 stage script 块，回读「哪些行用了 PS 7 才有的语法」。
 * `script: |` 正文按**缩进**收口（回到同级或更浅即结束），只扫代码不碰别的键；行内注释先剥 —— 判据说明里正当地会写出这些形状。
 * @returns 每条违规的 `行号: 说明`
 */
export function ps7OnlySyntaxIn(text: string): Array<string> {
  const lines = text.split("\n");
  const found: Array<string> = [];
  /* 正文缩进：`script: |` 自己的列 + 默认 2（块标量必须比键更深）。
   * 键可能写成 `script: |` 也可能写成列表项 `- script: |`，两种都收。 */
  let bodyIndent: number | null = null;
  lines.forEach((raw, i) => {
    const scriptStart = /^(?<indent>\s*)(?:-\s+)?script:\s*\|\s*$/.exec(raw);
    if (scriptStart) {
      bodyIndent = (scriptStart.groups?.indent ?? "").length + 2;
      return;
    }
    if (bodyIndent === null) {
      return;
    }
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
 * `.cnb.yml` 的 `env` 中 **stage 名有序清单**（`COMFYAPP_CI_GATES`）。顺序是事实：`单元测试` 必须排在 `Python 可用性` 之后 —— 缺 Python 时那一步照旧往下跑，
 * 而 `单元测试` 实测跑满 2h24m 被 8640s 墙钟掐断（`cnb-jt3-1k5071kou`），只剩 `timeout … exceeded` ⇒ 后面的 stage 要么看不到、要么在最贵处才看到。
 * 解析 `>-` 折叠标量、按 `,` 切名。@param text 原文；@returns stage 名（已 trim），`[]` = 键不在（调用方判红）。
 */
/* 实现见 `scripts/ci-gate-names.mjs`（判据脚本与三处消费它的测试共用同一份解析，
 * 不各写一遍 —— §12.12 / §12.18）。 */
export function registeredGateOrder(text: string): Array<string> {
  return gateOrderImpl(text);
}

/**
 * `.cnb.yml` 的 `env` 中**临时停用** stage 清单（`COMFYAPP_CI_DISABLED_GATES`）：屏蔽 stage 的两半（`.gates` 注释掉条目、从 `GATES` 摘名）都不报错，
 * 于是「临时停用」与「永久删除」在配置里逐字同形、评审只能猜。名字在此 = 被停用；不在 `GATES` 也不在此 = 被删除（判据点名）。
 * 与 `registeredGateOrder` 同一份折叠标量解析；`[]` = 键不在或为空，调用方不能据此推断「没有停用的」。
 */
/* 实现见 `scripts/ci-gate-names.mjs`（同一份解析，三处消费共用）。 */
export function registeredDisabledGates(text: string): Array<string> {
  return disabledGatesImpl(text);
}

/**
 * 定时那一跑的清单（与 `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES` 同一份，顺序即执行序）。
 * 第一条 `每日失败立案` 立案的是**上一跑**，必须排在任何可能红的格之前（否则被 `skipped`，ISSUE #2274）；
 * 最后一条 `每日单元测试` 是刻意的（业主口径「最容易出问题的放最后」，它单独超时会把后三格一起 skip）；「必须最后」由下面判据钉住。
 */
const DAILY_GATES = [
  "每日失败立案",
  /* ISSUE #2551：这一格是**读数**（这一跑的 `CNB_TOKEN` 够得着哪些能力）。
   * 它排在立案格**之后** —— 那一格立案的是上一跑、必须排在任何可能红的格前面，
   * 而这一格自己没有理由让位。 */
  "每日令牌权限读数",
  "每日工具链自证",
  "每日安装依赖",
  /* ISSUE #3063（档位 ②）：GH workflows 的真解析，只挂每日档 —— 二进制钉在节点常驻根，
   * 取用零网络（`scripts/ci-actionlint.mjs`）。 */
  "每日 YAML 真解析",
  "每日 Python 可用性",
  "每日 Python 探针读数",
  "每日同步数据库表结构",
  "每日新鲜度账",
  "每日生产构建",
  "每日 ESLint 零警告",
  "每日浏览器安装",
  "每日全量E2E",
  /* 2026-11-05 从 push 撤到每日档（ISSUE #2537）：新面 98% 触发率、中位 40.9s、
   * 占 140.2s 串行流水线的 30.6%。位置同 CNB 每日档：E2E 之后、单元测试之前
   * （后者必须是最后一个会红的格）。 */
  "每日 API 文档生成与自检",
  "每日单元测试",
  "覆盖率上报",
];

/**
 * 2026-10-19 从 **PR 那一条撤到每日档**的几格：`[PR 旧名, 每日名, 每日块入口, 旗标]`。
 * 业主口径「只判断环境的不必每次都判断」（逐格 13.8s / 2.8s / 3.0s / 3.0s）；撤的是节奏不是账 —— 这四名只出现在每日清单，且每日格里必须真有一格、点同一入口与旗标。
 * ⚠️ 每日名是**写出来的**：真实名 `每日 Python 可用性`（含空格），用 `每日${旧名}` 拼会得到 `每日Python 可用性` 让判据恒红（第一版就这么错）。
 */
const PR_MOVED_TO_DAILY: Array<[string, string, string, string]> = [
  ["工具链自证", "每日工具链自证", "scripts/ci-toolchain-selfcheck.mjs", ""],
  ["Python 可用性", "每日 Python 可用性", "scripts/ci-toolchain-selfcheck.mjs", "--python-only"],
  ["Python 探针读数", "每日 Python 探针读数", "scripts/python-probe.mjs", ""],
  ["浏览器安装", "每日浏览器安装", "scripts/ci-toolchain-selfcheck.mjs", "--playwright-only"],
  /* `ESLint 零警告` 是**另一条理由**（起一堆子进程而非节点事实）：它挂满过 8640s 与 20m，红的地方不是这次改动违规而是这台机腾不出核。
   * 同一张表接住它，因为要判的东西逐字相同：PR 清单不许再有、每日清单必须有一格、点的是 `pnpm run lint`（口径见 `package.json` 的 `lint` 与 `oxlint.parity.config.mjs` 顶部）。 */
  ["ESLint 零警告", "每日 ESLint 零警告", "pnpm run lint", ""],
  /* `新鲜度账` 是**第三种理由**（ISSUE #2300 主体分权）：PR 上下文读的是**主干的账**（`FRESHNESS_TRACKS[*].subject` 三档都是 `master`，权威副本在 `ci/freshness-ledger`）。
   * 它判的是「机器 / 主干怎么被调度」，不是某次 PR 的缺陷；第四元组留空（不共用脚本、无分档参数），每日那格的差别在 env（`COMFY_CI_SUBJECT`），env 不在比较面里。 */
  ["新鲜度账", "每日新鲜度账", "scripts/freshness-gate.mjs", ""],
];

/**
 * 门格总账（#2640，2026-10-31）：每格「在哪个档跑」的权威登记。§13.5.30 的档位归属是工程判断，但「撤出后必须登记、登记名不许还在跑」可以判（否则「悄悄删掉」与「降级登记」逐字同形）。
 * 判据：① 三份清单（PR / push / 每日）各自 ⇄ 总账双向相等（清单多/少一格而总账没同批改 ⇒ 红）；② `retired` 的格不许再出现在任何清单里（降级≠删除）且必须带理由。
 * 三条门槛（确定性 / 快 / 本地可复现）仍只在规范 §13.5.30 由人判，本账不碰。
 */
type GateTier = "PR" | "push" | "daily" | "retired";
type LedgerEntry = {
  name: string;
  note?: string;
  tier: GateTier;
};
const GATE_TIER_LEDGER: Array<LedgerEntry> = [
  // ── PR 档（COMFYAPP_CI_GATES）──
  { name: "镜像身份", tier: "PR" },
  { name: "工作区复用读数", tier: "PR" },
  { name: "缓存槽读数", tier: "PR" },
  /* #3051 从 `endStages` 前移进主列（为的是起跑时机，不是判决），现已翻承重
   * （#3051 期望第 3 条落地）：`--readout` 已摘除，退码生效、推不出去/派发失败即拦合。
   * 总账里它就在 `缓存槽读数` 之后、`环境前提` 之前 ——
   * 与 `.gates` 的实际执行序同处（下面那条「双向相等」判据比的是名字集合，顺序由
   * `registeredGateOrder` 与 stage 序另一条判据钉）。 */
  { name: "GitHub 镜像同步", tier: "PR" },
  { name: "环境前提", tier: "PR" },
  /* 2026-11-05 薄化：GA `pr-gate.yml` 已承接的格从 PR 清单撤出，档位登记在 retired 段
   * （每一项的 note 写明「现在谁跑」）。这一档此后只剩平台读数与判决链。 */
  /* 主列末尾的承重档（已摘 `--readout`，ISSUE #3051 期望第 3 条已落地）：镜像格派发的
   * 同一笔 head_sha，GitHub Actions 跑完没有、结论是什么。有结论且红 ⇒ 拦合；没跑起来 ⇒
   * exit 2 同样拦合；只有读到绿才放行。无跨档对应物，不进 CROSS_LANE_SCRIPT_MIRRORS。 */
  { name: "GitHub 判决回读", tier: "PR" },
  /* 判红那一形的**全量日志通道**（2026-11-05 按实测重做）：回读格把失败 job 的脱敏正文压成
   * gzip+base64 分块，这三格各打一块（每块 ≤ 90000 base64 字节，单 stage 封顶 102400）；
   * 块数 / 整包 sha256 / 尺寸在 manifest 里，拼回来能逐字核对。这三格**不许红**（读不到就
   * 各念一行、退 0），所以它们不是「判据」而是读数 —— 但仍然必须登记，否则闸序对不上。 */
  { name: "日志分块 1/3", tier: "PR" },
  { name: "日志分块 2/3", tier: "PR" },
  { name: "日志分块 3/3", tier: "PR" },
  /* 承重的那一格挪到分块之后：读回读格留下的 decision.json 并退真码（读不到 ⇒ exit 2）。 */
  { name: "GitHub 判决判定", tier: "PR" },
  /* 这两条**没有自己的 stage**（登记在 `COMFYAPP_CI_GATES_ELSEWHERE`）：原本由 PR 档的
   * `重档静态判据` 那一格跑，2026-11-05 整格搬到 GA 的同名 job —— 名字仍在 PR 清单里，
   * 因为它们在 PR 上仍然被判，只是换了一台 runner。 */
  { name: "格式化提交分离", tier: "PR" },
  { name: "零消费导出", tier: "PR" },
  // ── push 档（COMFYAPP_CI_PUSH_GATES，树级校验档 + 镜像出口格）──
  { name: "合并形态复核", tier: "push" },
  { name: "GitHub master 镜像", tier: "push" },
  { name: "安装依赖", tier: "push" },
  { name: "生成态文档与源同步", tier: "push" },
  { name: "文档引用与权威源一致", tier: "push" },
  { name: "工作区出处", tier: "push" },
  // ── 每日档（COMFYAPP_CI_DAILY_GATES）──
  { name: "每日失败立案", tier: "daily" },
  { name: "每日令牌权限读数", tier: "daily" },
  { name: "每日工具链自证", tier: "daily" },
  { name: "每日安装依赖", tier: "daily" },
  { name: "每日 YAML 真解析", tier: "daily" },
  { name: "每日 Python 可用性", tier: "daily" },
  { name: "每日 Python 探针读数", tier: "daily" },
  { name: "每日同步数据库表结构", tier: "daily" },
  { name: "每日新鲜度账", tier: "daily" },
  { name: "每日生产构建", tier: "daily" },
  { name: "每日 ESLint 零警告", tier: "daily" },
  { name: "每日浏览器安装", tier: "daily" },
  { name: "每日全量E2E", tier: "daily" },
  { name: "每日 API 文档生成与自检", tier: "daily" },
  { name: "每日单元测试", tier: "daily" },
  { name: "覆盖率上报", tier: "daily" },
  // ── retired（降级登记，必须带理由；§13.5.30）──
  {
    name: "API 文档生成与自检",
    tier: "retired",
    note: "2026-11-05 从 push 撤到每日档「每日 API 文档生成与自检」（ISSUE #2537 / 事故 #2528）：新触发面 98% 触发率、CI 中位 40.9s、占 140.2s 串行流水线的 30.6%，PR 侧不再即时判；最晚次日 01:00 暴露，暴露窗口 ≤24h，失败走既有 daily 红 build / 每日失败立案通道",
  },
  {
    name: "受影响用例",
    tier: "retired",
    note: "2026-11-02 从 PR 撤到每日全量单测：增量测试在共享节点读数不可信（fork worker 调度超时、超订变子进程），与 §13.5.21 全量单测只留每日档同口径；每日单元测试全量套件已含这一族用例，最晚 24h 发现",
  },
  {
    name: "固定结构用例",
    tier: "retired",
    note: "同上，从 PR 撤到每日全量单测：FIXED_STRUCTURAL_TESTS 契约测试由每日单元测试全量套件覆盖；PR 上 45m 预算、冷节点易 25m+ 且偶发 AggregateError 假红，性价比低",
  },
  {
    name: "core 骨架单一事实源",
    tier: "retired",
    note: "执行者即固定结构用例的固定清单（scripts/fixed-structural-tests.mjs）；固定结构用例 2026-11-02 撤档后这一格随之退休，由每日单元测试全量套件覆盖",
  },
  {
    name: "core 出口纪律与基类纯度",
    tier: "retired",
    note: "执行者即固定结构用例的固定清单（scripts/fixed-structural-tests.mjs）；固定结构用例 2026-11-02 撤档后这一格随之退休，由每日单元测试全量套件覆盖",
  },
  {
    name: "工具链自证",
    tier: "retired",
    note: "2026-10-19 撤到每日档（每日工具链自证）：只判节点事实，不必每 PR 判（§13.5.23）",
  },
  {
    name: "Python 可用性",
    tier: "retired",
    note: "同上，撤到每日 Python 可用性",
  },
  {
    name: "Python 探针读数",
    tier: "retired",
    note: "同上，撤到每日 Python 探针读数",
  },
  {
    name: "浏览器安装",
    tier: "retired",
    note: "同上，撤到每日浏览器安装：PR 上已无一步用浏览器（§13.5.23）",
  },
  {
    name: "ESLint 零警告",
    tier: "retired",
    note: "起一堆子进程、并行 PR 下读数不可信，撤到每日 ESLint 零警告（§13.5.21）",
  },
  {
    name: "新鲜度账",
    tier: "retired",
    note: "主体=master，判的是主干调度，撤到每日新鲜度账（ISSUE #2300）",
  },
  {
    name: "生产构建",
    tier: "retired",
    note: "2026-10-18 撤到每日生产构建，PR 上一条都不剩（§13.5.23）",
  },
  {
    name: "单元测试",
    tier: "retired",
    note: "撤到每日单元测试：全量单测只在 01:00 跑（§13.5.23）",
  },
  {
    name: "E2E 关键流程",
    tier: "retired",
    note: "2026-10-19 撤成每日全量E2E：整档不带 --grep，@critical 是其子集",
  },
  // ── 2026-11-05 薄化：GA `.github/workflows/pr-gate.yml` 承接（同一个 PR 事件、
  //    同一个镜像仓；PR 档只留平台读数 + 判决链，结论由 `GitHub 判决判定` 承重读回）。
  //    逐项归属与「为什么不在这边跑」写在 `.cnb.yml` 的 `.gates` 顶部那段。──
  {
    name: "Install dependencies",
    tier: "retired",
    note: "GA 各 job 自己的 `安装依赖` step；PR 档此后没有吃 node_modules 的格",
  },
  {
    name: "分支守卫",
    tier: "retired",
    note: "GA `分支守卫` job（`check-branch-guard.cjs --pr-check`）",
  },
  { name: "提交声明核对", tier: "retired", note: "GA `提交声明核对` job" },
  {
    name: "同步数据库表结构",
    tier: "retired",
    note: "GA `同步数据库表结构` job（每日档另有 `每日同步数据库表结构`）",
  },
  { name: "类型检查", tier: "retired", note: "GA `类型检查` job（`tsc --noEmit`）" },
  { name: "标题行让位", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "文件结构硬规则", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "跨平台动作对照", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "import 别名统一", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "ComfyUI 端口口径", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "内联样式注入", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "跨文件重复块", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "函数长度 TS", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "函数长度 Rust", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "模块循环依赖", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "端口推导跨语言一致性", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "CHANGELOG 碎片", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "主题色扫描", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "UI/逻辑分离", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  { name: "lib Node-only 声明", tier: "retired", note: "GA `静态判据` job 的同名 step" },
  {
    name: "oxfmt 格式",
    tier: "retired",
    note: "GA `oxfmt 格式` step（`check-format.cjs --changed`，每次 PR 都跑、无 ifModify）",
  },
  { name: "重档静态判据", tier: "retired", note: "GA `重档静态判据` job（`ci-heavy-gates.mjs`）" },
];

/**
 * **同一份实现长在另一条流水线上**的那几格（另一档名 → PR 名），比逐字同形：名字不同是刻意的（按名取块会撞车），同一件事只能由 script 相同保证。
 * 左边不一定是每日档（这里现在是每日档，push 档 `安装依赖` 在右边）；判据管「一条链被几条流水线各抄一份」，不管抄到第几条都要对账。
 * ⚠️ 只留两边都在的：`Python 可用性` / `浏览器安装` 已于 2026-10-19 撤出 PR（见 `PR_MOVED_TO_DAILY`），拿不存在的块比相同性只会教会人忽略红。
 * 2026-11-05 薄化后 PR 档不再有安装格，`Install dependencies` 那一对面换成「每日 ⇄ push」；
 * `同步数据库表结构 ⇄ 每日同步数据库表结构` 随 PR 格撤出一起消失。
 */
const CROSS_LANE_SCRIPT_MIRRORS: Array<[string, string]> = [
  // 多行块也在内：这一格是 `script: |` 的三行体，只比第一行会漏掉「第二行改了」这种漂移。
  ["每日安装依赖", "安装依赖"],
  /* 这一对是「每日 ⇄ push」：push 清单里没有构建格（ISSUE #2851），所以两侧都置着
   * `COMFY_CI_SLOT` —— 而 `DAILY_ENV_ONLY_ON_PR` 里给 `每日安装依赖` 登记一行豁免
   * （那张表按**左边那个名字**取豁免键），只动一边会被这条判据报成一堆行的差。 */
];

/**
 * 两格 env 之间**唯一被登记过的差别**：`每日安装依赖` 不接槽（ISSUE #2081）；键按左边格子名取，所以「哪格可少这行」一表说清。push 档 `安装依赖` 不在表里（理由的主语是「后面有没有 `next build`」，#2851）。
 * ⚠️ 钉的是更窄的形状：名单键在**右侧那一格**里必须**正好置一行** `KEY: "1"`；每日侧**一个字都不出现**（写 `"0"` 也算违规）。
 * 2026-11-05 起右侧是 push 档（PR 档的安装格已撤到 GA），符号名沿用旧名以免牵动调用面，
 * 语义看这条注释与 `CROSS_LANE_SCRIPT_MIRRORS` 的配对。`toEqual` 未松，否则判不出
 * 「不相同的那一行正是被允许的那一行」。
 */
const DAILY_ENV_ONLY_ON_PR: Record<string, Array<string>> = {
  每日安装依赖: ["COMFY_CI_SLOT"],
};

/** 一行 env 赋值的键名；不是赋值形状（如脚本行 `$enc=…` / `node …`）回 `null`。 */
function envAssignmentKey(line: string): string | null {
  const m = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line.trim());
  return m?.groups?.key ?? null;
}

/** 判「PR-only 例外」的形状；回 `null` = 合法，回一句字符串 = 下一动作。 */
function checkPrOnlyEnvExceptions(
  dailyEnv: Array<string>,
  prEnv: Array<string>,
  onlyOnPr: Array<string>,
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
function dropPrOnlyEnvLines(env: Array<string>, onlyOnPr: Array<string>): Array<string> {
  return env.filter((l) => !onlyOnPr.includes(envAssignmentKey(l) ?? ""));
}

/** `45m` / `30m` / `3h` → 分钟。解析不出时回 0（调用方的断言会把它读成「没预算」）。 */
function stageBudgetMinutes(raw: string | undefined): number {
  const m = /^(?<amount>\d+)(?<unit>[smh])$/.exec(String(raw ?? "").trim());
  if (!m) {
    return 0;
  }
  const n = Number(m.groups?.amount ?? 0);
  const unit = m.groups?.unit;
  return unit === "h" ? n * 60 : unit === "s" ? n / 60 : n;
}

/**
 * 某一格里**真正会执行**的命令行（丢掉空行与 shell 注释）：不比整块 —— 散文解释本就该不同，要求逐字只会逼人删注释，而漂移只藏在命令行。
 * 返回数组而非拼好的字符串，红的时候差在哪一行一眼可见。
 */
function executableScriptLines(text: string, name: string): Array<string> {
  return stageScriptLine(text, name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * 「这一格会在作业里真构建」的命令形态。接槽把 `node_modules` 接成指向项目根外的 junction，Turbopack 有硬要求 ⇒ 每日档不接（#2081 的 13.8s 死法）；push 档接槽的依据就是「无构建格」（#2851），加格者须被当场拦住。
 * ⚠️ `tauri build`（#2883）：桌包档经 tauri CLI 间接触发（`pnpm tauri build`），`build-desktop.mjs` 只写在 `tauri.conf.json` 的 `beforeBuildCommand` 与 `.cnb.yml` 的**注释**里。
 * 注释不在 `executableScriptLines()` 输入面上，旧三枚标记判现役桌包档会假阴性「没有构建格」，一旦用于 #2853 期望 1 就直接摘掉这条安全前提。
 */
const BUILD_CONSUMER_MARKERS: Array<string> = [
  "ci-daily-build.mjs",
  "build-desktop.mjs",
  "next build",
  "tauri build",
];

/** 从「格名 → 该格真正执行的命令行」里挑出含构建消费者的那几格（名字原样回，红时指得出人）。 */
function stagesWithBuildConsumer(scripts: Map<string, Array<string>>): Array<string> {
  const out: Array<string> = [];
  for (const [name, lines] of scripts) {
    if (lines.some((line) => BUILD_CONSUMER_MARKERS.some((marker) => line.includes(marker)))) {
      out.push(name);
    }
  }
  return out;
}

/**
 * 取某格 `env:` 下的**赋值行**（丢注释与空行），给镜像判据当第二条腿：`浏览器安装` 的下载根与连接超时在 env 里，不在 script 里。
 * 只比 script 时改动一侧是逐字通过，而可见形态是「第二天 02:00 红」，离最后一次被读已隔一整晚。
 * 只收 `KEY: value`（`-` 列表项与更深结构不算）；`env:` 缺席回空数组 = 两格都不许有 env。
 */
function stageEnvAssignments(text: string, name: string): Array<string> {
  const block = stageBlock(text, name);
  if (block === null || block === "") {
    return [];
  }
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*env:\s*$/.test(l));
  if (at === -1) {
    return [];
  }
  const out: Array<string> = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(?:script|timeout|ifModify|name|retries|jobs|runs_on|image):/.test(line)) {
      break;
    }
    const t = line.trim();
    if (t === "" || t.startsWith("#") || t.startsWith("-")) {
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * 取某一格的 `script` 原文（去掉行首缩进与尾部空白）。
 * 多行块取整块 —— 只取第一行会让「第一行相同、第二行不同」这种最坏漂移读成相同。
 */
function stageScriptLine(text: string, name: string): string {
  const block = stageBlock(text, name);
  if (block === null || block === "") {
    return "";
  }
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*script:/.test(l));
  if (at === -1) {
    return "";
  }
  const first = lines[at]?.replace(/^\s*script:[ \t]*/, "") ?? "";
  if (first && !/^[|>][-+]?\s*$/.test(first)) {
    return first.trim();
  }
  const body: Array<string> = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(?:timeout|env|ifModify|name|retries):/.test(line)) {
      break;
    }
    if (line.trim() === "") {
      continue;
    }
    body.push(line.replace(/^\s+/, "").trimEnd());
  }
  return body.join("\n");
}

/**
 * `.cnb.yml` 的**定时任务事件键**（`"crontab: 0 3 * * *"`）原文清单：它是**带引号的字符串键**且必须含完整五段 cron，写成 `crontab:` 映射 / `schedule:` / 段数不对时平台不报错、只是永不触发。
 * 同时带出**分支键**：定时任务不支持 glob、必须挂明确单一分支（父键 `master:` 才成立，挂 `**` / `$` 下是配置错误）。
 * @param text 原文 @returns 顶层分支键 + 事件键 + cron 表达式
 */
export function crontabEvents(
  text: string,
): Array<{ branch: string; cron: string; event: string }> {
  const out: Array<{ branch: string; cron: string; event: string }> = [];
  let branch = "";
  for (const line of text.split("\n")) {
    /* 顶层分支键：顶格、以 `:` 结尾（`master:` / `"dev/*":` / `$:`）。 */
    const top = /^(?<branchKey>[^\s#][^:]*):\s*$/.exec(line);
    const topKey = top?.groups?.branchKey;
    if (topKey !== undefined && !topKey.includes(":")) {
      branch = topKey.replaceAll(/^["']|["']$/g, "").trim();
      continue;
    }
    /* 事件键：两格缩进、带引号。**只有**引号形态能被平台当成 crontab 事件 ——
     * 裸的 `crontab:` 是映射键，不是事件名。 */
    const ev = /^ {2}"(?<event>crontab: [^"]*)":\s*$/.exec(line);
    const eventKey = ev?.groups?.event;
    if (eventKey === undefined) {
      continue;
    }
    out.push({
      branch,
      event: eventKey,
      cron: eventKey.slice("crontab:".length).trim(),
    });
  }
  return out;
}

/**
 * `.cnb.yml` 的 `env` 中**定时那一跑的 stage 名有序清单**（`COMFYAPP_CI_DAILY_GATES`）。
 * 与 `COMFYAPP_CI_GATES`（PR 上跑什么）分开登记，差别正是 ISSUE #2010 的答案（生产构建每天一次）；混成一份后，「今天这一跑该跑哪几格」读不出来，且两侧都会多跑。
 * 与 `registeredGateOrder()` 同一份折叠标量解析。@param text 原文 @returns stage 名（已 trim）；`[]` = 键不在（调用方判红）
 */
export function registeredDailyGateOrder(text: string): Array<string> {
  const m =
    /^[ \t]*COMFYAPP_CI_DAILY_GATES:[ \t]*>?-?[ \t]*\r?\n(?<body>(?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
      text,
    );
  const body = m?.groups?.body;
  if (body === undefined) {
    return [];
  }
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * push 档（`master 合并复核`）清单（`COMFYAPP_CI_PUSH_GATES`，顺序即执行序）：判的是**合并后的树**，既非单次改动（PR 档）也非 master 全量健康（每日档）。
 * 2026-11-02 多一格 `GitHub master 镜像`：本档唯一**出口动作**（把 master 推到 GitHub 镜像仓），不校验树，排在 `合并形态复核` 后、`安装依赖` 前。
 * 与每日清单同一份解析：声明 ⇄ `pipelineStageNames(text, "master 合并复核")` 双向核对，只读一份时另一份漂了没人红。
 */
export function registeredPushGateOrder(text: string): Array<string> {
  const m =
    /^[ \t]*COMFYAPP_CI_PUSH_GATES:[ \t]*>?-?[ \t]*\r?\n(?<body>(?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
      text,
    );
  const body = m?.groups?.body;
  if (body === undefined) {
    return [];
  }
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * 某个**流水线**块里 `stages:` 的直接子项名字（按出现顺序）：读的是「这一条真的跑哪几格」这个**事实**，与 `registeredGateOrder()` 的声明双向核对。
 * 只读声明时，删了 stage 却留着名字会全绿，而那一格其实没跑（清单完整、执行面为空）。
 * 只在给定流水线名之后找，且不接受注释行 —— 停用条目是 `#` 形态，扫全文会当成在跑。@returns `[]` = 没找到 / 没有 stages
 */
export function pipelineStageNames(text: string, pipelineName: string): Array<string> {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    /* 只认**流水线项**的 `name:`（`- <<: *anchor` 之后那一行），不认 stage 自己的
     * `- name:` —— 两边同名时（定时那条的流水线与它唯一那格就叫同一个名字）挑错了
     * 起点，解析会从「stage 的 name 行」往下走，结论变成「这条流水线一格都没有」。 */
    const m = /^\s+name:[ \t]*(?<name>\S.*?)[ \t]*$/.exec(lines[i] ?? "");
    if (m?.groups?.name === pipelineName && (lines[i - 1] ?? "").includes("<<")) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return [];
  }
  /* 流水线项的缩进 = 它 `name:` 那一行的缩进；`stages:` 的键在它**下一层**。 */
  const itemIndent = (lines[start] ?? "").length - (lines[start] ?? "").trimStart().length;
  const out: Array<string> = [];
  let stageIndent: number | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (stageIndent === null) {
      /* 还没见到 `stages:`：缩进**比流水线项更浅** ⇒ 这一条结束了。
       * 同级的 `- <<: *anchor` / `name:` 仍在同一条里，不能当成收尾（`push` 那条的
       * `- <<:` 就在这一层）。 */
      if (indent < itemIndent) {
        break;
      }
      /* `stages: *daily_gates` 这种**引用形态**：清单在锚点里，去那儿读。
       * 每日那七格现在是两个触发口共用一份（02:00 定时 + 页面上的手点按钮），写成两份
       * 的那一刻就是它俩开始各漂的那一刻。解析器必须认得引用，否则「手点那条跑的是不是
       * 同一份」这件事根本没有判据能问。 */
      const alias = /^stages:[ \t]*\*(?<anchor>\S+)[ \t]*$/.exec(body);
      const anchorName = alias?.groups?.anchor;
      if (anchorName !== undefined) {
        return anchorStageNames(text, anchorName);
      }
      if (body.startsWith("stages:")) {
        stageIndent = indent;
      }
      continue;
    }
    /* 已在 `stages:` 里：更浅或同级的键 ⇒ 这一条流水线结束了。 */
    if (indent <= stageIndent && !body.startsWith("- ")) {
      break;
    }
    const item = /^- name:[ \t]*(?<name>\S.*?)[ \t]*$/.exec(body);
    const itemName = item?.groups?.name;
    if (itemName !== undefined) {
      out.push(itemName);
    }
  }
  return out;
}

/**
 * 读一个顶层锚点（`.daily-gates: &daily_gates`）里的 stage 名单。
 * 收尾按**顶格行**判（锚点正文带缩进，遇到下一个 `.keys:` / `master:` 即结束）；注释与空行跳过，块里那些注释正当地解释每一格。
 * @param text 原文 @param anchor `&` 后的名字 @returns `[]` = 锚点不存在（调用方当「没找到」，不是「清单为空」）
 */
export function anchorStageNames(text: string, anchor: string): Array<string> {
  const lines = text.split("\n");
  const escaped = anchor.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const def = new RegExp(`^\\.[^:]*:[ \\t]*&${escaped}[ \\t]*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (def.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return [];
  }
  const out: Array<string> = [];
  for (const raw of lines.slice(start + 1)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      continue;
    }
    if (/^\S/.test(raw)) {
      break;
    }
    const item = /^-\s+name:[ \t]*(?<name>\S.*?)[ \t]*$/.exec(raw.trim());
    const itemName = item?.groups?.name;
    if (itemName !== undefined) {
      out.push(itemName);
    }
  }
  return out;
}

/**
 * 一个 stage 名在 `.gates` 里是否**以注释形态**留着：停用≠删除，恢复动作是「取消注释」，所以必须 grep 得回 `- name: <stage>` 那一行。
 * 少了这条，「等测试流程好了再加回来」就只剩一句注释。@param text 原文 @param name stage 名
 */
export function stageKeptAsComment(text: string, name: string): boolean {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^[ \t]*#+[ \t]*-[ \t]+name:[ \t]*${escaped}[ \t]*$`, "m").test(text);
}

/**
 * **合并键解析**（`<<: *anchor`）：`runner` 挂在锚点里、两个事件各引用一次。文本判据答不了它 —— YAML 1.2 把 `<<` 移出核心，
 * 不认合并键的解析器会静默丢掉 `<<: *common`，得到「有 runner 键的文本、却解析不出 runner」⇒ 回落到计费平台池，文本层面完全看不出。
 * 判法：自己按合并键语义解析，断言这两条流水线都解析出 `runner.namespace === "group"` 与非空 `tags`；不引第三方解析器（每次提交都跑，加依赖不划算）。
 */
export function resolveAnchoredRunner(
  text: string,
): Array<{ namespace?: string; tags?: Array<string> }> {
  // 抽出 `.common` 锚点块里的 runner（缩进两层：`  runner:` 下跟两键）。
  const anchor = /^\.common:\s*&\w+\s*$(?<body>[\s\S]*?)(?=^\S)/m.exec(text);
  const body = anchor?.groups?.body;
  if (body === undefined) {
    return [];
  }
  const runnerNS = /^\s+namespace:\s*(?<namespace>\S+)\s*$/m.exec(body);
  const tagLines = body.match(/^\s+-\s*(?:\S+)\s*$/gm) ?? [];
  return [
    {
      namespace: runnerNS?.groups?.namespace,
      tags: tagLines.map((l) => l.replace(/^\s*-\s*/, "").trim()),
    },
  ];
}

/**
 * `.cnb.yml` 的 stage 级 `timeout` 预算（stage 名 → 原文写法）：每个 stage 默认能跑满 2 小时（平台 Job 上限），而自托管节点只有一台。
 * 实测（ISSUE #1961）`ESLint 零警告` 与 `单元测试` 各挂到 8640s 才被掐断、只剩 `timeout of 8640000ms exceeded` ⇒ 漏掉预算，红法就从「20 分钟可读超时」退化成「两小时看不懂的超时」，且增删 stage 时最容易忘。
 * 只认 stage 列表项自己那层（到下一个同级项），env 不被误当预算；没写的 stage 不出现在结果里。
 */
/**
 * 摘出某个 stage 那一项的原文（从它的 `- name:` 到下一项 / 下一个更浅的键）。
 * 按**缩进收口**而不是正则一次匹配到底：stage 项里嵌着 `script: |`（含更深缩进的任意文本）与 `env:` 子映射，一次匹配容易多吃或少吃。
 * @param text 原文 @param name stage 名 @returns 那一项原文或 `null`
 */
export function stageBlock(text: string, name: string): string | null {
  const lines = text.split("\n");
  let start = -1;
  /** 命中那一项的列表项缩进 —— 收尾按它判（`push` 那条的 stage 在外层 `stages:` 下是
   *  8 空格、锚点那条直接挂在流水线下是 4 空格，两种都得收得住）。 */
  let itemIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^(?<indent> *)-\s+name:\s*(?<name>\S.*?)\s*$/.exec(lines[i] ?? "");
    const itemName = item?.groups?.name;
    if (itemName === name) {
      start = i;
      itemIndent = (item?.groups?.indent ?? "").length;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  const out: Array<string> = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 下一个**同级或更浅**的列表项 / 更浅的键都算收尾（空行不算 —— 配置里正文之间有空行）。 */
    const nextItem = /^(?<indent> *)-\s/.exec(raw);
    if (nextItem && (nextItem.groups?.indent ?? "").length <= itemIndent) {
      break;
    }
    const key = /^(?<indent> *)\S/.exec(raw);
    if (key && (key.groups?.indent ?? "").length < itemIndent) {
      break;
    }
    out.push(raw);
  }
  return out.join("\n");
}

/**
 * 摘出**被注释掉的** stage 那一项的原文（`# - name: X` 起）：停用的恢复动作是取消注释，原文必须 grep 得回来。
 * `stageBlock()` 只认活的 `- name: X`，停用后回 `null` ⇒ 「停用期间那两个键还在不在」没有判据看得见；这里剥 `# ` 前缀后按同一套缩进口径收口，不造第二轮子。
 * @param text 原文 @param name stage 名 @returns 那一项原文或 `null`
 */
export function commentedStageBlock(text: string, name: string): string | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^#\s+-\s+name:\s*(?<name>\S.*?)\s*$/.exec(lines[i] ?? "");
    const itemName = item?.groups?.name;
    if (itemName === name) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  const strip = (l: string) => l.replace(/^#\s?/, "");
  const out: Array<string> = [strip(lines[start] ?? "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 收尾：下一个同级（注释态）stage 项，或**回到未注释的顶格键**（`master:` 那一层）。
     * ⚠️ 判据不能写成「`^\S` 就收尾」—— 注释块里的每一行都以 `#` 开头，那也是 `\S`，
     * 于是块内容会被切在第一行之后（`- name: X` 一行）。 */
    if (/^#\s+-\s+name:/.test(raw) || (/^\S/.test(raw) && !raw.startsWith("#"))) {
      break;
    }
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
    if (raw.trim() === "") {
      continue;
    }
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
    if (current === null || currentIndent === null) {
      continue;
    }
    const ownIndent = jobIndent ?? currentIndent;
    /* 这一项自己的键：比它自己那一层深一层（Job 项深一层；没有 `jobs:` 的项就是
     * stage 项深一层）。更深的是 `env:` 里的同名键，不算。 */
    if (indent !== ownIndent + 2 || !body.startsWith("timeout:")) {
      continue;
    }
    out.set(current, body.slice("timeout:".length).trim());
  }
  return out;
}

/**
 * `.cnb.yml` 的**流水线级 `lock`** 是否声明 `cancel-in-progress: true`：自托管只有一台机，一次 PR 连推几个提交就起多条全量流水线、全落到同一台（实测三条并行各自冻结）。
 * 这个开关是唯一能把重复运行收成一条的，而它**漏掉时配置看起来与有它时一模一样**。
 * 判法用锚点展开后的形态（同 `resolveAnchoredRunner`）：`.common` 里必须出现 `lock:` 与其下的 `cancel-in-progress: true`。
 */
export function hasPipelineLockCancelInProgress(text: string): boolean {
  /* 收口到「下一个更浅缩进的键」或**文本末尾** —— 少了后半句，末尾没跟别的键的
   * 夹具会解析不出来（真 `.cnb.yml` 里 `.common` 后面还有 `.gates`，看不出来）。 */
  const anchor = /^\.common:\s*&\w+\s*$(?<body>[\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(text);
  const body = anchor?.groups?.body;
  if (body === undefined) {
    return false;
  }
  // `lock:` 块内出现 `cancel-in-progress: true`（同一块里的 `timeout`/`key` 不算）。
  return /^\s+lock:\s*$[\s\S]*?^\s+cancel-in-progress:\s*true\s*$/m.test(body);
}

/**
 * `.cnb.yml` 的流水线级 `lock.key` 原文（`null` = 没写，吃平台默认值）。⚠️ 不是风格：默认 key 是 `分支名-流水线名`，而 `pull_request` 下 `CNB_BRANCH` 取**目标分支**（官方 `build-in-env.md`）。
 * 于是「分支名」在 PR 上恒等于 `master`、全仓 PR 共用一把锁，`cancel-in-progress: true` 退化成「全仓只留最新一跑」：任意两条并行 PR 互相掐停（现场 PR #1980 掐了 #1982），代价是白跑一整条。
 * 判法同 `hasPipelineLockCancelInProgress`（锚点展开后）。@returns key 原文（未做变量替换），没写时 `null`
 */
export function pipelineLockKeyTemplate(text: string): string | null {
  const anchor = /^\.common:\s*&\w+\s*$(?<body>[\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(text);
  const body = anchor?.groups?.body;
  if (body === undefined) {
    return null;
  }
  const lock =
    /^(?<indent>\s+)lock:[ \t]*\r?\n(?<body>[\s\S]*?)(?=^\k<indent>\S|\s*$(?![\s\S]))/m.exec(body);
  const block = lock?.groups?.body;
  if (block === undefined) {
    return null;
  }
  const key = /^\s+key:[ \t]*(?<value>\S.*?)[ \t]*$/m.exec(block);
  return key?.groups?.value ?? null;
}

/**
 * `lock.key` 里允许出现的内置变量（**白名单**，缺一个就判红）。
 * 用白名单而非黑名单：失效形态是「代入一个看起来对、实际被解析成别的东西的变量」，黑名单只能拦已知的那一个。
 */
/* SAFETY: 类型断言已复核 */
const LOCK_KEY_ALLOWED_VARS = ["CNB_PULL_REQUEST_IID"] as const;

/**
 * 把 `lock.key` 原文按一次「事件 + 上下文」跑出**平台会算出来的那个 key**：只看原文判不出「两条 PR 会不会撞」，必须把变量代进去。
 * 与官方 `build/env.md` §变量替换同义：`$NAME` / `${NAME}` 都替换，无值换成空串；**查不到的变量按空串算**，于是平台不认识的变量会表现为「key 退化共用」，判据当场点名。
 * @param template `pipelineLockKeyTemplate()` 的返回值 @param vars 有值的变量（没列出的 = 无值）@returns 平台算出来的锁键
 */
export function resolveLockKey(template: string, vars: Record<string, string | undefined>): string {
  return template.replaceAll(
    /\$\{?(?<name>[A-Za-z0-9_]+)\}?/g,
    (_whole, name: string) => vars[name] ?? "",
  );
}

/** `.lock-*` 那几把**类锁**的定义：锚点名 → `{ key 原文, cancel-in-progress 原文, wait 原文 }`（后两者 `null` = 没写 = 吃平台默认 `false`）。 */
export function lockAnchorDefinitions(
  text: string,
): Map<string, { cancelInProgress: boolean | null; key: string; wait: boolean | null }> {
  const out = new Map<
    string,
    { cancelInProgress: boolean | null; key: string; wait: boolean | null }
  >();
  const def =
    /^\.lock-[\w-]+:[ \t]*&(?<name>lock_\w+)[ \t]*$(?<body>[\s\S]*?)(?=^\S|$(?![\s\S]))/gm;
  for (const m of text.matchAll(def)) {
    const name = m.groups?.name;
    const body = m.groups?.body ?? "";
    const key = /^[ \t]+key:[ \t]*(?<key>\S.*?)[ \t]*$/m.exec(body)?.groups?.key;
    if (name === undefined || key === undefined) {
      continue;
    }
    /* `null` = 这一行**没写**；`false` 是「写了、值是 false」—— 两者不同：
     * 漏写会让同一件事重复排队，而 `false` 是有意的取舍（逐笔留读数，见 R2）。 */
    const rawCancel = /^[ \t]+cancel-in-progress:[ \t]*(?<value>true|false)[ \t]*$/m.exec(body)
      ?.groups?.value;
    /* `wait` 同理（ISSUE #3207）：`null` = 没写 = 吃平台默认 `false` = **不排队**。
     * 「不终止」与「排队」是两件事，而两个默认值（`cancel-in-progress: false` /
     * `wait: false`）叠在一起是「既不终止、也不等」—— 后到那一跑在 Prepare 里当场红。 */
    const rawWait = /^[ \t]+wait:[ \t]*(?<value>true|false)[ \t]*$/m.exec(body)?.groups?.value;
    out.set(name, {
      key,
      cancelInProgress: rawCancel === undefined ? null : rawCancel === "true",
      wait: rawWait === undefined ? null : rawWait === "true",
    });
  }
  return out;
}

/**
 * `master:` 块里每条流水线的**锁归属**与它引用的 stage 清单：按文本解析而非 `js-yaml`（本文件其余判据全用文本形状，且它不是本仓直接依赖）。
 * 形状前提同 `resolveAnchoredRunner`：分支键 2 空格，项内 `name:` / `lock:` / `stages:` 在 6 空格那层。
 * @returns 每条流水线一项（`lockRef === null` = 吃 `.common` 那条 = 要么真是 PR，要么忘写覆盖）
 */
export function pipelineLockAssignments(text: string): Array<{
  event: string;
  lockRef: string | null;
  name: string;
  stagesRef: string | null;
}> {
  const out: Array<{
    event: string;
    lockRef: string | null;
    name: string;
    stagesRef: string | null;
  }> = [];
  let inMaster = false;
  let event = "";
  let name = "";
  let lockRef: string | null = null;
  let stagesRef: string | null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^master:[ \t]*$/.test(raw)) {
      inMaster = true;
      continue;
    }
    /* 下一个顶层键 ⇒ `master:` 块结束。 */
    if (inMaster && /^\S/.test(raw) && !raw.startsWith("#")) {
      inMaster = false;
    }
    if (!inMaster) {
      continue;
    }
    if (raw.trim() === "" || /^\s*#/.test(raw)) {
      continue;
    }
    const eventKey = /^ {2}(?<event>\S.*):[ \t]*$/.exec(raw);
    const eventName = eventKey?.groups?.event;
    if (eventName !== undefined) {
      event = eventName.replaceAll(/^"|"$/g, "").trim();
      continue;
    }
    /* 新的一项从**它自己的 `name:`** 起：认的是 `name:`，而 `lock:` / `stages:` 只在**当前项之内**算数。少了这句，上一条的 `lock:` 会被带进下一条
     * （探针三条自写 `runner`、不吃锚点且都带 `lock:`，会各自继承上一条的锁归属 —— ISSUE #2363 点过这个坏形态，判据侧到 2026-10-26 才堵上）。
     * 显式清空之后，「没写 `lock:` 的项」落到 R1 该有的读数上。 */
    const itemStart = /^ {4}-[ \t]*(?:<<:)?[ \t]*/.exec(raw) !== null;
    if (itemStart) {
      name = "";
      lockRef = null;
      continue;
    }
    const nameKey = /^ {6}name:[ \t]*(?<name>.+?)[ \t]*$/.exec(raw);
    const nameValue = nameKey?.groups?.name;
    if (nameValue !== undefined) {
      name = nameValue;
      lockRef = null;
      continue;
    }
    const lockKey = /^ {6}lock:[ \t]*\*(?<ref>\w+)[ \t]*$/.exec(raw);
    const lockRefValue = lockKey?.groups?.ref;
    if (lockRefValue !== undefined) {
      lockRef = lockRefValue;
      continue;
    }
    const stagesKey = /^ {6}stages:[ \t]*(?<ref>\*\w+)?[ \t]*$/.exec(raw);
    if (stagesKey !== null) {
      /* 一份 `stages:` 收尾一项；内联清单（没有 `*ref`）当作**只属于这一条**，
       * 于是「同一把锁只许给同一份工作清单」那条规则对它天然要求独占。 */
      stagesRef = stagesKey.groups?.ref ?? `inline:${name}`;
      out.push({ event, name, lockRef, stagesRef });
    }
  }
  return out;
}

/**
 * 锁按触发类分开后的六条规则（返回违规清单，空 = 都成立）。ISSUE #2114 第二条死因「非 PR 共用退化成 `pr-` 的锁」，现场 `cnb-5j9-1k5bc4p4u` 差 3 秒被 cancel、`cnb-lm1-1k5h1otqt` 244.06s 被无关 push 掐掉（差 0.2 秒）。
 * R1 非 PR 每条显式写 `lock:`（继承 `*common` 即退化入口）；R2 类锁在场、显式写 `cancel-in-progress`、key 为字面量（#1981；与「值为 true」是两件事，#2396）；R3 一把锁只给同一份清单（三条每日口允许共用 `*daily_gates`）；R4 非 PR key 不许等于 `pr-` / `pr-<iid>`。
 * R5 PR 仍用带 `CNB_PULL_REQUEST_IID` 的模板（不许回退「全仓一把」）；R6 `push` 锁必须 `cancel-in-progress: false` **且** `wait: true`（#2396 + #3207）—— 逐提交给读数，两笔都得有结论：「不终止旧跑」与「后到的那跑会排队」是两件事，只写前者时后到者照样在 Prepare 里被判 error。
 */
export function lockClassViolations(text: string, prIid = "1982"): Array<string> {
  const bad: Array<string> = [];
  const defs = lockAnchorDefinitions(text);
  const commonTemplate = pipelineLockKeyTemplate(text);
  if (commonTemplate === null) {
    return ["`.common` 锚点里没有 `lock.key` —— 全部流水线回落到平台默认 key"];
  }
  const rows = pipelineLockAssignments(text);
  if (rows.length === 0) {
    return ["解析不出 `master:` 块里的任何流水线 —— 判据在这一份配置上恒转（要修解析器）"];
  }
  const prKey = resolveLockKey(commonTemplate, {
    CNB_PULL_REQUEST_IID: prIid,
    CNB_PULL_REQUEST: "true",
  });
  /* 非 PR 事件上那个变量无值 ⇒ 这就是那份退化后的形状本身。 */
  const degenerateKey = resolveLockKey(commonTemplate, {});

  /** 同一把工作清单 → 允许共用它的那些锁；反过来锁 → 它只能给一份清单。 */
  const lockToWork = new Map<string, Set<string | null>>();

  /* 探针（ISSUE #2363）里**被测的就是锁本身**：A 的 `cancel-in-progress: false` 是要问的问题、B/C 的「一条锁都不写」是对照组 ⇒ R1 与 R2 的「显式写」对它们不成立。
   * 豁免**逐条点名**：`PROBE_PIPELINES` 是到期日与「不许吃锚点」名单，`PROBE_LOCK_EXEMPT` 是这一层的「放过哪条规则」名单；探针仍须过「key 字面量」「不撞退化形状」「一把锁只给一份清单」。
   * ⚠️ A 写成 `true` 不会被本函数点名（R6 只对 `push` 成立），那一半由下面那条用例直接读原文断言；两份名单是字面量而非投影，否则「C 有了锁」与「A 的锁错了」会读成同一件事。 */
  const probeExempt = new Map(PROBE_LOCK_EXEMPT.map((e) => [e.event, e]));

  for (const row of rows) {
    if (row.event === "pull_request") {
      /* R5：PR 那一条的 key 必须随 PR 编号变。用两个编号各代一次、比结果 ——
       * 只看原文里有没有那个变量名是不够的（#1981 那个 bug 的原文里也有变量，
       * 只是代进去之后两条 PR 逐字相同）。 */
      const template =
        row.lockRef === null ? commonTemplate : (defs.get(row.lockRef)?.key ?? commonTemplate);
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
    const exemptCancel = probeExempt.get(row.event)?.cancelFalse === row.lockRef;
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
    if (seen === undefined) {
      lockToWork.set(def.key, new Set([row.stagesRef]));
    } else {
      seen.add(row.stagesRef);
    }
  }
  /* R6：`push` 那一档逐提交卖读数，**两笔都得有结论** ⇒ 两个开关一起判：
   *   · `cancel-in-progress: false` —— 别终止**旧**的那一跑（#2396 现场：前一笔被判 `cancel`）；
   *   · `wait: true` —— 别掐掉**新**的那一跑（#3207 现场：`cnb-o1g-1k6m7jj8q` 在 Prepare 里
   *     `The lock (…-push) is occupied and the current process is terminated`，6 格全 skipped）。
   * 只写前者时「不终止」并不等于「排队」——`wait` 的默认值就是 `false`（`grammar.md#pipeline-lock`），
   * 于是语义变成「既不终止、也不等」，后到的照样红。判的是**代出来的 key**，
   * 不是锚点名 —— 改名 / 换锚点都逃不掉。 */
  for (const row of rows) {
    if (row.lockRef === null) {
      continue;
    }
    const def = defs.get(row.lockRef);
    if (def?.key !== "push") {
      continue;
    }
    if (def.cancelInProgress !== false) {
      bad.push(
        `锁 *${row.lockRef}（key「${def.key}」）的 cancel-in-progress 不是 false —— ` +
          "「master 合并复核」的读数是逐提交给的，终止旧的一跑等于把前一笔的结论删掉（ISSUE #2396）",
      );
    }
    if (def.wait !== true) {
      bad.push(
        `锁 *${row.lockRef}（key「${def.key}」）没有写 wait: true —— ` +
          "`wait` 缺省是 false，于是两跑重叠时**后到那一跑**在 Prepare 里直接被判 " +
          "`the lock … is occupied and the current process is terminated`，它那一笔没有读数；" +
          "而合并后紧跟的删源分支（branch.delete）正是最常见的重叠形态，没人会去补跑它（ISSUE #3207）",
      );
    }
  }
  for (const [key, works] of lockToWork) {
    if (works.size > 1) {
      const list = [...works].map((w) => w ?? "(没收到 stages 引用)").join(" / ");
      bad.push(
        `锁 key「${key}」被 ${works.size} 份不同的 stage 清单共用（${list}）—— 同一把锁只该挡「同一件事被重复排队」，不同事之间不该互掐`,
      );
    }
  }
  return bad;
}

/** 规范里必须留痕的口径；缺失 = 决策被悄悄推翻、而文件面判据还没跟着变。 */
const DOC_ANCHORS: Array<{ file: string; mustContain: Array<string> }> = [
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
  needles: Array<string>,
  root: string = ROOT,
): Array<string> {
  const text = readFileSync(path.join(root, file), "utf8");
  const flat = text.replaceAll("\r\n", "\n").replaceAll("\n", "");
  return needles.filter((needle) => !flat.includes(needle.replaceAll("\n", "")));
}

/**
 * `.cnb.yml` 的**顶层键**清单（缩进 0、非注释、非空行，取第一个 `:` 之前）。`master:` 出现两次时 YAML 不报错，后一处静默覆盖前一处。
 * 而 `master:` 下挂着 `"crontab: 0 3 * * *"`，所以「新开一个 `master:` 加几条流水线」会**当场让定时那一跑消失**，配置读起来却正常（#2114 同族失效形态）。
 * 判据只判一件事：同一顶层键不许出现第二行 —— 新事件一律作为已有 `master:` 的子键加。@returns 顶层键（按出现顺序，**允许重复**）
 */
export function topLevelKeys(text: string): Array<string> {
  const out: Array<string> = [];
  for (const raw of text.split("\n")) {
    if (raw === "" || raw.startsWith("#")) {
      continue;
    }
    if (/^\S/.test(raw)) {
      const m = /^(?<key>[^:]+):/.exec(raw.trimEnd());
      const key = m?.groups?.key;
      if (key !== undefined) {
        out.push(key.trim());
      }
    }
  }
  return out;
}

/**
 * 读登记在册的平台侧配置原文。它**不存在时直接抛**：所有调用点都建立在「这份配置在」这个前提上，
 * 回 `null` 只会把「文件没了」摊成每个调用点各自的 `!` 断言。抛出的信息里带文件名。
 */
function readRegisteredConfig(): string {
  const rel = REGISTERED_CI_CONFIG;
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) {
    throw new Error(`登记在册的平台侧配置不存在：${rel}（它缺席时这套判据全都无从谈起）`);
  }
  return readFileSync(p, "utf8");
}

describe("平台侧流水线配置：形态必须是「自托管 + 已登记」（§13.5.3 / §13.5.4）", () => {
  it("仓库根只允许出现登记在册的那一份，别的 CI 形态一律不许", () => {
    const present = ciConfigsAmong(repoTopLevel());
    expect(present.filter((rel) => !REGISTERED_CI_CONFIGS.includes(rel))).toEqual([]);
  });

  it("登记在册的那一份必须满足形态契约（漏掉哪条都是静默失效）", () => {
    const text = readRegisteredConfig();
    const missing = CONFIG_SHAPE.filter((c) => !c.mustMatch.test(text));
    expect(missing.map((c) => c.why)).toEqual([]);
  });

  it("runner 是**锚点展开后**真的落在流水线上的（文本里有 ≠ 解析得到）", () => {
    const text = readRegisteredConfig();
    const runners = resolveAnchoredRunner(text);
    expect(runners.length, "没解析出 .common 锚点里的 runner —— 锚点被删了或换了形状").toBe(1);
    const runner = runners[0];
    if (runner === undefined) {
      throw new Error("锚点里的 runner 解析不出来");
    }
    expect(runner.namespace).toBe("group");
    expect(runner.tags?.length ?? 0).toBeGreaterThan(0);
    // 每条流水线都必须引用那个锚点：少引用一条 = 悄悄回落到计费的平台池（`runner.namespace: group` + `tags` 在锚点里）。
    // 引用形态 = 分支键、事件键下那层 `- <<: *anchor`；两个锚点合在一个合并键里也算，而 `<<:` 同层写两次是非法 YAML，所以只有流式这一种合法写法。
    // ⚠️ 不钉写死条数（过去钉 5 = 把「今天有几条流水线」当判据）：基准从文本现推，一条流水线必然带且只带一个 6 空格 `stages:`，引用数与它对齐；删某条 `stages:` 同样红。
    const refs = text.match(/^\s+-\s*<<:\s*(?:\[\s*)?\*\w+/gm) ?? [];
    const stageLists = text.match(/^ {6}stages:/gm) ?? [];
    /* 有期限的探针例外（ISSUE #2363）从两边**同额**扣掉：探针不吃锚点、也不吃
     * `*common` 那条锁（理由见下面那条用例）。同额扣除必须两头都有 —— 只减一边
     * 会让「漏接锚点」与「探针在跑」在读数上变成同一个数字。 */
    const probing = PROBE_PIPELINES.filter((name) => text.includes(`  ${name}:\n`));
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
    /* 这是**有期限的例外**，不是放宽判据（ISSUE #2363 探针）：锚点自带 `lock.key: pr-$CNB_PULL_REQUEST_IID` 在 `api_trigger` 上无值 ⇒ 三条落回同一把字面 `pr-` 并互相掐停，探针先得自己不成为变量。
     * 处置是「例外 + 自毁」：名单字面量（`PROBE_PIPELINES`，不是「自带 runner 都放行」）、有到期日（`PROBE_BY`，过期即红要求删段）、探针消失后本用例照样绿（删探针不留只能靠改用例的判据）。
     */
    const text = readRegisteredConfig();
    const alive = PROBE_PIPELINES.filter((name) => text.includes(`  ${name}:\n`));
    if (alive.length === 0) {
      return;
    }
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
      expect(block, `探针 ${name} 没有 namespace: group（会回落到计费平台池）`).toMatch(
        /namespace:\s*group\b/,
      );
      expect(block, `探针 ${name} 没有非空 tags`).toMatch(/^\s*tags:\s*\n\s+-\s*\S+/m);
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

  it("push 档跑的就是 `COMFYAPP_CI_PUSH_GATES` 那几格（声明与事实双向核对）", () => {
    /* 2026-10-28 起 push 档从「只有合并形态复核一格」扩成「树级校验档」：
     * 形态复核 + 前提安装 + 文档链三格 + 工作区出处，判的是**合并后的树**。
     * 与每日清单同一套双向核对：声明（env 里的清单）与事实（流水线里真的在跑的
     * stage）只读一份时另一份漂了没人红 —— 名字留在清单、格子被删，账面全绿而
     * 执行面是空的，正是本仓最不能有的形态。 */
    const text = readRegisteredConfig();
    const declared = registeredPushGateOrder(text);
    expect(
      declared.length,
      "解析不出 COMFYAPP_CI_PUSH_GATES —— 键被删了或换了形状，这条判据就没有对象了",
    ).toBeGreaterThan(0);
    const actual = pipelineStageNames(text, "master 合并复核");
    expect(
      actual,
      "push 流水线的 stage 名单与 `COMFYAPP_CI_PUSH_GATES` 不一致" +
        "（缺一格 = 声明在吹牛；多一格 = 没登记就上了线）",
    ).toEqual(declared);

    /* 顺序约束（前提格先于吃 node_modules 的格子）：这一档过去举的例子是
     * `API 文档生成与自检`（要跑 typedoc，而 push 是全新 job 目录、`node_modules`
     * 恒不在场）。2026-11-05 它已撤到每日档（ISSUE #2537）—— push 侧今天没有吃
     * `node_modules` 的判据格，但 `安装依赖` 仍是后面镜像出口格的前提，必须在前。 */
    const installAt = declared.indexOf("安装依赖");
    expect(installAt, "push 清单里没有「安装依赖」—— 前提格被删了").toBeGreaterThanOrEqual(0);

    /* ISSUE #2537：这一格**不许**回到 PR/合并侧的即时判里 —— 它今天只在每日档
     * （`COMFYAPP_CI_DAILY_GATES` 的「每日 API 文档生成与自检」）。有人改回去要在这里红。 */
    expect(
      declared,
      "「API 文档生成与自检」又回到了 push 清单 —— 2026-11-05 起它只在每日档（ISSUE #2537：98% 触发率、40.9s 中位、占 30.6%）",
    ).not.toContain("API 文档生成与自检");

    /* `覆盖率上报` 不在 push 档（push 不跑测试，放进去只会静默空转）；它 2026-11-02 从
     * PR 档挪到了**每日档** —— 每日档的 `每日单元测试` 跑 `pnpm run test:coverage` 产出
     * lcov，这一格接在后面上报。 */
    expect(
      declared,
      "「覆盖率上报」不该出现在 push 清单里 —— push 档没有产出 lcov.info 的格子，它在那里只会静默跳过",
    ).not.toContain("覆盖率上报");

    /* 接槽的安全前提（ISSUE #2851）：这一档后面**不许有会真构建的格子**。
     * `安装依赖` 那一格置着 `COMFY_CI_SLOT: "1"`，而接槽形态下 Turbopack 拒指向项目根之外的
     * `node_modules` 链（每日档那次是 13.8s 就死 + 后面四格整片 `skipped`，ISSUE #2081）。
     * 「push 清单里没有构建格」过去只是 #2851 单子与配置注释里的一句话 —— 它现在是判据：
     * 往这份清单里加构建格的人要当场被拦住，而不是等那一跑死了再查为什么。 */
    const withBuild = stagesWithBuildConsumer(
      new Map(declared.map((n) => [n, executableScriptLines(text, n)])),
    );
    expect(
      withBuild,
      `push 清单里出现了会真构建的格子（${withBuild.join(" / ")}），而「安装依赖」那一格置着 ` +
        "`COMFY_CI_SLOT`：先摘那一行并同批把它登记进 `DAILY_ENV_ONLY_ON_PR`，" +
        "或先证明 #2521 的 `turbopackAdditionalRoots` 在这一档上跑得通（它在有构建格的档上一次都没被执行过）",
    ).toEqual([]);
  });

  it("手点 / API 两个触发口跑的是同一份清单，而按钮与事件键两两对上", () => {
    /* 定时那一口已迁 GitHub Actions（见「定时档不在本机、在 GA」那条）。留在 CNB 的
     * 手点 / API 两口不自动触发、不占这台机，只在有人明确要复验某一格或要一份本机
     * 产物时才跑。它们仍必须与 `COMFYAPP_CI_DAILY_GATES` 是**同一件事**，否则
     * 「手点一遍每日档」这句话就没有确定含义（复制一份 stage 清单 ⇒ 加格子时只加一边；
     * 按钮指到一个 PR 清单 ⇒ 手点的根本不是每日档）。 */
    const text = readRegisteredConfig();
    const viaButton = pipelineStageNames(text, "每日档（手动触发）");
    const viaApi = pipelineStageNames(text, "每日档（API 触发）");
    const declared = registeredDailyGateOrder(text);
    expect(declared.length, "每日清单解析为空 —— 后面的比较就没有对象了").toBeGreaterThan(0);
    expect(
      viaButton,
      "手点那一条的 stage 名单与 `COMFYAPP_CI_DAILY_GATES` 不一致 —— 它应当引用 `*daily_gates` 锚点",
    ).toEqual(declared);
    expect(
      viaApi,
      "API 那一条与手点那一条跑的**不是同一份**清单 —— 同一个锚点，不另抄一份",
    ).toEqual(declared);

    /* 事件名必须是 `api_trigger` 或其前缀 —— 这是**服务端**的硬要求（实测 400
     * `Event must be 'api_trigger' or start with 'api_trigger_'.`）。写成 `daily_api`
     * 那一类名字，这条流水线在配置解析期一个字都不报，而永远没人能触发它 ——
     * 判前缀不判整串：后缀是自由命名的（官方口径），把它钉成字面量等于把实现细节当判据。 */
    const apiEvents = [...text.matchAll(/^ {2}(?<event>api_trigger\w*):$/gm)].map(
      (m) => m.groups?.event,
    );
    expect(
      apiEvents,
      "API 触发口的事件键丢了，或不再是 `api_trigger` 前缀（服务端会直接 400）",
    ).toContain("api_trigger_daily");
    const badApi = [...text.matchAll(/^ {2}(?<event>\w+):$/gm)]
      .map((m) => m.groups?.event ?? "")
      .filter((k) => /api.?trigger|trigger.?api/i.test(k))
      .filter((k) => !k.startsWith("api_trigger"));
    expect(
      badApi,
      `有触发口用了服务端不收的事件名（必须 ^api_trigger）：${badApi.join(" / ")}`,
    ).toEqual([]);

    /* 事件键与按钮：**两个方向**都要有对象。这里的失效形态都是「按了没反应」或
     * 「永远没人按」，而两种都不会让任何一边自己变红。 */
    const events = [...text.matchAll(/^ {2}(?<event>web_trigger_\w+):$/gm)].map(
      (m) => m.groups?.event,
    );
    expect(events.length, ".cnb.yml 里没有 `web_trigger_*` 事件键").toBeGreaterThan(0);
    const triggerFile = path.join(ROOT, ".cnb", "web_trigger.yml");
    expect(
      existsSync(triggerFile),
      "缺 `.cnb/web_trigger.yml` —— 官方把按钮定义放在这个文件里，没有它就没有按钮可点",
    ).toBe(true);
    const buttons = readFileSync(triggerFile, "utf8");
    const bound = [
      ...buttons.matchAll(/^[ 	]*event:[ 	]*(?<event>web_trigger_\w+)[ 	]*$/gm),
    ].map((m) => m.groups?.event);
    expect(bound.length, "`.cnb/web_trigger.yml` 里一个 `event:` 都没有").toBeGreaterThan(0);
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

  /**
   * 出勤判据认的流水线名 ⇄ 配置里真正跑 `*daily_gates` 的流水线（ISSUE #2873）：`DAILY_LANE_PIPELINES` 是 `check-daily-attendance.mjs` 认档的唯一名单（事件名前缀不够，01:00 与 03:00 共享 `crontab:`）。
   * 名单漂两个方向都静默：配置改名而名单没跟 ⇒ 永远缺勤；名单留着已不存在的名字 ⇒ 永远出勤。两种都不让别的判据红。
   * 比的是「跑哪份清单」（`stagesRef`），不是「挂在哪个事件名 / 几点」（小时在 10-22 一天内换过两次）。
   */
  it("每日出勤判据认的流水线名，就是配置里跑 `*daily_gates` 的那几条（不多不少）", () => {
    const rows = pipelineLockAssignments(readRegisteredConfig());
    const dailyNames = rows.filter((r) => r.stagesRef === "*daily_gates").map((r) => r.name);
    expect(dailyNames.length, "配置里一条跑 `*daily_gates` 的流水线都没解析出来").toBeGreaterThan(
      0,
    );
    expect(
      [...DAILY_LANE_PIPELINES].sort(),
      "`DAILY_LANE_PIPELINES` 与 `.cnb.yml` 里跑 `*daily_gates` 的流水线名不是一张表 —— " +
        "配置那侧改了名（或加了一个触发口）而名单没跟，出勤判据就会静默变成恒缺勤或恒出勤",
    ).toEqual(dailyNames.sort());

    /* 定时档已迁 GA ⇒ CNB 配置里**不许再有** `crontab:` 流水线。这一条是反向的：
     * 删掉定时口这件事本身必须被判据看见，否则「配置看着还像有定时、平台其实没人起」
     * 就是 #1229 那一族的静默失效，而自托管机又是本机，负载白扛了也没人知道。
     * GA 侧两条 schedule 是否真的在，由「定时档不在本机、在 GA」那条钉。 */
    const cronRows = rows.filter((r) => r.event.startsWith("crontab:"));
    expect(
      cronRows.map((r) => `${r.event}|${r.name}`),
      "`.cnb.yml` 里又出现了 crontab 定时流水线 —— 定时重档的执行者是 GA，这台机不该再被时钟起",
    ).toEqual([]);
  });

  it("规范正文确实写着这次的决策反转（反向锚点）", () => {
    const drifted: Array<string> = [];
    for (const { file, mustContain } of DOC_ANCHORS) {
      const missing = missingAnchors(file, mustContain);
      if (missing.length > 0) {
        drifted.push(`${file} 缺：${missing.join(" / ")}`);
      }
    }
    expect(drifted).toEqual([]);
  });

  it("doc-facts **必须**把 .cnb.yml 登记成 path 类事实（它真的存在了）", () => {
    const facts = readFileSync(path.join(ROOT, "scripts/doc-facts.cjs"), "utf8");
    /* `source:` 在文件里有两种排版（独占一行 / 跟在 `kind` 后面同一行），
     * 所以扫的是「含 `source:` 的行」而不是「以 `source:` 开头的行」。 */
    const sourceLines = facts
      .split("\n")
      .filter((line) => /(?:^|[{,]\s*)source:\s*["']/.test(line));
    // 先确认扫描面没跑偏（事实表里一定有 `source:` 行，否则下面的断言是空转）。
    expect(sourceLines.length).toBeGreaterThan(0);
    expect(facts, "scripts/doc-facts.cjs 里连事实表都没读出来，扫描面指错了地方").toContain(
      "kind:",
    );
    // path 类事实的语义是「文档指向的文件必须存在」——文件回来了，就该有登记。
    const registered = sourceLines.some((line) => /source:\s*["']\.cnb\.yml["']/.test(line));
    expect(registered, "scripts/doc-facts.cjs 没有把 .cnb.yml 登记成 path 类事实").toBe(true);
    // 反向：别的 CI 形态不许被登记（登记一个刻意不存在的文件会让 doc:check 恒红）。
    const offenders = sourceLines.filter((line) =>
      CI_CONFIG_FILES.filter((n) => n !== ".cnb.yml").some((n) => line.includes(n)),
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
    const m = /^\s*COMFYAPP_CI_PYTHON_PROBE:\s*(?<path>\S+)\s*$/m.exec(text);
    const declared = m?.groups?.path;
    expect(
      declared,
      "`.cnb.yml` 的 env 里没有 COMFYAPP_CI_PYTHON_PROBE —— 缺 Python 时「跳过的是哪几条」" +
        "又变成只能靠人自己拼（`scripts/python-probe.mjs` 因此没有调用方）",
    ).toBeTruthy();
    if (declared === undefined || declared === "") {
      throw new Error("解析不出探测入口");
    }
    /* 它必须是**盘上真有的**文件：`env` 的值不经过 shell，写错了不会报任何错，
     * 只会在真要用的那一刻答「文件不存在」—— 那时候人正在查「为什么少判了几格」。 */
    expect(
      existsSync(path.join(ROOT, declared)),
      `env 点名的 Python 探测入口不在盘上：${declared}`,
    ).toBe(true);
  });

  it("`E2E 那一格已离开 PR（撤档，不是停用），而它的序约束整套挪到每日那一条", () => {
    const text = readRegisteredConfig();
    /* 立案（`cnb-ob4-1k5828a36`）：撤掉 PR 上的 `生产构建` 后，`E2E 关键流程` 红在 `Could not find a production build` ⇒ `Timed out waiting 180000ms`。
     * 病根是 `playwright.config.ts` 旧句 `CI || PNPM_START ⇒ pnpm start` 把「是不是 CI」与「工作区有没有产物」绑成一件。
     * 两条出路选了「整格挪到每日档」而非「PR 改跑现场编译档」，理由与实测读数写在 `.cnb.yml` 撤档说明里（dev 档在这台节点上没有读数，历史形态是「冒烟集体超时」）。 */
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
    expect(e2eAt, "「每日全量E2E」不在每日清单里 —— 上面那条搬家的断言失去落点").toBeGreaterThan(
      -1,
    );
    for (const prerequisite of ["每日浏览器安装", "每日生产构建"]) {
      expect(
        daily.indexOf(prerequisite),
        `「${prerequisite}」必须排在「每日全量E2E」之前 —— ${
          prerequisite === "每日生产构建"
            ? "这一格的 webServer 起的是 `pnpm start`，产物来自它"
            : "缺件时整档会以「每条都报同一个 launch 失败」的形态红"
        }`,
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
    /* 那一步点名的入口必须真在盘上（同 `Python 探测入口` 口径：路径写错不在解析期报错，只在真用时答「文件不存在」）。
     * **两种形态都要读得出来**：活的（锚点里 `script:` 带缩进）与被注释掉的（剥 `# ` 前缀后顶格）。
     * ⚠️ 正则**必须容忍前导空白** —— ISSUE #1966 恢复这格时只认顶格 `^(?:#\s*)?script:` 把活的判成「解析不出 script」；也不做「紧邻下一行」匹配（停用块在 `- name:` 与 `script:` 间插了说明）。
     * 名字带「每日」是 2026-10-19 挪档结果（撤节奏不撤账），由下面「PR 撤掉的格必须在每日清单有同名执行者」判。 */
    const blockText =
      stageBlock(text, "每日浏览器安装") ?? commentedStageBlock(text, "每日浏览器安装");
    const scriptLine = /^[ \t]*(?:#\s*)?script:[ \t]*(?<script>\S.*)$/m.exec(blockText ?? "");
    const command = scriptLine?.groups?.script?.trim();
    expect(command, "解析不出「每日浏览器安装」那一步的 script").toBeTruthy();
    /* ⚠️ 入口**不一定在第一个字符上**：每个 stage 的脚本现在都以一句
     * `[Console]::OutputEncoding=…;` 开头（平台 stage shell 是 PowerShell，
     * 不设它平台侧的中文日志全是乱码，见 `.cnb.yml` 头注第 6 条），外面还包着
     * `ci-cp936-exit.mjs`（ISSUE #1977 的 CP936 出口）。`unwrapCp936()` 剥掉后者 ——
     * 判的是「这一段命令点到的是哪个入口」，不是「中间隔了几层壳」。 */
    const entry = /(?:^|;)\s*(?:node\s+)?(?<path>scripts\/[^\s;]+)/.exec(unwrapCp936(command ?? ""))
      ?.groups?.path;
    expect(entry, `「每日浏览器安装」那一步指向的不是 scripts/ 下的入口：${command}`).toBeTruthy();
    expect(
      existsSync(path.join(ROOT, entry ?? "")),
      `「每日浏览器安装」点名的入口不在盘上：${entry}`,
    ).toBe(true);
  });

  it("`每日浏览器安装` 那一步把下载的套接字超时放宽了（180 MiB 撞 30s 是「没量完」）", () => {
    const text = readRegisteredConfig();
    /* 现场（`cnb-rkr-1k510rsgg` 的 `浏览器安装`）：180 MiB 包撞 Playwright 默认 30s **套接字**超时（`NET_DEFAULT_TIMEOUT`）被掐断（原文 `timed out after 30000ms`）。
     * 那不是「CDN 不通」的结论，是「这一次没量完」—— 处置相反（换镜像 vs 放宽），而日志里此前分不开它们。
     * 这个键是本档唯一能碰「下载」的地方，`env` 键写错不在解析期报错、只在下一次下载时同形再红 ⇒ 按「块内必须有这个键」判。
     */
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
    expect(stage, "解析不出「每日浏览器安装」这一步 —— 名字被改了？").toBeTruthy();
    expect(
      stage,
      "「每日浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` —— 默认的 30s 是" +
        "**套接字**超时，180 MiB 的包在慢链路上会被它按时掐断",
    ).toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT");
    expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:\s*"[1-9]\d*"/);

    /* 光放宽预算不够：放宽到 120s 之后**照旧超时**（`cnb-gt1-1k513ill4`：`timed out after 120000ms`）⇒ 这台节点真到不了 `cdn.playwright.dev`，镜像那一行才是让下载**到得了**的那件。
     * 少了它，这一步会以「超时」一直红，而人只会不断调那个数字；而它**推不出来**：Playwright 三个内置镜像全是同一族，`retryCount = 5` 的回退等于没有（实测 5 次同域名后 `Download failure, code=1`）。
     * 对应读数与判据见 `tests/ci-toolchain-selfcheck.test.ts` 的「下载根由外面给」那组。
     */
    expect(
      stage,
      "「每日浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_HOST` —— 自托管节点到不了 " +
        "`cdn.playwright.dev`（120s 也超时），只放宽那个超时数字是没用的",
    ).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST:\s*"https:\/\/[^"]+"/);
  });

  it("`每日单元测试` 排在 `每日 Python 可用性` 之后（声明清单那一份）", () => {
    /* 这条原来是 PR 那份顺序判据（`单元测试` vs `Python 可用性`）；2026-10-19 两格挪到每日档，顺序约束**没消失**、只是换了清单：缺解释器时单测照旧往下跑，而它要 2h24m 才可能被墙钟掐断（`cnb-jt3-1k5071kou`）。
     * 「要么看不到、要么在最贵的位置才看到」这个形态与挂哪条流水线无关。这里判**声明**（`COMFYAPP_CI_DAILY_GATES`），
     * 事实顺序由下面那条前提格判据判 —— 声明与事实双向核对，只读一份时另一份漂了没人红。 */
    const order = registeredDailyGateOrder(readRegisteredConfig());
    expect(
      order.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 键被删了或换了形状，这条顺序约束就没有执行者了",
    ).toBeGreaterThan(0);
    const probeAt = order.indexOf("每日 Python 可用性");
    const testAt = order.indexOf("每日单元测试");
    /* 两个名字都必须取到：取不到就是**这一格被从清单里删了**，而顺序判据会退化成
     * 「-1 比 -1 小」那种永远成立的空判（解析失败伪装成结论）。 */
    expect(probeAt, "`每日 Python 可用性` 不在每日清单里了").toBeGreaterThanOrEqual(0);
    expect(testAt, "`每日单元测试` 不在每日清单里了").toBeGreaterThanOrEqual(0);
    expect(
      probeAt,
      "`每日 Python 可用性` 必须排在 `每日单元测试` 之前：缺解释器时那一格照旧往下跑，" +
        "红的形态是几十分钟之后一句 `timeout of 8640000ms exceeded`，读不到原因",
    ).toBeLessThan(testAt);
  });

  it("`每日单元测试` 是每日那一跑最后一个**会红的格**；其后只允许 `覆盖率上报` 这种报告型尾巴", () => {
    /* 业主口径：「将每日单元测试放最后，最容易出问题的放最后」。这是**覆盖面**不是偏好：CNB stage 串行且失败即停，而这一格是唯一会因本机负载红的 ——
     * 实测 `cnb-b0l-1k59op66t` 775 份只 1 份红在 `Test timed out in 30000ms`（同时另有两份在跑全量 vitest/eslint），其后三格全 `skipped` ⇒ 它排中间时一次抖动决定那三格这一天跑不跑。
     * 判**事实**顺序；逐条相等由上面那条判住，这里钉「最后会红的格」。2026-11-02 起 `覆盖率上报` 接在其后（报告型、非关键，被 skip 只少一次上报），约束对象仍是「会红的格不许在其后」。定时口迁 GA 后顺序判在手点那一口（同一份 `*daily_gates`）。 */
    const stages = pipelineStageNames(readRegisteredConfig(), "每日档（手动触发）");
    const last = stages.at(-1);
    expect(stages.length, "手点那一口解析不出 stage —— 这条顺序判据没有对象了").toBeGreaterThan(0);
    const idx = stages.indexOf("每日单元测试");
    expect(idx, "每日那一跑必须有 `每日单元测试`").toBeGreaterThanOrEqual(0);
    expect(
      stages.slice(idx + 1),
      "每日单元测试 之后只允许跟 覆盖率上报（报告型尾巴），不能再有会红的格",
    ).toEqual(["覆盖率上报"]);
    expect(
      last,
      `每日那一跑最后落到的应是报告型尾巴「覆盖率上报」（当前是「${last}」）。` +
        "把 `每日单元测试` 挪回中间 = 让一单条负载超时决定后面几格跑不跑；" +
        "要动这条顺序，先把「超时指纹 ⇒ 隔离复跑」那一档补上（任务里记着）",
    ).toBe("覆盖率上报");
  });

  it("`API 文档生成与自检` 只在每日档：push 侧不再即时判，每日档排在单元测试之前（ISSUE #2537）", () => {
    /* 2026-11-05 的口径变更：这一格从 push 撤到每日档 —— **PR 侧不再即时判**，
     * 最晚次日 01:00 暴露，暴露窗口 ≤24h。判三件事：
     *   ① push 清单里没有旧名（有人改回去要红）；
     *   ② 每日清单里有新名，且**在 `每日单元测试` 之前**（后者必须是最后一个会红的格）；
     *   ③ 每日块真的在、点的是同一份判据。
     * ⚠️「触发面 = typedoc 派生面」的对账**没有因为挪档而削弱**：它在
     * `tests/ci-incremental-gates.test.ts`（`INPUT_RES` 形态）与
     * `tests/docs-api-input-closure.test.ts`（面罩得住事实面）里照旧判着。 */
    const text = readRegisteredConfig();
    expect(
      registeredPushGateOrder(text),
      "「API 文档生成与自检」回到了 push 清单 —— 2026-11-05 起它只在每日档（ISSUE #2537：98% 触发率、40.9s 中位、占 30.6%）",
    ).not.toContain("API 文档生成与自检");

    const daily = registeredDailyGateOrder(text);
    const at = daily.indexOf("每日 API 文档生成与自检");
    const lastRed = daily.indexOf("每日单元测试");
    expect(
      at,
      "每日清单里没有「每日 API 文档生成与自检」—— 降频之后这一格没有执行者了",
    ).toBeGreaterThanOrEqual(0);
    expect(lastRed, "每日清单里没有「每日单元测试」").toBeGreaterThanOrEqual(0);
    expect(
      at,
      "「每日 API 文档生成与自检」必须排在「每日单元测试」之前 —— 后者必须是最后一个会红的格",
    ).toBeLessThan(lastRed);
    const block = stageBlock(text, "每日 API 文档生成与自检");
    expect(block, "每日档里解析不出「每日 API 文档生成与自检」这一格").toBeTruthy();
    expect(block).toContain("scripts/check-docs-api.cjs");
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

  it("`oxfmt 格式` 是**在跑**的那一档，不是停用（2026-11-05 起执行者是 GA）", () => {
    /* 这格曾在停用清单里（2026-10-16 让位给 E2E 调试）；ISSUE #2010 把它从本地钩子挪到平台侧接管，
     * 2026-11-05 薄化再把它从 CNB PR 档搬到 `.github/workflows/pr-gate.yml`（同一句命令）。
     * 两次搬的都是「判据 ⇄ 执行者」关系，判据本身一字未改。这里判三件事：
     * ① GA 真的跑了它；② 它不在 CNB 的停用清单里（那是「不许跑」，与搬走是两件事）；
     * ③ 它也不再以 stage 形态留在 PR 清单里 —— 留一份没人执行的 stage 正是这次要清掉的东西。 */
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pr-gate.yml"), "utf8");
    expect(
      workflow,
      "`.github/workflows/pr-gate.yml` 里没有 `check-format.cjs --changed` —— 2026-11-05 把" +
        "`oxfmt 格式` 从 CNB PR 档搬走后，它是这条判据唯一的执行者；两边都没有 = 没人跑它",
    ).toContain("node scripts/check-format.cjs --changed");
    const disabled = registeredDisabledGates(readRegisteredConfig());
    expect(
      disabled,
      "`oxfmt 格式` 还在 `COMFYAPP_CI_DISABLED_GATES` 里 —— 那一项是 2026-10-16 的临时" +
        "让位（恢复条件是 E2E 一绿 + 日志中文可读），与「搬执行者」不是同一件事；" +
        "此刻它是这条判据的唯一执行者，停用等于把它关掉",
    ).not.toContain("oxfmt 格式");
    expect(
      registeredGateOrder(readRegisteredConfig()),
      "`oxfmt 格式` 又出现在 `COMFYAPP_CI_GATES` 里 —— 2026-11-05 起它由 GA 执行，" +
        "在 PR 清单里再登记一份等于给同一件事记两次执行者（而这边没有任何 stage 会跑它）",
    ).not.toContain("oxfmt 格式");
  });

  it("慢 stage 带着量级余量的 `timeout` 预算（不然卡死要等满 2h 才有人知道）", () => {
    const text = readRegisteredConfig();
    const timeouts = stageTimeouts(text);
    /* 为什么点名这几格而不是所有 stage：其余都是秒级（`node scripts/check-*.cjs` 一族），加预算只是噪音；真正的成本集中在这四个，且它们恰好是实测挂过或最可能挂的。
     * `单元测试` 被**临时停用**时不在清单里 ⇒ 这里也不要求预算，预算跟着 stage 走，加回来（不再出现在停用清单）即自动恢复。
     * `生成态文档与源同步` 曾是第五个（#1981）：`--check --autofix` 要就地重渲染再判；2026-10-19 收进聚合档 `重档静态判据`。2026-11-05 那一格整格搬到 GA，本文件的预算判据不再点它（GA 的 job 自带 `timeout-minutes`）。
     */
    const disabled = registeredDisabledGates(text);
    /* ⚠️ `生产构建`（2026-10-18）与 `E2E 关键流程`（2026-10-19）**都从这一列摘掉了**，不是因为预算可以不要：它们只在每日档（`每日生产构建` / `每日全量E2E`）。
     * 它们的预算与入口形态由「定时那一跑」那条判据钉；这里再留两个不存在的名字只会是空话。
     * 「谁加回 PR 却不给预算」由 `MUST_ALWAYS_RUN`（`ci-incremental-gates`）与 `.gates` 那两段撤档说明看着。 */
    const required = [
      "ESLint 零警告",
      "单元测试",
      /* `GitHub 判决回读` 墙钟上限就是它的轮询预算（45m）—— 零构建但**不**是秒级，
       * 节点 egress 抖动的现场它会顶满预算跑，预算缺席时卡死要等满 2h 才有人知道。 */
      "GitHub 判决回读",
      // 2026-11-02 `受影响用例` / `固定结构用例` 从 PR 撤到每日全量单测（见 GATE_TIER_LEDGER
      // 的 retired 段）：这两个 PR stage 不再存在，预算要求随之解除。
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
      const m = /^(?<amount>\d+)(?<unit>[smh])$/.exec(raw);
      expect(m, `${name} 的 timeout 写法认不出：${raw}`).not.toBeNull();
      if (!m) {
        continue;
      }
      const unit = m.groups?.unit;
      const minutes =
        Number(m.groups?.amount ?? 0) * (unit === "h" ? 60 : unit === "s" ? 1 / 60 : 1);
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
    if (template === null) {
      return;
    }
    // ① 代入的变量必须在白名单里 —— `CNB_BRANCH` 正是那个会退化成目标分支的。
    const used = [...template.matchAll(/\$\{?(?<name>[A-Za-z0-9_]+)\}?/g)].map(
      (m) => m.groups?.name ?? "",
    );
    const stray = used.filter(
      /* SAFETY: 类型断言已复核 */
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

  /* ── 锁按**触发类**分开（ISSUE #2114 第二条死因）─────────────────────── 上一条判「PR 之间不许互掐」（#1981：PR #1980 掐了 #1982）；这一族判另一半：
   * `CNB_PULL_REQUEST_IID` 在非 PR 事件上无值 ⇒ 所有非 PR 落回同一把 `pr-`，而非 PR 流水线从一条长到九条（合并复核 + 每日三触发口 + 单跑六条），前提写在注释里被推翻。
   * 现场：`cnb-5j9-1k5bc4p4u` 的每日单元测试差 3 秒被 push 掐掉；`cnb-lm1-1k5h1otqt` 的按需复验 244.06s 被无关 push 掐掉（差 0.2 秒）。 */
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
    expect(rows.filter((r) => r.event !== "pull_request").length).toBeGreaterThanOrEqual(9);
    /* 三条每日触发口仍然同一把（那份互斥是刻意保留的，不是被这次改动顺手拆掉的）。
     * 这里**不钉事件名清单** —— 「有没有定时口」由「定时档不在本机、在 GA」那条管，
     * 这里只管锁。定时口迁走之后 `lock_daily` 归手点 / API 两口共用，仍是同一件事。 */
    const daily = rows.filter((r) => r.lockRef === "lock_daily");
    expect(daily.length).toBe(2);
    expect(new Set(daily.map((r) => r.stagesRef)).size).toBe(1);
    expect(daily.every((r) => r.event !== "pull_request")).toBe(true);
    /* 单跑：同一档的 web 与 api 各引用同一把、且引用同一份 stage 清单。 */
    /* SAFETY: 类型断言已复核 */
    for (const suffix of ["build", "e2e", "unit"] as const) {
      const same = rows.filter((r) => r.lockRef === `lock_oneshot_${suffix}`);
      expect(same.length, `单跑 ${suffix} 那两条应有一把共用的类锁`).toBe(2);
      expect(new Set(same.map((r) => r.stagesRef)).size).toBe(1);
    }
  });

  /**
   * 反向自检：这一族五条规则各喂一个坏形状，都必须被抓到。用**自带最小配置**而不是改现役 `.cnb.yml`（近两千行，替换没命中会被伪装成判据过了，本仓栽过）。
   * 夹具的五条流水线形状与现役一致（分支键 2 空格、项内 6 空格、`- <<: *common`），所以它同时是**解析器本身**的活体证据 —— 那 4 条收不齐，后面每条断言都无从谈起。
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
      "  wait: true",
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
    expect([...lockAnchorDefinitions(fixture).keys()]).toEqual(["lock_push", "lock_daily"]);
    expect(lockClassViolations(fixture)).toEqual([]);

    /* ⑦ 探针三条**不吃锚点**、各自带 `runner`，而 `lock:` 只在**当前项之内**算数：解析器必须在它自己的 `name:` 上收口，否则上一条的 `lock:` 会被带进下一条。
     * 于是「B/C 故意一条锁都不写」没有对象、A 的 `false` 也测不到要测的锁（`.cnb.yml` 那段注释早点了这个坏形态）。
     * 顺带钉住例外**边界**：豁免只覆盖「漏写」与「一条都不写」，别的规则一条都不放过。 */
    const probeFixture = (o: { cancel?: string | null; extra?: string; probeB?: string }) =>
      [
        ".common: &common",
        "  lock:",
        "    key: pr-$CNB_PULL_REQUEST_IID",
        "    cancel-in-progress: true",
        ".lock-push: &lock_push",
        "  key: push",
        "  cancel-in-progress: false",
        "  wait: true",
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
      pipelineLockAssignments(probeFixture({})).map((r) => `${r.event}|${r.lockRef ?? "(没写)"}`),
    ).toContain("api_trigger_probe_a|lock_probe_a");
    expect(
      pipelineLockAssignments(probeFixture({})).map((r) => `${r.event}|${r.lockRef ?? "(没写)"}`),
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
      lockClassViolations(
        probeFixture({}).replace("  key: probe-2363-a", "  key: probe-$CNB_BRANCH"),
      ).join("\n"),
      "例外不覆盖 key 形态：带变量照旧点名",
    ).toContain("带变量");

    // ① R1：有人**忘了写覆盖** ⇒ 那条流水线静默回落到 `pr-`，正是被修掉的那个形态。
    const forgotten = fixture.replace("      lock: *lock_push\n", "");
    expect(lockClassViolations(forgotten).join("\n")).toContain("没有显式的 lock 覆盖");

    // ② R3：两个**不同的工作清单**被并进一把锁 ⇒ 单跑会掐掉每日（本条要拦的形状）。
    const merged = fixture.replace(
      ".lock-daily: &lock_daily\n  key: daily\n",
      ".lock-daily: &lock_daily\n  key: push\n",
    );
    expect(lockClassViolations(merged).join("\n")).toContain("份不同的 stage 清单共用");

    // ③ R2：类锁**漏写** `cancel-in-progress` ⇒ 重复排队收不成一条，而不报错。
    const noCancel = fixture.replace(
      ".lock-daily: &lock_daily\n  key: daily\n  cancel-in-progress: true\n",
      ".lock-daily: &lock_daily\n  key: daily\n",
    );
    expect(lockClassViolations(noCancel).join("\n")).toContain("没有显式写 cancel-in-progress");

    // ③′ R6 的前一半：`push` 那把写回 `true` ⇒ 前一笔 push 的复核读数被销毁（ISSUE #2396 的形态）。
    const pushCancels = fixture.replace(
      "  key: push\n  cancel-in-progress: false",
      "  key: push\n  cancel-in-progress: true",
    );
    expect(lockClassViolations(pushCancels).join("\n")).toContain("cancel-in-progress 不是 false");

    // ③″ R6 的后一半：`wait: true` 被摘掉 ⇒ 两跑重叠时**后到那一跑**在 Prepare 里直接红
    // （ISSUE #3207 的现场形态：`cnb-o1g-1k6m7jj8q` 405ms 判 error、6 格全 skipped）。
    // 这一形必须单独点名 —— 只判 `cancel-in-progress` 时它一个字都不响，而那正是线上那笔。
    const pushNoWait = fixture.replace(
      "  cancel-in-progress: false\n  wait: true\n",
      "  cancel-in-progress: false\n",
    );
    expect(lockClassViolations(pushNoWait).join("\n")).toContain("没有写 wait: true");
    // 写 `wait: false` 与漏写在配置里长得不像、在语义上是一件事（平台默认就是 false）。
    const pushWaitFalse = fixture.replace("  wait: true\n", "  wait: false\n");
    expect(lockClassViolations(pushWaitFalse).join("\n")).toContain("没有写 wait: true");

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
    expect(lockClassViolations(degenerate).join("\n")).toContain("与非 PR 退化 / PR 那把逐字相同");
    const prCollapses = fixture.replace(
      "    key: pr-$CNB_PULL_REQUEST_IID\n",
      "    key: pr-$CNB_DEFAULT_BRANCH\n",
    );
    expect(lockClassViolations(prCollapses).join("\n")).toContain("与 PR 编号无关");

    /* ⑥ 解析器不许假装通过。两种「没有对象」是两件不同的事，都必须出声：
     *    · 没有 `.common.lock.key` ⇒ 全档回落到平台默认 key（#1981 那个 bug 的形状）；
     *    · 有 `.common` 但 `master:` 下一条流水线都收不出来 ⇒ 判据在空转。 */
    expect(lockClassViolations("master:\n").join("\n")).toContain("没有 `lock.key`");
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
    /* 这形态发生过两次：上报在 #623 删旧流水线时被一起拿走、#1959 重建时没带回来 ⇒「洞察 → 单元测试覆盖率」永远「无 / 无」而没有任何一步红（少一条执行者与「还没跑过」长得一样）。
     * 2026-10-19 起它收进聚合档 `重档静态判据`：① 在条目表里且入口在盘上；② 缺 `coverage/lcov.info` 时只跳过不判红（`单元测试` 临时停用，判红会让停用连带拦死整条流水线）。
     * ⚠️ 2026-10-22 订正：它**恢复成独立活 stage** —— 聚合档读钩子注册表，而它 2026-10-16 已从钩子撤走 ⇒ 那格从没跑它，平台覆盖读数从那天起没人写而两张登记表互核全绿；现为报告型、无 `ifModify`。 */
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
    expect(script, "那个脚本必须有一个「没有报告」的出口，且在缺报告时**不退非零**").toMatch(
      /没有报告/,
    );
  });

  it("定时档不在本机、在 GA：CNB 无 crontab，GA 两条 schedule 在，手动口仍跑同一份清单", () => {
    /* 定时重档的执行者从这台自托管机迁到 GitHub Actions 之后，「有没有每天跑一次」
     * 换了地方，判据不能跟着松掉 —— 三件各自会静默失效的事实仍要逐项钉：
     *
     *   ① CNB 配置里**不许**再有 `crontab:` 事件。留一条空占位最危险：平台不报错、
     *      只是永远不触发，而配置看上去仍像有定时档（#1229 那一族）；本机白扛负载
     *      或两边都不跑，账面一条红都不会有。
     *   ② GA 侧 `daily.yml` / `package-desktop.yml` 必须各有 `schedule`，且 cron 对位
     *      北京 01:00 / 03:00（GitHub cron 用 UTC ⇒ 17:00 / 19:00 前一天）。少一条 =
     *      本机已撤定时、那边又没人起，这一档就真的没有执行者了。
     *   ③ 留在 CNB 的手点口仍跑 `COMFYAPP_CI_DAILY_GATES` 那份清单，跑法脚本与
     *      timeout 预算一字不动 —— 撤的是「时钟起它」，不是把判据本身撤掉。 */
    const text = readRegisteredConfig();
    expect(
      crontabEvents(text),
      "`.cnb.yml` 里又出现了 crontab 事件 —— 定时重档已迁 GA，本机不该再被时钟起",
    ).toEqual([]);
    expect(text, "配置里少了「定时档已迁 GA」的说明锚点 —— 撤定时是决策，不是顺手删两行").toMatch(
      /定时档的执行者已从这台机迁到 GitHub Actions/,
    );

    const dailyYml = readFileSync(path.join(ROOT, ".github/workflows/daily.yml"), "utf8");
    const packageYml = readFileSync(
      path.join(ROOT, ".github/workflows/package-desktop.yml"),
      "utf8",
    );
    expect(dailyYml, "`.github/workflows/daily.yml` 没有 schedule —— 每日档从此无人执行").toMatch(
      /^\s*schedule:\s*$/m,
    );
    expect(dailyYml, "每日档的 cron 不是北京 01:00（UTC 17:00）").toMatch(
      /cron:\s*"0 17 \* \* \*"/,
    );
    expect(packageYml, "`.github/workflows/package-desktop.yml` 没有 schedule").toMatch(
      /^\s*schedule:\s*$/m,
    );
    expect(packageYml, "桌包档的 cron 不是北京 03:00（UTC 19:00）").toMatch(
      /cron:\s*"0 19 \* \* \*"/,
    );

    const daily = pipelineStageNames(text, "每日档（手动触发）");
    expect(daily, "手点那一口解析不出 stage —— 「撤定时不撤判据」这句话就没有对象了").toEqual(
      registeredDailyGateOrder(text),
    );
    expect(
      registeredDailyGateOrder(text),
      "`COMFYAPP_CI_DAILY_GATES` 与手点那一口的 stage 对不上 —— 那一档跑什么就没有事实源了",
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
    /* 业主口径「桌包独立一条，不要并进每日 `*daily_gates` 表」；原话里的条数**不在这里记账**（#2878 同口径：写进注释而判据不读，漂了没人红；要数问 `.daily-gates` ⇄ `COMFYAPP_CI_DAILY_GATES`，见 §13.5.17）。
     * 落成三件会静默失效的事实：① 清单是**另一张锚点**（并进 `.daily-gates` 后每日会多背一次 cargo 编译）；② 锁是**另一把**（共用 `*lock_daily` 会让手点桌包掐停当日某一格，#2114 换方向复发）；
     * ③ 定时与手点两个触发口引用**同一个锚点** —— 抄第二份那一刻就开始漂。 */
    const text = readRegisteredConfig();
    /* 定时口已迁 GA，这里改从**手点那一口**取同一份 `*package_gates`：
     * 清单与锚点一字未动，撤的只是时钟。 */
    const stages = pipelineStageNames(text, "桌面成品包（手动触发）");
    expect(
      stages.length,
      "「桌面成品包（手动触发）」解析不出 stage —— 锚点没接上，或者流水线名被改了",
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
    ).toContain("pnpm tauri build");
    /* 由上面那一行直接推出来的那条安全前提（ISSUE #2883 把它变成判据，#2853 的期望 1 曾想反过来）：
     * 这一档**有**会真构建的格子 ⇒ 它的安装格**不许**接依赖缓存槽。接槽形态下 `node_modules` 是
     * 指向项目根之外的 junction，而 Turbopack 对这一条有硬要求（#2081 那次 13.8s 就死 + 后面整片
     * `skipped`）—— 与每日档、`单跑构建` 档同一口径。谁要接，先证明 #2521 的
     * `experimental.turbopackAdditionalRoots` 在**这一档**上跑得通，不是照别的档推。 */
    const packageInstall = stageBlock(text, "打包·安装依赖");
    expect(
      packageInstall,
      "`.cnb.yml` 里找不到「打包·安装依赖」那一格 —— 找不到就先断言找不到，" +
        "否则下面那条「不许出现 `COMFY_CI_SLOT`」会退成一句恒真的空判",
    ).toBeTruthy();
    expect(
      packageInstall ?? "",
      "「打包·安装依赖」出现了 `COMFY_CI_SLOT` —— 桌包这一档后面有真构建格（`pnpm tauri build` → " +
        "`build-desktop.mjs` → `pnpm build`），接槽会撞 #2081 那一形；要接得先验 #2521 的门",
    ).not.toContain("COMFY_CI_SLOT");

    /* 工具预置那一格（ISSUE #2525）：它在不在、点的是谁、以及**排在真打包之前**。
     * 顺序是判据的一部分 —— 预置跑在 `pnpm tauri build` 之后等于没有：那一格的
     * `timeout: global` 已经先把 nsis 判红了，而这一格退的是「没有结论」。 */
    const prefetch = stageBlock(text, "打包·桌包工具预置");
    expect(prefetch, "`.cnb.yml` 里找不到「打包·桌包工具预置」那一格").toBeTruthy();
    const prefetchEntry = "scripts/tauri-tools-cache.mjs";
    expect(prefetch, `预置那一格点的应是 ${prefetchEntry}`).toContain(prefetchEntry);
    expect(existsSync(path.join(ROOT, prefetchEntry)), `${prefetchEntry} 不在盘上`).toBe(true);
    const packageStages = pipelineStageNames(text, "桌面成品包（手动触发）");
    expect(
      packageStages.indexOf("打包·桌包工具预置"),
      "「打包·桌包工具预置」没在清单里 —— 那一格丢了就等于回到「构建期现下 GitHub release」",
    ).toBeGreaterThanOrEqual(0);
    expect(
      packageStages.indexOf("打包·桌包工具预置") < packageStages.indexOf("打包·桌面成品构建"),
      "工具预置排到了真打包之后 —— 那一刻 bundler 已经自己去撞那条下载预算了",
    ).toBe(true);

    const rows = pipelineLockAssignments(text).filter((r) => r.stagesRef === "*package_gates");
    expect(
      rows.map((r) => r.event).sort(),
      "桌包档在 CNB 只剩 `web_trigger_package` 一个触发口（定时已迁 GA；按钮在 `.cnb/web_trigger.yml`）",
    ).toEqual(["web_trigger_package"]);
    expect(
      new Set(rows.map((r) => r.lockRef)).size,
      "同一份清单的触发口点的不是同一把锁 —— 同一件事会被排成两次互掐",
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
    expect(script, "「每日单元测试」没有 `script` —— 那一格根本不会跑任何命令").toBeTruthy();
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
      expect(script, `「每日单元测试」带了 ${forbidden} —— 那不是整档，跑绿也不记账`).not.toContain(
        forbidden,
      );
    }
    /* 预算必须**大于**脚本自己的墙钟预算：否则先被掐的是 stage，而那一刀不带
     * 「被预算砍 vs 判据红」的分流话术（`classifyOutcome`），读起来就像判据红。 */
    const minutes = stageBudgetMinutes(stageTimeouts(text).get("每日单元测试"));
    expect(minutes, "「每日单元测试」没有 `timeout` 预算（一天的量级，卡死要早报）").toBeTruthy();
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
    expect(script, "「每日全量E2E」没有 `script` —— 那一格根本不会跑任何命令").toBeTruthy();
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
      expect(script, `「每日全量E2E」带了 ${forbidden} —— 那不是整档，跑绿也不记账`).not.toContain(
        forbidden,
      );
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
      const stage = String(track.ciStage).trim();
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
    /* `FRESHNESS_TRACKS[*].subject` 答「**这一次是谁在判**」：`"pr"` = 本 PR（工作树那份账，PR 流水线与本地钩子），`"master"` = 主干（每日档在 master HEAD 上跑出的那份，权威副本在 `ci/freshness-ledger`）。
     * ⚠️ 主体=master ⇒ 那一档的账是主干的账 ⇒ 执行者必须落在**每日档**（每天 00:00 刷新），PR 流水线里没有也不该有；否则「那一档没人判」无人回答，失效形态是「PR 拿主干的账判红别人的提交」。
     * ⚠️ **不**断言「它不许出现在 PR 清单」：`ciStage` 记的是每日格名，那条断言恒真 = 空转；PR 侧格名（`新鲜度账`）由 `PR_MOVED_TO_DAILY` 与 `tests/doc-check-hook-wiring.test.ts` 那条判。
     */
    const text = readRegisteredConfig();
    const dailyOrder = registeredDailyGateOrder(text);
    expect(
      dailyOrder.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 这条判据就没有对象了",
    ).toBeGreaterThan(0);
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      const subject = String(track.subject).trim();
      expect(
        ["pr", "master"],
        `${kind}.subject 写成了「${subject}」—— 只认 pr / master（主体答的是「这一次是谁在判」）`,
      ).toContain(subject);
      const stage = String(track.ciStage).trim();
      expect(
        stage,
        `\`${kind}\` 没有登记平台侧执行者（ciStage）—— 那一档现在没有任何执行者`,
      ).toBeTruthy();
      if (subject !== "master") {
        continue;
      }
      expect(
        dailyOrder,
        `「${stage}」（${kind}，主体=master）不在 \`COMFYAPP_CI_DAILY_GATES\` 里 —— ` +
          "主干的账只能由每日档那一格刷新与判读；它不在那儿，这一档就没人判了",
      ).toContain(stage);
    }
  });

  it("定时那一跑的前提格：安装、Python、库表都必须排在单测之前", () => {
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
  });

  /**
   * 「同一份实现长在几条流水线上」的对账（`CROSS_LANE_SCRIPT_MIRRORS`）：命令行 / env 赋值 / `timeout` 三样一样都不能少。
   * 命令行取「真正会执行的那些行」（块脚本注释与空行不算，散文本就该不同，漂移藏在命令行）；env 赋值两侧各配一份就是各自判两件事；
   * `timeout` 是唯一「改了不会被任何一行命令读出来」的一行 —— `.cnb.yml` 那两段注释一直声称它在比对面里而此前**不在**，现在才有执行者（#2851）。
   */
  it("跨档同形格：命令行 / env / timeout 三样逐字相同，唯一的 env 例外是登记过的那一行", () => {
    const text = readRegisteredConfig();
    const timeouts = stageTimeouts(text);
    for (const [lane, pr] of CROSS_LANE_SCRIPT_MIRRORS) {
      const laneScript = executableScriptLines(text, lane);
      const prScript = executableScriptLines(text, pr);
      const laneEnv = stageEnvAssignments(text, lane);
      const prEnv = stageEnvAssignments(text, pr);
      expect(
        [...laneScript, ...laneEnv],
        `「${lane}」这一格取不到 script/env —— 它被删了、改了名，还是整块没了`,
      ).toBeTruthy();
      expect(
        [...prScript, ...prEnv],
        `PR 那一跑里找不到「${pr}」的 script —— 镜像判据两边都要取得到，否则它是空转`,
      ).toBeTruthy();
      /* 例外那一半先按**形状**判（名单里的键必须只在 PR 侧、且必须是「置着」的形状），
       * 再把那几行剥掉 —— 剩下的仍然走同一条逐字相同。顺序要紧：先判形状，
       * 「那一格被人补回了开关」才会被读成那句，而不是被 toEqual 报成一堆行的差。 */
      const onlyOnPr = DAILY_ENV_ONLY_ON_PR[lane] ?? [];
      expect(
        checkPrOnlyEnvExceptions(laneEnv, prEnv, onlyOnPr),
        `${lane} 与 ${pr} 之间的 PR-only env 例外形状不成立`,
      ).toBeNull();
      expect(
        [...laneScript, ...dropPrOnlyEnvLines(laneEnv, onlyOnPr)],
        `「${lane}」与 PR 那一格的**命令行与 env 赋值**不再逐字相同 —— 判据是同一份脚本、` +
          "取字节的根也是同一个，改一边不改另一边就是两条流水线各自漂（§12.12 的孪生形态，" +
          "只是它长在配置里）。登记在 DAILY_ENV_ONLY_ON_PR 的那几行是唯一放开的差别，其余一字不动",
      ).toEqual([...prScript, ...dropPrOnlyEnvLines(prEnv, onlyOnPr)]);
      /* `timeout` 单独一条断言，不塞进上面那个数组：混在一起时红报出来是「一堆行的差」，
       * 读的人要自己找哪一行是预算；分开报，红字直接说出漂的是墙钟还是命令行。 */
      expect(
        timeouts.get(lane) ?? "(没写)",
        `「${lane}」的 timeout 与 PR 那一格「${pr}」不是同一个数（现在：${
          timeouts.get(lane) ?? "(没写)"
        } ⇄ ${timeouts.get(pr) ?? "(没写)"}）—— 墙钟是那条链上唯一改了不会被命令行读出来的一行`,
      ).toBe(timeouts.get(pr) ?? "(没写)");
    }
  });

  it("PR-only env 例外不是空转：四种坏形状都要被点名，而现役形状必须过", () => {
    const keys = ["COMFY_CI_SLOT"];
    const healthyPr = ['COMFY_CI_SLOT: "1"'];
    // 对照组：现役那份形状（PR 置着、每日一个字都没有）必须判成合法 ——
    // 否则这条判据就成了恒红，而恒红的判据与没有判据在账面上同形。
    expect(checkPrOnlyEnvExceptions([], healthyPr, keys)).toBeNull();
    // ① 每日那一格被人补回了开关（这正是本次要挡回去的那一步）。
    expect(checkPrOnlyEnvExceptions(['COMFY_CI_SLOT: "1"'], healthyPr, keys)).toContain(
      "每日那一格又写上了",
    );
    // ② 写成「关掉的开关」同样不行：它读起来像「这里本来就该有一行」。
    expect(checkPrOnlyEnvExceptions(['COMFY_CI_SLOT: "0"'], healthyPr, keys)).toContain(
      "每日那一格又写上了",
    );
    // ③ PR 那一格被摘干净 ⇒ 名单过期，必须点名而不是静默放行。
    expect(checkPrOnlyEnvExceptions([], [], keys)).toContain("名单过期了");
    // ④ PR 那一格还在，但不再是「置着」的形状 ⇒ 例外被改成了「随便漂」。
    expect(checkPrOnlyEnvExceptions([], ['COMFY_CI_SLOT: "0"'], keys)).toContain(
      "不再是「置着」的形状",
    );
    // 同一个键写两遍（YAML 静默覆盖）也要被抓住。
    expect(
      checkPrOnlyEnvExceptions([], ['COMFY_CI_SLOT: "1"', 'COMFY_CI_SLOT: "0"'], keys),
    ).toContain("同一个键写两遍");
    // 名单为空时不误伤：形状检查一条都不该响。
    expect(checkPrOnlyEnvExceptions(["A: 1"], ["A: 1"], [])).toBeNull();
    // 剥行那一步只剥名单里的键，其余一字不动（否则「逐字相同」会被悄悄放宽）。
    expect(
      dropPrOnlyEnvLines(['COMFY_CI_SLOT: "1"', 'PLAYWRIGHT_DOWNLOAD_HOST: "x"'], keys),
    ).toEqual(['PLAYWRIGHT_DOWNLOAD_HOST: "x"']);
    expect(dropPrOnlyEnvLines(['B: "1"'], [])).toEqual(['B: "1"']);
    // 脚本行不会被误认成 env 赋值（`$enc=…` / `node …` 都没有 `KEY:` 那个形状）。
    expect(envAssignmentKey("$enc=[Text.Encoding]::UTF8")).toBeNull();
    expect(envAssignmentKey("node scripts/db-push.mjs")).toBeNull();
    expect(envAssignmentKey('  COMFY_CI_SLOT: "1"')).toBe("COMFY_CI_SLOT");
  });

  it("「这一档有没有构建格」那张表不是空转：正例点得出格名，现役写法不误伤", () => {
    /* 正例：构建那一跳出现过专用入口 / `pnpm build` 字面 / 直接点 `build-desktop.mjs` / **经 tauri 间接触发**，每一种都要被认出来 —— 认不出的表等于给接槽的安全前提留了「加了构建格而没人红」的门。
     * ⚠️ 第四例（#2883）原写理想形态 `node tools/build/build-desktop.mjs --release`，而现役是 `pnpm tauri build`（`build-desktop.mjs` 名在 `tauri.conf.json` 的 `beforeBuildCommand` 与 `.cnb.yml` 的**注释**里，两者都不在输入面）。
     * 用例于是绿着，而它对现役配置的回答是假的：**正例必须长得像事实**。 */
    expect(
      stagesWithBuildConsumer(
        new Map([
          ["每日生产构建", ["node scripts/ci-cp936-exit.mjs -- node scripts/ci-daily-build.mjs"]],
        ]),
      ),
    ).toEqual(["每日生产构建"]);
    expect(stagesWithBuildConsumer(new Map([["构建", ["pnpm run next build"]]]))).toEqual(["构建"]);
    expect(
      stagesWithBuildConsumer(
        new Map([["桌包", ["node tools/build/build-desktop.mjs --release"]]]),
      ),
    ).toEqual(["桌包"]);
    expect(
      stagesWithBuildConsumer(
        new Map([["打包·桌面成品构建", ["node scripts/ci-cp936-exit.mjs -- pnpm tauri build"]]]),
      ),
      "经 tauri 间接触发的那一形没被认出来 —— 桌包档会被这张表判成「没有构建格」，" +
        "而它那一格真的在跑 `build-desktop.mjs` → `pnpm build`（`src-tauri/tauri.conf.json` 的 " +
        "`beforeBuildCommand`）⇒ 拿这张表去判断跑的档接不接槽，就会给出摘掉安全前提的答案",
    ).toEqual(["打包·桌面成品构建"]);
    /* 对**现役配置**判一次，而不是只对夹具判一次（这一句才是上面那枚标记的执行者）：
     * 桌包那一档必须被认成"有构建格"。取不到格名 ⇒ 先断言取到了，否则下面那条会退成恒真的空判。 */
    const configText = readRegisteredConfig();
    const packageStages = pipelineStageNames(configText, "桌面成品包（手动触发）");
    expect(
      packageStages.length,
      "解析不出桌包手点那一口的 stage 名单 —— 下面那条判据就没有对象了",
    ).toBeGreaterThan(0);
    expect(
      stagesWithBuildConsumer(
        new Map(packageStages.map((n) => [n, executableScriptLines(configText, n)])),
      ),
      "桌包那一档里按现役配置认不出构建格 —— 那张表的量程又比它自称的小了一圈（#2883）",
    ).toContain("打包·桌面成品构建");
    /* 反例：现役 push 清单里那几格的样子（安装 / typedoc / 文档对账 / 读 git 的脚本）。
     * 其中 `安装依赖` 那一行含 `ci-install-deps.mjs` —— 名字里带 "install"，别把它读成构建。 */
    expect(
      stagesWithBuildConsumer(
        new Map([
          [
            "合并形态复核",
            [
              "node scripts/ci-cp936-exit.mjs -- node scripts/check-branch-guard.cjs --merge-commit",
            ],
          ],
          ["安装依赖", ["node scripts/ci-cp936-exit.mjs -- node scripts/ci-install-deps.mjs"]],
          [
            "API 文档生成与自检",
            ["node scripts/ci-cp936-exit.mjs -- node scripts/check-docs-api.cjs"],
          ],
          [
            "工作区出处",
            ["node scripts/ci-cp936-exit.mjs -- node scripts/ci-workspace-provenance.mjs"],
          ],
        ]),
      ),
    ).toEqual([]);
  });

  it("从 PR 撤下来的环境格，每一格在每日那一跑里都有同名执行者（撤拦 ≠ 撤账）", () => {
    /* 2026-10-19 口径：只判**节点**的格不必每个 PR 都判（13.8s / 2.8s / 3.0s / 3.0s，逐格读数来自合并前那一跑的 stage 表）。**撤的是节奏，不是账**，判据是这句的机器形式：
     * ① 不在 PR 清单里（否则同时是两份执行者，镜像判据失去对象）；② 每日清单有 `每日<名>` 那格；③ 那格点的仍是**同一个入口脚本**、共用脚本时带**那个分档旗标**。
     * 少了③，「撤到每日档」与「悄悄删掉」逐字同形：名字还在清单上、块换成别的命令，两边都绿而那一格谁都不判了。 */
    const text = readRegisteredConfig();
    const prOrder = registeredGateOrder(text);
    const dailyOrder = registeredDailyGateOrder(text);
    expect(prOrder.length, "解析不出 COMFYAPP_CI_GATES —— 这条判据就没有对象了").toBeGreaterThan(0);
    expect(
      dailyOrder.length,
      "解析不出 COMFYAPP_CI_DAILY_GATES —— 这条判据就没有对象了",
    ).toBeGreaterThan(0);
    for (const [former, dailyName, entry, flag] of PR_MOVED_TO_DAILY) {
      expect(
        prOrder,
        `「${former}」又回到 PR 清单里了 —— 那意味着它同时是两份执行者，` +
          "`CROSS_LANE_SCRIPT_MIRRORS` 必须同批把它加回相同性判据，两处不能各说一套",
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
      expect(command, `「${dailyName}」点的入口不是 ${entry}：撤档不等于换判据`).toContain(entry);
      if (flag !== "") {
        expect(
          command,
          `「${dailyName}」丢了 ${flag} —— 它与别的格共用同一份脚本，是这一面旗标把它分成另一格`,
        ).toContain(flag);
      }
    }
  });

  it("门格总账：每一格的档位登记 ⇄ 三份清单实际在跑的格名（双向相等，#2640）", () => {
    /* §13.5.30 把「某格该属哪一级」判成工程判断，但「撤出后必须登记、且登记名不许还在跑」可以判；`GATE_TIER_LEDGER` 就是册子（档位手写登记）。
     * ① 三份清单 ⇄ 总账双向相等（清单多/少一格而总账没同批改、或总账漏登记都红 —— 这正是「两边一起被删」时仍绿的那个洞）；
     * ② `retired` 的格不许再出现在任何清单里（降级≠删除），且必须带理由。 */
    const text = readRegisteredConfig();
    const prOrder = new Set(registeredGateOrder(text));
    const pushOrder = new Set(registeredPushGateOrder(text));
    const dailyOrder = new Set(registeredDailyGateOrder(text));
    const running = new Set([...prOrder, ...pushOrder, ...dailyOrder]);

    const tiers: Array<[GateTier, Set<string>, string]> = [
      ["PR", prOrder, "COMFYAPP_CI_GATES"],
      ["push", pushOrder, "COMFYAPP_CI_PUSH_GATES"],
      ["daily", dailyOrder, "COMFYAPP_CI_DAILY_GATES"],
    ];
    for (const [tier, actual, envKey] of tiers) {
      const booked = new Set(GATE_TIER_LEDGER.filter((e) => e.tier === tier).map((e) => e.name));
      expect(
        [...booked].sort(),
        `门格总账记成 ${tier} 档的格 ⇄ ${envKey} 实际在跑的格名不一致（` +
          "多/少了一格却没同批改总账，或登记漏了这一格）",
      ).toEqual([...actual].sort());
    }

    for (const entry of GATE_TIER_LEDGER.filter((e) => e.tier === "retired")) {
      expect(
        running.has(entry.name),
        `「${entry.name}」记成 retired（降级登记）却仍出现在某份清单里 —— ` +
          "降级≠删除，撤档必须同批改总账；否则与「悄悄删掉」逐字同形（§13.5.30）",
      ).toBe(false);
      expect(
        (entry.note ?? "").trim(),
        `「${entry.name}」进了降级登记却没有理由 —— 观察登记必须写下「为什么撤、撤到哪」`,
      ).not.toBe("");
    }
  });

  /**
   * 「每日档红 ⇒ 自动立案」这格不能只在清单上有个名字（ISSUE #2274）：上一条管「撤下的格还在不在」，这条管**新加那格点的还是同一个入口**。
   * 名字还在、块被换成别的命令，两边都绿而自动立案谁都不做 —— 那是这一族（判据在场、执行者不在场）唯一的失效形态。
   * 位置也钉：必须排在所有可能红的格**之前**，否则被前面那次红一起 `skipped`（平台没有可依赖的条件语法，今天只有 `ifModify`）。
   */
  it("每日链里必须有一格点的是 `ci-daily-failure-issue.mjs --no-block`，且排在最前", () => {
    const text = readRegisteredConfig();
    const lines = executableScriptLines(text, "每日失败立案");
    expect(lines, "配置文件里没有「每日失败立案」这一格 ⇒ 自动立案没有执行者了").toBeTruthy();
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
    expect(ciConfigsAmong([".github/workflows"])).toEqual([".github/workflows"]);
    // ② 反向锚点判据在缺文案时确实会红。
    expect(missingAnchors("package.json", ["不可能出现的句子"])).toEqual(["不可能出现的句子"]);
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
      ps7OnlySyntaxIn("master:\n  push:\n    - script: |\n        $x = $o?.Source\n"),
    ).toHaveLength(1);
    expect(
      ps7OnlySyntaxIn(
        "master:\n  push:\n    - script: |\n        # 不许写 ?. （PS 7 only）\n        $x = 1\n",
      ),
    ).toEqual([]);
    // 块外的同形文本不许被算进来（缩进收口真在起作用）。
    expect(ps7OnlySyntaxIn("master:\n  name: a?.b\n    - script: |\n        $x = 1\n")).toEqual([]);
    expect(PS7_ONLY.length).toBeGreaterThanOrEqual(4);
    /* ⑦ stage 顺序判据与探测入口判据都要能红：喂进一份「单元测试 排在 Python 后面」
     * 的配置时必须点名，喂进**没有那个键**的配置时必须答「解析不出」。 */
    const badOrder = "x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      单元测试, Python 可用性\n";
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
    expect(registeredDisabledGates(disabledFixture)).toEqual(["单元测试", "别的东西"]);
    expect(registeredDisabledGates("master:\n  push:\n    - x\n")).toEqual([]);
    // `GATES` 的内容不许被 `DISABLED_GATES` 的解析器收走（两个键的正则不能互相命中）。
    expect(
      registeredDisabledGates("x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      单元测试\n"),
    ).toEqual([]);
    expect(
      registeredGateOrder("x:\n  env:\n    COMFYAPP_CI_DISABLED_GATES: >-\n      单元测试\n"),
    ).toEqual([]);
    // 注释形态：整行被 `#` 注释掉才算「留了原文」；没注释的不算、名字不同的不算。
    expect(
      stageKeptAsComment("x:\n  stages:\n  #   - name: 单元测试\n  #     script: x\n", "单元测试"),
    ).toBe(true);
    expect(
      stageKeptAsComment("x:\n  stages:\n  - name: 单元测试\n    script: x\n", "单元测试"),
    ).toBe(false);
    expect(stageKeptAsComment("x:\n  stages:\n  #   - name: 别的\n", "单元测试")).toBe(false);
    /* ⑧ 预算与流水线锁两条判据都要能红：喂进不带 timeout 的 stage 块、
     * 喂进不带 lock 的锚点，都必须答「没有」。 */
    // 夹具按**真实缩进**写：`stages:` 的直接子项是 2 空格、键在 4 空格。
    const noBudget = "x:\n  stages:\n  - name: 单元测试\n    script: x\n";
    expect(stageTimeouts(noBudget).has("单元测试")).toBe(false);
    const withBudget = "x:\n  stages:\n  - name: 单元测试\n    script: x\n    timeout: 45m\n";
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
      stageTimeouts("x:\n  stages:\n  - name: a\n    env:\n      timeout: 99m\n").has("a"),
    ).toBe(false);
    // 同级下一项开始后，上一项的 timeout 不许被算到它头上。
    expect(
      stageTimeouts(
        "x:\n  stages:\n  - name: a\n    timeout: 20m\n  - name: b\n    script: x\n",
      ).has("b"),
    ).toBe(false);
    expect(
      hasPipelineLockCancelInProgress(".common: &common\n  runner:\n    namespace: group\n"),
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
    expect(pipelineLockKeyTemplate(keyFixture)).toBe("pr-$CNB_PULL_REQUEST_IID");
    // 默认口径的那种写法（`$CNB_BRANCH`）也能被解析出来 —— 由调用方判它违规，
    // 不是靠「解析不出来」蒙过去。
    expect(
      pipelineLockKeyTemplate(".common: &common\n  lock:\n    key: $CNB_BRANCH-质量门禁\n"),
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
    expect(crontabEvents('master:\n  "crontab: 0 4 * * *":\n    - x\n')).toEqual([
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
      registeredDailyGateOrder("x:\n  env:\n    COMFYAPP_CI_DAILY_GATES: >-\n      每日生产构建\n"),
    ).toEqual(["每日生产构建"]);
    expect(registeredDailyGateOrder("master:\n  push:\n    - x\n")).toEqual([]);
    expect(
      registeredDailyGateOrder("x:\n  env:\n    COMFYAPP_CI_GATES: >-\n      每日生产构建\n"),
    ).toEqual([]);
    expect(
      registeredGateOrder("x:\n  env:\n    COMFYAPP_CI_DAILY_GATES: >-\n      每日生产构建\n"),
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
    expect(pipelineStageNames(fixture, "每日生产构建")).toEqual(["每日生产构建"]);
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
    expect(pipelineStageNames(aliased, "每日生产构建")).toEqual(["每日安装依赖", "每日全量E2E"]);
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
   * 某一格的**正文**（剥掉列表项自己那行 `name:`，再剥注释与空行，比 `script` / `env` / `timeout`）。
   * ① **名字不参与比较**：单跑那格本来就要另起不重名的名字，比名字等于比错的东西；
   * ② **注释不算漂移**：`stageBlock()` 会把下一格前的说明注释一起收进来，而每日那几格带着大量取证注释、单跑不该重抄。要比的是命令、env、预算。
   */
  function stageBody(text: string, name: string): string | null {
    const block = stageBlock(text, name);
    if (block === null) {
      return null;
    }
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
   * 锚点列表里（恰好两空格缩进的 `- name:`）出现**两次以上**的格名：`.daily-gates` / `.oneshot-*` / `.gates` 的 stage 项都在这一层。
   * `jobs:` 下的 Job 与所属 stage **同名是刻意的**（容器那格），更深缩进不算违规。要防「两条流水线里有两个同名 stage」——那会让按名取块的解析器读到哪个变成运气（`.cnb.yml` 里 `每日安装依赖` 那段注释记着同一件事）。
   */
  function duplicatedStageNames(text: string): Array<string> {
    const seen = new Map<string, number>();
    for (const m of text.matchAll(/^ {2}- name: (?<name>\S.*?)[ \t]*$/gm)) {
      const name = m.groups?.name ?? "";
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
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
      /* SAFETY: 类型断言已复核 */
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

  it("每个单跑格的正文与它对应的真身格逐字相同（副本不许漂）", () => {
    const text = readRegisteredConfig();
    for (const target of ONESHOT_TARGETS) {
      for (const pair of oneshotPairs(target)) {
        /* 真身默认是每日那一格；写了 `source` 的那一行跟着它登记的真身（目前只有
         * `单跑单测·安装依赖` → push 的 `安装依赖`，理由整段写在注册表头注里，#2853）。
         * 这里**不放宽比较面** —— 比的仍是同一个 `stageBody`（script / env / timeout），
         * 换的只是"与谁相同"。 */
        const sourceName = pair.source ?? pair.daily;
        const oneshotBody = stageBody(text, pair.oneshot);
        const dailyBody = stageBody(text, sourceName);
        expect(oneshotBody, `${pair.oneshot} 在配置里找不到那一项`).not.toBeNull();
        expect(dailyBody, `${sourceName} 在配置里找不到那一项`).not.toBeNull();
        expect(
          oneshotBody,
          `${pair.oneshot} 的正文与 ${sourceName} 不再逐字相同 —— 这就是「同一份脚本长在两条流水线上各漂一份」（ISSUE #2081 那一族）`,
        ).toBe(dailyBody);
      }
    }
  });

  /**
   * 接槽与构建消费者的线，**双向**都要有执行者（#2853 / #2883 / #2851）：① 安全前提 —— 置了 `COMFY_CI_SLOT` 的安装格，所在档后面**不许**有会真构建的格（junction 对 Turbopack 有硬要求，#2081 的 13.8s 死法）；
   * ② 防静默回退 —— 注册表里 `source` 指接槽那一族的格**必须真的**带那枚 env，否则「按判据它该接」与「配置里它接了」各自漂（摘掉那行不会有任何格红）。
   * ⚠️ 刻意**不**判逆命题（无构建格的档必须接槽）：`单跑E2E` 就是反例（无构建消费者，但后一格带 `COMFY_E2E_SERVER: start`，`.next` 从哪来没有读数，#2853 期望 2）；把「没判」写成「必须」就是拿配置在场抵一次没跑过的前提。
   */
  it("接槽开关与构建消费者两两对得上：置了的必须有没构建的格，注册表认了的必须真置着", () => {
    const text = readRegisteredConfig();
    /** 每档：流水线名 → 它那一格的安装格名（名字逐字取自身配置，不做拼接）。 */
    const laneInstall = [
      { pipeline: "master 合并复核", install: "安装依赖" },
      /* 两条定时口已迁 GA；接槽开关的形状判在留下来的**手点口**上，
       * 它们引用的是同一份 `*daily_gates` / `*package_gates`，结论不变。 */
      { pipeline: "每日档（手动触发）", install: "每日安装依赖" },
      { pipeline: "桌面成品包（手动触发）", install: "打包·安装依赖" },
      { pipeline: "单跑生产构建（手动触发）", install: "单跑构建·安装依赖" },
      { pipeline: "单跑全量E2E（手动触发）", install: "单跑E2E·安装依赖" },
      { pipeline: "单跑全量单测（手动触发）", install: "单跑单测·安装依赖" },
    ];
    /* 「这一格接了槽」认的是**那枚开关被置成 1**，不是"正文里出现过这个名字"：
     * 判据 `ci-install-deps.mjs` 读的是 `COMFY_CI_SLOT === "1"`，所以把键改名
     * （`COMFY_CI_SLOT_MUTATED: "1"`）或置成 `0` 都等于**没接**—— 用 `includes("COMFY_CI_SLOT")`
     * 去认，改名那一形会同时骗过这里两个方向（安全侧假装"接了"、防回退侧假装"真接了"）。
     * 单/双引号都认（env 值在 YAML 里两种写法等价），其余一律算"没接"。 */
    const slotOn = (body: string): boolean => /COMFY_CI_SLOT:\s*["']1["']/.test(body);
    for (const row of laneInstall) {
      const stages = pipelineStageNames(text, row.pipeline);
      expect(
        stages.length,
        `${row.pipeline} 那条流水线解析不出 stage —— 判据在这里没有对象`,
      ).toBeGreaterThan(0);
      const withBuild = stagesWithBuildConsumer(
        new Map(stages.map((n) => [n, executableScriptLines(text, n)])),
      );
      if (slotOn(stageBody(text, row.install) ?? "")) {
        expect(
          withBuild,
          `${row.pipeline} 的「${row.install}」把 \`COMFY_CI_SLOT\` 置成 1，而这一档后面有会真构建的格子` +
            `（${withBuild.join(" / ")}）—— 接槽形态下 Turbopack 会拒那条链（#2081 那一形）`,
        ).toEqual([]);
      }
    }
    /* 注册表指了 `source` 的那些格：它们跟着的是**接槽那一族**，就必须真把那枚开关置成 1。 */
    const followingSlotFamily = ONESHOT_TARGETS.flatMap((t) =>
      (Array.isArray(t.prereqs) ? t.prereqs : [])
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- 值来自 JSON/`as` 断言后的外部形状，类型按非空标，保留运行期防线
        .filter((p) => typeof p?.source === "string" && p.source !== "")
        .map((p) => p.oneshot),
    );
    expect(
      followingSlotFamily.length,
      "注册表里没有一格登记 `source` —— 上面那段因果就没有对象了（注册表被改回去而这里没跟上）",
    ).toBeGreaterThan(0);
    for (const name of followingSlotFamily) {
      const body = stageBody(text, name) ?? "";
      expect(
        slotOn(body),
        `「${name}」在注册表里跟着接槽那一族（source 指向置着开关的那一格），配置里却没把 ` +
          "`COMFY_CI_SLOT` 置成 1 —— 摘掉那一行不会有任何别处红，所以这一句要在这里红。" +
          `（该格正文：\n${body}）`,
      ).toBe(true);
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
    if (!e2e) {
      throw new Error("注册表里没有「每日全量E2E」那一行，这条自检没有基准");
    }
    const pipeline = e2e.pipelineWeb;
    const live = pipelineStageNames(text, pipeline);

    /* ① 漏一格：整项删掉（改名不算删 —— 改名之后清单还是四格，那条判据要抓的是
     * 「这一档根本没跑」，所以变异必须真的少一格）。 */
    const browserAt = text.indexOf("  - name: 单跑E2E·浏览器安装");
    const e2eAt = text.indexOf("  - name: 单跑E2E·全量E2E", browserAt);
    if (browserAt === -1 || e2eAt === -1) {
      throw new Error("单跑E2E 那张锚点表里找不到浏览器/目标那两格");
    }
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
    const collided = text.replace("  - name: 单跑E2E·安装依赖", "  - name: 每日安装依赖");
    expect(duplicatedStageNames(collided), "④ 重名必须被点名").toContain("每日安装依赖");

    /* 现役形状：四条判据一条都不许抓到东西（否则上面的「会变」是自证的假象）。 */
    expect(live).toEqual(oneshotGates(e2e));
    expect(duplicatedStageNames(text)).toEqual([]);
    for (const pair of oneshotPairs(e2e)) {
      expect(stageBody(text, pair.oneshot)).toBe(stageBody(text, pair.daily));
    }

    /* ⑤ 决定必须在规范正文里有原文（只长在配置里的决定等于没有决定）。 */
    expect(
      missingAnchors("docs/standards/13-提交与-code-review.md", ["单跑那一跑不是每日档的出勤"]),
    ).toEqual([]);
  });
});
