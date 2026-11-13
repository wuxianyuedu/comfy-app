/**
 * 平台侧自动触发的流水线配置：要么没有，要么必须是「自托管 + 已登记」的那一份（决策反转见 ISSUE #623 → #1229 → #1959，判据职责不变；本文件在每次提交都跑的固定清单里）。
 * 守三类形态：#1229 的 `分支: { 事件: [流水线] }`；`runner.namespace: group` + 非空 `tags`（漏掉 = 静默回落到计费平台池）；`pull_request` 与 `push` 两事件。
 * 反向注销：`scripts/doc-facts.cjs` 必须登记 `.cnb.yml`、规范留「为什么能回来」锚点；旧口径「本仓没有 CI」必须已改写（与 #1229 同形、方向相反）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/* 每个 stage 现在都以 `node scripts/ci-cp936-exit.mjs -- <真命令>` 起（ISSUE #1977），
 * 而下面那条「这一步点名的入口在不在盘上」判据抓的是 `scripts/…` —— 不剥外壳就会
 * 抓到外壳自己（它当然在盘上），判据从「接线对不对」退化成「外壳在不在」。
 * （#3504 起触发口在平台池容器里直跑 node，不再有这一层外壳；判据保留给
 * 仍在自托管宿主上跑的那几格。） */
/* 那两份清单的解析**搬进 `scripts/ci-gate-names.mjs`** 了 —— 判据脚本
 * `scripts/check-gate-name-executors.mjs` 也要读同一份清单，两边各写一遍就会漂开。
 * 这里保留转出（三个消费方 import 的是这个文件的导出）。 */
import {
  registeredDisabledGates as disabledGatesImpl,
  registeredGateOrder as gateOrderImpl,
} from "../scripts/ci-gate-names.mjs";
/* 触发口 ⇄ GA workflow 的配对注册表与「每日格 ⇄ GA step」对照是**数据**，一份出处在
 * `scripts/ci-ga-trigger-map.mjs`（#3504：CNB 侧不再执行任何构建，旧注册表
 * `ci-oneshot-gates.mjs` 随 `*oneshot_*` 锚点一并退役）。这里 import 它而不是在
 * 测试里重抄一遍 —— 重抄就成了「判据自己就是第二份事实」。 */
import {
  DAILY_GATE_EXECUTORS,
  GA_TRIGGER_TARGETS,
  dispatchStageName,
} from "../scripts/ci-ga-trigger-map.mjs";
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
 * 平台池镜像出口（ISSUE #3346 实验转正 / #3418；push 出口见 #3426）的**常驻例外** ——
 * 这两条刻意**上平台池**（自托管出网不稳，推送整个挪过去）。它们不吃 `*common`
 * 锚点（runner / docker / lock 全自带），所以锚点计数、锁计数两处要同额扣掉；
 * 名单不许泛化成「自带 runner 的都放行」（等于关掉判据）。不再有期限：删掉哪一条，
 * 对应事件就没有推送出口了。
 */
const HOSTED_MIRROR_PIPELINES = [
  "GitHub 镜像同步（平台池）",
  "GitHub master 镜像（平台池）",
] as const;

/** 质量门禁（#3478 起平台池例外）：主列只剩站内回读一格，形态见专用 describe。 */
const PR_GATE_PIPELINE = "质量门禁" as const;

/** GA 判决回调（#3529 起平台池例外）：CNB 侧最后一条离开自托管的流水线。 */
const VERDICT_PIPELINE = "GA 判决回调（骨架·休眠）" as const;

/** 从 `- name:` 那一行起，收到**下一个 2 空格事件键**为止（含 push 之后的事件）。 */
function nextEventAt(text: string, from: number): number {
  const rest = text.slice(from).split("\n").slice(1).join("\n");
  const m = /\n {2}[a-zA-Z_][\w"-]*:/.exec(rest);
  return m ? from + 1 + m.index : text.length;
}

/** 从某个顶层锚点（`.xxx: &xxx`）起，收到**下一个顶层锚点**为止。
 *  `.gates` 这类 stage 清单锚点没有「下一个事件键」可截，用它取正文段。
 *  锚点名必须带**前导点**（`.gates:`），否则起始行自己的残段（「gates: &gates」）
 *  会当场命中、把正文段截成空。 */
function nextAnchorAt(text: string, from: number): number {
  const rest = text.slice(from + 1);
  const m = /^\.[a-z][\w.-]*:\s*&/m.exec(rest);
  return m ? from + 1 + m.index : text.length;
}

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
 * 每日档的执行面自 #3504 起全部在 GA：`.github/workflows/daily.yml` 是「每天跑什么」
 * 的唯一事实源。逻辑格名 ⇄ step 名的对照登记在 `scripts/ci-ga-trigger-map.mjs` 的
 * `DAILY_GATE_EXECUTORS`（判据 import 它，不在这里重抄）。
 * 顺序即执行序（**重格链**单 job 串行，与 CNB 每日档同一工作区语义对齐）：
 *   单元测试排最后（业主口径「最容易出问题的放最后」）—— 「必须最后」由下面判据钉住。
 * ⚠️ 这份文件现在有**两个 job**：`daily`（重格链）与 `daily-failure-issue`（失败立案，
 * `needs: daily`）。所以「有没有执行者」与「谁排在谁前面」是两个不同的问题，各用各的取法：
 *   · 成员资格（总账 / 新鲜度 / 撤档对账）⇒ `gaDailySteps()`，**整份文件**的 step；
 *   · 顺序（前提格 / 尾巴 / 最后一个会红的格）⇒ `gaDailyJobSteps()`，**只 `daily` 那个 job**。
 * 混用会让顺序判据把另一个 job 的 step 也算进来 —— 那种红指不到真正的执行序。
 */
const DAILY_YML = ".github/workflows/daily.yml" as const;

/** GA workflow 的 steps 在 6 空格缩进层（`jobs.<id>.steps`）。 */
const GA_STEP_RE = /^ {6}- name: (?<name>.+?)[ \t]*$/gm;

/**
 * GA workflow 里某个 job 的块原文（从 `  <id>:` 行起，到下一个 2 空格缩进的非空行为止 ——
 * 那要么是下一个 job，要么是挂在它头上的注释段）；取不到给 null。
 */
function gaJobBlock(file: string, jobId: string): string | null {
  const text = readFileAt(ROOT, file);
  const marker = `  ${jobId}:`;
  const at = text.indexOf(`\n${marker}\n`);
  if (at === -1) {
    return null;
  }
  const start = at + 1;
  const after = start + marker.length;
  const next = text.slice(after).search(/\n {2}\S/);
  return next === -1 ? text.slice(start) : text.slice(start, after + next);
}

/**
 * `daily` 那一个 job 的 step 名有序清单 —— **顺序判据专用**（见上面那段两个 job 的分工）。
 * 取不到 job 块时给空数组，由调用方的「清单非空」前置断言接住（不静默恒放行）。
 */
function gaDailyJobSteps(): Array<string> {
  const block = gaJobBlock(DAILY_YML, "daily") ?? "";
  return [...block.matchAll(GA_STEP_RE)].map((m) => m.groups?.name ?? "");
}

/**
 * GA daily.yml 的 step 名有序清单（判据的匹配面就是这些**逐字**名字；
 * 改 step 名必须同批改 `DAILY_GATE_EXECUTORS` 与总账）。
 */
function gaDailySteps(): Array<string> {
  return [...readFileAt(ROOT, DAILY_YML).matchAll(GA_STEP_RE)].map((m) => m.groups?.name ?? "");
}

/** GA workflow 里某个 step 的块原文（从 `- name:` 行起到下一个 step 为止）；取不到给 null。 */
function gaStepBlock(file: string, name: string): string | null {
  const text = readFileAt(ROOT, file);
  const marker = `      - name: ${name}`;
  const start = text.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const next = text.indexOf("\n      - name:", start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

/**
 * GA daily.yml 里**不进门格总账**的前提设施 step：检出是 checkout 动作、装 pnpm /
 * 装 Node 是工具链准备，环境证据是 `if: failure()` 的诊断读数（恒不判红）。
 * 它们不是门格 —— 总账 ⇄ step 名双向对账时把这几行豁免掉（豁免名单是显式的：
 * 悄悄加一个「不判红也不立案」的 step 仍会被多出来的一格红）。
 * 后两行属于 `daily-failure-issue` 那个 job（#3563 起立案是下游 job）：它不装依赖，
 * 所以只有检出与装 Node 两件设施，没有「装 pnpm」。
 */
const GA_DAILY_INFRA_STEPS: ReadonlyArray<string> = [
  "检出",
  "装 pnpm（按 package.json 的 packageManager 钉死版）",
  "装 Node（engines 下限 26.12.1；镜像预装只到 24，必须显式）",
  "环境证据（失败时：dmesg 的 OOM 行 + 内存读数）",
  "检出（立案脚本在仓库里）",
  "装 Node（engines 下限 26.12.1；脚本只吃 node:*）",
];

/**
 * GA **PR 门禁** workflow（PR 主列的代码判据都在它里面）。
 *
 * 这一档是 2026-11-13 补的第四个面（ISSUE #3662）：此前总账只认三份清单
 * （CNB 的 PR / push / GA daily.yml），**GA 的 PR job 一处都不在** ⇒
 * 「记成 retired 却仍在 PR 上跑」这一形态对判据是隐形的。
 */
const PR_GATE_YML = ".github/workflows/pr-gate.yml" as const;

/**
 * GA pr-gate.yml 里**不进门格总账**的前提设施 step（与 `GA_DAILY_INFRA_STEPS` 同角色）。
 *
 * 逐条理由：
 *   · 检出 / 装 pnpm / 装 Node / cargo 缓存 —— 工具链准备，恒不判红（daily 段同款）。
 *   · `装 Tauri 的 Linux 系统依赖（壳门禁要在本机编 Tauri）` —— 前提铺装（#3572 /
 *     #3580）：它装的是壳门禁的**编译期依赖**，判红的是它后面那一步。
 *   · `安装依赖`（3 个 job）与 `安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）`
 *     （1 个 job）—— **每个 job 自己装一次**的前提设施：装不上 ⇒ 那个 job 红，
 *     读数已经在账上（daily 段那一条 `安装依赖（…）` 是**整跑一次**的安装 ⇒ 是门格）。
 *   · `失败时上传诊断产物` —— `if: failure()` 的诊断动作，恒不判红。
 *   · `把结论送回 CNB` / `把 GA 判红日志正文搬到 CNB` —— **判决的运输腿**
 *     （`continue-on-error: true`，不承重；承重退码在 CNB 侧的 `GA 回调结论回读`，
 *     那一条在 PR 段）。
 */
const GA_PR_INFRA_STEPS: ReadonlyArray<string> = [
  "检出（按镜像 payload 的 sha）",
  "检出（回调脚本在仓库里）",
  "装 pnpm（按 package.json 的 packageManager 钉死版）",
  "装 Node（engines 下限 26.12.1；镜像预装只到 24，必须显式）",
  "装 Node（engines 下限 26.12.1；脚本只吃 node:*）",
  "装 Tauri 的 Linux 系统依赖（壳门禁要在本机编 Tauri）",
  "cargo 缓存",
  "安装依赖",
  "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
  "失败时上传诊断产物",
  "把结论送回 CNB",
  "把 GA 判红日志正文搬到 CNB",
];

/**
 * GA pr-gate.yml 里**判红的那几格**的 step 名（逐字）—— ga-pr 档的名单。
 *
 * 取法与 daily 段同一份：`GA_STEP_RE` 现读工作流文件（不抄第二份，§12.18），
 * 再减掉前提设施豁免 ⇒ 「GA 的 PR 侧跑了什么」**从工作流文件本身读出来**。
 *
 * @returns {string[]} 逐字 step 名（重复的 job 同名 step 会在这里重复出现，判据侧用集合）
 */
function gaPrGateSteps(): Array<string> {
  return [...readFileAt(ROOT, PR_GATE_YML).matchAll(GA_STEP_RE)]
    .map((m) => m.groups?.name ?? "")
    .filter((name) => !GA_PR_INFRA_STEPS.includes(name));
}

/** 读仓库内文件（相对路径），集中一处方便阅读。 */
function readFileAt(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

/** 桌包档的 GA workflow（GA artifact + nightly Release + #3607 CNB 站内回传，#3504 起不再回写常驻目录）。 */
const PACKAGE_YML = ".github/workflows/package-desktop.yml" as const;

/**
 * 2026-10-19 从 **PR 那一条撤到每日档**的几格：`[PR 旧名, 每日逻辑名, 入口, 旗标]`。
 * 业主口径「只判断环境的不必每次都判断」。撤的是节奏不是账 —— 判据是这句的机器形式：
 * PR 清单不许再有旧名，每日档（现在是 GA daily.yml 的对应 step，见
 * `DAILY_GATE_EXECUTORS`）必须真有一格、点同一入口与旗标。
 * ⚠️ 每日名是**写出来的**：真实名 `每日 Python 可用性`（含空格），用 `每日${旧名}` 拼会得到 `每日Python 可用性` 让判据恒红（第一版就这么错）。
 *
 * #3504 起三格**随自托管执行面退役**（连 GA 都刻意不承接，`daily.yml` 头注写明理由
 * ——「GitHub runner 的工具链由镜像与 setup-* 钉死，无需自证」）：`每日工具链自证` /
 * `每日 Python 可用性` / `每日 Python 探针读数` 从这张表摘掉；它们的退役登记在
 * `GATE_TIER_LEDGER` 的 retired 段（每条带「为什么现在没人跑也不算丢账」），
 * 「退役决定有原文」由 `每日单元测试` 那条判据对着 daily.yml 头注钉住。
 */
const PR_MOVED_TO_DAILY: Array<[string, string, string, string]> = [
  ["浏览器安装", "每日浏览器安装", "scripts/ci-toolchain-selfcheck.mjs", "--playwright-only"],
  /* `ESLint 零警告` 是**另一条理由**（起一堆子进程而非节点事实）：它挂满过 8640s 与 20m，红的地方不是这次改动违规而是这台机腾不出核。
   * 同一张表接住它，因为要判的东西逐字相同：PR 清单不许再有、GA 每日档必须有一格、点的是 `pnpm run lint`（口径见 `package.json` 的 `lint` 与 `oxlint.parity.config.mjs` 顶部）。 */
  ["ESLint 零警告", "每日 ESLint 零警告", "pnpm run lint", ""],
  /* `新鲜度账` 是**第三种理由**（ISSUE #2300 主体分权）：PR 上下文读的是**主干的账**（`FRESHNESS_TRACKS[*].subject` 三档都是 `master`，权威副本在 `ci/freshness-ledger`）。
   * 它判的是「机器 / 主干怎么被调度」，不是某次 PR 的缺陷；第四元组留空（不共用脚本、无分档参数），GA 那格的差别在 env（`COMFY_CI_SUBJECT`），env 不在比较面里。 */
  ["新鲜度账", "每日新鲜度账", "scripts/freshness-gate.mjs", ""],
];

/**
 * 门格总账（#2640，2026-10-31）：每格「在哪个档跑」的权威登记。§13.5.30 的档位归属是工程判断，但「撤出后必须登记、登记名不许还在跑」可以判（否则「悄悄删掉」与「降级登记」逐字同形）。
 * 判据：① 三份清单（PR / push / 每日）各自 ⇄ 总账双向相等（清单多/少一格而总账没同批改 ⇒ 红）；② `retired` 的格不许再出现在任何清单里（降级≠删除）且必须带理由。
 * 三条门槛（确定性 / 快 / 本地可复现）仍只在规范 §13.5.30 由人判，本账不碰。
 */
type GateTier = "PR" | "push" | "daily" | "ga-pr" | "retired";
type LedgerEntry = {
  name: string;
  note?: string;
  tier: GateTier;
};
const GATE_TIER_LEDGER: Array<LedgerEntry> = [
  // ── PR 档（COMFYAPP_CI_GATES）──
  /* ISSUE #3378 收尾（08:25 指令）：`镜像身份` / `工作区复用读数` / `缓存槽读数` /
   * `环境前提` 四格是**自托管节点事实读数**（恒退 0、问的是这台 runner 的镜像 / 工作区 /
   * pnpm 槽根 / 工具链），过去 CNB 侧承重时才每个 PR 判；GA `pr-gate.yml` 承接全部代码
   * 判据之后，这条 `pull_request` build 只剩「站内读 GA 送回的结论」一件事，四格没有
   * 消费者 ⇒ 摘掉，档位登记进 retired 段（逐项写明「现在谁跑」）。 */
  /* 主列末尾的承重档（已摘 `--readout`，ISSUE #3051 期望第 3 条已落地）：镜像格派发的
   * 同一笔 head_sha，GitHub Actions 跑完没有、结论是什么。有结论且红 ⇒ 拦合；没跑起来 ⇒
   * exit 2 同样拦合；只有读到绿才放行。无跨档对应物，不进 CROSS_LANE_SCRIPT_MIRRORS。 */
  /* ISSUE #3378 转正（§13.5.33 逐笔对账）：出站轮询 GitHub conclusion 的五格
   * （`GitHub 判决回读` / `日志分块 ×3` / `GitHub 判决判定`）随老轮询主列一起停用，
   * 档位登记在 retired 段（每一项的 note 写明「现在谁跑」）。这一格是它们的执行者：
   * 站内读 GA 送回 commit-statuses 的结论，承重退码仍落在 `pull_request` build 上。
   * 它排在 `环境前提` 之后、`格式化提交分离` / `零消费导出`（两条无 stage 的登记）之前 ——
   * 与 `.gates` 的实际执行序同处。 */
  { name: "GA 回调结论回读", tier: "PR" },
  /* 这两条**没有自己的 stage**（登记在 `COMFYAPP_CI_GATES_ELSEWHERE`）：原本由 PR 档的
   * `重档静态判据` 那一格跑，2026-11-05 整格搬到 GA 的同名 job —— 名字仍在 PR 清单里，
   * 因为它们在 PR 上仍然被判，只是换了一台 runner。 */
  { name: "格式化提交分离", tier: "PR" },
  { name: "零消费导出", tier: "PR" },
  /* `schema⇄迁移等价`（ISSUE #3599）：**L1** —— §13.5.30 的三条门槛（确定性 / 快 /
   * 本地可复现）逐条评过，逐条读数与裁决见规范 §13.5.40。
   * 形状与上面两条同形：**没有自己的 stage**（登记在 `COMFYAPP_CI_GATES_ELSEWHERE`，
   * 入口路径 = `tests/db-migrate-equivalence.test.ts`），执行者是 GA `pr-gate.yml` 的
   * `typecheck-db-format` job 里那一步 —— 判据 `scripts/check-gate-name-executors.mjs`
   * 的**第四处执行面**（GA PR 门禁的 `run:` 行）就是为它补的：另三面一处都不在 GA。 */
  { name: "schema⇄迁移等价", tier: "PR" },
  // ── push 档（COMFYAPP_CI_PUSH_GATES）──
  /* ISSUE #3378 收尾：push 主列整条撤掉。文档链两格由 GA `master-gate.yml` 同款逐字
   * 承接（§13.5.34 并行期已验），`安装依赖` 只被那两格吃、`合并形态复核` 是形态留痕
   * （真防线是平台分支保护，check-branch-guard.cjs 头注自承）、`工作区出处` 是自托管
   * 专有读数 ⇒ 五格全摘，档位登记进 retired 段。`COMFYAPP_CI_PUSH_GATES` 键随主列
   * 一起删除（见下面那条判据的收口）。 */
  // ── 每日档（执行者 = GA `.github/workflows/daily.yml` 的 step，名字逐字，#3504）──
  /* CNB 侧的 `COMFYAPP_CI_DAILY_GATES` 随构建执行退役；这一档的名字换成 GA step 名
   * （「哪一步」的账跟着执行者走）。与 daily.yml 的 step 名双向对账由门格总账那条判，
   * 检出 / 装 pnpm / 装 Node / 环境证据四行前提设施豁免（见 GA_DAILY_INFRA_STEPS）。 */
  { name: "失败立案（补洞：GA 每日档跑红 ⇒ CNB 单，按格名去重）", tier: "daily" },
  { name: "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）", tier: "daily" },
  { name: "同步数据库表结构（cnb 同款判据一字不改）", tier: "daily" },
  { name: "新鲜度账（cnb 同款判据一字不改）", tier: "daily" },
  { name: "生产构建（cnb 同款判据一字不改）", tier: "daily" },
  {
    name: "ESLint 零警告（cnb 同款判据一字不改：pnpm run lint，不是 eslint .）",
    tier: "daily",
  },
  { name: "浏览器安装（cnb 同款入口；npmmirror 镜像源同 CNB）", tier: "daily" },
  { name: "全量E2E（cnb 同款判据一字不改）", tier: "daily" },
  { name: "API 文档生成与自检（cnb 同款判据一字不改）", tier: "daily" },
  {
    name: "单元测试（排最后：唯一会因机器负载而红的一档，同 CNB 口径）",
    tier: "daily",
  },
  { name: "覆盖率报告（artifact；对位 CNB 的 `覆盖率上报` 格）", tier: "daily" },
  { name: "镜像漂移判据（CNB master vs GitHub master）", tier: "daily" },
  // ── ga-pr 档（执行者 = GA `.github/workflows/pr-gate.yml` 的 step，名字逐字，#3662）──
  /* 这一段是 **2026-11-13 补的第四个面**（ISSUE #3662）：PR 主列的代码判据全在 GA 侧
   * （`.cnb.yml` 的 PR 档自 #3378 起只剩「站内回读结论 + 红了立案」两件纯 API 动作），
   * 而在此之前总账只认三份清单（CNB 的 PR / push / GA daily.yml）—— **GA 的 PR job 不在
   * 任何一个面里** ⇒ 「记成 retired 却仍在 PR 上跑」这一形态对判据是隐形的
   * （`受影响用例` / `固定结构用例` 两格就是这样：账上写着「2026-11-02 撤到每日全量单测」，
   * 而 `pr-gate.yml` 里两个 job 每个 PR 都跑、且在判决的 `needs:` 里）。
   *
   * **名字取 GA step 名（逐字），与 daily 段同一口径**（§13.5.30 的「哪一格属哪一级」
   * 跟着执行者走）。本段的名字 = `pr-gate.yml` 的 step 名清单（减去前提设施豁免），
   * 由 `gaPrGateSteps()` 现算 ⇒ 「GA 的 PR 侧跑了什么」从工作流文件本身读出来，
   * 不靠人抄一份（§12.18）。
   *
   * ⚠️ **同一格在两个名字空间各有一条**：`PR` 段用 CNB 清单的名字（本仓自己起的短名），
   * 本段用 GA step 的名字（逐字）—— 同一格的两条登记面，不是两格。
   * 例：`schema⇄迁移等价`（PR 段，CNB 清单名）+ `schema⇄迁移等价（cnb 同款判据一字不改）`
   * （本段，GA step 名）—— 一格，两个名字空间各一条。
   */
  { name: "分支守卫（cnb 同款判据一字不改）", tier: "ga-pr" },
  { name: "提交声明核对（cnb 同款判据一字不改）", tier: "ga-pr" },
  { name: "同步数据库表结构（cnb 同款判据一字不改）", tier: "ga-pr" },
  { name: "类型检查（cnb 同款判据一字不改）", tier: "ga-pr" },
  { name: "标题行让位", tier: "ga-pr" },
  { name: "文件结构硬规则", tier: "ga-pr" },
  { name: "跨平台动作对照", tier: "ga-pr" },
  { name: "import 别名统一", tier: "ga-pr" },
  { name: "ComfyUI 端口口径", tier: "ga-pr" },
  { name: "内联样式注入", tier: "ga-pr" },
  { name: "跨文件重复块", tier: "ga-pr" },
  { name: "函数长度 TS", tier: "ga-pr" },
  { name: "函数长度 Rust", tier: "ga-pr" },
  { name: "模块循环依赖", tier: "ga-pr" },
  { name: "端口推导跨语言一致性", tier: "ga-pr" },
  { name: "CHANGELOG 碎片", tier: "ga-pr" },
  { name: "主题色扫描", tier: "ga-pr" },
  { name: "UI/逻辑分离", tier: "ga-pr" },
  { name: "lib Node-only 声明（cnb 同款判据一字不改）", tier: "ga-pr" },
  { name: "oxfmt 格式（cnb 同款判据一字不改；基线 = CNB_PULL_REQUEST_TARGET_SHA）", tier: "ga-pr" },
  {
    name: "oxfmt 格式（全量档：硬闸「未过 oxfmt 的文件一个都不许有」）",
    tier: "ga-pr",
  },
  { name: "重档静态判据（cnb 同款判据一字不改）", tier: "ga-pr" },
  {
    name: "受影响用例（cnb 同款判据一字不改）",
    tier: "ga-pr",
    note: "ISSUE #3662 出口 B：**这一格在 GA 的 PR 侧仍在跑**（`pr-gate.yml` 的 `affected-tests` job，2026-11-12/13 实测墙钟 37~135s / 10 跑全绿），账上曾写「2026-11-02 撤到每日全量单测」—— 那句只对 **CNB 侧**成立。撤档理由在 GA 侧**不成立**（逐条读数见规范 §13.5.41）：45m 预算从未被接近，GA 侧那 4 次红全是**真红**（真断言红 ×3 / 真缺陷红 ×1），没有一例是 CNB 共享节点上的「墙钟掐断 → 未判定」或 AggregateError 那一族。",
  },
  {
    name: "固定结构用例（cnb 同款判据一字不改）",
    tier: "ga-pr",
    note: "ISSUE #3662 出口 B：同上，**这一格在 GA 的 PR 侧仍在跑**（`pr-gate.yml` 的 `fixed-structural-tests` job，2026-11-12/13 实测墙钟 87~133s / 10 跑全绿）。撤档理由（45m 预算 / 冷节点 25m+ / AggregateError 假红）在 GA 侧不成立 —— 逐条读数与那 4 次红的形状见规范 §13.5.41。",
  },
  { name: "schema⇄迁移等价（cnb 同款判据一字不改）", tier: "ga-pr" },
  // ── retired（降级登记，必须带理由；§13.5.30）──
  /* ISSUE #3378 收尾（08:25 指令）：CNB 侧从承重平台退成「站内回读结论 + 平台池镜像出口」，
   * 只为过去 CNB 承重 / 自托管节点环境存在的格子整批摘掉。降级 ≠ 删除，逐条登记「现在谁跑」。 */
  /* ── #3504：每日档迁 GA，七格在 CNB 与 GA 两侧都没有了执行者 ── */
  {
    name: "每日失败立案",
    note: "#3504：立案对象（本机执行的每日跑）不存在了。GA daily.yml 的下游 job `daily-failure-issue`（`失败立案` step，CNB 单子，#3436 同通道）承接本档这一跑自己的立案；格名进 `DAILY_GATE_EXECUTORS`",
    tier: "retired",
  },
  {
    name: "每日令牌权限读数",
    note: "#3504：读的是自托管节点 `CNB_TOKEN` 的能力面；触发口在平台池容器里只带 GITHUB_MIRROR_TOKEN 且不装依赖，读数没有消费者。脚本留手动档（npm script 直跑）",
    tier: "retired",
  },
  {
    name: "每日工具链自证",
    note: "#3504：GA runner 的工具链由镜像与 setup-* 钉死（daily.yml 头注原文），自证在 hosted runner 上是空转；本地钩子的对应档不随本次变动",
    tier: "retired",
  },
  {
    name: "每日镜像出勤立案",
    note: "#3504：脚本要 `cnb` CLI（node_modules），触发口不再装依赖。出网信号由镜像出口的红 + GA daily.yml 的 `镜像漂移判据` step 接住；`check:mirror-attendance` 留手动档",
    tier: "retired",
  },
  {
    name: "每日 YAML 真解析",
    note: "#3504：actionlint 二进制钉在节点常驻根，平台池容器里没有。workflows 的真解析改由 `tests/ci-ga-trigger-map.test.ts` 的结构判据 + GA runner 自身的 workflow 校验接住",
    tier: "retired",
  },
  {
    name: "每日 Python 可用性",
    note: "#3504：GA runner 事实读数（Python 由 ubuntu-24.04 镜像钉死），daily.yml 头注写明「刻意不承接」；相关单测用例的 env 档跳过逻辑不随本次变动",
    tier: "retired",
  },
  {
    name: "每日 Python 探针读数",
    note: "#3504：同上，自托管宿主机事实读数在 hosted runner 上没有对象",
    tier: "retired",
  },
  {
    name: "镜像身份",
    tier: "retired",
    note: "PR 档自托管节点镜像身份读数（恒退 0）。GA 承接代码判据后这条 build 不再判节点事实，无消费者 ⇒ 摘。脚本 ci-image-identity.mjs 留盘，每日档同名读数仍在",
  },
  {
    name: "工作区复用读数",
    tier: "retired",
    note: "PR 档 ephemeral 工作区复用形态读数（恒退 0）。CNB 主列不再有吃工作区热态的判据，无消费者 ⇒ 摘。脚本已随 #3480 退役",
  },
  {
    name: "缓存槽读数",
    tier: "retired",
    note: "PR 档 pnpm 缓存槽命中读数（恒退 0）。PR 档早不装依赖（GA 各 job 自己装），本格自承「假如这一档装会命中哪档」，无对象 ⇒ 摘。脚本 ci-cache-slot.mjs 留盘",
  },
  {
    name: "环境前提",
    tier: "retired",
    note: "PR 档自托管节点工具链 / 浏览器下载根前提读数（几秒、mostly 不判红）。它问的是这台节点能不能跑到下载根，而 PR 主列的判据全在 GA runner 上跑 ⇒ 摘。脚本 ci-env-probe.mjs 与 tests/ci-env-probe.test.ts 留盘（每日档环境判据仍用它）",
  },
  {
    name: "合并形态复核",
    tier: "retired",
    note: "push 档形态留痕（check-branch-guard.cjs --merge-commit）。脚本头注自承「真正的防线是平台分支保护，本条是形态留痕、不是那条防线」；主列撤掉后无对象 ⇒ 摘。平台分支保护设置不动",
  },
  {
    name: "生成态文档与源同步",
    tier: "retired",
    note: "push 档文档链格（--check --autofix）⇒ 挪 GA .github/workflows/master-gate.yml 同名 step（同款入口、同款旗标，§13.5.34 并行期已跑过若干轮逐格比对）",
  },
  {
    name: "文档引用与权威源一致",
    tier: "retired",
    note: "push 档文档链格 ⇒ 挪 GA .github/workflows/master-gate.yml 同名 step（check-doc-references.cjs 逐字一致）",
  },
  {
    name: "工作区出处",
    tier: "retired",
    note: "push 档自托管工作区出处判据（跑哪份源码 / 谁写脏过 tracked 面）。CNB 侧不再有写盘判据，GA runner 无此概念（ga-migration-checklist G-19）⇒ 摘。脚本已随 #3480 退役",
  },
  {
    name: "GitHub master 镜像",
    tier: "retired",
    note: "ISSUE #3426（#3378 后续指令）：与 PR 出口同形，镜像推送从自托管主列挪成 `push` 事件下第二条平台池流水线（`GitHub master 镜像（平台池）`），摘 `--readout`、退码生效；不再占 `COMFYAPP_CI_PUSH_GATES` 主列。失败出口 = 该流水线自己的 error + 每日 `镜像漂移判据` 跨仓兜底",
  },
  {
    name: "GitHub 镜像同步",
    tier: "retired",
    note: "ISSUE #3418（#3378 后续指令）：自托管节点到 github.com 出网不稳、判断推送成功半天出不来，推送与派发整个挪到平台池那条同名流水线（另一条出网路径、退码生效）；自托管主列停用、原文按注释形态留在 .gates。「后续流程走不通」由 GA 回调结论回读的 fail-closed（没终态/超时判红）兜住，§13.6 承重锚不变",
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
  // ── 2026-11-13（ISSUE #3662 出口 B）：下面这些 **CNB 时代的老名字**撤了 ──
  /* 它们的格**仍在跑**，只是执行者换了地方、名字也换了：
   *   · `浏览器安装` / `ESLint 零警告` / `新鲜度账` / `生产构建` / `单元测试` /
   *     `E2E 关键流程` / `API 文档生成与自检` ⇒ 执行者是 GA `daily.yml` 的同名 step，
   *     **已在 daily 段逐字登记**（daily 段是 GA step 名，账跟着执行者走）。
   *   · `分支守卫` / `提交声明核对` / `同步数据库表结构` / `类型检查` / `标题行让位` /
   *     `文件结构硬规则` / `跨平台动作对照` / `import 别名统一` / `ComfyUI 端口口径` /
   *     `内联样式注入` / `跨文件重复块` / `函数长度 TS` / `函数长度 Rust` /
   *     `模块循环依赖` / `端口推导跨语言一致性` / `CHANGELOG 碎片` / `主题色扫描` /
   *     `UI/逻辑分离` / `lib Node-only 声明` / `oxfmt 格式` / `重档静态判据` /
   *     `受影响用例` / `固定结构用例` ⇒ 执行者是 GA `pr-gate.yml` 的同名 step，
   *     **已在 ga-pr 段逐字登记**。
   * ⇒ 留着这些老名字当「retired」就是**账上写着不再跑、实际每个 PR 都跑**
   * （ISSUE #3662 的现场：`受影响用例` / `固定结构用例` 两格）⇒ 撤。
   * 「降级 ≠ 删除」那条规矩管的是**降级登记**（档位降了、名字要在册），
   * 管不到「名字与执行者不同名空间」这一族 —— 那一族的登记面是**逐字名的那一段**。
   */
  // ── 2026-11-05 薄化：GA `.github/workflows/pr-gate.yml` 承接（同一个 PR 事件、
  //    同一个镜像仓；PR 档只留平台读数 + 判决链，结论 2026-11-08 起由 `GA 回调结论回读` 承重读回）。
  //    逐项归属与「为什么不在这边跑」写在 `.cnb.yml` 的 `.gates` 顶部那段。──
  /* 这一段原来的 CNB 时代老名字（`Install dependencies` / `分支守卫` / `提交声明核对` /
   * `同步数据库表结构` / `类型检查` / `标题行让位` / `文件结构硬规则` / `跨平台动作对照` /
   * `import 别名统一` / `ComfyUI 端口口径` / `内联样式注入` / `跨文件重复块` /
   * `函数长度 TS` / `函数长度 Rust` / `模块循环依赖` / `端口推导跨语言一致性` /
   * `CHANGELOG 碎片` / `主题色扫描` / `UI/逻辑分离` / `lib Node-only 声明` /
   * `oxfmt 格式` / `重档静态判据`）**全部撤了**（ISSUE #3662）：它们的格在 GA 的 PR 侧
   * 仍在跑，登记面换成 ga-pr 段的**逐字 step 名** ⇒ 同一格在两个名字空间各一条，
   * 而不是「老名字记成 retired + 新名字记成在跑」那种两处各说各话。
   *
   * ⚠️ 唯一留在 retired 段的是 **push 档**那个安装格（名字加 `（push 档）` 后缀）——
   * push 主列早已撤掉，它没有执行者；而 GA 的 PR 侧那几个 `安装依赖` step 是**前提设施**
   * （每个 job 自己装一次），不是一格 ⇒ 不进 ga-pr 段（见 `GA_PR_INFRA_STEPS`）。
   */
  {
    name: "安装依赖（push 档）",
    tier: "retired",
    note: "push 档安装格，只被同档文档链两格吃 node_modules；两格挪 GA master-gate.yml（它自己 pnpm install）之后无消费者 ⇒ 摘。单跑单测·安装依赖 的逐字相同真身改向 每日安装依赖。⚠️ 名字带 `（push 档）` 后缀是为了不与 ga-pr 段的 `安装依赖`（GA 各 job 自己的前提设施 step）撞名",
  },
  //    `GA 回调结论回读`（§13.5.33）。原文按注释形态留在 `.gates`，恢复动作照旧。
  // ── 2026-11-08 转正（ISSUE #3378）：老轮询主列五格停用，执行者换成站内的
  //    `GA 回调结论回读`（§13.5.33）。原文按注释形态留在 `.gates`，恢复动作照旧。
  {
    name: "GitHub 判决回读",
    tier: "retired",
    note: "ISSUE #3378 转正：出站轮询 api.github.com 的 conclusion 换成站内读 `GA 回调结论回读`（`ci-ga-verdict-readout.mjs` 读 commit-statuses）；出站轮询链仍留在盘上供 `pnpm ship --gh-logs` 按需复验与快速回退",
  },
  {
    name: "日志分块 1/3",
    tier: "retired",
    note: "同上：gzip+base64 全量日志分块通道随出站回读一起停用；GA 判红日志改 `pnpm ship --gh-logs <run-id|pr号>` 按需取，不再占 PR 档三格",
  },
  { name: "日志分块 2/3", tier: "retired", note: "同 `日志分块 1/3`，随老轮询主列停用" },
  { name: "日志分块 3/3", tier: "retired", note: "同 `日志分块 1/3`，随老轮询主列停用" },
  {
    name: "GitHub 判决判定",
    tier: "retired",
    note: "同上：`ci-github-verdict-decide.mjs` 读 decision.json 折退码那格停用，承重退码改由 `GA 回调结论回读` 直接给出（fail-closed 三态：绿 0 / 红 1 / 没判过 2）",
  },
];

/**
 * **同一份实现长在另一条流水线上**的那几格（另一档名 → PR 名），比逐字同形：名字不同是刻意的（按名取块会撞车），同一件事只能由 script 相同保证。
 * 左边不一定是每日档（这里现在是每日档，push 档 `安装依赖` 在右边）；判据管「一条链被几条流水线各抄一份」，不管抄到第几条都要对账。
 * ⚠️ 只留两边都在的：`Python 可用性` / `浏览器安装` 已于 2026-10-19 撤出 PR（见 `PR_MOVED_TO_DAILY`），拿不存在的块比相同性只会教会人忽略红。
 * 2026-11-05 薄化后 PR 档不再有安装格，`Install dependencies` 那一对面换成「每日 ⇄ push」；
 * `同步数据库表结构 ⇄ 每日同步数据库表结构` 随 PR 格撤出一起消失。
 */
const CROSS_LANE_SCRIPT_MIRRORS: Array<[string, string]> = [
  /* ISSUE #3378 收尾：push 主列撤掉后，`安装依赖` 那一格不再存在。
   * 「每日 ⇄ push 安装格逐字相同」这一对随之失效（§13.5.34 的切换三处里
   * 早就写明这一对要同批消失）。#3504 再撤掉单跑/桌包的 CNB 前提格后，
   * CNB 配置内已没有任何跨档副本 —— 同形判据换宿主到 GA workflow 之间
   * （daily.yml ⇄ oneshot-*.yml 的 `run:` 行），见「单跑口」describe。 */
];

/**
 * 两格 env 之间**唯一被登记过的差别**：`每日安装依赖` 不接槽（ISSUE #2081）；键按左边格子名取，所以「哪格可少这行」一表说清。push 档 `安装依赖` 不在表里（理由的主语是「后面有没有 `next build`」，#2851）。
 * ⚠️ 钉的是更窄的形状：名单键在**右侧那一格**里必须**正好置一行** `KEY: "1"`；每日侧**一个字都不出现**（写 `"0"` 也算违规）。
 * 2026-11-05 起右侧是 push 档（PR 档的安装格已撤到 GA），符号名沿用旧名以免牵动调用面，
 * 语义看这条注释与 `CROSS_LANE_SCRIPT_MIRRORS` 的配对。`toEqual` 未松，否则判不出
 * 「不相同的那一行正是被允许的那一行」。
 */
const DAILY_ENV_ONLY_ON_PR: Record<string, Array<string>> = {
  /* ISSUE #3378：push 安装格已撤 ⇒ 不再有「哪格可少 COMFY_CI_SLOT 这一行」的
   * 两格对照。表留空壳是让「跨档同形」判据仍有对象，不静默跳过。 */
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

/** `45m` / `30m` / `3h` → 分钟的换算随「CNB stage `timeout` 预算」判据一并退役：#3504 起重档预算都长在 GA workflow 的 `timeout-minutes` 上（整数分钟，无需换算）。 */

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
 * push 档（`master 合并复核`）清单（`COMFYAPP_CI_PUSH_GATES`，顺序即执行序）：判的是**合并后的树**，既非单次改动（PR 档）也非 master 全量健康（每日档）。
 * 镜像出口（原 `GitHub master 镜像` 格）已挪成 `push` 事件下另一条平台池流水线，不占这份清单（ISSUE #3426）。
 * 与 PR 清单同一份解析：声明 ⇄ `pipelineStageNames(text, "master 合并复核")` 双向核对，只读一份时另一份漂了没人红。
 * （每日档那份解析随 `COMFYAPP_CI_DAILY_GATES` 键一并退役：#3504 起每日执行面在 GA
 * daily.yml，判据直接解析 step 名 —— 见 `gaDailySteps()` 与 `DAILY_GATE_EXECUTORS`。）
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
     * （一条项的 `lock:` 只在它自己之内算数，否则上一条的锁归属会被带进下一条）。
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
    /* R1：非 PR 的一条都不许靠继承拿锁 —— 那次退化就是从继承进来的。 */
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
     * 一样，所以漏写默认判红。 */
    if (def.cancelInProgress === null) {
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
    /* R3 的「同一份工作」按**格名签名**认，不按 stagesRef 语法认：#3504 起触发口的
     * stage 清单从锚点引用（`*daily_gates`）改成了内联（`stagesRef = inline:<流水线名>`），
     * 两条触发口的 inline 引用名必然不同，但它们是**同一件事**（同一格派发）。
     * 内联时把那条流水线的实际格名拼成签名 —— 「同一把锁只挡同一件事」判的是事，不是引用写法。 */
    const workKey = (row: { name: string; stagesRef: string | null }): string =>
      row.stagesRef !== null && !row.stagesRef.startsWith("inline:")
        ? row.stagesRef
        : `names:${pipelineStageNames(text, row.name).join("|")}`;
    if (seen === undefined) {
      lockToWork.set(def.key, new Set([workKey(row)]));
    } else {
      seen.add(workKey(row));
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
    /* 平台池流水线（ISSUE #3346 实验转正 / #3418；push 出口 #3426；主列 #3478）是常驻例外：
     * 它们**刻意**不吃 `*common`（runner / docker / lock 全自带 —— 镜像出口去 platform pool
     * 正是「自托管出网不稳、换一条出网路径」这件事本身；主列只剩一格站内回读，
     * 自托管的算力与缓存对它没有对象）。 */
    const poolPipelines = [...HOSTED_MIRROR_PIPELINES, PR_GATE_PIPELINE, VERDICT_PIPELINE].filter(
      (name) => text.includes(`- name: ${name}`),
    );
    expect(
      refs.length + poolPipelines.length,
      `锚点引用数（${refs.length}）+ 平台池例外流水线数（${String(poolPipelines.length)}）` +
        `与带 \`stages:\` 的流水线数（${stageLists.length}）对不上 —— 有一条流水线既没接上 ` +
        "`*common` 又没登记为例外，它会静默回落到计费的平台池（或反向：例外登记了却还在吃锚点）",
    ).toBe(stageLists.length);
    expect(
      refs.length,
      "一条流水线都没引用锚点（`.common` 被删了或换了形状）",
    ).toBeGreaterThanOrEqual(5);
  });

  it("质量门禁（ISSUE #3478 迁平台池）：只剩站内回读一格，形态与镜像出口同族", () => {
    /* 主列判据全在 GA（pr-gate.yml 五 job），CNB 这一侧只剩「站内回读结论」+「红了立案」
     * 两件纯 API 动作 —— 不吃 node_modules、不碰 Windows 特性，留在自托管已无对象。
     * 这是对 #1993「门禁主列永远自托管」的显式推翻，形态判据在这里钉死：
     * 平台池标签、无 namespace: group、不吃锚点、script 无 PowerShell 前缀与 cp936 外壳、
     * 锁仍是 pr-$CNB_PULL_REQUEST_IID 这把钥匙唯一的用户、endStages 是立案格。 */
    const text = readRegisteredConfig();
    const at = text.indexOf(`- name: ${PR_GATE_PIPELINE}`);
    expect(at, "质量门禁流水线找不到条目起点").toBeGreaterThan(-1);
    const chunk = text
      .slice(at, nextEventAt(text, at))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(chunk, "质量门禁没有点名平台池标签").toMatch(/^\s+tags:\s*\n\s+-\s*cnb:arch:amd64\s*$/m);
    expect(
      chunk,
      "质量门禁写了 namespace: group —— 主列已迁平台池，写回自托管等于整条回退",
    ).not.toMatch(/namespace:\s*group\b/);
    expect(
      chunk,
      "质量门禁引用了 `*common` —— 它会继承自托管 runner（Windows 节点），迁移被静默撤销",
    ).not.toMatch(/<<:\s*(?:\[\s*)?\*\w+/);
    /* 平台池是 Linux 容器（node 镜像 + cnb-cli 预装，#3457）：stage shell 是 `sh`，
     * PowerShell 前缀会被拆碎、cp936 外壳在 Linux 上是多余一层 —— 与镜像出口同一组判据。
     * stage 正文住在 `.gates` 锚点里（流水线侧是 `stages: *gates` 引用），所以 script 行
     * 的判据对象是**锚点段**，不是流水线 chunk。 */
    expect(
      chunk,
      "质量门禁的 stages 不是 `.gates` 引用 —— 锚点结构变了，下面的 stage 判据落空",
    ).toContain("stages: *gates");
    const gatesAt = text.indexOf(".gates: &gates");
    expect(gatesAt, "`.gates` 锚点找不到 —— stage 正文无从判起").toBeGreaterThan(-1);
    const gatesChunk = text
      .slice(gatesAt, nextAnchorAt(text, gatesAt))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    const gateScriptLines = gatesChunk.split("\n").filter((line) => /^\s+script:\s/.test(line));
    expect(gateScriptLines.length, "`.gates` 解析不出 script 行").toBeGreaterThan(0);
    for (const line of gateScriptLines) {
      expect(
        line,
        "`.gates` 的 script 带了 Windows PowerShell 语法（[Text.Encoding]）",
      ).not.toContain("[Text.Encoding]");
      expect(
        line,
        "`.gates` 的 script 还包着 ci-cp936-exit.mjs —— 平台池上它是多余一层",
      ).not.toContain("ci-cp936-exit.mjs");
    }
    /* 主列 stage 只剩一格：站内回读（fail-closed 承重锚，§13.6「PR 跑绿才合并」）。 */
    expect(
      gatesChunk,
      "质量门禁的主列不是「GA 回调结论回读」一格 —— 又有格子回流自托管了",
    ).toContain("- name: GA 回调结论回读");
    expect(gatesChunk, "质量门禁的回读脚本被改写 —— 站内回读是唯一承重形态").toContain(
      "node scripts/ci-ga-verdict-readout.mjs",
    );
    /* endStages 立案格内联在流水线里（sh 形态），锁仍是 pr-$IID 这把钥匙唯一的用户（镜像出口用 mirror-pr-$IID）。 */
    expect(chunk, "质量门禁丢了 endStages 立案格 —— 红了没人立案").toContain("- name: PR 失败立案");
    expect(chunk, "立案格 script 不是直跑形态").toContain(
      "node scripts/ci-pr-failure-issue.mjs --no-block",
    );
    expect(chunk, "质量门禁的锁不是 pr-$CNB_PULL_REQUEST_IID —— 这把钥匙的唯一用户变了").toContain(
      "key: pr-$CNB_PULL_REQUEST_IID",
    );
  });

  it("平台池镜像出口（ISSUE #3418 转正）：刻意平台池、真实推送与派发、自带锁", () => {
    /* ISSUE #3346 的实验已转正：自托管主列那一格停用，推送与派发整个由这一条承担。
     * 例外仍只盖「不吃锚点」这一件事；锁自带且不共用 `pr-$CNB_PULL_REQUEST_IID`
     * （同 key + cancel-in-progress 会掐停并行的「质量门禁」，#2114 同款）。
     * 实验期的 `--once` / `--readout` 两个旗标随转正摘掉：现在是缺省重试档、退码生效。 */
    const text = readRegisteredConfig();
    for (const name of HOSTED_MIRROR_PIPELINES) {
      /* 它住在 `pull_request` 的流水线列表里，不在事件键那一层 —— 按「下一份 `push:` 事件
       * 键」截取它所在的片段（比另造一个解析器便宜，且足以钉形状）。 */
      const at = text.indexOf(`- name: ${name}`);
      expect(at, `平台池镜像流水线「${name}」找不到条目起点 —— 它是唯一的推送出口`).toBeGreaterThan(
        -1,
      );
      const chunk = text
        .slice(at, nextEventAt(text, at))
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      expect(chunk, `「${name}」没有点名平台池标签 —— 推送走的是云托管节点那条出网路径`).toMatch(
        /^\s+tags:\s*\n\s+-\s*cnb:arch:amd64\s*$/m,
      );
      expect(
        chunk,
        `「${name}」写了 namespace: group —— 它就该在平台池上，写自托管等于把出网路径换回去`,
      ).not.toMatch(/namespace:\s*group\b/);
      expect(
        chunk,
        `「${name}」引用了 \`*common\` —— 它会继承自托管 runner 与 PR 模板锁，出口自己成了变量`,
      ).not.toMatch(/<<:\s*(?:\[\s*)?\*\w+/);
      expect(
        chunk,
        `「${name}」还带实验期的 --once —— 投递侧不稳时单次即弃，推送可靠性不该回退`,
      ).not.toContain("--once");
      expect(
        chunk,
        `「${name}」还带实验期的 --readout —— 推不出去 / 派发失败必须退非零`,
      ).not.toContain("--readout");

      /* 平台池是 Linux 容器（node 镜像），stage shell 是 `sh`：自托管那句
       * `$enc=[Text.Encoding]::UTF8; …` 是 Windows PowerShell，sh 会把它拆成
       * `=[Text.Encoding]::UTF8: not found` 当场退 127；`ci-cp936-exit.mjs` 也只是
       * 中文 Windows 那一跳的转码外壳（Linux 上直通）。两者都不许被照抄进平台池格
       * —— 现场：push 出口的 `endStages` 立案格带着这两样，退出 127、整格红。 */
      const scriptLines = chunk.split("\n").filter((line) => /^\s+script:\s/.test(line));
      expect(
        scriptLines.length,
        `「${name}」解析不出 script 行 —— 下面两条语法判据就没有对象了`,
      ).toBeGreaterThan(0);
      for (const line of scriptLines) {
        expect(
          line,
          `「${name}」的 script 带了 Windows PowerShell 语法（[Text.Encoding]）—— ` +
            "这一条在平台池 Linux 容器里跑，sh 会当场退 127",
        ).not.toContain("[Text.Encoding]");
        expect(
          line,
          `「${name}」的 script 还包着 ci-cp936-exit.mjs —— CP936 转码只属中文 Windows ` +
            `自托管那一跳，Linux 上这层外壳是多余的`,
        ).not.toContain("ci-cp936-exit.mjs");
      }
      const isPushMirror = name === "GitHub master 镜像（平台池）";
      expect(
        chunk,
        `「${name}」的锁不是自带 key —— 共用 PR 主列那把会掐停并行的质量门禁`,
      ).toContain(isPushMirror ? "lock_push_mirror" : "mirror-pr-$CNB_PULL_REQUEST_IID");
      expect(chunk, `「${name}」没 import 镜像令牌 —— 推送格读不到它`).toContain(
        "GITHUB_MIRROR_TOKEN",
      );
      /* push 镜像出口的三条专属读数只在 isPushMirror 上判：条件收进「取表」，
       * 断言本体在无条件循环里跑（no-conditional-expect）。 */
      const pushMirrorChecks: Array<[string, string]> = isPushMirror
        ? [
            ["--master", "push 镜像出口没有点 `--master` —— 它要推 master 且不派发"],
            [
              "name: GitHub master 镜像",
              "push 镜像出口的 stage 名不是 `GitHub master 镜像` —— 立案回读按格名认",
            ],
            [
              "ci-pr-failure-issue.mjs --no-block --lane push",
              "push 镜像出口的 endStages 没有立案格 —— 红了就没人知道（这一格是 push 事件下唯一的流水线）",
            ],
          ]
        : [];
      for (const [needle, why] of pushMirrorChecks) {
        expect(chunk, why).toContain(needle);
      }
    }
  });

  it("平台池镜像 Dockerfile 预装 cnb CLI（endStages 立案格的执行前提）", () => {
    /* `push 失败立案` 的判决链（fetchBuildList / fetchBuildDetails / 建单 / 补标签 /
     * 独立回读）整条走 `makeRunner()` 起 `cnb` 子进程。平台池容器是 `node:26` +
     * git-lfs，本就没有这个二进制 —— #3453 之前那一格即使修好了 sh 语法也会
     * 「取不到读数、一次都不写」（`--no-block` 折成退 0）⇒ 绿着空转。
     * 装它的动作**只有这一处**，所以判据点名 Dockerfile：缺这一行，换台机器
     * 重建镜像就又回到「判据在场、执行者不在场」。官方 `zh/develops/cnb-cli.md`
     * 的接入方式是 npm 包或 cnbcool/cnb-cli 镜像；平台注入 CNB_TOKEN 无需登录。 */
    const dockerfile = readFileSync(path.join(ROOT, ".cnb/ci-image/Dockerfile"), "utf8");
    expect(
      dockerfile,
      "`.cnb/ci-image/Dockerfile` 没装 @cnbcool/cnb-cli —— 平台池 endStages 的立案格起不来 cnb 子进程",
    ).toContain("@cnbcool/cnb-cli");
    expect(
      dockerfile,
      "装完没自证 —— `cnb` 不在 PATH / 包没解开时镜像照样构建成功，那一格仍然空转",
    ).toContain("cnb --version");
    /* 反例：只写注释不算装（与「入口计数面只认会被执行的 script 行」同一条口径）。
     * 把 RUN 那行注释掉，判据必须当场红，否则它守不住「删装法只留说明」那一形。 */
    const commented = dockerfile.replace(
      /^RUN npm install -g @cnbcool\/cnb-cli && cnb --version$/m,
      "# RUN npm install -g @cnbcool/cnb-cli && cnb --version",
    );
    expect(commented).not.toBe(dockerfile);
    expect(/^RUN .*@cnbcool\/cnb-cli/m.test(commented)).toBe(false);
  });

  it("自托管主列「GitHub 镜像同步」已停用，推送出口只在平台池那一条（ISSUE #3418）", () => {
    /* 两半一起判：① 主列那格停用（清单摘名 + 原文按注释形态留着），
     * ② 平台池那条是真实推送与派发（不带实验期旗标）。只判①会把「停用」与
     * 「悄悄删掉、没人推送」混成同一个绿；只判②则主列那格可能又自己推一遍。 */
    const text = readRegisteredConfig();
    expect(
      registeredGateOrder(text),
      "自托管主列还挂着「GitHub 镜像同步」—— 它半天判不出推送成功，按 #3378 后续指令应停用",
    ).not.toContain("GitHub 镜像同步");
    expect(
      registeredDisabledGates(text),
      "停用没登记（停用 ≠ 删除：要能从 DISABLED_GATES 读回这件事）",
    ).toContain("GitHub 镜像同步");
    expect(
      stageKeptAsComment(text, "GitHub 镜像同步"),
      "停用后 .gates 里找不到注释形态的原文 —— 恢复时无原文可依",
    ).toBe(true);
    const at = text.indexOf("- name: GitHub 镜像同步（平台池）");
    expect(at, "平台池那条推送流水线不在了 —— 这一停就把出口一起停掉了").toBeGreaterThan(-1);
    const chunk = text
      .slice(at, nextEventAt(text, at))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(chunk, "平台池出口还带 --readout —— 派发失败不会有人知道").not.toContain("--readout");
    expect(chunk, "平台池出口不是 ci-github-mirror-push.mjs —— 推送与派发没有执行者").toContain(
      "node scripts/ci-github-mirror-push.mjs",
    );
  });

  it("push 主列不再带镜像格与镜像令牌（ISSUE #3426）", () => {
    const text = readRegisteredConfig();
    const main = configEventBlock(text, "push").split(
      "    - name: GitHub master 镜像（平台池）",
    )[0];
    expect(
      main,
      "`master 合并复核` 还 import 着镜像令牌 —— 那一枚只该被第二条平台池流水线读取",
    ).not.toContain("GITHUB_MIRROR_TOKEN");
    expect(
      main,
      "push 主列的 stages 里还挂着 `GitHub master 镜像` —— 它已挪成另一条流水线",
    ).not.toContain("- name: GitHub master 镜像");
  });

  it("push 主列已撤：CNB 侧只剩平台池镜像出口，文档链由 GA master-gate 承接（ISSUE #3378 / #3397）", () => {
    /* 2026-11-09（ISSUE #3378 收尾 / #3397「摘掉 GA 已跑过的格」）：push 主列整条撤掉。
     * 原先那五格分别是：形态留痕（真防线是平台分支保护）、只被文档链两格吃的安装格、
     * GA `master-gate.yml` 已同款逐字在跑的文档链两格、自托管工作区出处读数。
     * 后者由 GA 侧承接（§13.5.34 并行期逐格比对结论一致后才切换），前三者无消费者。
     * 声明键 `COMFYAPP_CI_PUSH_GATES` 随主列一起删 —— 留一个空清单会变成「在册 ≠ 出勤」
     * 那族静默失效，而判据读到空数组也只会给一句没对象的绿。 */
    const text = readRegisteredConfig();
    expect(
      registeredPushGateOrder(text),
      "`COMFYAPP_CI_PUSH_GATES` 又出现了 —— push 主列已撤，这份清单没有对象；要加回判据就同批把主列加回配置并登记进 GATE_TIER_LEDGER",
    ).toEqual([]);
    expect(
      pipelineStageNames(text, "master 合并复核"),
      "「master 合并复核」流水线又回来了 —— 它与这份清单必须同批出现或同批消失",
    ).toEqual([]);
    /* 反向钉住出口仍在：push 事件下的平台池镜像流水线一条都不能少（它是 GA 侧
     * daily / master-gate / package-desktop 的树来源，删了那边判的是旧树）。 */
    const push = configEventBlock(text, "push");
    expect(push, "push 事件下没有平台池镜像出口了").toContain(
      "- name: GitHub master 镜像（平台池）",
    );
    expect(push, "平台池镜像出口没点名推送脚本").toContain(
      "node scripts/ci-github-mirror-push.mjs --master",
    );
  });

  it("手点 / API 两个触发口跑的是同一份清单，而按钮与事件键两两对上", () => {
    /* #3504 起「清单」换了含义：每档的 web / API 两条触发口各跑**一格派发**
     * （`GA 派发·<档>`，`ci-ga-dispatch.mjs --preset <名>`），实际执行在 GA 对应
     * workflow。它们仍必须与注册表（`ci-ga-trigger-map.mjs`）是**同一件事**，否则
     * 「手点一遍某档」这句话就没有确定含义（按钮指到一个不存在的 preset / 派发目标
     * 没人触发 / 两条触发口跑的不是同一档 —— 复制 stage 清单 ⇒ 加档时只加一边）。 */
    const text = readRegisteredConfig();
    for (const target of GA_TRIGGER_TARGETS) {
      const stage = dispatchStageName(target);
      const viaButton = pipelineStageNames(text, target.pipelineWeb);
      const viaApi = pipelineStageNames(text, target.pipelineApi);
      expect(
        viaButton,
        `${target.eventWeb} 那一条的 stage 名单与注册表不一致 —— 它应当只有一格 \`${stage}\``,
      ).toEqual([stage]);
      expect(
        viaApi,
        `${target.eventApi} 那一条与手点那一条跑的**不是同一档** —— 同一格名，不另抄一份`,
      ).toEqual([stage]);
      /* 派发格点的必须是注册表认的那条命令：`--preset` 是路由的唯一依据，
       * 写错在 CNB 侧不红（退 2 有话术），但「按了这个按钮派发的根本不是这一档」。 */
      const script = stageScriptLine(text, stage);
      expect(script, `\`${stage}\` 解析不出 script`).not.toBe("");
      expect(
        script,
        `\`${stage}\` 的命令与注册表不一致 —— 应为 \`node scripts/ci-ga-dispatch.mjs --preset ${target.preset}\``,
      ).toBe(`node scripts/ci-ga-dispatch.mjs --preset ${target.preset}`);
    }

    /* 事件名必须是 `api_trigger` 或其前缀 —— 这是**服务端**的硬要求（实测 400
     * `Event must be 'api_trigger' or start with 'api_trigger_'.`）。写成 `daily_api`
     * 那一类名字，这条流水线在配置解析期一个字都不报，而永远没人能触发它 ——
     * 判前缀不判整串：后缀是自由命名的（官方口径），把它钉成字面量等于把实现细节当判据。 */
    const apiEvents = [...text.matchAll(/^ {2}(?<event>api_trigger\w*):$/gm)].map(
      (m) => m.groups?.event,
    );
    for (const target of GA_TRIGGER_TARGETS) {
      expect(
        apiEvents,
        "API 触发口的事件键丢了，或不再是 `api_trigger` 前缀（服务端会直接 400）",
      ).toContain(target.eventApi);
    }
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
   * 出勤判据认的流水线名 ⇄ 配置里跑「派发 daily」的流水线（ISSUE #2873）：`DAILY_LANE_PIPELINES` 是 `check-daily-attendance.mjs` 认档的唯一名单（事件名前缀不够，01:00 与 03:00 共享 `crontab:`）。
   * 名单漂两个方向都静默：配置改名而名单没跟 ⇒ 永远缺勤；名单留着已不存在的名字 ⇒ 永远出勤。两种都不让别的判据红。
   * #3504 起认的是「派发到 GA daily.yml 那一格」（`--preset daily`），不是旧 `*daily_gates` 锚点。
   */
  it("每日出勤判据认的流水线名，就是配置里派发 daily 的那几条（不多不少）", () => {
    const text = readRegisteredConfig();
    const dailyTargets = GA_TRIGGER_TARGETS.filter((t) => t.preset === "daily");
    /* 名单里的每一条在配置里都要真的派发 daily（派发格在、且 --preset 对）——
     * 名单留着已不存在的名字那条失效形态在这里被点名，而不是靠出勤读数偶尔看见。 */
    for (const target of dailyTargets) {
      for (const name of [target.pipelineWeb, target.pipelineApi]) {
        const stages = pipelineStageNames(text, name);
        expect(stages, `「${name}」解析不出 stage —— 出勤名单里的流水线在配置里没了`).toEqual([
          dispatchStageName(target),
        ]);
        expect(
          stageScriptLine(text, stages[0] ?? ""),
          `「${name}」那一条不再派发 daily —— 出勤判据会把它记成「这一档跑过」，而 GA 那边什么都没发生`,
        ).toContain("--preset daily");
      }
    }
    /* 反向：配置里派发 daily 的流水线，出勤名单一条都不许少。 */
    const dispatchingDaily = dailyTargets.flatMap((t) => [t.pipelineWeb, t.pipelineApi]);
    expect(
      [...DAILY_LANE_PIPELINES].sort(),
      "`DAILY_LANE_PIPELINES` 与 `.cnb.yml` 里派发 daily 的流水线名不是一张表 —— " +
        "配置那侧改了名（或加了一个触发口）而名单没跟，出勤判据就会静默变成恒缺勤或恒出勤",
    ).toEqual(dispatchingDaily.sort());

    /* 定时档已迁 GA ⇒ CNB 配置里**不许再有** `crontab:` 流水线。这一条是反向的：
     * 删掉定时口这件事本身必须被判据看见，否则「配置看着还像有定时、平台其实没人起」
     * 就是 #1229 那一族的静默失效，而自托管机又是本机，负载白扛了也没人知道。
     * GA 侧 schedule 是否真的在，由「定时档不在本机、在 GA」那条钉。 */
    const rows = pipelineLockAssignments(text);
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

  it("GA 回调 build 的判定脚本念得出自己绑在哪个 sha 上（CNB 侧日志身份读数）", () => {
    /* `git.enable: false` 的回调 build 没有仓库代码，判定逻辑内联在 `.cnb.yml`。
     * 以前只打 `conclusion`，排查「这条回调绑的是哪笔预合并 sha」得跳去 GA run
     * 页面翻（#3378 03:48 贴图）。GA 侧把 sha 随 `env.GA_CALLBACK_SHA` 送进来后，
     * 这份 script 必须把它打进日志，并保留与 `CNB_COMMIT` 的交叉核对 ——
     * 平台对 `api_trigger*` 事件的 `CNB_COMMIT` 没有明文取值保证。
     * #3529 起这条流水线在平台池 Linux：内联脚本换 sh 形态（PowerShell 残留零容忍）。 */
    const script = stageScriptLine(readRegisteredConfig(), "GA 结论判定");
    expect(script, "解析不出 `GA 结论判定` 的 script").not.toBe("");
    expect(script).toContain("${GA_CALLBACK_SHA:-}");
    expect(script).toContain("${GA_PR_NUMBER:-}");
    expect(script).toContain("${CNB_COMMIT:-}");
    expect(script).toContain("[ga-verdict] callback sha=");
    expect(script).toContain("[ga-verdict] callback cnb_commit=");
    expect(script).toContain("sha_check=");
    /* 三态退码一字不许动：身份读数只是日志，不参与判定。 */
    expect(script).toContain("exit 2");
    expect(script).toContain("exit 0");
    expect(script).toContain("exit 1");
    expect(script).toContain("conclusion=$v sha=$short -> success");
    expect(script).toContain("conclusion=$v sha=$short -> failure");
    /* 平台池是 sh 容器：PowerShell 残留（前缀 / $env: 取值 / Write-Host）零容忍。 */
    expect(script, "判定脚本残留 PowerShell 语法（$env:）—— sh 读不到这个取值形态").not.toContain(
      "$env:",
    );
    expect(script, "判定脚本残留 Write-Host —— sh 容器里那是一条外部命令").not.toContain(
      "Write-Host",
    );
  });

  it("GA 判决回调流水线（ISSUE #3529 迁平台池）：判决必经链不再等开发机醒来", () => {
    /* #3528 现场：这条流水线是每条 PR 判决的必经链，钉在自托管上时节点离线
     * （睡眠 / runner 连接掉）⇒ build 死在 prepare，fail-closed 把 error 送回主列，
     * 所有 PR 的判决变红 —— 与代码无关。它是纯 env 折叠动作，不吃节点算力。
     * 形态判据与质量门禁段同一族：平台池标签、无 namespace: group、不吃锚点、
     * script 无 PowerShell 残留、锁仍是 ga-verdict、git.enable: false 在（不检出）。 */
    const text = readRegisteredConfig();
    const at = text.indexOf(`- name: ${VERDICT_PIPELINE}`);
    expect(at, "GA 判决回调流水线找不到条目起点").toBeGreaterThan(-1);
    const chunk = text
      .slice(at, nextEventAt(text, at))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(chunk, "判决回调没有点名平台池标签").toMatch(/^\s+tags:\s*\n\s+-\s*cnb:arch:amd64\s*$/m);
    expect(
      chunk,
      "判决回调写了 namespace: group —— 迁移被静默撤销，开发机睡着时所有 PR 判红",
    ).not.toMatch(/namespace:\s*group/);
    expect(chunk, "判决回调引用了 `*common` —— 它会继承自托管 runner（Windows 节点）").not.toMatch(
      /<<:\s*(?:\[\s*)?\*\w+/,
    );
    expect(chunk, "判决回调丢了 `git.enable: false` —— 不检出是它内联判定的前提").toContain(
      "enable: false",
    );
    /* 锁经 `*lock_ga_verdict` 锚点引用（key 在锚点定义处）；断言两层都在。 */
    expect(chunk, "判决回调的锁不是 *lock_ga_verdict —— 同一 PR 连派发的互斥没了").toContain(
      "lock: *lock_ga_verdict",
    );
    expect(text, "`*lock_ga_verdict` 锚点的 key 不是 ga-verdict —— 钥匙被人换了").toContain(
      "key: ga-verdict",
    );
    const scriptLines = chunk.split("\n").filter((line) => /^\s+script:/.test(line));
    expect(scriptLines.length, "判决回调解析不出 script 行").toBeGreaterThan(0);
    for (const line of scriptLines) {
      expect(line, "判决回调的 script 带了 Windows PowerShell 语法").not.toContain(
        "[Text.Encoding]",
      );
      expect(line, "判决回调的 script 还包着 ci-cp936-exit.mjs").not.toContain("ci-cp936-exit.mjs");
    }
  });

  it("GA 判红日志正文搬到 CNB：relay step 在收尾 job，且不碰承重主列（ISSUE #3437）", () => {
    /* 结论回调（`ci-ga-verdict-callback.mjs`）已经把 GA 的 verdict 送回 CNB；
     * #3437 补的是**日志正文**这一半：GA 侧把失败 job 日志脱敏 + gzip + base64
     * 写成 CNB 附件 + 一条带 marker 的 PR 评论，本地 `pnpm ship --gh-logs`
     * 优先从 CNB 站内读，判红时不必再出站 github.com。
     * 这几条钉住「接线在场 + 不承重」：少一条就会退回旧链路而没人发现。 */
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pr-gate.yml"), "utf8");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("ci-ga-logs-relay.mjs");
    expect(workflow).toContain("把 GA 判红日志正文搬到 CNB");
    /* 写评论用已配好的 CNB_ISSUE_TOKEN（repo-notes:rw）；ISSUE #3454 起另配一枚
     * CNB_PULL_REQUEST_TOKEN（repo-pr:rw）只写 PR 描述，旧令牌不扩权。
     * 内置 github.token 读本 run 的 job logs。 */
    expect(workflow).toContain("secrets.CNB_ISSUE_TOKEN");
    expect(workflow).toMatch(/GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/u);
    /* step 级 continue-on-error：日志搬不到绝不改本 run 的 conclusion。
     * 判决链 / commit-statuses / 流水线 name 一个字都不许动。 */
    const relayBlock = workflow.slice(workflow.indexOf("把 GA 判红日志正文搬到 CNB"));
    expect(relayBlock).toContain("continue-on-error: true");
    expect(relayBlock).toContain("if: always()");
    /* 流水线 name 在 `.cnb.yml`（commit-status context 含它），本格一个字不动。 */
    expect(readRegisteredConfig()).toContain("name: GA 判决回调（骨架·休眠）");
    /* 本地读者在场：ship 侧从 CNB 站内读回的模块。 */
    expect(readFileSync(path.join(ROOT, "scripts/ship-gh-logs.mjs"), "utf8")).toContain(
      "ship-ga-logs-cnb.mjs",
    );
  });

  it("GA 判红评论并列念送达/判决：relay step 带 GA_JOB_RESULTS，承重一字不动（ISSUE #3452）", () => {
    /* commit-status 那条 `error [2.2s]` 是 GA 判决结论的镜像，不是回调腿挂了；
     * 平台这格 description 没有写入口（Swagger 三条 commit-status 路径全是 get），
     * 承重退码更不许动，于是把解释念进 #3437 那条本来就会发的 PR 评论。
     * 这几条钉住「env 接线在场 + 复用同一份结论折叠 + 不碰承重」。 */
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pr-gate.yml"), "utf8");
    const relay = readFileSync(path.join(ROOT, "scripts/ci-ga-logs-relay.mjs"), "utf8");
    /* relay step 带 GA_JOB_RESULTS（与结论回调那一跳同源），评论才念得出本次 verdict。 */
    const relayBlock = workflow.slice(workflow.indexOf("把 GA 判红日志正文搬到 CNB"));
    expect(relayBlock).toContain("GA_JOB_RESULTS: ${{ join(needs.*.result, ',') }}");
    /* 复用优先：结论折叠 import callback 已导出的纯函数，不另抄词表（§12.18）。 */
    expect(relay).toContain("conclusionFromJobResults");
    expect(relay).toContain("verdictFromConclusion");
    expect(relay).toContain('from "./ci-ga-verdict-callback.mjs"');
    /* 评论里并列念两件事，且 marker 形状不动（本地读者只认 marker + 附件链）。 */
    expect(relay).toContain("**送达**");
    expect(relay).toContain("**判决**");
    expect(relay).toContain("GA 判决结论的镜像");
    /* 承重一字不动：不写 commit-statuses、不改流水线 name、不改三态退码。 */
    expect(readRegisteredConfig()).toContain("name: GA 判决回调（骨架·休眠）");
    expect(relay).toContain("不碰承重");
    const script = stageScriptLine(readRegisteredConfig(), "GA 结论判定");
    expect(script).toContain("exit 0");
    expect(script).toContain("exit 1");
    expect(script).toContain("exit 2");
  });

  it("GA 判红日志挂 PR 本体：另配 CNB_PULL_REQUEST_TOKEN（repo-pr:rw），评论仍是权威读源（ISSUE #3454）", () => {
    /* 期望 3 的答案是「另配写描述专用令牌」，不是给 CNB_ISSUE_TOKEN 扩权：
     * `patch-pull` 要 repo-pr:rw、`post-pull-comment` 要 repo-notes:rw，两枚分开。
     * 描述通道是「读改写只替换自己那块」的只写镜像；本地读者只扫评论列表，
     * 不许把描述也并进读源（两处都命中 = 读到哪份全凭列表顺序）。 */
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pr-gate.yml"), "utf8");
    const relay = readFileSync(path.join(ROOT, "scripts/ci-ga-logs-relay.mjs"), "utf8");
    const reader = readFileSync(path.join(ROOT, "scripts/ship-ga-logs-cnb.mjs"), "utf8");
    /* 接线：新 secret 注入 relay step，脚本认这个 env 名。 */
    expect(workflow).toContain("CNB_PULL_REQUEST_TOKEN: ${{ secrets.CNB_PULL_REQUEST_TOKEN }}");
    expect(relay).toContain("CNB_PULL_REQUEST_TOKEN");
    /* 只写描述：GET 读回 → PATCH 写回，且用另一枚令牌（不拿 CNB_ISSUE_TOKEN 顶）。 */
    expect(relay).toContain("PATCH");
    expect(relay).toContain("mergeRelayDescription");
    expect(relay).toContain("stripRelayDescription");
    /* 评论先发（发布附件）再镜像描述；描述失败不算送达失败。 */
    expect(relay).toContain("mirrorRelayDescription");
    /* 本地读者一行不改：仍只认 `cnb pulls list-comments`，描述不进读源。 */
    expect(reader).toContain("pulls");
    expect(reader).toContain("list-comments");
    expect(reader).not.toContain("get-pull");
    /* 承重一字不动：step 仍不承重，流水线 name 与三态退码不变。 */
    const relayBlock = workflow.slice(workflow.indexOf("把 GA 判红日志正文搬到 CNB"));
    expect(relayBlock).toContain("continue-on-error: true");
    expect(relayBlock).toContain("if: always()");
    expect(readRegisteredConfig()).toContain("name: GA 判决回调（骨架·休眠）");
    expect(relay).toContain("不碰承重");
  });

  it("ISSUE #3667：判绿按需档接线在场，且不碰承重（scope=all / CNB 触发口 / 本地读回）", () => {
    /* 判红 relay 默认只搬失败 job（#3437）；本单让「有需要时」判绿也能经
     * GA→CNB→本地 取到日志：GA 侧 scope=all 搬全部 job，CNB 侧一条平台池触发口
     * 代发 workflow_dispatch，本地 --gh-logs 按 marker 的 scope 呈现。
     * 这几条钉住「接线在场 + 不承重」：少一条就会静默退回出站链路。 */
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pr-gate.yml"), "utf8");
    const relay = readFileSync(path.join(ROOT, "scripts/ci-ga-logs-relay.mjs"), "utf8");
    const onDemand = readFileSync(path.join(ROOT, "scripts/ci-ga-logs-on-demand.mjs"), "utf8");
    const reader = readFileSync(path.join(ROOT, "scripts/ship-gh-logs.mjs"), "utf8");
    /* GA 侧：workflow_dispatch 多三个按需 input，relay step 读 scope / run_id / PR 号。 */
    expect(workflow).toMatch(/^ {6}pr_number:$/m);
    expect(workflow).toMatch(/^ {6}relay_scope:$/m);
    expect(workflow).toMatch(/^ {6}run_id:$/m);
    expect(workflow).toContain("GA_LOG_SCOPE: ${{ github.event.inputs.relay_scope || '' }}");
    expect(workflow).toContain("GA_LOG_RUN_ID: ${{ github.event.inputs.run_id || '' }}");
    expect(workflow).toContain(
      "github.event.inputs.pr_number || github.event.client_payload.pr_number",
    );
    /* relay 脚本：默认 failed、只认字面 all、marker 带 scope、判绿全量也走同一载体。 */
    expect(relay).toContain("relayScopeFromEnv");
    expect(relay).toContain("RELAY_SCOPE.ALL");
    expect(relay).toContain("scope=${scope}");
    expect(relay).toContain("按需全量");
    /* CNB 侧：触发口在册、平台池形态、点的是专用脚本（不是 --preset）、有独占锁。 */
    const cnb = readRegisteredConfig();
    expect(cnb).toContain("api_trigger_ga_logs:");
    expect(cnb).toContain("node scripts/ci-ga-logs-on-demand.mjs");
    expect(cnb).toContain("*lock_ga_logs");
    const lane = /^[ ]{2}api_trigger_ga_logs:[\s\S]*?(?=^[ ]{2}\S|^\S)/m.exec(cnb);
    expect(lane?.[0]).not.toContain("--preset");
    expect(onDemand).toContain("dispatchRequest");
    /* 本地读者：旧评论（无 scope）回落 failed 逐字兼容，全量档不把判绿误报成失败。 */
    expect(reader).toContain('meta.scope === "all"');
    expect(reader).toContain("判绿 job 的正常形态");
    /* 承重一字不动：relay step 仍不承重，流水线 name 与三态退码不变。 */
    const relayBlock = workflow.slice(workflow.indexOf("把 GA 判红日志正文搬到 CNB"));
    expect(relayBlock).toContain("continue-on-error: true");
    expect(relayBlock).toContain("if: always()");
    expect(cnb).toContain("name: GA 判决回调（骨架·休眠）");
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

  it("`E2E 那一格已离开 PR（撤档，不是停用），而它的序约束整套落在 GA 每日档", () => {
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
     * 顺序约束整体搬到了每日档，搬去的落点（GA daily.yml）由本条后半判住。 */
    expect(
      disabled,
      "`E2E 关键流程` 出现在停用清单里 —— 它不是「临时屏蔽、等环境好了加回来」，" +
        "而是**已经在每日档上每天跑着**（GA daily.yml 的 `全量E2E` step）。登进停用清单等于同时说两句假话",
    ).not.toContain("E2E 关键流程");

    /* 顺序约束落到 GA 每日档：浏览器缺件时整档只红在 launch 那一跳，而产物不在时
     * 红在 webServer 的 180s 超时上 —— 两者都指不到真正缺的那一格。 */
    const steps = gaDailyJobSteps();
    const e2eAt = steps.findIndex((n) => n.startsWith("全量E2E"));
    expect(
      e2eAt,
      "GA daily.yml 里没有「全量E2E」step —— 上面那条搬家的断言失去落点",
    ).toBeGreaterThan(-1);
    for (const prerequisite of ["浏览器安装", "生产构建"]) {
      const at = steps.findIndex((n) => n.startsWith(prerequisite));
      const why =
        prerequisite === "生产构建"
          ? "这一格的 webServer 起的是 `pnpm start`，产物来自它"
          : "缺件时整档会以「每条都报同一个 launch 失败」的形态红";
      expect(
        at,
        `GA daily.yml 里没有「${prerequisite}」step —— 「${prerequisite}」必须排在「全量E2E」之前 —— ${why}`,
      ).toBeGreaterThanOrEqual(0);
      expect(at, `GA daily.yml 的「${prerequisite}」必须排在「全量E2E」之前`).toBeLessThan(e2eAt);
    }
    /* 产物前提要**写在配置里**，不能只靠顺序推断：这一格显式声明 `COMFY_E2E_SERVER: start`。
     * 少了这一行，它对产物的依赖就回到「因为它是 CI」那种推论 —— 而这次的红正是推论错了。
     * 单跑口（oneshot-e2e.yml）是同一格的副本，同一条断言一起钉。 */
    expect(
      gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日全量E2E"] ?? ""),
      "GA daily.yml 的「全量E2E」没有显式声明 `COMFY_E2E_SERVER: start` —— 它起的是生产服务器，" +
        "这件事必须由配置自己说出来，而不是由「它是 CI」推出来（`cnb-ob4-1k5828a36` 的教训）",
    ).toContain('COMFY_E2E_SERVER: "start"');
    expect(
      gaStepBlock(".github/workflows/oneshot-e2e.yml", "全量E2E（cnb 同款判据一字不改）"),
      "单跑 E2E（oneshot-e2e.yml）没有显式声明 `COMFY_E2E_SERVER: start` —— 与每日档同一份判据",
    ).toContain('COMFY_E2E_SERVER: "start"');
  });

  it("`每日浏览器安装` 的入口在盘上（#3504 起执行者是 GA daily.yml 那一格）", () => {
    /* 那一步点名的入口必须真在盘上（同 `Python 探测入口` 口径：路径写错不在解析期报错，只在真用时答「文件不存在」）。
     * 名字带「每日」是 2026-10-19 挪档结果（撤节奏不撤账），由「PR 撤掉的格必须在每日档有同名执行者」判。 */
    const block = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日浏览器安装"] ?? "");
    expect(block, "GA daily.yml 里解析不出「浏览器安装」那一步").toBeTruthy();
    const command =
      block
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? "";
    const entry = /(?<path>scripts\/[A-Za-z0-9_\-./]+)/.exec(command)?.groups?.path;
    expect(entry, `「浏览器安装」那一步指向的不是 scripts/ 下的入口：${command}`).toBeTruthy();
    expect(
      existsSync(path.join(ROOT, entry ?? "")),
      `「浏览器安装」点名的入口不在盘上：${entry}`,
    ).toBe(true);
  });

  it("`每日浏览器安装` 那一步把下载的套接字超时放宽了（180 MiB 撞 30s 是「没量完」）", () => {
    /* 现场（`cnb-rkr-1k510rsgg` 的 `浏览器安装`）：180 MiB 包撞 Playwright 默认 30s **套接字**超时（`NET_DEFAULT_TIMEOUT`）被掐断（原文 `timed out after 30000ms`）。
     * 那不是「CDN 不通」的结论，是「这一次没量完」—— 处置相反（换镜像 vs 放宽），而日志里此前分不开它们。
     * 这个键是本档唯一能碰「下载」的地方，`env` 键写错不在解析期报错、只在下一次下载时同形再红 ⇒ 按「块内必须有这个键」判。
     * #3504 起执行者是 GA daily.yml 的 `浏览器安装` step，单跑口（oneshot-e2e.yml）是同一格的副本 —— 两处一起钉，改一边不改另一边当场红。
     */
    for (const [file, step] of [
      [DAILY_YML, DAILY_GATE_EXECUTORS["每日浏览器安装"] ?? ""],
      [".github/workflows/oneshot-e2e.yml", "浏览器安装（cnb 同款入口；npmmirror 镜像源同 CNB）"],
    ] as const) {
      const stage = gaStepBlock(file, step);
      expect(stage, `${file} 里解析不出「浏览器安装」这一步 —— 名字被改了？`).toBeTruthy();
      expect(
        stage,
        `${file} 的「浏览器安装」没设 \`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT\` —— 默认的 30s 是` +
          "**套接字**超时，180 MiB 的包在慢链路上会被它按时掐断",
      ).toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT");
      expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:\s*"[1-9]\d*"/);

      /* 光放宽预算不够：放宽到 120s 之后**照旧超时**（`cnb-gt1-1k513ill4`：`timed out after 120000ms`）⇒ 这台节点真到不了 `cdn.playwright.dev`，镜像那一行才是让下载**到得了**的那件。
       * 少了它，这一步会以「超时」一直红，而人只会不断调那个数字；而它**推不出来**：Playwright 三个内置镜像全是同一族，`retryCount = 5` 的回退等于没有（实测 5 次同域名后 `Download failure, code=1`）。
       * 对应读数与判据见 `tests/ci-toolchain-selfcheck.test.ts` 的「下载根由外面给」那组。
       */
      expect(
        stage,
        `${file} 的「浏览器安装」没设 \`PLAYWRIGHT_DOWNLOAD_HOST\` —— 自托管节点到不了 ` +
          "`cdn.playwright.dev`（120s 也超时），只放宽那个超时数字是没用的",
      ).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
      expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST:\s*"https:\/\/[^"]+"/);
    }
  });

  it("`每日单元测试` 排在 GA 每日档全部前提格之后；Python 前提格的退役有原文", () => {
    /* 这条原来是 PR 那份顺序判据（`单元测试` vs `Python 可用性`）；2026-10-19 两格挪到每日档。缺前提时单测照旧往下跑，而它要 2h24m 才可能被墙钟掐断（`cnb-jt3-1k5071kou`）——「要么看不到、要么在最贵的位置才看到」这个形态与挂哪条流水线无关。
     * #3504 起判 **GA daily.yml 的事实顺序**（单 job 串行，与 CNB 每日档同一工作区语义）；
     * `每日 Python 可用性` / `每日 Python 探针读数` 随自托管退役（GA runner 的 Python 由镜像钉死）——
     * 退役是**写出来的决定**（daily.yml 头注「刻意不承接」段），不是顺手删两行，这里对着原文钉住。 */
    const dailyYml = readFileAt(ROOT, DAILY_YML);
    expect(
      dailyYml,
      "daily.yml 头注没有「刻意不承接」那段 —— Python 前提格的退役必须是写出来的决定，" +
        "否则「没人跑」与「还没迁」分不开",
    ).toContain("刻意不承接");
    expect(
      dailyYml,
      "退役理由的原文丢了 —— 「GitHub runner 的工具链由镜像与 setup-* 钉死」是那七格退役的根据",
    ).toContain("无需自证");

    const steps = gaDailyJobSteps();
    const testAt = steps.findIndex((n) => n.startsWith("单元测试"));
    /* 两个名字都必须取到：取不到就是**这一格被从清单里删了**，而顺序判据会退化成
     * 「-1 比 -1 小」那种永远成立的空判（解析失败伪装成结论）。 */
    expect(testAt, "`单元测试` 不在 GA daily.yml 里了").toBeGreaterThanOrEqual(0);
    for (const prerequisite of ["安装依赖", "同步数据库表结构"]) {
      const at = steps.findIndex((n) => n.startsWith(prerequisite));
      expect(at, `GA daily.yml 里没有「${prerequisite}」step`).toBeGreaterThanOrEqual(0);
      expect(
        at,
        `GA daily.yml 的「${prerequisite}」必须排在「单元测试」之前：缺 ${prerequisite} 时那一格照旧往下跑，` +
          "红的形态是几十分钟之后一句 `timeout`，读不到原因",
      ).toBeLessThan(testAt);
    }
  });

  it("`单元测试` 是 GA 每日档最后一个**会红的格**；其后只允许读数型尾巴", () => {
    /* 业主口径：「将每日单元测试放最后，最容易出问题的放最后」。这是**覆盖面**不是偏好：GA 的 steps 串行且失败即停，而这一格是唯一会因机器负载红的 ——
     * 实测 `cnb-b0l-1k59op66t` 775 份只 1 份红在 `Test timed out in 30000ms`（同时另有两份在跑全量 vitest/eslint），其后三格全 `skipped` ⇒ 它排中间时一次抖动决定那三格这一天跑不跑。
     * #3504 起顺序判在 GA daily.yml：其后只允许 `if: failure()`（环境证据，绿跑不付钱、红跑不吞结论）与
     * `if: always()`（覆盖率报告 warn / 镜像漂移）这些**读数型尾巴**，不能再有会红的重格。
     * ⚠️ 顺序只在 `daily` 这一个 job 内有意义 —— `失败立案` 自 #3563 起是**下游 job**，
     * 它不在这条尾巴里（它的 `if: failure()` / `continue-on-error` 由立案那条判据钉在 job 级）。 */
    const steps = gaDailyJobSteps();
    const idx = steps.findIndex((n) => n.startsWith("单元测试"));
    expect(steps.length, "GA daily.yml 解析不出 steps —— 这条顺序判据没有对象了").toBeGreaterThan(
      0,
    );
    expect(idx, "GA 每日档必须有 `单元测试`").toBeGreaterThanOrEqual(0);
    expect(
      steps.slice(idx + 1),
      "`单元测试` 之后只能跟读数型尾巴（环境证据 / 覆盖率报告 / 镜像漂移判据），不能再有会红的格",
    ).toEqual([
      "环境证据（失败时：dmesg 的 OOM 行 + 内存读数）",
      "覆盖率报告（artifact；对位 CNB 的 `覆盖率上报` 格）",
      "镜像漂移判据（CNB master vs GitHub master）",
    ]);
    /* 「读数型」不是嘴上说说：尾巴三格各自带 `if:` 限形 —— 证据只在失败那一跑、
     * 覆盖率与漂移不挡树级读数。谁把尾巴换成无条件会红的格，上面那条 toEqual 已经红；
     * 这里再钉 `if:` 形状，把「尾巴必须是读数」这件事留在机器可读的面上。
     * 取的是 **`daily` 那个 job 的块**而不是整份文件：整份搜会把下游 job 的 `if:` 也算进来，
     * 于是「尾巴被换成无条件重格」这种红会被别处的字面量掩盖过去。 */
    const dailyJob = gaJobBlock(DAILY_YML, "daily") ?? "";
    const unitAt = dailyJob.indexOf("      - name: 单元测试");
    expect(
      unitAt,
      "在 `daily` job 块里定位不到「单元测试」—— 这条尾巴判据没有对象了",
    ).toBeGreaterThan(-1);
    const tail = dailyJob.slice(unitAt);
    expect(
      (tail.match(/if: (?:failure|always)\(\)/g) ?? []).length,
      "单元测试之后的尾巴没有 `if: failure()` / `if: always()` 限形 —— 它们必须是读数型格子",
    ).toBeGreaterThanOrEqual(3);
  });

  it("`API 文档生成与自检` 只在每日档：push 侧不再即时判，GA 每日档排在单元测试之前（ISSUE #2537）", () => {
    /* 2026-11-05 的口径变更：这一格从 push 撤到每日档 —— **PR 侧不再即时判**，
     * 最晚次日 01:37 暴露，暴露窗口 ≤24h。判三件事：
     *   ① push 清单里没有旧名（有人改回去要红）；
     *   ② GA 每日档有这一格，且**在 `单元测试` 之前**（后者必须是最后一个会红的格）；
     *   ③ GA 那格点的还是同一份判据。
     * ⚠️「触发面 = typedoc 派生面」的对账**没有因为挪档而削弱**：它在
     * `tests/ci-incremental-gates.test.ts`（`INPUT_RES` 形态）与
     * `tests/docs-api-input-closure.test.ts`（面罩得住事实面）里照旧判着。 */
    const text = readRegisteredConfig();
    expect(
      registeredPushGateOrder(text),
      "「API 文档生成与自检」回到了 push 清单 —— 2026-11-05 起它只在每日档（ISSUE #2537：98% 触发率、40.9s 中位、占 30.6%）",
    ).not.toContain("API 文档生成与自检");

    const steps = gaDailyJobSteps();
    const at = steps.findIndex((n) => n.startsWith("API 文档生成与自检"));
    const lastRed = steps.findIndex((n) => n.startsWith("单元测试"));
    expect(
      at,
      "GA daily.yml 里没有「API 文档生成与自检」—— 降频之后这一格没有执行者了",
    ).toBeGreaterThanOrEqual(0);
    expect(lastRed, "GA daily.yml 里没有「单元测试」").toBeGreaterThanOrEqual(0);
    expect(
      at,
      "「API 文档生成与自检」必须排在「单元测试」之前 —— 后者必须是最后一个会红的格",
    ).toBeLessThan(lastRed);
    const block = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日 API 文档生成与自检"] ?? "");
    expect(block, "GA 每日档里解析不出「API 文档生成与自检」这一格").toBeTruthy();
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
    /* 停用档才要求留痕 —— 条件收进合取式（未停用即恒真），断言本体无条件跑。 */
    expect(
      !inDisabled || stageKeptAsComment(text, "单元测试"),
      "`单元测试` 被停用了，但 .gates 里没有它的注释原文 —— 恢复时无原文可依",
    ).toBe(true);
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
      /* 2026-11-08 转正（ISSUE #3378）：`GitHub 判决回读` 随老轮询主列停用，换成
       * `GA 回调结论回读` —— 它同样要活到 GA 出结论（站内短轮询 45m 预算），
       * 预算缺席时卡死要等满 2h 才有人知道，所以这一列不能空。 */
      "GA 回调结论回读",
      // 2026-11-02 `受影响用例` / `固定结构用例` 从 **CNB 侧**撤到每日全量单测：这两个
      // **CNB PR stage** 不再存在，预算要求随之解除（GA 的 PR 侧仍有那两个 job ——
      // 它们的预算是 workflow 里的 `timeout-minutes: 45`，不在本表；见规范 §13.5.41）。
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
    /* PR = 一条主列 + 平台池镜像出口（ISSUE #3418 转正后的常驻例外）。
     * ISSUE #3378 收尾：push **主列已撤**，push 事件下只剩那条平台池镜像出口
     * （ISSUE #3426），所以这一行从「1 + 出口」改成「出口」。 */
    const prMirrorAlive = text.includes("- name: GitHub 镜像同步（平台池）") ? 1 : 0;
    const pushMirrorAlive = text.includes("- name: GitHub master 镜像（平台池）") ? 1 : 0;
    expect(rows.filter((r) => r.event === "pull_request").length).toBe(1 + prMirrorAlive);
    expect(rows.filter((r) => r.event === "push").length).toBe(pushMirrorAlive);
    expect(rows.filter((r) => r.event !== "pull_request").length).toBeGreaterThanOrEqual(8);
    /* 三条每日触发口仍然同一把（那份互斥是刻意保留的，不是被这次改动顺手拆掉的）。
     * 这里**不钉事件名清单** —— 「有没有定时口」由「定时档不在本机、在 GA」那条管，
     * 这里只管锁。#3504 起清单是内联的（stagesRef = inline:<流水线名>，两条必然不同名），
     * 「同一件事」按**实际格名签名**比 —— 与 lockClassViolations 的 R3 同一条口径。 */
    const workSignature = (r: { name: string }): string =>
      `names:${pipelineStageNames(text, r.name).join("|")}`;
    const daily = rows.filter((r) => r.lockRef === "lock_daily");
    expect(daily.length).toBe(2);
    expect(new Set(daily.map(workSignature)).size).toBe(1);
    expect(daily.every((r) => r.event !== "pull_request")).toBe(true);
    /* 单跑：同一档的 web 与 api 各引用同一把、且跑的是同一格派发。 */
    /* SAFETY: 类型断言已复核 */
    for (const suffix of ["build", "e2e", "unit"] as const) {
      const same = rows.filter((r) => r.lockRef === `lock_oneshot_${suffix}`);
      expect(same.length, `单跑 ${suffix} 那两条应有一把共用的类锁`).toBe(2);
      expect(new Set(same.map(workSignature)).size).toBe(1);
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
     * #3504 起执行者是 GA daily.yml 的 `覆盖率报告` step：GitHub runner 没有 `cnb` CLI（CNB 那格的 `ci-coverage-report.mjs` 走平台插件），判据本体不为换平台重抄，
     * 这里退成**产物出口** —— `full-suite-run.mjs` 已产出 lcov / json-summary，上传成 artifact 让「今天的覆盖率」有地方可取。
     * 「没有报告时不判红」的机器形状：`if: always()` + `if-no-files-found: warn` —— 单测红了仍要能拿到报告，而报告缺席不许把这一格叠成第二个红。 */
    const step = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["覆盖率上报"] ?? "");
    expect(
      step,
      "GA daily.yml 里没有「覆盖率报告」step —— 平台侧的覆盖率读数又没人写了（报告连落点都没有）",
    ).toBeTruthy();
    expect(step, "「覆盖率报告」不是 `if: always()` —— 单测红了的那一跑也要能拿到报告").toContain(
      "if: always()",
    );
    expect(
      step,
      "「覆盖率报告」缺报告时必须 warn 而不是判红（`if-no-files-found` 缺省是 error —— 那正是旧版在 1~2s 内红掉的那一格的 GA 形）",
    ).toContain("if-no-files-found: warn");
    expect(
      step,
      "「覆盖率报告」要上传 `coverage/` —— 上报到别处时「今天的覆盖率」从 artifact 里取不到",
    ).toContain("path: coverage/");
    expect(
      step,
      "「覆盖率报告」必须点名 artifact 名 comfyapp-coverage —— 落点名字漂了，取报告的人按旧名找不到",
    ).toContain("name: comfyapp-coverage");
  });

  it("定时档不在本机、在 GA：CNB 无 crontab，GA schedule 在，手点口派发到同一份清单", () => {
    /* 定时重档的执行者从这台自托管机迁到 GitHub Actions 之后，「有没有每天跑一次」
     * 换了地方，判据不能跟着松掉 —— 三件各自会静默失效的事实仍要逐项钉：
     *
     *   ① CNB 配置里**不许**再有 `crontab:` 事件。留一条空占位最危险：平台不报错、
     *      只是永远不触发，而配置看上去仍像有定时档（#1229 那一族）；本机白扛负载
     *      或两边都不跑，账面一条红都不会有。
     *   ② GA 侧 `daily.yml` / `package-desktop.yml` 必须各有 `schedule`，且 cron 对位
     *      北京 01:37 / 03:37（GitHub cron 用 UTC ⇒ 17:37 / 19:37 前一天；#3485 起挪出
     *      整点 —— 官方明示整点高负载下 schedule 会延迟甚至被丢弃，11/9 Daily 缺席即此）。
     *      少一条 = 本机已撤定时、那边又没人起，这一档就真的没有执行者了。
     *   ③ 留在 CNB 的手点口派发到 GA daily.yml（`--preset daily`，与注册表一致）——
     *      撤的是「时钟起它」+「本机执行」，不是把这一档本身撤掉。 */
    const text = readRegisteredConfig();
    expect(
      crontabEvents(text),
      "`.cnb.yml` 里又出现了 crontab 事件 —— 定时重档已迁 GA，本机不该再被时钟起",
    ).toEqual([]);
    expect(text, "配置里少了「定时档已迁 GA」的说明锚点 —— 撤定时是决策，不是顺手删两行").toMatch(
      /定时档的执行者已从这台机迁到 GitHub Actions/,
    );

    const dailyYml = readFileSync(path.join(ROOT, ".github/workflows/daily.yml"), "utf8");
    const packageYml = readFileSync(path.join(ROOT, PACKAGE_YML), "utf8");
    expect(dailyYml, "`.github/workflows/daily.yml` 没有 schedule —— 每日档从此无人执行").toMatch(
      /^\s*schedule:\s*$/m,
    );
    expect(dailyYml, "每日档的 cron 不是北京 01:37（UTC 17:37）").toMatch(
      /cron:\s*"37 17 \* \* \*"/,
    );
    expect(packageYml, "`.github/workflows/package-desktop.yml` 没有 schedule").toMatch(
      /^\s*schedule:\s*$/m,
    );
    expect(packageYml, "桌包档的 cron 不是北京 03:37（UTC 19:37）").toMatch(
      /cron:\s*"37 19 \* \* \*"/,
    );

    const dailyTarget = GA_TRIGGER_TARGETS.find((t) => t.preset === "daily");
    if (!dailyTarget) {
      throw new Error("注册表里没有 daily 那一行，这条判据没有对象");
    }
    expect(
      stageScriptLine(text, dispatchStageName(dailyTarget)),
      "手点那一口不再派发 daily —— 「撤定时不撤判据」这句话就没有对象了",
    ).toBe(`node scripts/ci-ga-dispatch.mjs --preset daily`);
    /* 每日档的「跑什么」现在全部住在 daily.yml；这一格是最贵的重格，入口与预算在
     * GA 那边继续钉（stageTimeout 的对应物是 `timeout-minutes`）。 */
    const buildStep = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日生产构建"] ?? "");
    expect(buildStep, "GA daily.yml 里找不到「生产构建」那一格").toBeTruthy();
    expect(
      buildStep,
      "「生产构建」跑的还是裸 `pnpm run build` —— 那样这一次的绿只落在日志里、" +
        "账面上一个字不变。入口要写 `node scripts/ci-daily-build.mjs`",
    ).not.toContain("pnpm run build");
    const entry = "scripts/ci-daily-build.mjs";
    expect(buildStep, `「生产构建」没有点名 ${entry}`).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在 GA 侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 预算：一天的预算只有这一条，卡满 2h 墙钟等于当天这一跑没有结论。
     * GA 的 `timeout-minutes: 30` 对位 CNB 那格的 `timeout: 30m`。 */
    expect(
      buildStep,
      "「生产构建」没有 `timeout-minutes` 预算 —— GA job 顶层是 300m 兜底，卡死要等满才有人知道",
    ).toContain("timeout-minutes: 30");
  });

  it("每日档重格红后有环境证据步：dmesg 的 OOM 行 + 内存读数（ISSUE #3333）", () => {
    /* 立案现场：GA Daily 连续多天红在不同重格（全量E2E / API 文档 / 单元测试），每次
     * 环境杀都停在「最大嫌疑」——hosted runner 的内核 OOM 行不会自己进 step 日志，
     * dmesg 在 ubuntu-24.04 镜像上要 sudo。这一步 `if: failure()` 兜住全部会红的格：
     * 一个诊断点，不按重格复制三份；绿的那一跑一个字节都不付。 */
    const dailyYml = readFileSync(path.join(ROOT, ".github/workflows/daily.yml"), "utf8");
    const stepAt = dailyYml.indexOf("name: 环境证据");
    expect(
      stepAt,
      "每日档没有「环境证据」诊断步 —— 重格的环境杀永远停在「疑似 OOM」",
    ).toBeGreaterThan(-1);
    expect(
      stepAt,
      "「环境证据」没排在「单元测试」之后 —— 排在它前面的会红格没被兜住",
    ).toBeGreaterThan(dailyYml.indexOf("name: 单元测试"));
    expect(
      stepAt,
      "「环境证据」该在「覆盖率报告」之前 —— 它是诊断读数，不该排到产物出口后面",
    ).toBeLessThan(dailyYml.indexOf("name: 覆盖率报告"));
    const stepText = dailyYml.slice(stepAt, dailyYml.indexOf("name: 覆盖率报告"));
    expect(stepText, "「环境证据」不是 `if: failure()` —— 绿的那一跑也要付这笔钱").toContain(
      "if: failure()",
    );
    expect(stepText, "没有 dmesg 的 OOM 行读数 —— 证据步空转").toContain("dmesg");
    expect(stepText, "没有内存读数（free -h）—— 只有 OOM 行分不出「耗尽」还是「被杀」").toContain(
      "free -h",
    );
  });

  it("桌包那一档独立成档：自己的派发目标 + 自己的锁 + 两个触发口同一份（ISSUE #2503）", () => {
    /* 业主口径「桌包独立一条，不要并进每日档」；落成三件会静默失效的事实：
     * ① 派发目标是**另一个 workflow**（并进每日档后每日会多背一次 cargo 编译 —— GA 侧
     *    `package-desktop.yml` 与 `daily.yml` 是两个文件、两个并发组，配对注册表逐行钉住）；
     * ② 锁是**另一把**（共用 `*lock_daily` 会让手点桌包掐停当日某一派发，#2114 换方向复发）；
     * ③ 定时与手点两个触发口引用**同一格派发** —— 抄第二份那一刻就开始漂。 */
    const text = readRegisteredConfig();
    const packageTarget = GA_TRIGGER_TARGETS.find((t) => t.preset === "package");
    if (!packageTarget) {
      throw new Error("注册表里没有 package 那一行，这条判据没有对象");
    }
    for (const name of [packageTarget.pipelineWeb, packageTarget.pipelineApi]) {
      expect(
        pipelineStageNames(text, name),
        `「${name}」解析不出 stage —— 锚点没接上，或者流水线名被改了`,
      ).toEqual([dispatchStageName(packageTarget)]);
      expect(
        stageScriptLine(text, dispatchStageName(packageTarget)),
        `「${name}」不再派发 package —— 那一档的执行者就只剩 GA 的 schedule 了`,
      ).toBe(`node scripts/ci-ga-dispatch.mjs --preset package`);
    }

    /* GA 侧承接（package-desktop.yml）的形状：构建格点既有的执行者 `pnpm tauri build`
     * （本单只换执行平台，不抄第二份打桌包脚本），预置格排在真构建**之前** ——
     * 顺序是判据的一部分：预置跑在 `pnpm tauri build` 之后等于没有，那一刻 bundler
     * 已经自己去撞那条下载预算了。 */
    const packageYml = readFileSync(path.join(ROOT, PACKAGE_YML), "utf8");
    const steps = [...packageYml.matchAll(GA_STEP_RE)].map((m) => m.groups?.name ?? "");
    const buildAt = steps.findIndex((n) => n.startsWith("桌面成品构建"));
    expect(
      buildAt,
      "package-desktop.yml 里没有「桌面成品构建」step —— 桌包这一档没有执行者了",
    ).toBeGreaterThanOrEqual(0);
    const buildStep = gaStepBlock(PACKAGE_YML, steps[buildAt] ?? "");
    expect(
      buildStep,
      "「桌面成品构建」必须点既有的执行者 `pnpm tauri build`（不抄第二份打桌包脚本）",
    ).toContain("pnpm tauri build");
    const prefetchAt = steps.findIndex((n) => n.startsWith("桌包工具预置"));
    expect(
      prefetchAt,
      "package-desktop.yml 里没有「桌包工具预置」step —— 那一格丢了就等于回到「构建期现下 GitHub release」",
    ).toBeGreaterThanOrEqual(0);
    expect(
      prefetchAt < buildAt,
      "工具预置排到了真打包之后 —— 那一刻 bundler 已经自己去撞那条下载预算了",
    ).toBe(true);

    /* 由「这一档有会真构建的格」直接推出来的那条安全前提（ISSUE #2883 把它变成判据）：
     * 它的安装格**不许**接依赖缓存槽。接槽形态下 `node_modules` 是指向项目根之外的
     * junction，而 Turbopack 对这一条有硬要求（#2081 那次 13.8s 就死）—— 换到 GA 的
     * Windows runner 依旧成立。GA 侧整批 workflow 都不该再出现这枚开关
     * （槽机制是自托管节点的 pnpm store 事实，hosted runner 没有那个根）。 */
    /* ⚠️ 只扫**代码行**（剥 `#` 注释）：daily.yml 的头注正当地会写出「COMFY_CI_SLOT 不置时
     * 一次槽都不问」这类取证文字，把注释判成违规等于逼人删注释（与 PS 5.1 那条同口径）。 */
    const slotBanned = (wf: string): boolean =>
      readFileAt(ROOT, path.join(".github/workflows", wf))
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .join("\n")
        .includes("COMFY_CI_SLOT");
    for (const wf of [
      "daily.yml",
      "oneshot-build.yml",
      "oneshot-e2e.yml",
      "oneshot-unit.yml",
      "package-desktop.yml",
    ]) {
      expect(
        slotBanned(wf),
        `GA workflow ${wf} 出现了 \`COMFY_CI_SLOT\` —— 槽是自托管节点的 pnpm store 机制，` +
          "hosted runner 上没有那个根；接槽会撞 #2081 那一形（要接得先验 #2521 的门）",
      ).toBe(false);
    }

    /* NSIS 工具现场读数（ISSUE #3297）：三件事都要有执行者 —— 在 GA 侧在、入口在盘上、
     * 且**夹在工具预置与真打包之间**（排到构建之后，那一刻 bundler 已经撞完 0x2，
     * 读数就没有「下一次红就能定性」的用处了）。 */
    const readoutAt = steps.findIndex((n) => n.startsWith("NSIS 工具镜像缓存"));
    expect(
      readoutAt,
      "package-desktop.yml 里没有「NSIS 工具镜像缓存」step —— 那一格丢了就回到「两格互相矛盾、仓里读不出答案」",
    ).toBeGreaterThanOrEqual(0);
    expect(
      prefetchAt < buildAt && readoutAt < buildAt,
      "NSIS 工具读数 / 工具预置必须都排在真打包之前 —— 排到构建之后，那一刻 bundler 已经撞完 0x2，读数就没有「下一次红就能定性」的用处了（GA 侧把「NSIS 镜像缓存」并入预置段，两格都在构建前即可）",
    ).toBe(true);

    /* 成品落点随执行面换形（#3504）：GA 产 artifact（按 run 取）+ 滚动 nightly Release，
     * 不再是本机常驻目录的「留 2 份」（hosted runner 是即弃机，回写开发机既没有通道也不该有）。
     * 四个落点都要有 step：少一个，「跑成功了但产物去哪了」就没人回答。
     * #3607 起补第四个：CNB 站内滚动 Release（用户在 CNB 侧提诉求、也该在 CNB 侧拿包，
     * GitHub 只是镜像仓）。 */
    for (const landing of ["上传安装版", "上传免安装版", "发布到滚动 Release", "回传成品到 CNB"]) {
      expect(
        steps.some((n) => n.startsWith(landing)),
        `package-desktop.yml 里没有「${landing}」step —— 成品落点少了一个`,
      ).toBe(true);
    }

    /* #3607 接线判据：回传步必须点既有脚本、带 continue-on-error（回传失败不碰构建结论）、
     * 且用专用 repo-release:rw 令牌。少一件，「CNB 侧能拿到包」这句话就没有执行者，
     * 或反过来把「桌包打出来了」判红 —— 正是这一格最容易静默失效的两头。 */
    const relayStep = gaStepBlock(PACKAGE_YML, "回传成品到 CNB（滚动 nightly Release）");
    expect(relayStep, "回传 step 解析不出来").toBeTruthy();
    expect(
      relayStep,
      "回传 step 没点既有入口 `ci-ga-desktop-relay.mjs`（别把上传链抄进 workflow 内联）",
    ).toContain("node scripts/ci-ga-desktop-relay.mjs");
    expect(relayStep, "回传 step 缺 continue-on-error —— 回传失败会反过来把构建结论判红").toContain(
      "continue-on-error: true",
    );
    expect(relayStep, "回传 step 没接专用 CNB_RELEASE_TOKEN（repo-release:rw）").toContain(
      "CNB_RELEASE_TOKEN",
    );
    /* #3607 诉求原意含「只要 build-tauri-release.ps1 那个纯壳、dev server 照用」：
     * 回传步要把现成 app.exe 的落点传给脚本，否则脚本只回传完整成品，纯壳那一半
     * 又随会话消失。判据钉的是接线形状（env 名 + 现成产物路径），不是脚本内部实现。 */
    expect(relayStep, "回传 step 没把纯壳产物落点 DESKTOP_SHELL_EXE 传给脚本").toContain(
      "DESKTOP_SHELL_EXE",
    );
    expect(relayStep, "纯壳落点不是 target/release/app.exe（别指向打包器后的别处）").toContain(
      "src-tauri/target/release/app.exe",
    );

    /* 锁：两个触发口同一把，且是桌包自己那把 —— 与每日档共用会互相掐停。
     * 两个触发口也要都在（ISSUE #3297：按钮要一双手，而 `#3302` 那格 NSIS 现场读数
     * 从合入起一次都没跑到 —— 判「读数格有没有执行者」这件事，得先有一个能被
     * CLI / NPC 触发的口）。 */
    const rows = pipelineLockAssignments(text).filter(
      (r) => r.name === packageTarget.pipelineWeb || r.name === packageTarget.pipelineApi,
    );
    expect(rows.length, "桌包那两条触发口没解析出来").toBe(2);
    expect(
      rows.map((r) => r.event).sort(),
      "桌包档在 CNB 该有 `web_trigger_package` + `api_trigger_package` 两个触发口（定时已迁 GA）",
    ).toEqual(["api_trigger_package", "web_trigger_package"]);
    expect(
      new Set(rows.map((r) => r.lockRef)).size,
      "同一份清单的触发口点的不是同一把锁 —— 同一件事会被排成两次互掐",
    ).toBe(1);
    expect(
      rows.every((r) => r.lockRef === "lock_package"),
      "桌包档的锁不是自己那把 `lock_package` —— 与每日档共用一把会互相掐停",
    ).toBe(true);
  });

  it("每日单元测试：整档 + 跑法脚本 + 预算大于脚本自己的墙钟预算（GA daily.yml）", () => {
    const entry = "scripts/full-suite-run.mjs";
    /* 只扫 `run` 那一串，不扫整块：这一档的注释正当地要写出「不许带 `--grep`」这句话，
     * 把说明判成违规等于逼人删注释（与 PS 5.1 那条形制判据「注释里同形文本放过」同一条口径）。 */
    const step = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日单元测试"] ?? "");
    const run =
      step
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? "";
    expect(run, "GA daily.yml 的「单元测试」没有 `run` —— 那一格根本不会跑任何命令").toBeTruthy();
    expect(
      run,
      "「单元测试」跑的应是**跑法脚本** —— 裸 vitest 的绿只落在日志里，" +
        "`scripts/.full-suite-freshness.json` 一个字不变，本地「当天跑过」那条判据照旧拦人",
    ).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在 GA 侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 整档：`isWholeTrackRun` 把「透传了参数」判成不构成凭证、当场不记账。
     * 所以这里判的不是风格 —— 加了 `--grep` 的那一跑会**绿着不记账**，
     * 而账面看起来与真跑过一模一样。 */
    for (const forbidden of ["--grep", "--coverage=false", "tests/"]) {
      expect(run, `「单元测试」带了 ${forbidden} —— 那不是整档，跑绿也不记账`).not.toContain(
        forbidden,
      );
    }
    /* 预算必须**大于**脚本自己的墙钟预算：否则先被掐的是 step，而那一刀不带
     * 「被预算砍 vs 判据红」的分流话术（`classifyOutcome`），读起来就像判据红。 */
    const m = /timeout-minutes:\s*(?<m>\d+)/.exec(step ?? "");
    const minutes = m ? Number(m.groups?.m) : 0;
    expect(
      minutes,
      "「单元测试」没有 `timeout-minutes` 预算（一天的量级，卡死要早报）",
    ).toBeTruthy();
    expect(
      minutes * 60_000,
      `step 预算必须大于 FULL_SUITE_TIMEOUT_MS（${FULL_SUITE_TIMEOUT_MS}ms）—— ` +
        "否则先被平台掐的是 step，那一刀没有分流话术",
    ).toBeGreaterThan(FULL_SUITE_TIMEOUT_MS);
    /* 单跑口是同一格的副本：跑法逐字相同（副本不许漂），预算同值。 */
    const oneshotStep = gaStepBlock(
      ".github/workflows/oneshot-unit.yml",
      "全量单测（cnb 同款判据一字不改）",
    );
    const oneshotRun =
      oneshotStep
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? "";
    expect(
      oneshotRun,
      "单跑单测（oneshot-unit.yml）的 `run` 与每日档不再逐字相同 —— 同一份脚本长在两个 workflow 各漂一份（#2081 那一族）",
    ).toBe(run);
  });

  it("每日全量E2E：整档（不许带任何收窄参数）+ 排在浏览器之后 + 有分钟量级预算（GA daily.yml）", () => {
    const entry = "scripts/e2e-run.mjs";
    const step = gaStepBlock(DAILY_YML, DAILY_GATE_EXECUTORS["每日全量E2E"] ?? "");
    const run =
      step
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? "";
    expect(run, "GA daily.yml 的「全量E2E」没有 `run` —— 那一格根本不会跑任何命令").toBeTruthy();
    expect(
      run,
      `「全量E2E」应点名 ${entry} —— 它是 \`FRESHNESS_TRACKS.e2e\` 现在唯一的执行者，` +
        "裸 `playwright test` 的绿不记账，而本地自证已经从钩子里撤掉（§11.8）",
    ).toContain(entry);
    expect(
      existsSync(path.join(ROOT, entry)),
      `${entry} 不在盘上 —— 那一步会在 GA 侧以「文件不存在」的形态红`,
    ).toBe(true);
    /* 收窄参数 = 跑绿也**不构成整档凭证**（`isWholeTrackRun`）。这一条比「风格」重：
     * PR 那一格带的正是 `--grep=@critical`，抄过来会得到一格「每天绿、账面永远不动」
     * 的档 —— 与「这一档三个月没人跑」在账面上逐字同形。
     * 只扫 `run`：这一档的注释正当地要写出「不许带 `--grep`」这句话。 */
    for (const forbidden of ["--grep", "tests/", "e2e/"]) {
      expect(run, `「全量E2E」带了 ${forbidden} —— 那不是整档，跑绿也不记账`).not.toContain(
        forbidden,
      );
    }
    /* 顺序与产物前提**不在这里判**：`生产构建` / `浏览器安装` 必须排在前、
     * 以及这一格显式声明 `COMFY_E2E_SERVER: start`，都写在上面那条「E2E 已离开 PR」的
     * 判据里 —— 那三件与「为什么这一格非搬不可」是同一个故事，拆成两处各自半条，
     * 读者两边都看不全（而同一件事判两遍正是 §12.12 要拦的形状）。
     * 这一格只管**跑法形状**：点名整档入口、不带任何收窄参数、带分钟量级预算。 */
    const m = /timeout-minutes:\s*(?<m>\d+)/.exec(step ?? "");
    const minutes = m ? Number(m.groups?.m) : 0;
    expect(
      minutes,
      "「全量E2E」没有 `timeout-minutes` 预算 —— GA job 顶层是 300m 兜底，卡死要等满才有人知道",
    ).toBeTruthy();
    expect(minutes, `「全量E2E」的预算 ${minutes}m 不在分钟量级那一档（10~60）`).toBeGreaterThan(9);
  });

  it("本地撤掉自证要求的三档，每一档的 `ciStage` 都在 GA 每日档有执行者（撤拦 ≠ 没人跑）", () => {
    /* 这一条是 `FRESHNESS_TRACKS[*].ciStage` 那格豁免的**唯一前提**：
     * `freshness-gate.mjs` 看到非空 `ciStage` 就不再要求本地当天自证，
     * 于是「本地不拦」成立的条件全在「平台侧那一格真的每天在跑」上。
     * 没有这条判据时，删掉一个每日 step（或把名字打错）会让那一档变成
     * **谁都不跑**，而本地照样绿 —— 那是本仓最不能有的静默形态（§11.23 那一族）。
     * #3504 起执行面在 GA daily.yml：逻辑格名 ⇄ step 名的对照登记在
     * `DAILY_GATE_EXECUTORS`，对照值必须真的在 daily.yml 的 step 名单里。 */
    const steps = gaDailySteps();
    expect(
      steps.length,
      "GA daily.yml 解析不出 steps —— 这条判据一旦取不到清单就会恒放行",
    ).toBeGreaterThan(0);
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      const stage = String(track.ciStage).trim();
      expect(
        stage,
        `\`${kind}\` 没有登记 ciStage，而本地又不拦 —— 那一档现在没有任何执行者`,
      ).toBeTruthy();
      const executor = DAILY_GATE_EXECUTORS[stage];
      expect(
        executor,
        `\`${stage}\`（${kind}）不在 \`DAILY_GATE_EXECUTORS\` 里 —— ${track.label} 这一档` +
          "的执行者登记缺失。要么补登记，要么把 ciStage 清空让本地重新拦",
      ).toBeTruthy();
      expect(
        steps,
        `\`${executor}\`（${stage} 的 GA 执行者）不在 daily.yml 的 step 名单里 —— ` +
          "本地不拦的前提没了。改 step 名必须同批改对照登记",
      ).toContain(executor);
    }
  });

  it("主体=master 的档：它的执行者在 GA 每日档（判据主体分权，ISSUE #2300）", () => {
    /* `FRESHNESS_TRACKS[*].subject` 答「**这一次是谁在判**」：`"pr"` = 本 PR（工作树那份账，PR 流水线与本地钩子），`"master"` = 主干（每日档在 master HEAD 上跑出的那份，权威副本在 `ci/freshness-ledger`）。
     * ⚠️ 主体=master ⇒ 那一档的账是主干的账 ⇒ 执行者必须落在**每日档**（每天刷新），PR 流水线里没有也不该有；否则「那一档没人判」无人回答，失效形态是「PR 拿主干的账判红别人的提交」。
     * ⚠️ **不**断言「它不许出现在 PR 清单」：`ciStage` 记的是每日格名，那条断言恒真 = 空转；PR 侧格名（`新鲜度账`）由 `PR_MOVED_TO_DAILY` 与 `tests/doc-check-hook-wiring.test.ts` 那条判。
     */
    const steps = gaDailySteps();
    expect(steps.length, "GA daily.yml 解析不出 steps —— 这条判据就没有对象了").toBeGreaterThan(0);
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
        steps,
        `\`${stage}\`（${kind}，主体=master）的 GA 执行者不在 daily.yml 里 —— ` +
          "主干的账只能由每日档那一格刷新与判读；它不在那儿，这一档就没人判了",
      ).toContain(DAILY_GATE_EXECUTORS[stage]);
    }
  });

  it("GA 每日档的前提格：安装、库表都必须排在单测之前", () => {
    const steps = gaDailyJobSteps();
    const suite = steps.findIndex((n) => n.startsWith("单元测试"));
    expect(suite, "「单元测试」不在 GA daily.yml 里").toBeGreaterThan(-1);
    /* 顺序不是风格：每次构建都是全新 runner（hosted runner 即弃机），没有
     * `node_modules` 与库表时，那一跑会以「找不到 next / 连不上库」的形态红，
     * 而那种报错指不到真正缺的那一格。 */
    expect(
      steps.findIndex((n) => n.startsWith("安装依赖")),
      "「安装依赖」必须排在「单元测试」之前 —— 否则整档跑在没有 node_modules 的检出上",
    ).toBeLessThan(suite);
    expect(
      steps.findIndex((n) => n.startsWith("同步数据库表结构")),
      "「同步数据库表结构」必须排在「单元测试」之前 —— 没库时读库的用例报的是「连不上」",
    ).toBeLessThan(suite);
    /* `每日 Python 可用性` 前提格已随自托管退役（GA runner 的 Python 由镜像钉死）；
     * 退役决定的原文由「单元测试排在前提格之后」那条判据对着 daily.yml 头注钉。 */
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
     * 桌包那一档必须被认成"有构建格"。#3504 起执行面在 GA package-desktop.yml ——
     * 取不到那格的 `run:` 行 ⇒ 先断言取到了，否则下面那条会退成恒真的空判。 */
    const packageBuild = gaStepBlock(PACKAGE_YML, "桌面成品构建（cnb 同款判据一字不改）");
    expect(
      packageBuild,
      "package-desktop.yml 里取不到「桌面成品构建」的 run 行 —— 现役对账就没有对象了",
    ).toBeTruthy();
    expect(
      stagesWithBuildConsumer(
        new Map([["桌面成品构建（cnb 同款判据一字不改）", [packageBuild ?? ""]]]),
      ),
      "桌包那一档按现役配置认不出构建格 —— 那张表的量程又比它自称的小了一圈（#2883）",
    ).toContain("桌面成品构建（cnb 同款判据一字不改）");
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

  it("从 PR 撤下来的环境格，每一格在 GA 每日档里都有同名执行者（撤拦 ≠ 撤账）", () => {
    /* 2026-10-19 口径：只判**节点**的格不必每个 PR 都判。**撤的是节奏，不是账**，判据是这句的机器形式：
     * ① 不在 PR 清单里（否则同时是两份执行者，镜像判据失去对象）；② GA 每日档（daily.yml）有对应 step；
     * ③ 那格点的仍是**同一个入口脚本**、共用脚本时带**那个分档旗标**。
     * 少了③，「撤到每日档」与「悄悄删掉」逐字同形：名字还在登记上、step 换成别的命令，两边都绿而那一格谁都不判了。
     * ⚠️ 三格（工具链自证 / Python ×2）连 GA 都刻意不承接 —— 它们已从本表摘掉、登记进总账 retired 段，
     * 退役决定有原文由「单元测试排在前提格之后」那条对着 daily.yml 头注钉。 */
    const text = readRegisteredConfig();
    const prOrder = registeredGateOrder(text);
    expect(prOrder.length, "解析不出 COMFYAPP_CI_GATES —— 这条判据就没有对象了").toBeGreaterThan(0);
    const steps = gaDailySteps();
    expect(steps.length, "GA daily.yml 解析不出 steps —— 这条判据就没有对象了").toBeGreaterThan(0);
    for (const [former, dailyName, entry, flag] of PR_MOVED_TO_DAILY) {
      expect(
        prOrder,
        `「${former}」又回到 PR 清单里了 —— 那意味着它同时是两份执行者，` +
          "`CROSS_LANE_SCRIPT_MIRRORS` 必须同批把它加回相同性判据，两处不能各说一套",
      ).not.toContain(former);
      const executor = DAILY_GATE_EXECUTORS[dailyName];
      expect(
        executor,
        `「${dailyName}」不在 \`DAILY_GATE_EXECUTORS\` 里 —— 「${former}」从 PR 撤下来之后没有执行者登记`,
      ).toBeTruthy();
      expect(
        steps,
        `「${former}」从 PR 撤下来之后，GA 每日档里没有「${executor}」—— ` +
          "这一格如今谁都不判，而清单上看着仍在",
      ).toContain(executor);
      const block = gaStepBlock(DAILY_YML, executor ?? "");
      const run =
        block
          ?.split("\n")
          .find((l) => /^\s*run:/.test(l))
          ?.trim() ?? "";
      expect(
        run,
        `GA 每日档里取不到「${executor}」的 run 行 —— 名字改了，还是整块没了`,
      ).toBeTruthy();
      expect(run, `「${executor}」点的入口不是 ${entry}：撤档不等于换判据`).toContain(entry);
      /* 旗标可空（不带旗标的格没有这一面）—— 条件收进合取式，断言本体无条件跑。 */
      expect(
        flag === "" || run.includes(flag),
        `「${executor}」丢了 ${flag} —— 它与别的格共用同一份脚本，是这一面旗标把它分成另一格`,
      ).toBe(true);
    }
  });

  it("门格总账：每一格的档位登记 ⇄ 各档实际在跑的格名（双向相等，#2640）", () => {
    /* §13.5.30 把「某格该属哪一级」判成工程判断，但「撤出后必须登记、且登记名不许还在跑」可以判；`GATE_TIER_LEDGER` 就是册子（档位手写登记）。
     * ① 各档清单 ⇄ 总账双向相等（清单多/少一格而总账没同批改、或总账漏登记都红 —— 这正是「两边一起被删」时仍绿的那个洞）；
     *    #3504 起每日档的实际格名 = GA daily.yml 的 step 名（检出 / 装 pnpm / 装 Node / 环境证据四行前提设施豁免）；
     *    #3662 起多一面：**GA pr-gate.yml 的 step 名**（ga-pr 档）—— 此前 GA 的 PR job 不在任何一面里，
     *    「记成 retired 却仍在 PR 上跑」对判据隐形（`受影响用例` / `固定结构用例` 两格）；
     * ② `retired` 的格不许再出现在任何清单里（降级≠删除），且必须带理由。 */
    const text = readRegisteredConfig();
    const prOrder = new Set(registeredGateOrder(text));
    const pushOrder = new Set(registeredPushGateOrder(text));
    const dailyOrder = new Set(gaDailySteps().filter((n) => !GA_DAILY_INFRA_STEPS.includes(n)));
    /* #3662 起多一面：GA pr-gate.yml 的 step 名（ga-pr 档）—— 此前 GA 的 PR job
     * 不在任何一面里，「记成 retired 却仍在 PR 上跑」对判据隐形。 */
    const gaPrOrder = new Set(gaPrGateSteps());
    const running = new Set([...prOrder, ...pushOrder, ...dailyOrder, ...gaPrOrder]);

    const tiers: Array<[GateTier, Set<string>, string]> = [
      ["PR", prOrder, "COMFYAPP_CI_GATES"],
      ["push", pushOrder, "COMFYAPP_CI_PUSH_GATES"],
      ["daily", dailyOrder, "GA daily.yml steps"],
      ["ga-pr", gaPrOrder, "GA pr-gate.yml steps"],
    ];
    for (const [tier, actual, source] of tiers) {
      const booked = new Set(GATE_TIER_LEDGER.filter((e) => e.tier === tier).map((e) => e.name));
      expect(
        [...booked].sort(),
        `门格总账记成 ${tier} 档的格 ⇄ ${source} 实际在跑的格名不一致（` +
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
    /* 对照登记与总账互相校验：`DAILY_GATE_EXECUTORS` 的值（GA step 名）必须都在
     * 总账的 daily 档里 —— 两份登记少同批改一边时，这里先红，而不是等对账静默漏一格。 */
    for (const [gate, step] of Object.entries(DAILY_GATE_EXECUTORS)) {
      expect(
        [...dailyOrder],
        `对照登记里的「${gate}」（GA step \`${step}\`）不在总账的 daily 档里 —— ` +
          "两份登记不同批改，总账会静默漏掉这一格",
      ).toContain(step);
    }
  });

  it("ga-pr 档：GA 的 PR 侧没有「跑了没人记」的格（ISSUE #3662）", () => {
    /* 这一条是 #3662 的承重：**GA 的 PR 侧跑的每一格都要在总账里有一席**，
     * 且豁免名单是显式的（`GA_PR_INFRA_STEPS`）—— 「悄悄加一个不判红也不立案的 step」
     * 仍会被多出来的一格红（与 daily 段同一条口径）。
     *
     * 它治的是哪一类红：`.cnb.yml` 的 PR 档自 #3378 起只剩「站内回读结论 + 红了立案」
     * 两件纯 API 动作 ⇒ PR 主列的代码判据全在 GA 侧；而总账此前只认三份清单
     * （CNB 的 PR / push / GA daily.yml）⇒ GA 的 PR job 一处都不在 ⇒
     * 「记成 retired 却仍在 PR 上跑」这一形态对判据隐形（`受影响用例` / `固定结构用例`
     * 两格：账上写着「2026-11-02 撤到每日全量单测」，而 `pr-gate.yml` 里两个 job
     * 每个 PR 都跑、且在判决的 `needs:` 里）。 */
    const steps = gaPrGateSteps();
    expect(
      steps.length,
      "GA pr-gate.yml 里解析不出 step 名 —— 这一条判据没有对象了（GA_STEP_RE 的取法变了？）",
    ).toBeGreaterThan(0);
    /* 前提设施豁免名单里的名字**必须真在文件里**：豁免名单写了一个已经不存在的
     * step 名 ⇒ 它会静默变成「什么都豁免不掉」的隐形偏移。 */
    const present = new Set(
      [...readFileAt(ROOT, PR_GATE_YML).matchAll(GA_STEP_RE)].map((m) => m.groups?.name ?? ""),
    );
    for (const infra of GA_PR_INFRA_STEPS) {
      expect(
        present.has(infra),
        `前提设施豁免名单里的「${infra}」在 pr-gate.yml 里已经不存在了 —— ` +
          "豁免名单会静默失效（那几行要么改了名，要么那一步已经不在文件里）",
      ).toBe(true);
    }
    /* 反向：GA 的 PR 侧跑的每一格都必须在总账的 ga-pr 段有一席（逐字名）。 */
    const booked = new Set(GATE_TIER_LEDGER.filter((e) => e.tier === "ga-pr").map((e) => e.name));
    for (const step of new Set(steps)) {
      expect(
        booked.has(step),
        `GA 的 PR 侧跑的「${step}」在门格总账里没有登记 —— ` +
          "「GA 的 PR job 跑了没人记」这一族对判据隐形（ISSUE #3662）。" +
          "补一条 ga-pr 档条目（名字逐字），或在 GA_PR_INFRA_STEPS 里显式豁免并写明理由",
      ).toBe(true);
    }
  });

  /**
   * 「每日档红 ⇒ 自动立案」这格不能只在登记上有个名字（ISSUE #2274 / #3436）：上一条管「撤下的格还在不在」，这条管**新加那格点的还是同一个入口**。
   * 名字还在、step 被换成别的命令，两边都绿而自动立案谁都不做 —— 那是这一族（判据在场、执行者不在场）唯一的失效形态。
   * #3504 起执行者在 GA daily.yml（CNB 单子，CNB_ISSUE_TOKEN 同通道）。
   *
   * ⚠️ #3563 起它必须是**下游 job**（`needs: daily`），不是 `daily` 里的一个 step —— 这一条
   * 与「点的还是同一个脚本」同等承重，所以两边都钉：脚本只认 jobs API 的 `steps[].conclusion`，
   * 跑在 `daily` 内部时那个 job 自己还在飞，实测读回 0 个红格 ⇒ 零写入（run `42915112854`）。
   * 那种失效**不会红**：`--no-block` 把退码 2 折成 0，屏幕上与「今天没红」逐字同形。
   * 「先出环境证据、再立案」的顺序现在由 `needs: daily` 承担（整个上游 job 跑完才轮到它），
   * 不再靠同一 job 内的 step 排位 —— 所以这里钉 `needs`，不钉跨 job 的下标大小。
   */
  it("GA 每日档的失败立案是 `needs: daily` 的下游 job，点 `ci-ga-daily-failure-issue.mjs --no-block`", () => {
    const filingName = DAILY_GATE_EXECUTORS["每日失败立案"] ?? "";
    expect(filingName, "`DAILY_GATE_EXECUTORS` 里没有「每日失败立案」的执行者登记").toBeTruthy();

    /* ① 反面：`daily` 那个 job 里**不许**再有这一格。挪回去 = 回到 #3563 的静默零写入。 */
    const dailyJob = gaJobBlock(DAILY_YML, "daily");
    expect(dailyJob, "GA daily.yml 里解析不出 `daily` job —— 这条判据没有对象了").toBeTruthy();
    expect(
      gaDailyJobSteps(),
      "「失败立案」回到了 `daily` job 内部 —— 那个 job 还在飞时 jobs API 读不到它自己的红格，" +
        "立案会静默零写入（#3563 / run 42915112854 打印「红格 0 个」）",
    ).not.toContain(filingName);

    /* ② 正面：它在一个 `needs: daily` 的下游 job 里，且 job 级限形齐全。 */
    const filingJob = gaJobBlock(DAILY_YML, "daily-failure-issue");
    expect(
      filingJob,
      "GA daily.yml 里没有 `daily-failure-issue` job ⇒ 自动立案没有执行者了",
    ).toBeTruthy();
    const job = filingJob ?? "";
    expect(
      job,
      "立案 job 必须 `needs: daily` —— 上游不先 completed，读到的 conclusion 就不是终值（#3563）",
    ).toMatch(/^ {4}needs: daily$/m);
    expect(
      job,
      "立案 job 不是 `if: failure()` —— 绿的那一跑也要付这笔钱（起 runner + 读 jobs API + 写单）",
    ).toMatch(/^ {4}if: failure\(\)$/m);
    expect(
      job,
      "立案 job 必须带 `continue-on-error: true` —— 立案发不出去不该给这一跑叠第二个红；但**不静默**，失败话术由脚本原样打印",
    ).toMatch(/^ {4}continue-on-error: true$/m);

    /* ③ 点的还是同一个入口 + 同一枚旗标（名字在、命令被换掉是这一族唯一的失效形态）。 */
    const step = gaStepBlock(DAILY_YML, filingName);
    expect(step, "GA daily.yml 里没有「失败立案」step ⇒ 自动立案没有执行者了").toBeTruthy();
    const run =
      step
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? "";
    expect(run).toContain("scripts/ci-ga-daily-failure-issue.mjs");
    expect(run).toContain("--no-block");
    /* 这一格必须真的落在下游 job 里，而不是「文件里某处有个同名 step」。 */
    expect(
      job.includes(`      - name: ${filingName}`),
      "「失败立案」step 不在 `daily-failure-issue` job 块里 —— 上面那三条 job 级限形钉的就不是它",
    ).toBe(true);
  });

  /**
   * #3504：`每日镜像出勤立案` 随自托管执行面退役 —— 脚本要 `cnb` CLI（node_modules），
   * 触发口在平台池容器里不再装依赖；出网信号由镜像出口的红 + GA daily.yml 的
   * `镜像漂移判据` step 接住。退役 ≠ 删除：脚本与 npm script 留手动档，
   * `.cnb.yml` 里不许再有引用它的 stage（有人挂回去而触发口不装依赖 = 那一格
   * 以「文件不存在」红，或者更糟 —— CI 镜像里恰好有 node 而 cnb CLI 不在，静默退化）。
   */
  it("`每日镜像出勤立案` 已退役：脚本留手动档，配置与 GA 都不再自动跑它", () => {
    const text = readRegisteredConfig();
    expect(
      text.includes("ci-mirror-egress-issue.mjs"),
      "`.cnb.yml` 又引用了 `ci-mirror-egress-issue.mjs` —— 它的自动执行者已退役，" +
        "挂回去之前先给触发口配依赖安装（否则那一格红在「文件不存在」或 cnb CLI 缺失）",
    ).toBe(false);
    expect(
      existsSync(path.join(ROOT, "scripts/ci-mirror-egress-issue.mjs")),
      "`scripts/ci-mirror-egress-issue.mjs` 不在盘上 —— 退役是「不自动跑」，不是删文件；" +
        "手动档（npm script 直跑）还要用它",
    ).toBe(true);
    /* 自动化的那半个执行者换成了 GA daily.yml 的镜像漂移判据（匿名 ls-remote，
     * 不引新密钥）：它红 = 两边 master 漂移，立案走 `--file-issue`。 */
    const drift = gaStepBlock(DAILY_YML, "镜像漂移判据（CNB master vs GitHub master）");
    expect(drift, "GA daily.yml 里没有「镜像漂移判据」step —— 出网兜底没有执行者了").toBeTruthy();
    expect(drift).toContain("scripts/ci-mirror-drift.mjs");
    expect(drift).toContain("--file-issue");
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
    // ③ 清单解析器（每日档那份随 `COMFYAPP_CI_DAILY_GATES` 键退役 —— #3504 起每日
    // 执行面在 GA daily.yml，判据直接解析 step 名）：PR / 停用两份解析器的键自证保留。
    expect(registeredGateOrder("master:\n  push:\n    - x\n")).toEqual([]);
    expect(
      registeredGateOrder("x:\n  env:\n    COMFYAPP_CI_DISABLED_GATES: >-\n      每日生产构建\n"),
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

describe("单跑口：三档 + 桌包各自派发到 GA 对应 workflow，跨档同形格逐字相同", () => {
  /**
   * 锚点列表里（恰好两空格缩进的 `- name:`）出现**两次以上**的格名：`.gates` 的 stage 项在这一层。
   * `jobs:` 下的 Job 与所属 stage **同名是刻意的**（容器那格），更深缩进不算违规。要防「两条流水线里有两个同名 stage」——那会让按名取块的解析器读到哪个变成运气。
   */
  function duplicatedStageNames(text: string): Array<string> {
    const seen = new Map<string, number>();
    for (const m of text.matchAll(/^ {2}- name: (?<name>\S.*?)[ \t]*$/gm)) {
      const name = m.groups?.name ?? "";
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  }

  /** GA workflow 里某 step 的 `run:` 行原文（去掉缩进）。取不到给空串。 */
  function gaRunLine(file: string, stepName: string): string {
    const block = gaStepBlock(file, stepName);
    return (
      block
        ?.split("\n")
        .find((l) => /^\s*run:/.test(l))
        ?.trim() ?? ""
    );
  }

  it("每档的 web 与 api 两条流水线跑同一格派发，且派发目标等于注册表那一行", () => {
    const text = readRegisteredConfig();
    for (const target of GA_TRIGGER_TARGETS) {
      const expected = [dispatchStageName(target)];
      for (const [ev, pipeline] of [
        [target.eventWeb, target.pipelineWeb],
        [target.eventApi, target.pipelineApi],
      ] as const) {
        expect(
          pipelineStageNames(text, pipeline),
          `${ev} 那一条跑的清单与注册表不一致：期望 ${expected.join(" → ")}`,
        ).toEqual(expected);
      }
    }
  });

  /**
   * #3504 把 CNB 的单跑 stage 清单换成了「一格派发」，前提格跟着进了 GA workflow ——
   * 「同一份脚本长在两条流水线上各漂一份」（ISSUE #2081 那一族）没有消失，只是
   * 换了宿主：**共享格的 `run:` 行在 daily.yml 与 oneshot-*.yml 之间必须逐字相同**。
   * 对照表只收「两处真的都有」的格（每日档与单跑档的工序交集）；package 档不收 ——
   * 它的安装格带 better-sqlite3 原生编译说明、没有每日对位格。
   */
  it("GA 侧的跨档同形格：共享格的 run 行与 daily.yml 逐字相同（副本不许漂）", () => {
    /* 每对是 [每日 step 名, 单跑 step 名] —— **名字刻意不同**（另起不重名的名字），
     * 比「同一件事只能由 run 行相同保证」；对照表只收「两处真的都有」的格。
     * package 档不收 —— 它的安装格带 better-sqlite3 原生编译说明、没有每日对位格。 */
    const sharedSteps: Array<[string, Array<[string, string]>]> = [
      [
        "oneshot-build.yml",
        [
          [
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
          ],
          ["同步数据库表结构（cnb 同款判据一字不改）", "同步数据库表结构（cnb 同款判据一字不改）"],
          ["生产构建（cnb 同款判据一字不改）", "生产构建（cnb 同款判据一字不改）"],
        ],
      ],
      [
        "oneshot-e2e.yml",
        [
          [
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
          ],
          ["同步数据库表结构（cnb 同款判据一字不改）", "同步数据库表结构（cnb 同款判据一字不改）"],
          [
            "浏览器安装（cnb 同款入口；npmmirror 镜像源同 CNB）",
            "浏览器安装（cnb 同款入口；npmmirror 镜像源同 CNB）",
          ],
          ["全量E2E（cnb 同款判据一字不改）", "全量E2E（cnb 同款判据一字不改）"],
        ],
      ],
      [
        "oneshot-unit.yml",
        [
          [
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
            "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
          ],
          [
            "单元测试（排最后：唯一会因机器负载而红的一档，同 CNB 口径）",
            "全量单测（cnb 同款判据一字不改）",
          ],
        ],
      ],
    ];
    for (const [wf, pairs] of sharedSteps) {
      for (const [dailyName, oneshotName] of pairs) {
        const daily = gaRunLine(DAILY_YML, dailyName);
        const oneshot = gaRunLine(path.join(".github/workflows", wf), oneshotName);
        expect(
          daily,
          `daily.yml 里取不到「${dailyName}」的 run 行 —— 对照表收了一个不存在的格`,
        ).not.toBe("");
        expect(
          oneshot,
          `${wf} 里取不到「${oneshotName}」的 run 行 —— 对照表收了一个不存在的格`,
        ).not.toBe("");
        expect(
          oneshot,
          `「${dailyName} ⇄ ${oneshotName}」的 run 行在 ${wf} 与 daily.yml 之间漂了 —— ` +
            "改一边不改另一边就是两个 workflow 各自一份判据（§12.12 的孪生形态）",
        ).toBe(daily);
      }
    }
  });

  it("GA 单跑 workflow 的形态：workflow_dispatch 带 head_sha 输入 + 注册表的并发组", () => {
    for (const target of GA_TRIGGER_TARGETS) {
      const text = readFileAt(ROOT, path.join(".github/workflows", target.workflow));
      expect(
        /^\s*workflow_dispatch:\s*$/m.exec(text),
        `${target.workflow} 没有 \`workflow_dispatch\` —— 派发那一跳会 404，触发口按了没反应`,
      ).toBeTruthy();
      expect(
        /^\s*head_sha:\s*$/m.exec(text),
        `${target.workflow} 的 workflow_dispatch 没有 \`head_sha\` 输入 —— 派发口送的那笔 sha 没人接，` +
          "GA 会判在默认分支 HEAD 上而不是按下的那一刻",
      ).toBeTruthy();
      expect(
        text,
        `${target.workflow} 没有按检出 \`ref\` 用 \`inputs.head_sha\` —— 派发的是那一笔、判的是另一笔`,
      ).toContain("inputs.head_sha");
      const group = /concurrency:\s*\n(?:\s*#[^\n]*\n)*\s*group:\s*(?<g>\S+)/.exec(text)?.groups?.g;
      expect(
        group,
        `${target.workflow} 没有 \`concurrency.group\` —— 同档连点两次会两跑同时压 runner`,
      ).toBe(target.concurrencyGroup);
    }
  });

  it("单跑安装格的名字不许再出现在 .cnb.yml（接槽那一族随执行面退役）", () => {
    const text = readRegisteredConfig();
    for (const retired of [
      "单跑构建·安装依赖",
      "单跑E2E·安装依赖",
      "单跑单测·安装依赖",
      "单跑E2E·浏览器安装",
      "单跑E2E·同步数据库表结构",
    ]) {
      expect(
        text.includes(`- name: ${retired}`),
        `\`${retired}\` 又出现在 .cnb.yml 里 —— 单跑口只剩一格派发，` +
          "把前提格挂回触发口 = 触发口重新装依赖（#3504 撤的就是这个）",
      ).toBe(false);
    }
  });

  it("单跑的格名不许与每日格或彼此重名", () => {
    const text = readRegisteredConfig();
    expect(
      duplicatedStageNames(text),
      "锚点清单里出现了同名 stage：按名字取块的解析器会读错那一条流水线",
    ).toEqual([]);
  });

  it("顶层 `master:` 只许有一份：多开一份会让触发口那一批静默消失", () => {
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
    const e2e = GA_TRIGGER_TARGETS.find((t) => t.preset === "e2e");
    if (!e2e) {
      throw new Error("注册表里没有 e2e 那一行，这条自检没有基准");
    }
    const pipeline = e2e.pipelineWeb;
    const live = pipelineStageNames(text, pipeline);

    /* ① 漏派发格：删掉那一个 stage 项（从 `- name:` 到它自己的 `timeout:` 行收口，
     * 不越过流水线边界 —— 跨界删会把下一条流水线的 `name:` 一起删掉，变异就失真了）。 */
    const stageAt = text.indexOf(`        - name: ${dispatchStageName(e2e)}`);
    if (stageAt === -1) {
      throw new Error("单跑E2E 的派发格在 .cnb.yml 里找不到，自检没有对象");
    }
    const stageEnd = text.indexOf("timeout: 10m", stageAt);
    if (stageEnd === -1) {
      throw new Error("单跑E2E 的派发格没有 timeout 收口行，自检没有对象");
    }
    const dropped = text.slice(0, stageAt) + text.slice(stageEnd + "timeout: 10m".length);
    const droppedList = pipelineStageNames(dropped, pipeline);
    expect(droppedList, "① 漏派发格必须让清单变短").not.toEqual(live);
    expect(droppedList).toHaveLength(0);

    /* ② preset 漂移：把 `--preset e2e` 改成别的档，由「命令与注册表一致」那条抓。 */
    const drifted = text.replace(
      `script: node scripts/ci-ga-dispatch.mjs --preset e2e`,
      "script: node scripts/ci-ga-dispatch.mjs --preset build",
    );
    expect(
      stageScriptLine(drifted, dispatchStageName(e2e)),
      "② preset 漂移必须改得到那一行",
    ).not.toBe(`node scripts/ci-ga-dispatch.mjs --preset e2e`);

    /* ③ 并发组漂移：改 oneshot-e2e.yml 的 group 值，由「workflow 形态」那条抓。 */
    const oneshotE2e = readFileAt(ROOT, ".github/workflows/oneshot-e2e.yml");
    const driftedWorkflow = oneshotE2e.replace("group: oneshot-e2e", "group: oneshot-build");
    expect(driftedWorkflow).not.toContain("group: oneshot-e2e");
    expect(driftedWorkflow).toContain("group: oneshot-build");

    /* ④ 名字撞车：把锚点层（2 空格）唯一那格复制一份，由「不许重名」那条抓 ——
     * 派发格在 8 空格层（流水线内联），锚点层才是这个判据的扫描面。 */
    const collided = text.replace(
      "  - name: GA 回调结论回读",
      "  - name: GA 回调结论回读\n  - name: GA 回调结论回读",
    );
    expect(duplicatedStageNames(collided), "④ 重名必须被点名").toContain("GA 回调结论回读");

    /* 现役形状：四条判据一条都不许抓到东西（否则上面的「会变」是自证的假象）。 */
    expect(live).toEqual([dispatchStageName(e2e)]);
    expect(duplicatedStageNames(text)).toEqual([]);

    /* ⑤ 决定必须在规范正文里有原文（只长在配置里的决定等于没有决定）。 */
    expect(
      missingAnchors("docs/standards/13-提交与-code-review.md", ["单跑那一跑不是每日档的出勤"]),
    ).toEqual([]);
  });
});
