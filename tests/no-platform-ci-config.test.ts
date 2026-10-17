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
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^ {2}-\s+name:\s*(\S.*?)\s*$/.exec(lines[i] ?? "");
    if (item?.[1] === name) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const out: string[] = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 下一个同级 stage 项 / 更浅的键都算收尾（空行不算 —— 配置里正文之间有空行）。 */
    if (/^ {2}-\s+name:/.test(raw) || /^\S/.test(raw)) break;
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
  for (const raw of lines) {
    // stage 列表项：恰好两空格缩进的 `- name: X`（`stages:` 的直接子项）。
    const item = /^ {2}-\s+name:\s*(\S.*?)\s*$/.exec(raw);
    if (item?.[1] !== undefined) {
      current = item[1];
      continue;
    }
    // 同级或更浅的键 = 这一项结束了（`env:`、顶层 `master:` 等）。
    if (current !== null && /^\S/.test(raw)) current = null;
    if (current === null) continue;
    const t = /^\s{4}timeout:\s*(\S+)\s*$/.exec(raw);
    if (t?.[1] !== undefined) out.set(current, t[1]);
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
    // 两条流水线都必须引用那个锚点：只引用一条 = 另一条悄悄回落到平台池。
    // 引用形态 = 分支键下、事件键下的那一层 `- <<: *anchor`。
    const refs = text.match(/^\s+-\s*<<:\s*\*\w+/gm) ?? [];
    expect(
      refs.length,
      "锚点引用数与流水线数对不上（两个事件各要 <<: 一次）",
    ).toBe(2);
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

  it("`浏览器安装` 排在 `E2E 关键流程` 之前，且点名的入口在盘上", () => {
    const text = readRegisteredConfig();
    /* 这一格是自托管路径上**新暴露**的（ISSUE #1961）：旧版 `docker.image: node:24`
     * 那条路里，Playwright 的浏览器是镜像白拿的；换成裸宿主机之后没了那层兜底，
     * 而 `pnpm install` 不会拉浏览器二进制 —— `E2E 关键流程` 第一次真跑到就红在
     * `Executable doesn't exist at …\ms-playwright\chromium_headless_shell-…` 上。
     *
     * 顺序约束与 Python 那条同源：装浏览器要下 ~100+ MiB（分钟级），而判「装没装成」
     * 是零成本的；排在 E2E 之后 = 那个结论要么看不到、要么在最贵的位置才看到。
     *
     * **停用时这条顺序约束无从谈起**（两条都不在清单里，`indexOf` 回 -1）——
     * 处置与 `单元测试` 那条逐字相同：停用与否不是这里判的（那是「停用登记」两条的事），
     * 这里只判「在它们真排进清单时必须一前一后」，并要求停用必须留痕。 */
    const order = registeredGateOrder(text);
    const disabled = registeredDisabledGates(text);
    const installAt = order.indexOf("浏览器安装");
    const e2eAt = order.indexOf("E2E 关键流程");
    if (installAt < 0 || e2eAt < 0) {
      expect(
        disabled,
        "「浏览器安装」/「E2E 关键流程」既不在 `COMFYAPP_CI_GATES` 里、也没在 " +
          "`COMFYAPP_CI_DISABLED_GATES` 里登记 —— 这是「删除」而不是「停用」",
      ).toEqual(expect.arrayContaining(["浏览器安装", "E2E 关键流程"]));
    } else {
      expect(
        installAt,
        "`浏览器安装` 必须排在 `E2E 关键流程` 之前：缺件时那一步会以" +
          "「全档每条都报同一个 launch 失败」的形态红，看不出真正要修的是什么",
      ).toBeLessThan(e2eAt);
    }

    /* 那一步点名的入口必须真在盘上（同 `Python 探测入口` 那条口径：`script` 里的
     * 路径写错了不会在配置解析期报错，只在真要用的那一刻答「文件不存在」）。
     * **两种形态都要读得出来**：活的（`.gates` 里那一项，`script:` 缩进 4 空格）
     * 与被注释掉的（`# ` 前缀让 `- name:` 那一行不再是 stage 项，剥掉前缀后顶格）。
     * ⚠️ 正则**必须容忍前导空白** —— ISSUE #1966 恢复这一格时，只认顶格的
     * `^(?:#\s*)?script:` 把活的形态判成「解析不出 script」，而它要判的是
     * 「入口在不在盘上」，不是那一行在第几列。
     * 不从原文里做「紧邻下一行」的匹配：停用块在 `- name:` 与 `script:` 之间插了
     * 一段说明，紧邻匹配会当场落空。 */
    const blockText =
      stageBlock(text, "浏览器安装") ?? commentedStageBlock(text, "浏览器安装");
    const scriptLine = /^[ \t]*(?:#\s*)?script:[ \t]*(\S.*)$/m.exec(
      blockText ?? "",
    );
    const command = scriptLine?.[1]?.trim();
    expect(command, "解析不出「浏览器安装」那一步的 script").toBeTruthy();
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
      `「浏览器安装」那一步指向的不是 scripts/ 下的入口：${command}`,
    ).toBeTruthy();
    expect(
      existsSync(path.join(ROOT, entry ?? "")),
      `「浏览器安装」点名的入口不在盘上：${entry}`,
    ).toBe(true);
  });

  it("`浏览器安装` 那一步把下载的套接字超时放宽了（180 MiB 撞 30s 是「没量完」）", () => {
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
    const active = stageBlock(text, "浏览器安装");
    const stage = active ?? commentedStageBlock(text, "浏览器安装");
    if (active === null) {
      expect(
        registeredDisabledGates(text),
        "「浏览器安装」既不在 `GATES` 里、也没在 `DISABLED_GATES` 里登记 —— " +
          "这一段判据会失去扫描对象，先补登记",
      ).toContain("浏览器安装");
    }
    expect(stage, "解析不出「浏览器安装」这一步 —— 名字被改了？").toBeTruthy();
    expect(
      stage,
      "「浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` —— 默认的 30s 是" +
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
      "「浏览器安装」没设 `PLAYWRIGHT_DOWNLOAD_HOST` —— 自托管节点到不了 " +
        "`cdn.playwright.dev`（120s 也超时），只放宽那个超时数字是没用的",
    ).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(stage).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST:\s*"https:\/\/[^"]+"/);
  });

  it("`单元测试` 排在 `Python 可用性` 之后（缺件要在最便宜的位置报出来）", () => {
    const order = registeredGateOrder(readRegisteredConfig());
    expect(
      order.length,
      "解析不出 COMFYAPP_CI_GATES —— 键被删了或换了形状，这条顺序约束就没有执行者了",
    ).toBeGreaterThan(0);
    const probeAt = order.indexOf("Python 可用性");
    expect(probeAt).toBeGreaterThanOrEqual(0);
    /* **停用时这条顺序约束无从谈起**（条目不在清单里，indexOf 回 -1）。
     * 停用与否不是这里判的 —— 那是下面「停用登记」两条的事；这里只判
     * 「在它真排进清单时必须排在 Python 之后」，而不是把它当成永久删除。 */
    const testAt = order.indexOf("单元测试");
    if (testAt < 0) {
      expect(
        registeredDisabledGates(readRegisteredConfig()),
        "`单元测试` 既不在 COMFYAPP_CI_GATES 里、也没在 COMFYAPP_CI_DISABLED_GATES " +
          "里登记 —— 这是「删除」而不是「停用」，判据拦的就是这个静默形态",
      ).toContain("单元测试");
      return;
    }
    expect(
      probeAt,
      "`Python 可用性` 必须排在 `单元测试` 之前：缺解释器时那一步照旧往下跑" +
        "（相关用例走 env 档跳过、不会红），而它要跑到 2h24m 才可能被平台墙钟掐断" +
        "（实测 cnb-jt3-1k5071kou）—— 排在后面 = 这个结论要么看不到、要么在最贵的位置才看到",
    ).toBeLessThan(testAt);
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
     * `生成态文档与源同步` 是那个名单的第五个（ISSUE #1981）：从 `--check` 换成
     * `--check --autofix` 之后，它**红了要就地重渲染再判一次**（30 份文档的渲染，
     * 冷节点上不是秒级），而它正是那条「自动修档凭什么可以多花这一次钱」的另一半 ——
     * 该有的预算与那几条一样是分钟量级。 */
    const disabled = registeredDisabledGates(text);
    const required = [
      "ESLint 零警告",
      "单元测试",
      "生成态文档与源同步",
      "生产构建",
      "E2E 关键流程",
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
    const pushKey = resolveLockKey(template, { CNB_PULL_REQUEST_IID: undefined });
    expect(pushKey).not.toBe(prKey("1982"));
    /* ⑤ 未替换的原文不许留下裸 `$`（平台不认的写法会**原样**进 key，看起来像
     * 「生效了」而实际是所有人共用一把名字里带 `$` 的锁）。 */
    expect(template).not.toMatch(/\$[^{A-Za-z0-9_]/);
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
    expect(pipelineLockKeyTemplate(keyFixture)).toBe("pr-$CNB_PULL_REQUEST_IID");
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

  it("扫描面真的收到了仓库根（不是空数组假装通过）", () => {
    const top = repoTopLevel();
    // 仓库根一定存在的锚点文件：缺了说明 readdirSync 指错了地方。
    for (const anchor of ["package.json", "vitest.config.ts", ".githooks"]) {
      expect(top).toContain(anchor);
    }
  });
});
