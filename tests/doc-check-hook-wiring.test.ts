/**
 * pre-commit 里「接线本身」的在位判据：`doc:check` 那一步的执行者（ISSUE #1371 立档 →
 * ISSUE #1975 挪平台侧）、R5 棘轮的 `--strict` 硬闸（ISSUE #1404 / #1811）、注释语言棘轮
 * （ISSUE #1451）、桌面壳（ISSUE #1597）、全库扫描的输入面跳过与 AST 聚合档（ISSUE #1747）、
 * 新鲜度账的第二执行者（ISSUE #1979），以及 **D0 形态前置档**（钩子重构 1：哪几条判据在
 * 「启动其余四组之前」串行跑完、按什么顺序）。
 *
 * 第三条的立案现场：`scripts/check-comment-language.cjs` 头部自称
 * 「供 `.githooks/pre-commit` 与 CI 调用」、§12.4.6 也写着它在钩子里报红，
 * 而 `grep -c comment-language .githooks/pre-commit` 一直是 0，CI 又随 ISSUE #623 删除
 * —— 一条基线为 0 的硬闸**一个执行者都没有，文档却说它在执行**。
 * 判据本身是对的（`next-code-frame` 按字节切串，中文注释会让 Rust 侧 panic），
 * 缺的只是执行者，所以这里连着「不准回到那句书面自白」一起钉。
 *
 * 为什么单独成文件、并进 `scripts/affected-tests.mjs` 的 FIXED_STRUCTURAL_TESTS：
 * 这两步的价值都是「每次提交都跑」，而改 `.githooks/**` 会让增量层**放弃收窄、
 * 只跑固定清单**（`mode: "all"`，清单长度由下面那条用例核与钩子注释一致，
 * 所以这里不抄数字）—— 把这类断言留在按路径引用的那份用例里，恰好在本该拦住的
 * 那次改动（有人把某一步摘回手动档 / 抹掉 flag / 改了计数陈述）上一条都不跑，
 * 判据存在但没有执行者，与没有等价。这里只读几份文本、不起子进程，成本可忽略。
 *
 * 为什么解析步骤行而不是 `toContain(那一行)`：变异实测把那行前面加 `# ` 注掉后，
 * `toContain` 仍然命中（注释行里也含同一段字面），只有计数那条会红。
 * 「把这一步静音」正是这一族要拦的动作（同台账 F13「对编译器按下静音键」）。
 * 解析器收在 `tests/helpers/hook-groups.ts`，与另外两处消费者共用一份 —— 各写一份的
 * 漂移形态是「同一份钩子在三条判据里长成三个形状」（§12.12 / §12.18）。
 *
 * 同一格先例：`tests/shell-gate.test.ts` 的「新增门禁脚本必须同时接进 pre-commit」、
 * `tests/no-platform-ci-config.test.ts` 的「平台侧兜底在不在」。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  registeredDisabledGates,
  registeredGateOrder,
  stageBlock,
} from "./no-platform-ci-config.test";

import { groupShBody, runSteps, stepsInGroup } from "./helpers/hook-groups";
import { HEAVY_GATES } from "../scripts/ci-heavy-gates.mjs";

const REPO_ROOT = resolve(".");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");
const STRUCTURE = join(REPO_ROOT, "scripts", "check-file-structure.cjs");
const R5_BASELINE = join(REPO_ROOT, "scripts", ".file-size-baseline.json");

/**
 * 钩子里**全部** `run "<标签>" <命令>` 步骤行（D0 形态前置档 + D 静态判据档，不分组）。
 *
 * 在场判据要的正是这个并集：一条判据「在不在门禁链里」与它在哪个组无关 —— 把它从并行档
 * 挪进前置档，**不该**让任何一条在场判据变红（那会把「编排」误判成「拆掉了判据」）。
 * 解析而不是 `toContain(那一行)`：把那行前面加 `# ` 注掉，`toContain` 仍然命中（注释行里
 * 也含同一段字面），只有计数与逐字命令那两条会红 —— 「把这一步静音」正是这一族要拦的动作。
 * 解析器本体在 `tests/helpers/hook-groups.ts`（三处判据共用一份，不在这里各写一遍）。
 */
function hookGateSteps(hookText: string) {
  return runSteps(hookText);
}

/**
 * 平台侧 `.cnb.yml` 的 stage 清单（**名字 + 该 stage 的原文块**）。
 *
 * 名字取自 `COMFYAPP_CI_GATES`（那份有序清单是既有事实源，见 `.cnb.yml` 的 `env`），
 * 原文块复用 `no-platform-ci-config.test.ts` 的 `stageBlock()` —— **不在这里抄第二份
 * 解析器**（§12.12 / §12.18：抄一份就会漂，而漂的形态是静默的）。
 *
 * ⚠️ 用「清单里的名字 → 原文块」而不是「扫全文找 `- name:`」：被 `#` 注释掉的 stage
 * （临时停用那一档）**不在清单里**，扫全文会把停用的那几步当成「在跑」—— 那正是
 * ISSUE #1975 要判的那件事的反面。
 *
 * `stage === null` 的条目表示「清单里点了名、`.gates` 里却找不到那一项」，
 * 调用方据此判红（名字被删 / 改名 = 平台侧这一步没了）。
 *
 * @returns {{name: string, stage: string | null}[]}
 */
function platformStages(): { name: string; stage: string | null }[] {
  const text = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");
  return registeredGateOrder(text).map((name) => ({
    name,
    stage: stageBlock(text, name),
  }));
}

/**
 * 某条判据在平台侧的**执行面**：它跑在哪、那条命令行长什么样。
 *
 * 两个来源都要读（2026-10-19 起）：`.cnb.yml` 里独立的 stage，与聚合档
 * `重档静态判据` 里的条目（`HEAVY_GATES`）。只读前者会把收进聚合档的那几条判成
 * 「平台侧没有这一步」，而那是个**指错方向的红** —— 人会跑去配置里补一个 stage，
 * 而判据其实好好地跑在格子里。唯一出处仍是 `.cnb.yml` 的 `script:` 与
 * `scripts/ci-heavy-gates.mjs` 的条目表，本函数不抄第二份。
 *
 * @param {string} stageName stage 名，或聚合档里的条目名（两者不重名）
 * @returns {{where: string, command: string} | null}
 */
function platformExecutor(stageName: string) {
  const stage = stageBlock(
    readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8"),
    stageName,
  );
  if (stage !== null) return { where: "stage", command: stage };
  const gate = HEAVY_GATES.find((g) => g.name === stageName);
  if (!gate) return null;
  return { where: "重档静态判据", command: gate.argv.join(" ") };
}

/** §13.1「本地提交前必须通过」代码块里的命令（`✅ <命令>  # 说明` 的那部分）。 */
const GATE_CHECKLIST_DOC = join(
  REPO_ROOT,
  "docs",
  "standards",
  "13-提交与-code-review.md",
);

/**
 * 读 §13.1 清单里的命令集合。marker 那句写在围栏**里面**，所以取 marker 之后遇到的
 * 第一个 ``` 就是这份清单的收尾（与 `check-doc-references.cjs` 同一份解析，不写第二份）。
 * @returns {Set<string>}
 */
function readChecklistCommands() {
  const text = readFileSync(GATE_CHECKLIST_DOC, "utf8");
  const start = text.indexOf("本地提交前必须通过");
  if (start < 0) return new Set();
  const rest = text.slice(start);
  const close = rest.indexOf("```");
  if (close < 0) return new Set();
  return new Set(
    rest
      .slice(0, close)
      .split("\n")
      .filter((l) => l.startsWith("✅ "))
      .map((l) =>
        (l.slice(2).split(/ +# /)[0] ?? "").replace(/\s+/g, " ").trim(),
      ),
  );
}

describe("doc:check 在平台侧、不在钩子里（ISSUE #1371 立档 → ISSUE #1975 挪执行者）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  /* 这一条守的动作**变过一次**，两半都要留着：
   *   · ISSUE #1371 翻档：它原来自称「不接 pre-commit」，翻档是把它**接进**钩子；
   *   · ISSUE #1975：它从钩子**挪到平台侧**（理由见规范 §13.5.17 —— 判的是文档面，
   *     挡不住任何一次代码回归，而平台侧回来之后这一档有了第二个执行者）。
   * 于是现在判的是**两半**：钩子里不再有它、平台侧那一步在。只判一半的话，
   * 「钩子撤掉 + 平台侧也忘了加」会全绿，而它的失效形态正是「谁都没跑它」。 */
  it("钩子 D 组**不再**执行这一步（它已在平台侧，见 §13.5.17）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-doc-references.cjs"),
    );
    expect(
      hit,
      `门禁链 ${steps.length} 步里又有 doc:check 了 —— 它已随 ISSUE #1975 挪到平台侧 ` +
        "（`.cnb.yml` 的「文档引用与权威源一致」）。要么把它从钩子里去掉，要么同步改本判据",
    ).toBeUndefined();
  });

  it("平台侧真的在跑这一步（挪走 ≠ 没人跑）", () => {
    const executor = platformExecutor("文档引用与权威源一致");
    expect(
      executor,
      "平台侧（`.cnb.yml` 的 stage 清单与聚合档 `重档静态判据` 的条目表）都没有" +
        "「文档引用与权威源一致」—— 钩子撤掉 + 平台侧没加 = 这条判据一个执行者都没有，" +
        "而它正是本判据要拦的形态（§13.5.17）",
    ).not.toBeNull();
    expect(
      executor?.command,
      "那一条点的不是 scripts/check-doc-references.cjs —— 名字在、判据换了",
    ).toContain("scripts/check-doc-references.cjs");
  });

  it("脚本头不许回到「不接 pre-commit（避免过度打扰提交）」那句旧签字", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).not.toContain("不接 pre-commit（避免过度打扰提交）");
  });

  it("钩子里那句「D(N 个判据脚本)」的 N 与实际步骤数一致（这数字没有别的判据核）", () => {
    const claimed = /D\((\d+) 个判据脚本\)/.exec(hook);
    expect(claimed, "钩子里的判据计数陈述还在吗？").not.toBeNull();
    expect(
      Number(claimed?.[1]),
      `钩子注释写 ${claimed?.[1]}，实际 ${steps.length}`,
    ).toBe(steps.length);
  });
});

describe("R5 的硬闸在钩子里（ISSUE #1404 立档 / ISSUE #1811 收成硬闸）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("结构那一步真的在跑，且不带任何 flag（R5 已是硬闸，没有 --strict 可加）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-file-structure.cjs"),
    );
    expect(
      hit,
      `结构那一步不在了，或标签 / flag 与预期不符（D 组共 ${steps.length} 步）`,
    ).toEqual({
      label: "文件结构硬规则(R1-R12，R5 硬闸)",
      cmd: "node scripts/check-file-structure.cjs",
    });
    /* 反面：不许再给它加回 `--strict`。R5 翻硬闸时那个旗标被删掉了 ——
     * 加回来的人想必是想恢复「不传它就不判」的通道（那就是本次要消灭的东西）。 */
    expect(
      hit?.cmd.includes("--strict"),
      "`--strict` 已随 R5 棘轮在 ISSUE #1811 删除，不该再出现在钩子里",
    ).toBe(false);
  });

  it("这一步的标签与注释不许回到「R5 只提醒」那句旧签字", () => {
    expect(hook).not.toContain("R5 只提醒");
    // 那段「遗留」注释是「零执行者」的书面自白；它回来 = 有人把硬闸又摘回手动档
    expect(hook).not.toContain("--strict 判定不在这里执行");
  });

  it("R5 的基线文件已经没有（翻硬闸时删掉，不会「先留着以防万一」）", () => {
    /* 翻闸之后「基线还在」有两种坏法：① 脚本里那段读基线的代码被留着（判据读数随
     * 别人的检出内容变）；② 有人靠它把新超限文件登记成存量。两者都以「文件在场」
     * 为起点，所以这一格正面钉住它不在。 */
    expect(existsSync(R5_BASELINE)).toBe(false);
  });

  it("脚本侧不许把执行者再写成「CI」（那份流水线已随 ISSUE #623 删除）", () => {
    const script = readFileSync(STRUCTURE, "utf8");
    expect(script).not.toContain("`--strict`(CI)");
    expect(script).not.toContain("900 行以上的文件在本仓库只增不减");
  });
});

/**
 * 注释语言棘轮接进 D 组（ISSUE #1451）。
 *
 * 为什么它不是「再抄一遍 §13.1 清单」：这一族要拦的动作恰好是「把某一步摘回手动档 /
 * 抹掉 flag」，而 §13.1 那份**权威清单自己**就漂过 5 步（见 §13.5.10）——抄一份
 * 只会更难保持正确。所以断言形状与上面两条同款：解析 D 组步骤、只认真调用。
 */
const COMMENT_LANGUAGE = join(
  REPO_ROOT,
  "scripts",
  "check-comment-language.cjs",
);

describe("注释语言棘轮在钩子里（ISSUE #1451）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-comment-language.cjs"),
    );
    // 命令逐字相等，顺带钉住「只接判定档」：`--report` 恒 exit(0)（盘点档，接进来
    // 等于接了个寂寞）、`--update` 会改基线（人的动作）、`--strict`（基线未收紧即失败）
    // 在基线已是 total: 0 时属另一类动作 —— 三者都不许混进钩子。
    expect(
      hit,
      `门禁链 ${steps.length} 步里没有注释语言棘轮 —— §12.4.6 写着它在钩子里报红，` +
        "而拆掉这一步之后它一个执行者都没有（平台流水线已随 ISSUE #623 删除）",
    ).toEqual({
      label: "注释语言硬闸",
      cmd: "node scripts/check-comment-language.cjs",
    });
  });

  it("脚本头不许去掉「供 .githooks/pre-commit 调用」这句承诺（它是本次事故的直接判据）", () => {
    // 反向要求：这句话**现在**是真的（钩子里有这一步）。若有人既拆掉钩子里那一步、
    // 又把这句删掉，文档与实现会一起闭嘴，而判据消失本身不会有人发现。
    const script = readFileSync(COMMENT_LANGUAGE, "utf8");
    expect(
      script,
      "头部那句「供 .githooks/pre-commit …调用」是这次事故的判据，别让它消失",
    ).toContain("供 .githooks/pre-commit");
  });
});

/**
 * API 文档生成物与源同步：**已从 D 组挪到平台侧**（ISSUE #1329 收尾 → ISSUE #1975）。
 *
 * 它进钩子时带的是 `--staged`（输入面跳过），而那个跳过的**输入面是 `src/lib|server|trpc`**
 * —— 本仓最常见的提交类别正好全落在它里面，于是「跳过」在真实提交上几乎不生效：
 * 实测改一个 `src/lib` 文件（一行注释都算）这一档照旧走满 **31s**，是 D 组最贵的一步。
 * 规范 §13.5.17 记了判据面（「结论挡不住任何一次代码回归」）与逐条实测。
 *
 * 判两半：钩子里不再有它、平台侧那一步在（且**不带 `--staged`** —— 平台侧是全量档，
 * 传 `--staged` 会让它在平台侧恒跳过，等于白挂）。
 */
const DOCS_API = join(REPO_ROOT, "scripts", "check-docs-api.cjs");
/** 生成物目录（提交进 git，判据对象是它）。 */
const DOCS_API_OUT = join(REPO_ROOT, "docs", "api");

describe("API 文档生成物与源同步（ISSUE #1329 收尾 → ISSUE #1975 挪执行者）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("钩子 D 组**不再**执行这一步（它已在平台侧，见 §13.5.17）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-docs-api.cjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里又有 docs-api 同步了 —— 它已随 ISSUE #1975 挪到平台侧 ` +
        "（`.cnb.yml` 的「API 文档生成物与源同步」）。要么把它从钩子里去掉，要么同步改本判据",
    ).toBeUndefined();
  });

  it("平台侧那一步在，且是**全量档**（`--staged` 在平台侧恒跳过 = 白挂）", () => {
    const executor = platformExecutor("API 文档生成物与源同步");
    expect(
      executor,
      "平台侧（`.cnb.yml` 的 stage 清单与聚合档 `重档静态判据` 的条目表）都没有" +
        "「API 文档生成物与源同步」—— 钩子撤掉 + 平台侧没加 = docs/api/** 又回到" +
        "「进 git + 零判据」的过期面（§13.5.17）",
    ).not.toBeNull();
    expect(
      executor?.command,
      "平台侧那一步的原文块解析不出来（名字被改了？）",
    ).toBeTruthy();
    expect(
      executor?.command,
      "平台侧那一步带了 `--staged`：平台侧的工作区就是这次要判的那份源码，" +
        "`--staged` 在那里读的是「本次暂存」，恒为空 ⇒ 这一步恒跳过（挂了等于没挂）",
    ).not.toContain("--staged");
    expect(
      executor?.command,
      "平台侧那一步必须是 `--check --autofix`（只写不判 = 恒绿）",
    ).toContain("--check");
  });

  it("生成物仍然提交进 git（判据对象没被 .gitignore 摘掉）", () => {
    // 判据的整个前提是「产物在仓库里」。若有人把它退回忽略态，这一步会找不到目录
    // 而报「不存在」—— 那条报错读起来像配置问题，不像「你把判据对象搬走了」。
    expect(
      existsSync(DOCS_API_OUT),
      `docs/api/ 不在仓库里了 —— 本判据的对象是提交进 git 的生成物；` +
        "要么把它加回来，要么连同这一步一起删（不要留下一个指向空气的判据）",
    ).toBe(true);
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignore).not.toContain("docs/api");
  });

  it("脚本头写明它现在由**平台侧**调用（挪了执行者，承诺要跟着改）", () => {
    /* 反向要求：这句话**现在**是真的（`.cnb.yml` 里有那一步）。脚本头原先写的是
     * 「供 .githooks/pre-commit 调用」—— 挪到平台侧之后那句就成了假承诺，而
     * 「脚自称在哪跑」与「它真在哪跑」不一致正是本文件立案的那族形态（§13.5.12）。
     * 判据只要求**指向平台侧那一份**，不钉具体措辞。 */
    const script = readFileSync(DOCS_API, "utf8");
    expect(
      script,
      "check-docs-api.cjs 的头部没写明它由平台侧 `.cnb.yml` 调用 —— " +
        "脚本自称的执行者与实际不一致时，读的人（与下一个人）会被指到钩子里去找一步不存在的步骤",
    ).toContain(".cnb.yml");
  });
});

/**
 * 桌面壳门禁接进 D 组（ISSUE #1597）。
 *
 * 立案现场：`shell-gate.mjs` 在钩子里**确实**有一步，但那一格「专守它」的判据没有 ——
 * `tests/shell-gate.test.ts` 只有 `expect(hook).toContain("node scripts/shell-gate.mjs")`，
 * 而 `toContain` 对**注释行**同样命中（同一段字面在注释里也出现）。§13.1 清单与钩子
 * 的双向对账（`scripts/check-doc-references.cjs`）也拦不住：它是「钩子 ⇄ 清单」两份
 * 手抄的互核，把两份**同时**抹掉（顺手把 `D(N)` 计数一起改小）就两边一致、全绿。
 *
 * 于是「把这步摘回手动档」这个动作会静默通过。本条与上面三条同款：解析 D 组步骤、
 * 只认真调用 —— 上面那几条都只钉自己那一步，`shell-gate` 是同一个洞里的第四格。
 *
 * 为什么它值一条判据：这一步是 AGENTS 硬规则 5（改了壳必须重编）的**唯一执行者**，
 * 也是 `src-tauri/src/**` 里那批 `#[test]` 全仓唯一的执行者；静音它 = 回归「判据在
 * 文档里、没人跑」。
 */
const SHELL_GATE = join(REPO_ROOT, "scripts", "shell-gate.mjs");

describe("桌面壳门禁接进 pre-commit（ISSUE #1597）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/shell-gate.mjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里没有桌面壳门禁 —— AGENTS 硬规则 5「改了壳必须重编」` +
        "与壳里那批 #[test] 都没有别的执行者",
    ).toEqual({
      label: "桌面壳（改了 src-tauri 才跑）",
      cmd: "node scripts/shell-gate.mjs",
    });
  });

  it("§13.1 清单里也有它（对账的两份手抄不构成执行者，这里显式钉一份）", () => {
    // 判据是「清单里有没有这条命令」本身，不是「清单与钩子一致」——后者两份一起抹
    // 掉就一致了（这正是 check-doc-references.cjs 那条双向对账的边界）。
    const checklist = readChecklistCommands();
    expect(
      checklist.has("node scripts/shell-gate.mjs"),
      "§13.1「本地提交前必须通过」清单里没有桌面壳门禁 —— 照清单手跑的人会以为它不存在",
    ).toBe(true);
  });

  it("脚本头那句「由 .githooks/pre-commit 的 D 组调用」是本次事故的判据，别让它消失", () => {
    // 反向要求：这句话**现在**是真的（钩子里有这一步）。若有人既拆掉钩子里那一步、
    // 又把这句删掉，文档与实现会一起闭嘴，而判据消失本身不会有人发现。
    const script = readFileSync(SHELL_GATE, "utf8");
    expect(
      script,
      "头部那句「由 `.githooks/pre-commit` 的 D 组调用」是这次事故的判据，别让它消失",
    ).toContain("由 `.githooks/pre-commit` 的 D 组调用");
  });
});

/**
 * 两步全库扫描的「输入面跳过」接进 D 组（ISSUE #1747）。
 *
 * 立案现场：pre-commit 的 D 组实测 56 步、热跑约 18.9s，而其中**两步就占 34%**
 * （`check-ui-primitives.cjs` 3.6s、`check-format.cjs` 2.9s）—— 两者都是全库扫描，
 * 而扫描面实际只是全库的一个子集（前者五条根全在 `src/` 下；后者由 `GLOB_RES` 剔掉
 * `IGNORE_GLOBS` 之后只剩 `src/**` 与 `.storybook/**`）。于是「只加 changelog 碎片 /
 * 只改文档 / 只动 `scripts/` 或 `tests/`」这一大类高频提交在这两步上白付 6.5s。
 *
 * ⚠️ `check-format.cjs` 那一半**已随 ISSUE #2010 整体挪到平台侧**（题面那句
 * 「prettier 只是格式化，不影响功能」）—— 它不再只是「加个 `--staged`」，而是
 * 「不在提交这一档上跑」。所以本组现在只钉 `check-ui-primitives`，格式那一条的
 * 两半判据在下面 `prettier 格式：执行者在平台侧` 那一组里。
 *
 * 同族里 **`--staged` 就是这一步能存在的前提**（与上面 docs-api 那条同一口径）：
 * 抹掉 flag 在本文件里与「让全库扫描回到无条件执行」等价，而**没有任何别的判据**
 * 会看见这个差异 —— 它只会让每次提交慢一点，慢不会让任何人报错。
 *
 * 这两条与 docs-api 那条一样，只读几份文本、不起子进程。
 */
const FORMAT_GATE = join(REPO_ROOT, "scripts", "check-format.cjs");
const UI_PRIMITIVES = join(REPO_ROOT, "scripts", "check-ui-primitives.cjs");

describe("全库扫描的输入面跳过接进 D 组（ISSUE #1747）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("UI 基元复用棘轮在钩子里带 --staged 条件触发", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-ui-primitives.cjs"),
    );
    expect(
      hit,
      `门禁链 ${steps.length} 步里没有 UI 基元复用棘轮，或它丢了 --staged —— ` +
        "后者会让全库扫描回到无条件执行（每次提交白付 3.6s，D 组单项最贵）",
    ).toEqual({
      label: "UI 基元复用棘轮",
      cmd: "node scripts/check-ui-primitives.cjs --staged",
    });
  });

  it("UI 基元的脚本实现了 --staged 这一档（不是只在钩子里写了个 flag）", () => {
    // 钩子里的 flag 与脚本里的实现是两件事：只写 flag 而脚本不认它，会被解析成
    // 未知参数（多数脚本忽略）⇒ 条件触发**静默失效**，退回无条件全库扫描。
    const cases = [["check-ui-primitives.cjs", UI_PRIMITIVES]] as const;
    for (const [name, file] of cases) {
      const script = readFileSync(file, "utf8");
      expect(
        script.includes('ARGS.has("--staged")'),
        `${name} 没有 --staged 这一档 —— 钩子里那个 flag 会变成静默失效的条件触发`,
      ).toBe(true);
    }
  });

  it("判据面由扫描配置现算，没有第二份手抄的目录清单", () => {
    // 这是本步能「不漂移」的前提：判据面必须从既有配置（`SCAN_DIRS`）现算，
    // 抄一份就会漂 —— 抄的那份多收一个目录，那类文件的违规从此没人查，
    // 且形态是静默的（§12.12 / §12.18）。
    // （`check-format.cjs` 那一半随 ISSUE #2010 挪到平台侧，它自己那套「面由
    // `GLOB_RES` + `IGNORE_RES` 现算」的判据在下面那组里单独钉。）
    const ui = readFileSync(UI_PRIMITIVES, "utf8");
    expect(
      ui.includes("skipUnlessStagedTouches({ roots: SCAN_DIRS"),
      "check-ui-primitives.cjs 的扫描面判定没有把 SCAN_DIRS 交给共享件 —— " +
        "手抄一份目录清单就会与 SCAN_DIRS 漂移",
    ).toBe(true);
  });
});

/**
 * prettier 格式：**执行者在平台侧**（ISSUE #2010）。
 *
 * 立案现场是用户的一句话：「prettier 只是格式化，不影响功能，挪到 ci 执行」。
 * 这句话之所以成立，是因为它正落在 §13.5.17 那条尺子上 —— **结论挡不挡得住一次
 * 代码回归**。格式漂了没有任何运行时症状，最坏后果是一次 `--write` 产出一份与本次
 * 改动无关的全文件 diff（一眼可见、改回来也只是再跑一次格式化）；而它留在**每一次
 * 提交**里要付冷缓存 ~21s / 热缓存 ~4.5s（钩子那一档的 `--staged` 只省掉「没碰到
 * 扫描面」那一半，而 `src/**` 是最高频的提交类别）。
 *
 * 判五件事，**每一件都是「没有任何别的判据会看见」的静默形态**：
 *   ① 钩子里不再有它（有 = 挪了个寂寞，提交照旧付那一笔）；
 *   ② 平台侧有这一步（它判的是「谁都没跑它」这一格 —— 钩子撤掉 + 平台侧没加 = 判据消失）；
 *   ③ 平台侧那一步**不带 `--staged`**（带 = 在平台侧恒跳过，挂了等于没挂）；
 *   ④ 它在本地的**出口**还在（`pnpm check:all` 的 `format` 项）—— 挪执行者不等于删能力；
 *   ⑤ 脚本头那句自我介绍指向平台侧（「自称在哪跑」⇄「真在哪跑」不一致，
 *      正是 `tests/gate-executors.test.ts` 立案的那族形态）。
 *
 * ⑤ 与 ① 是同一条口径的反向两半：脚本文本与钩子步骤**同时**改错时（一起闭嘴）没有任何
 * 别的判据会红，所以两半都要正面钉住。
 */
describe("prettier 格式：执行者在平台侧（ISSUE #2010）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);
  const config = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");

  it("钩子 D 组里已经没有它了（挪走 = 提交那一刻不再付这笔）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-format.cjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里又有 prettier 格式硬闸了 —— 它已随 ISSUE #2010 ` +
        "挪到平台侧（`.cnb.yml` 的「prettier 格式」）。要么把它从钩子里去掉，" +
        "要么同步改本判据（外加 §13.5.1.1 与 `.githooks/pre-commit` 头注那笔账）",
    ).toBeUndefined();
  });

  it("平台侧 `.cnb.yml` 真的有这一步（挪走 ≠ 没人跑）", () => {
    expect(
      platformStages().some((x) => x.name === "prettier 格式"),
      "`.cnb.yml` 里没有「prettier 格式」这一步 —— 钩子撤掉 + 平台侧没加 = " +
        "这条判据一个执行者都没有（§13.5.1.1 与 §13.5.17 同一条两半判法）",
    ).toBe(true);
    expect(
      registeredGateOrder(config),
      "`prettier 格式` 不在 COMFYAPP_CI_GATES 里（在跑但不登记 = 在场没有执行者）",
    ).toContain("prettier 格式");
  });

  it("平台侧那一步是**全量档**，且点名的就是这份脚本", () => {
    const stage = platformStages().find(
      (x) => x.name === "prettier 格式",
    )?.stage;
    expect(stage, "`.cnb.yml` 里解析不出「prettier 格式」这一步").toBeTruthy();
    expect(
      stage,
      "平台侧那一步带了 `--staged`：那里的工作区就是这次要判的那份源码，" +
        "`--staged` 读的是「本次暂存」、恒为空 ⇒ 这一步恒跳过（挂了等于没挂）",
    ).not.toContain("--staged");
    expect(
      stage,
      "「prettier 格式」跑的不是 scripts/check-format.cjs —— 两处各写一份判据必然分叉",
    ).toContain("scripts/check-format.cjs");
  });

  it("它不在**停用**清单里（那是另一件事：临时让位，不是挪执行者）", () => {
    /* `COMFYAPP_CI_DISABLED_GATES` 里同名的那条是 2026-10-16 的临时停用（让位给 E2E
     * 调试），恢复条件是「E2E 一绿 + 平台日志中文可读」。本轮它是被**挪过来接管**的，
     * 判据与执行者的关系变了 —— 于是「既在 GATES 又在 DISABLED」这句话会自相矛盾：
     * 停止清单里的档按定义不该跑，而这一步现在是它的唯一执行者。 */
    const disabled = registeredDisabledGates(config);
    expect(
      disabled,
      "`prettier 格式` 同时出现在 GATES 与 DISABLED_GATES 里 —— 它此刻是这条判据的" +
        "唯一执行者，停用清单里那一项是 2026-10-16 的临时让位，已随 ISSUE #2010 出网",
    ).not.toContain("prettier 格式");
  });

  it("本地出口还在（`pnpm check:all` 的 format 项）—— 挪执行者不等于删能力", () => {
    const gate = readFileSync(
      join(REPO_ROOT, "scripts", "quality-gate.mjs"),
      "utf8",
    );
    expect(
      gate,
      "`pnpm check:all` 里没有 prettier 这一档了 —— 挪走执行者之后它成了" +
        "「只有平台侧跑」的一条，而本仓承诺的是「完整验证这一档照旧能本地跑一遍」",
    ).toContain("scripts/check-format.cjs");
  });

  it("脚本头写明执行者在平台侧（自称 ⇄ 实际，别让两份承诺一起过期）", () => {
    const script = readFileSync(FORMAT_GATE, "utf8");
    expect(
      script,
      "check-format.cjs 的头部没写明它由平台侧 `.cnb.yml` 调用 —— " +
        "脚本自称的执行者与实际不一致时，读的人会被指到钩子里去找一步不存在的步骤",
    ).toContain(".cnb.yml");
    expect(
      script.includes("供 `.githooks/pre-commit` 调用"),
      "check-format.cjs 的头部又写回「供 .githooks/pre-commit 调用」了 —— 钩子里" +
        "已经没有这一步，那就是一句假承诺（§13.5.12 的立案形态）",
    ).toBe(false);
  });

  it("判据面仍由扫描配置现算（没有第二份手抄的目录清单）", () => {
    /* 这一条原住在上面那组里（与 `check-ui-primitives` 并列）；它随 ISSUE #2010
     * 跟着这一步一起搬过来 —— 判据自己的身体没变，与它在哪个执行者手里无关。 */
    const fmt = readFileSync(FORMAT_GATE, "utf8");
    expect(
      fmt.includes("GLOB_RES.some") && fmt.includes("IGNORE_RES.some"),
      "check-format.cjs 的扫描面判定没有由 GLOBS / IGNORE_GLOBS 现算 —— " +
        "手抄一份目录清单就会与 IGNORE_GLOBS 漂移",
    ).toBe(true);
  });
});

/**
 * 第二梯队全库扫描的「输入面跳过」接进 D 组（ISSUE #1747 续）。
 *
 * 立案现场：D 组里除两步最贵的（`check-ui-primitives` / `check-format`；后者已随
 * ISSUE #2010 整体挪到平台侧）之外，
 * 还有第二梯队 14 步各自「扫全库的一个子集」，单项 0.27–1.85s，合计 ≈8.5s
 * （实测热缓存 8 核）。它们的扫描面全是**固定前缀**（`src/`、`src/lib`、
 * `src/components`+`src/app`、`src-tauri/src` ……），于是「只加 changelog 碎片 /
 * 只改文档 / 只动 `scripts/` `tests/`」这一大类提交（实测占最近 60 次提交的 57%）
 * 在这些步上白付 —— 与 #1798 那两步同源，同一套口径（§13.5.8.2）。
 *
 * 为什么这条判据必须存在：抹掉一个 `--staged` 在本文件里与「让那一步回到无条件
 * 全库扫描」等价，而**没有任何别的判据**会看见这个差异 —— 它只会让每次提交慢一点，
 * 慢不会让任何人报错。同族先例是 #1798 那两条，本条把第二梯队 14 步一次钉住。
 *
 * 三条都只读几份文本，不起子进程。
 */
const SECOND_TIER: ReadonlyArray<readonly [string, string, string]> = [
  // [标签, 脚本名, 期望命令里带 --staged 的形态]
  [
    "标题行让位硬规则",
    "check-title-bar-clearance.cjs",
    "node scripts/check-title-bar-clearance.cjs --staged",
  ],
  [
    "import 别名统一(~ 前缀)",
    "check-import-alias.cjs",
    "node scripts/check-import-alias.cjs --staged",
  ],
  [
    "内联样式注入",
    "check-inline-style.cjs",
    "node scripts/check-inline-style.cjs --staged",
  ],
  [
    "跨文件重复块",
    "check-code-duplication.cjs",
    "node scripts/check-code-duplication.cjs --staged",
  ],
  [
    "函数长度(硬闸，>400 行即阻断)",
    "check-function-length.cjs",
    "node scripts/check-function-length.cjs --staged",
  ],
  [
    "模块循环依赖(硬闸)",
    "check-circular-deps.cjs",
    "node scripts/check-circular-deps.cjs --staged",
  ],
  [
    "地基层零消费导出(硬闸)",
    "check-dead-exports.cjs",
    "node scripts/check-dead-exports.cjs --staged",
  ],
  [
    "浮层层级刻度硬闸",
    "check-overlay-z.cjs",
    "node scripts/check-overlay-z.cjs --staged",
  ],
];

/**
 * **被聚合档接管的 6 条 AST 判据**（ISSUE #1747 续，「第四笔账」）。
 *
 * 它们此前各自在钩子里占一行、各自把 `src/` 全量解析一遍。现在钩子里只有
 * `node scripts/run-ast-gates.cjs --staged` 一行，这 6 条由聚合档一次解析后逐条跑。
 *
 * 这里要钉两件事，因为**两件的失效形态都是静默的**：
 *   1. 这 6 条**必须仍然实现 `--staged` 且短路在 `require("typescript")` 之前** ——
 *      聚合档的 `loadGate()` 就是在这次口径下 require 它们的（聚合档把 `--staged`
 *      判断提升到按条算，但脚本自身的短路点位置仍是它「自己单跑」时的省时前提）；
 *   2. 钩子里**不许**再让它们各占一行（各占一行 = 与聚合档跑两遍，白付一次解析）。
 *      第 2 条同时在 `tests/ast-gates-aggregate.test.ts` 里从聚合档侧钉了一遍。
 */
const AGGREGATED_AST_GATES: readonly string[] = [
  "check-react-updater-purity.cjs",
  "check-non-null-assertions.cjs",
  "check-void-floats.cjs",
  "check-ts-duplicate-keys.cjs",
  "check-form-field-wiring.cjs",
  "check-click-keyboard.cjs",
];

describe("第二梯队全库扫描的输入面跳过接进 D 组（ISSUE #1747 续）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it.for(SECOND_TIER)(
    "%s 在钩子里带 --staged 条件触发",
    ([label, , expected]) => {
      const hit = steps.find((s) => s.label === label);
      expect(
        hit,
        `门禁链 ${steps.length} 步里没有「${label}」—— 判据从门禁链里被摘掉了`,
      ).toBeDefined();
      expect(
        hit?.cmd,
        `「${label}」丢了 --staged —— 全库扫描会回到无条件执行：这一大类高频提交` +
          "（只加 changelog 碎片 / 只改文档 / 只动 scripts 或 tests）在它上面白付",
      ).toBe(expected);
    },
  );

  it.for(SECOND_TIER)("%s 的脚本真的实现了 --staged", ([, script]) => {
    // 钩子里的 flag 与脚本里的实现是两件事：只写 flag 而脚本不认它，会被解析成未知
    // 参数（多数脚本忽略）⇒ 条件触发**静默失效**，退回无条件全库扫描。
    const text = readFileSync(join(REPO_ROOT, "scripts", script), "utf8");
    expect(
      text.includes("skipUnlessStagedTouches("),
      `${script} 没有实现 --staged —— 钩子里那个 flag 会变成静默失效的条件触发`,
    ).toBe(true);
  });

  it("短路点在重活之前（不是在 main() 末尾）", () => {
    // 这一条接的是本轮实测出来的坑：`--staged` 若落在 `main()` 里、或落在
    // `require("typescript")` / 预加载 IIFE 之后，跳过那一支**照样付**那笔开销
    // （TS 模块加载 ≈180ms、`check-dead-exports` 的语料预加载 ≈340ms），
    // 「跳过」就成了形式上的绿、没有省下任何东西 —— 而退出码看不出差别。
    //
    // 判据形态：短路语句的行号必须**小于**该脚本里第一次出现
    // `require("typescript")` 那一行（没有就 <= `require("node:fs")` 之后即可）。
    for (const [, script] of SECOND_TIER) {
      const text = readFileSync(join(REPO_ROOT, "scripts", script), "utf8");
      const lines = text.split("\n");
      const skipAt = lines.findIndex((l) =>
        l.includes("skipUnlessStagedTouches("),
      );
      expect(
        skipAt,
        `${script} 找不到 --staged 短路语句`,
      ).toBeGreaterThanOrEqual(0);
      // 只认**真的** require 行：注释里出现的同一段字面不算（本仓的风格是
      // 在文件头解释「为什么这样加载」，那条注释必然含 `require("typescript")`）。
      const tsAt = lines.findIndex(
        (l) =>
          !/^\s*(\/\/|\*|\/\*)/.test(l) &&
          /require\(\s*"typescript"\s*\)/.test(l),
      );
      if (tsAt === -1) continue; // 该步不加载 typescript
      expect(
        skipAt,
        `${script} 的 --staged 短路在第 ${skipAt + 1} 行、` +
          `而 require("typescript") 在第 ${tsAt + 1} 行 —— 跳过档照样付 ≈180ms 的模块加载，` +
          "「跳过」等于没省；短路必须提到它前面",
      ).toBeLessThan(tsAt);
    }
  });
});

describe("被聚合档接管的 6 条 AST 判据（ISSUE #1747 续，第四笔账）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("聚合档那一行在钩子里带 --staged 条件触发", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/run-ast-gates.cjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里没有 AST 判据聚合档 —— 6 条判据一个执行者都没有了`,
    ).toBeDefined();
    expect(hit?.cmd).toBe("node scripts/run-ast-gates.cjs --staged");
  });

  it.for(AGGREGATED_AST_GATES)(
    "%s 不再单独占钩子一行（否则与聚合档跑两遍）",
    (script) => {
      const dup = steps.filter((s) => s.cmd.includes(`scripts/${script}`));
      expect(
        dup.map((s) => s.label),
        `${script} 又单独占了一行钩子 —— 它会与聚合档各跑一遍，白付一次解析`,
      ).toEqual([]);
    },
  );

  it.for(AGGREGATED_AST_GATES)(
    '%s 自己仍实现 --staged，且短路在 require("typescript") 之前',
    (script) => {
      const lines = readFileSync(
        join(REPO_ROOT, "scripts", script),
        "utf8",
      ).split("\n");
      const skipAt = lines.findIndex((l) =>
        l.includes("skipUnlessStagedTouches("),
      );
      expect(
        skipAt,
        `${script} 的 --staged 短路没了 —— 聚合档把这条单跑时它不再省时`,
      ).toBeGreaterThanOrEqual(0);
      const tsAt = lines.findIndex(
        (l) =>
          !/^\s*(\/\/|\*|\/\*)/.test(l) &&
          /require\(\s*"typescript"\s*\)/.test(l),
      );
      if (tsAt === -1) return; // 该步不加载 typescript
      expect(
        skipAt,
        `${script} 的短路在第 ${skipAt + 1} 行、require("typescript") 在第 ${tsAt + 1} 行`,
      ).toBeLessThan(tsAt);
    },
  );
});

/**
 * 新鲜度账判决的**第二个执行者**（ISSUE #1979）。
 *
 * 立案现场：三档「每天首次自证」（全量 e2e / 全量单测 + 覆盖率 / 产物级护栏）的
 * **判决**一直只在本地钩子里跑（`scripts/freshness-gate.mjs`；那一档后来进了 D0 前置档），
 * 而**执行**那三档的
 * 跑法脚本在平台侧从来没被调用过 —— `.cnb.yml` 的「生产构建」跑的是裸
 * `pnpm run build`（而不是 `artifact-run.mjs`），于是「这一步绿了」只落在日志里、
 * 账面上一个字不变。判据与账是两件事，两个执行者要读到同一份事实。
 *
 * 判四层（2026-10-18 起第三半换了执行者、第四半分量的确变重了）：
 *   ① 平台侧那一步在（`.cnb.yml` 的「新鲜度账」，跑的是与钩子**同一份**脚本）；
 *   ② PR 那一条上**凡刷新账的档都排在它之后**，而此刻一条都没有 —— `生产构建` 挪进
 *      每日档（§13.5.23）、`单元测试` 仍停用。所以这一条判两半：在场的刷新者不许排在
 *      前面（给「加回来」留着），以及 `生产构建` 不许在 `GATES` 里（把撤档这个决定
 *      写死成断言，而不是留一句「顺序真好看」）；
 *   ③ ~~「生产构建」的入口是跑法脚本~~ —— 同一件事现在**只**由每日档那一条判
 *      （`tests/no-platform-ci-config.test.ts` 的「定时那一跑」：入口 + `timeout`）。
 *      这里删掉而不是留个空壳：两处钉同一个事实，漂了没人知道哪份是真的（§12.12）；
 *   ④ 本地那一半**不许撤**：这一步仍在每次提交里跑、仍打三份账的时刻与形状。
 *      ⚠️ 2026-10-19 起它的角色变了：三档都登记了 `ciStage`（执行者在平台侧每日档），
 *      所以它**不再要求当天自证**，只剩两件事仍然非有不可 —— 打读数（「这一档上次被
 *      实证跑绿是什么时候」必须被看见），以及判账面形状（撤的是要求，不是让读数可以假）。
 *      「撤拦 ≠ 撤掉这一步」由下面那条用例判：把这一步从链里删掉，读数就再没有读者。
 *      而「本地不拦」成立的前提（那一格真在每日清单里）由
 *      `tests/no-platform-ci-config.test.ts` 判，不在这里写第二份。
 */
describe("新鲜度账：平台侧的第二个执行者（ISSUE #1979）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);
  const config = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");

  it("平台侧有「新鲜度账」这一步，且跑的是与钩子同一份脚本", () => {
    const hit = platformStages().find((x) => x.name === "新鲜度账");
    expect(
      hit,
      "`.cnb.yml` 里没有「新鲜度账」这一步 —— 判据在平台侧没有执行者，而它要拦的" +
        "正是「谁都没跑它」这个静默形态（§13.5.17 同款两半判法）",
    ).toBeDefined();
    expect(hit?.stage, "那一步的原文块解析不出来（名字被改了？）").toBeTruthy();
    expect(
      hit?.stage,
      "平台侧那一步跑的不是 scripts/freshness-gate.mjs —— 两处各写一份判据必然分叉，" +
        "而分叉之后「本地绿、平台红」（或反过来）读起来像环境差异，不像判据不一致",
    ).toContain("scripts/freshness-gate.mjs");
    expect(
      registeredGateOrder(config),
      "`新鲜度账` 不在 COMFYAPP_CI_GATES 里（在跑但不登记 = 顺序与在场都没有执行者）",
    ).toContain("新鲜度账");
  });

  it("PR 那一条上凡刷新新鲜度账的档都排在「新鲜度账」之后（此刻一格都不许有）", () => {
    /* 这条不是风格：跑法脚本跑绿之后会**刷新自己那笔账**
     * （`artifact-run.mjs` → `scripts/.artifact-freshness.json`，`full-suite-run.mjs` →
     * `.full-suite-freshness.json`），而同一分支的 stage **共享同一个工作区** ——
     * 排在 `新鲜度账` 之前时，那一步读到的是「刚被这一次运行改过的账」，
     * 于是「源分支上账是旧的」永远判不出来（判据在场、结论恒放行，
     * 正是本仓最不能有的静默形态）。
     *
     * 认的是「这一步的 script 点名了记账入口」这个**语义**，不是行形状：把命令包进
     * `ci-cp936-exit.mjs`、换 stage 的位置、甚至换 YAML 缩进，这条都还看得见。
     *
     * ⚠️ `e2e-run.mjs` **不在这一列**，两个理由现在叠在一起：PR 那条 2026-10-19 起没有
     *   端到端那一格（整格挪到每日档），而它此前带的 `--grep=@critical` 按
     *   `isWholeTrackRun()` 也**不构成整档凭证 ⇒ 不记账**（见 `freshness-ledger.mjs`）。
     *   算进来等于判出一条假冲突；而每日那一格跑的是整档、真的会刷新账，那一半由
     *   「每日清单 ⇄ `ciStage`」那条判据管，不在这里写第二份。
     *
     * 2026-10-18 之后这一列在 PR 上是**空的**：`生产构建` 与 `单元测试` 都只在每日档
     * （`每日生产构建` / `每日单元测试`）。所以这一条今天判的是第二半 ——
     * 「PR 清单里不许出现记账入口」，而那是刻意的挪档结论，不是恰好没有。
     * 谁把某一格加回来，第一半（顺序）自动接管。 */
    const ledgerRefreshing = [
      "scripts/artifact-run.mjs",
      "scripts/full-suite-run.mjs",
    ];
    const order = registeredGateOrder(config);
    expect(order, "`新鲜度账` 不在 GATES 清单里").toContain("新鲜度账");
    const freshAt = order.indexOf("新鲜度账");
    const refreshers = platformStages()
      .map((s, at) => ({ ...s, at }))
      .filter((s) =>
        ledgerRefreshing.some((entry) => (s.stage ?? "").includes(entry)),
      );
    const beforeGate = refreshers
      .filter((s) => s.at < freshAt)
      .map((s) => s.name);
    expect(
      beforeGate,
      `这些 stage 排在 \`新鲜度账\` 之前：${beforeGate.join(", ")} —— 它们的跑法脚本会先把账刷新，` +
        "于是这一步读到的是「刚被本次运行证过的账」，恒放行",
    ).toEqual([]);
    /* 半边二：`生产构建` 此刻**不许**在 PR 清单里 —— 2026-10-18 的挪档结论要写死成
     * 断言，而不是靠「恰好解析不出来」。它现在只在每日档，那一格的入口与预算由
     * `tests/no-platform-ci-config.test.ts` 的「定时那一跑」判。 */
    expect(
      order,
      "`生产构建` 又回到 `COMFYAPP_CI_GATES` 了 —— 那是 2026-10-18 撤掉的一格" +
        "（PR 上再跑一次 `pnpm run build` 是第二次执行同一个判据，不是第二份信息：" +
        "这一档的机器执行者是每日那一格 `每日生产构建`。要恢复请先改 §13.5.23）",
    ).not.toContain("生产构建");
  });

  it("本地那一半仍在钩子门禁链里（平台侧 squash 合并不跑本地钩子，不能只剩它）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/freshness-gate.mjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里没有新鲜度账判决 —— 平台侧只在 PR 事件上跑，` +
        "本地迭代与 PR 之间的那些提交会整段失去能见度",
    ).toBeDefined();
    expect(hit?.cmd).toBe("node scripts/freshness-gate.mjs");
  });
});

/**
 * D0 形态前置档（钩子重构 1）。
 *
 * 立案现场（本机账 `.git/comfy-precommit-timing.jsonl`，最近 17 次提交里 6 次红）：
 * D 组带 `set -e`，一次红的记录里「记到哪一条」就是拦下你的那一条（后面的没有跑）。
 * 那六次读出来是：**新鲜度账 ×3**（跨过一个 00:00 之后的第一次提交）、
 * **生成态文档与源同步 ×2**（这条已随 ISSUE #1975 挪到平台侧，本地不再付）、
 * **CHANGELOG 碎片 ×1** —— 而那一次 **D 组跑到 14.2s 就已判红，整条钩子照旧付满 C 组的
 * 156.6s 才退出**（exit 1、D=14.2s、C=156.6s、总 157.6s）。
 * 四组是「并行且**全部等完**」的（墙钟 = max(各组) = C），所以在 D 组内部重排不会让任何
 * 一次提交变快 —— 能省的形状只有一个：在 A/B/C 启动之前先拿到这一档结论。
 *
 * 为什么要一条判据守着这一档：它是**编排决定**，会被「顺手加一条」「顺手挪回 D」改掉，
 * 而改掉的表现为「红的那几次又慢回去了」—— 慢不会让任何人报错。与 SECOND_TIER 那两条
 * 同一条立案理由（「抹掉一个 `--staged` 与让全库扫描回到无条件执行等价，而没有任何别的
 * 判据会看见这个差异」）。
 *
 * 判五件事：① D0 块解析得出来（解析不出时下面每条都会「没有站点要查」地绿）；
 * ② 名单里每条确实在 D0 块里、命令逐字一致；③ 名单不许无声变长或换序（往**串行**档里
 * 加东西 = 给每一次绿提交加税，这条决定必须过人的眼）；④ D0 与 D 不相交、且 D0 的等待点
 * 排在 `run_group A` **之前**（否则这一档退化成第六个并行组，本档存在的理由就没了）；
 * ⑤ 读不到 D0 退出码时是拦下而不是放行。
 *
 * 三条都只读文本、不起子进程。
 */
const FORM_PREPASS: ReadonlyArray<readonly [string, string]> = [
  ["CHANGELOG 碎片", "node scripts/check-changelog-fragments.cjs"],
  ["待发段落的来源锚 ⇄ 条目归属", "node scripts/check-changelog-versions.cjs"],
  [
    "每档都有主（新鲜度账：e2e / 全量单测 / 产物三档自证）",
    "node scripts/freshness-gate.mjs",
  ],
  ["UI/逻辑分离硬闸", "node scripts/check-ui-logic-separation.cjs"],
  ["地基层零消费导出(硬闸)", "node scripts/check-dead-exports.cjs --staged"],
  [
    "故事面（title / 接上真组件 / 分组一致 / 必填 props 的 args）",
    "node scripts/storybook-check.mjs --changed",
  ],
  ["产品版本号三处同步(D7)", "node scripts/check-app-version.cjs"],
  ["ui/ 定制标记与台账（§16.8）", "node scripts/check-ui-customizations.cjs"],
  ["跨平台动作对照(.ps1⇄.mjs)", "node scripts/check-ps1-consistency.mjs"],
  ["端口推导跨语言一致性", "node scripts/check-app-port-vectors.cjs"],
  ["import 别名统一(~ 前缀)", "node scripts/check-import-alias.cjs --staged"],
  [
    "依赖新鲜度（只判动了依赖面的提交，§13.5.13）",
    "node scripts/check-deps-freshness.mjs --staged",
  ],
  [
    "依赖构建脚本与 allowBuilds 对账（只判动了依赖面的提交）",
    "node scripts/check-allow-builds.cjs --staged",
  ],
  [
    "基础设施层文件长度硬闸(scripts+tools，§12.6 R5 姊妹档)",
    "node scripts/check-infra-file-size.cjs --staged",
  ],
];

describe("D0 形态前置档：串行的那一条线（钩子重构 1）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const d0 = stepsInGroup(hook, "D0");
  const d = stepsInGroup(hook, "D");

  it("两个块都解析得出来（解析不出时其余各条会空转）", () => {
    // 「读不到块」与「块里没有那一步」在两处都长成同样的绿，所以先正面钉扫描面非空。
    expect(
      d0.length,
      "读不到 D0 块的 `run` 步骤 —— 组名或 `sh -c` 的引号形状变了",
    ).toBeGreaterThan(0);
    expect(d.length, "读不到 D 块的 `run` 步骤").toBeGreaterThan(0);
  });

  it.for(FORM_PREPASS)("%s 在 D0 块里且命令逐字一致", ([label, cmd]) => {
    const hit = d0.find((s) => s.label === label);
    expect(hit, `D0 块里没有「${label}」—— 前置档被摘掉了这一条`).toBeDefined();
    expect(
      hit?.cmd,
      `「${label}」的命令与名单登记的不一致 —— flag 就是判据的档位（` +
        "钩子档 / `--report` 盘点档 / `--update` 收紧档不是同一件事）",
    ).toBe(cmd);
  });

  it("D0 的成员与顺序都不许无声变化", () => {
    /* 用 `toEqual` 而不是 `toEqual(expect.arrayContaining(...))`：成员之外，**顺序**也是
     * 这一档的决定（本机账里真拦下过提交的那两条排最前，让最可能用到的结论最早到）。
     * 换序在账本上只表现为「某一步的读数变了」，不会有人来改这份名单。 */
    expect(
      d0.map((s) => s.label),
      "D0 块的步骤与这份名单不一致 —— 往串行档里加一条就是给每一次绿提交加税，" +
        "挪走一条就是让那一类红重新等满 C 组的墙钟；两种都要过人的眼",
    ).toEqual(FORM_PREPASS.map(([label]) => label));
  });

  it("同一条判据不许在 D0 与 D 里各跑一遍", () => {
    const both = d0.filter((s) => d.some((x) => x.label === s.label));
    expect(
      both.map((s) => s.label),
      "两个组里都有这一步 ⇒ 白付一遍，而 `$LOGD/steps.ms` 里会出现两个同名标签，" +
        "账本上那一步的读数是两次之和（读起来像「这条判据变慢了」）",
    ).toEqual([]);
  });

  it("D0 的等待点排在 `run_group A` 之前（这一档存在的全部理由）", () => {
    const waitAt = hook.indexOf('wait "$D0_pid"');
    const aAt = hook.indexOf("run_group A ");
    expect(waitAt, "钩子里找不到 D0 的等待点").toBeGreaterThanOrEqual(0);
    expect(aAt, "钩子里找不到 A 组的启动点").toBeGreaterThanOrEqual(0);
    expect(
      waitAt,
      "D0 的等待点排在 A/B/C 之后 ⇒ 前置档退化成第六个**并行**组：结论照样迟到，" +
        "而被形态判据拦下的那几次仍然付满 C 组的墙钟 —— 那正是本档要消掉的东西",
    ).toBeLessThan(aAt);
  });

  it("读不到 D0 的退出码时拦下，不是放行", () => {
    const seg = hook.slice(
      hook.indexOf('wait "$D0_pid"'),
      hook.indexOf("run_group A "),
    );
    const guardAt = seg.indexOf('[ ! -f "$LOGD/D0.rc" ]');
    expect(
      guardAt,
      "D0 之后没有「读不到退出码」那一支 —— 缺退出码就成了「默认 0 = 通过」",
    ).toBeGreaterThanOrEqual(0);
    expect(
      seg.slice(guardAt, seg.indexOf("_d0_rc=", guardAt)),
      "读不到退出码那一支没有 exit 1 —— 这一档是后面四组的唯一前置，" +
        "「判据没跑完」不等于「判据通过」（§13.5.15 同款口径）",
    ).toContain("exit 1");
  });

  it("D0 与 D 的步骤数之和等于门禁链总数（块边界完好）", () => {
    /* 这条不是形式检查。本轮重排 D0 时，组收尾的那个单引号被并进了最后一条步骤行的行尾
     * （`… check-infra-file-size.cjs --staged'`）：`sh -n` **照样过**（它确实闭合了本组的
     * `sh -c`），但四个解析器看到的命令就多了一个 `'`，而「取 D0 块」的切片会一路吞到 D 组
     * 的收尾 —— 于是 D0 读出来是 51 步。现场靠人读文件才发现，所以把它收成两条判据：
     * 两组的并 == 全文步骤总数（块边界被吞时左边会大于右边），且没有一条命令以 `'` 结尾。 */
    expect(
      d0.length + d.length,
      `D0(${d0.length}) + D(${d.length}) 与门禁链总数 ${hookGateSteps(hook).length} 对不上 ⇒ 某一组的` +
        "边界被吞了（收尾引号并进了行内），此时按组解析出来的步骤是假的",
    ).toBe(hookGateSteps(hook).length);
    const glued = [...d0, ...d].filter((s) => s.cmd.endsWith("'"));
    expect(
      glued.map((s) => s.label),
      "有步骤的命令以单引号结尾 ⇒ 组的收尾引号并进了那一行，四个解析器都会读到带引号的命令",
    ).toEqual([]);
  });

  it("D0 与 D 都 source 同一份计时（否则前置档的逐步读数会静默消失）", () => {
    // 两个块都是 `sh -c` 起的新 shell：外层函数看不见它们，未 source 时形态是
    // 「读数落到一个空路径」，丢掉的是整组逐步的账（第一版就是这么错的）。
    for (const id of ["D0", "D"]) {
      expect(
        groupShBody(hook, id),
        `组 ${id} 没有 source 时钟，或那个块解析不出来`,
      ).toContain('. "$COMFY_TIMING_SH"');
    }
  });
});
