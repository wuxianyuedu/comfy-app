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
    expect(present.filter((rel) => !REGISTERED_CI_CONFIGS.includes(rel))).toEqual(
      [],
    );
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
      ps7OnlySyntaxIn("master:\n  push:\n    - script: |\n        $x = $o?.Source\n"),
    ).toHaveLength(1);
    expect(
      ps7OnlySyntaxIn(
        "master:\n  push:\n    - script: |\n        # 不许写 ?. （PS 7 only）\n        $x = 1\n",
      ),
    ).toEqual([]);
    // 块外的同形文本不许被算进来（缩进收口真在起作用）。
    expect(
      ps7OnlySyntaxIn("master:\n  name: a?.b\n    - script: |\n        $x = 1\n"),
    ).toEqual([]);
    expect(PS7_ONLY.length).toBeGreaterThanOrEqual(4);
  });

  it("扫描面真的收到了仓库根（不是空数组假装通过）", () => {
    const top = repoTopLevel();
    // 仓库根一定存在的锚点文件：缺了说明 readdirSync 指错了地方。
    for (const anchor of ["package.json", "vitest.config.ts", ".githooks"]) {
      expect(top).toContain(anchor);
    }
  });
});
