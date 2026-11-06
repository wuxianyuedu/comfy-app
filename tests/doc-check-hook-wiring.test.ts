/**
 * pre-commit「接线本身」的在位判据：doc:check 执行者（#1371 → #1975）、R5 `--strict`（#1404/#1811）、注释语言
 * 棘轮（#1451）、桌面壳（#1597）、全库扫描输入面与 AST 聚合档（#1747）、新鲜度账第二执行者（#1979）、D0 前置档。
 * 单列成文件并进 FIXED_STRUCTURAL_TESTS：改 `.githooks/**` 时增量层跑 `mode:"all"`；解析步骤行而非 `toContain`（注掉后仍命中）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  registeredDailyGateOrder,
  registeredDisabledGates,
  registeredGateOrder,
  stageBlock,
} from "./no-platform-ci-config.test";

import { groupShBody, runSteps, stepsInGroup } from "./helpers/hook-groups";
import { HEAVY_GATES, heavyGateRegistryProblems } from "../scripts/ci-heavy-gates.mjs";
import { parseStageScripts } from "../scripts/ci-autofix-duties.mjs";
import { readHookSteps } from "../scripts/base-check/hook-steps.mjs";

const REPO_ROOT = resolve(".");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");
const STRUCTURE = join(REPO_ROOT, "scripts", "check-file-structure.cjs");
const R5_BASELINE = join(REPO_ROOT, "scripts", ".file-size-baseline.json");

/**
 * 钩子里**全部** `run "<标签>" <命令>` 步骤行（D0 前置档 + D 静态判据档，不分组）：在场判据要的正是这个并集，
 * 一条判据在不在门禁链里与它在哪组无关（从并行档挪进前置档不该让任何在场判据变红）。解析而非 `toContain(那一行)`：
 * 加 `# ` 注掉后 `toContain` 仍命中，只有计数与逐字命令会红。解析器本体在 `tests/helpers/hook-groups.ts`（三处共用）。
 */
function hookGateSteps(hookText: string) {
  return runSteps(hookText);
}

/**
 * 每日那一条流水线的 stage 清单（`COMFYAPP_CI_DAILY_GATES`），与 PR 档同形状、同解析器
 * （`registeredDailyGateOrder` + `stageBlock`；抄第二份就会静默漂，§12.12 / §12.18）。需要它是因为 ISSUE #2300：
 * 「新鲜度账」2026-10-23 从 PR 档撤到每日档，拿 PR 清单问会答「不在」，真相是「搬走了，不是不存在」。
 * PR 档那一条在 2026-11-05 薄化后只剩平台读数与判决链，因此这里不再有 `platformStages()` 那一份。 */
function dailyStages(): Array<{ name: string; stage: string | null }> {
  const text = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");
  return registeredDailyGateOrder(text).map((name) => ({
    name,
    stage: stageBlock(text, name),
  }));
}

/**
 * 某条判据在平台侧的**执行面**（跑在哪、命令行长什么样）。两个来源都要读（2026-10-19 起）：`.cnb.yml` 的独立
 * stage 与聚合档 `重档静态判据` 的 `HEAVY_GATES` 条目 —— 只读前者会把收进聚合档的判成「没有这一步」，那是
 * **指错方向的红**（人会去补 stage，判据其实在跑）。唯一出处仍是 `.cnb.yml` 的 `script:` 与 `ci-heavy-gates.mjs`。
 */
function platformExecutor(stageName: string) {
  const stage = stageBlock(readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8"), stageName);
  if (stage !== null) {
    return { where: "stage", command: stage };
  }
  const gate = HEAVY_GATES.find((g) => g.name === stageName);
  if (!gate) {
    return null;
  }
  /* 聚合档这一支**必须核「这一格真会跑它」**（2026-10-22 加）。原来「条目表里有这个名字」就算数，而那张表只是
   * **登记面**，这一格跑的是**钩子的步骤行**。2026-10-20 就是这样溜过去的：表上 4 条、钩子里没有、配置原文也
   * 注释掉 ⇒ 那 4 条一个执行者都没有而这里全绿。⇒「表上有」不等于「有人跑」，故现在按钩子的步骤行认。 */
  const hook = readFileSync(HOOK, "utf8");
  const step = hookGateSteps(hook).find((s) => s.cmd === gate.argv.join(" "));
  if (!step) {
    return null;
  }
  return { where: "重档静态判据", command: step.cmd };
}

/** §13.1「本地提交前必须通过」代码块里的命令（`✅ <命令>  # 说明` 的那部分）。 */
const GATE_CHECKLIST_DOC = join(REPO_ROOT, "docs", "standards", "13-提交与-code-review.md");

/**
 * 读 §13.1 清单里的命令集合。marker 那句写在围栏**里面**，所以取 marker 之后遇到的
 * 第一个 ``` 就是这份清单的收尾（与 `check-doc-references.cjs` 同一份解析，不写第二份）。
 * @returns {Set<string>}
 */
function readChecklistCommands() {
  const text = readFileSync(GATE_CHECKLIST_DOC, "utf8");
  const start = text.indexOf("本地提交前必须通过");
  if (start === -1) {
    return new Set();
  }
  const rest = text.slice(start);
  const close = rest.indexOf("```");
  if (close === -1) {
    return new Set();
  }
  return new Set(
    rest
      .slice(0, close)
      .split("\n")
      .filter((l) => l.startsWith("✅ "))
      .map((l) => (l.slice(2).split(/ +# /)[0] ?? "").replaceAll(/\s+/g, " ").trim()),
  );
}

describe("doc:check 在平台侧、不在钩子里（ISSUE #1371 立档 → ISSUE #1975 挪执行者）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  /* 这一条守的动作**变过一次**，两半都要留着：ISSUE #1371 翻档是把它**接进**钩子；ISSUE #1975 又从钩子**挪到
   * 平台侧**（§13.5.17：判的是文档面，挡不住代码回归；平台侧回来后有第二个执行者）。所以判两半：钩子里不再有
   * 它、平台侧那一步在。只判一半的话「钩子撤掉 + 平台侧也忘了加」会全绿，失效形态正是「谁都没跑它」。 */
  it("钩子 D 组**不再**执行这一步（它已在平台侧，见 §13.5.17）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-doc-references.cjs"));
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
    const claimed = /D\((?<count>\d+) 个判据脚本\)/.exec(hook);
    expect(claimed, "钩子里的判据计数陈述还在吗？").not.toBeNull();
    expect(
      Number(claimed?.groups?.count),
      `钩子注释写 ${claimed?.groups?.count}，实际 ${steps.length}`,
    ).toBe(steps.length);
  });
});

describe("R5 的硬闸在钩子里（ISSUE #1404 立档 / ISSUE #1811 收成硬闸）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("结构那一步真的在跑，且不带任何 flag（R5 已是硬闸，没有 --strict 可加）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-file-structure.cjs"));
    expect(hit, `结构那一步不在了，或标签 / flag 与预期不符（D 组共 ${steps.length} 步）`).toEqual({
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
 * 注释语言棘轮接进 D 组（ISSUE #1451）。它不是「再抄一遍 §13.1 清单」：这一族要拦的是「把某一步摘回手动档 /
 * 抹掉 flag」，而那份权威清单自己就漂过 5 步（§13.5.10），抄一份只会更难保持正确。断言形状与上面两条同款：
 * 解析 D 组步骤、只认真调用。
 */
const COMMENT_LANGUAGE = join(REPO_ROOT, "scripts", "check-comment-language.cjs");

describe("注释语言棘轮在钩子里（ISSUE #1451）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-comment-language.cjs"));
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
 * API 文档生成与自检：已从 D 组挪到平台侧（#1329 收尾 → #1975），#2231 改了判据对象，
 * 2026-11-05 又从 push **降到每日档**（ISSUE #2537：最晚次日 01:00 暴露，窗口 ≤24h）。它带的
 * `--staged` 输入面是 typedoc 的解析根（几乎任何源码/脚本/用例改动）。
 * 判两半：钩子里不再有它、平台侧那一步在且**不带 `--staged`**；#2231 后也不带 `--autofix`
 * （产物不进 git，自动修+再判让陈旧隐形）。
 */
const DOCS_API = join(REPO_ROOT, "scripts", "check-docs-api.cjs");

describe("API 文档生成与自检（#1329 收尾 → #1975 挪执行者 → #2231 改判据对象 → #2537 降每日档）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("钩子 D 组**不再**执行这一步（它已在平台侧，见 §13.5.17）", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-docs-api.cjs"));
    expect(
      hit,
      `门禁链 ${steps.length} 步里又有 docs-api 同步了 —— 它已随 ISSUE #1975 挪到平台侧 ` +
        "（`.cnb.yml` 每日档的「每日 API 文档生成与自检」）。要么把它从钩子里去掉，要么同步改本判据",
    ).toBeUndefined();
  });

  it("平台侧那一步在，且是**全量档**（`--staged` 在平台侧恒跳过 = 白挂）", () => {
    const executor = platformExecutor("每日 API 文档生成与自检");
    expect(
      executor,
      "平台侧（`.cnb.yml` 的每日档 stage 清单与聚合档 `重档静态判据` 的条目表）都没有" +
        "「每日 API 文档生成与自检」—— 钩子撤掉 + 每日档没加 = 这一格又回到" +
        "「没人跑」的形态（§13.5.17 / ISSUE #2537）",
    ).not.toBeNull();
    expect(executor?.command, "平台侧那一步的原文块解析不出来（名字被改了？）").toBeTruthy();
    expect(
      executor?.command,
      "平台侧那一步带了 `--staged`：平台侧的工作区就是这次要判的那份源码，" +
        "`--staged` 在那里读的是「本次暂存」，恒为空 ⇒ 这一步恒跳过（挂了等于没挂）",
    ).not.toContain("--staged");
  });

  it("平台侧那一步**不带 `--autofix`**（产物不再进 git，没有「自动修完再提交」的对象）", () => {
    /* ISSUE #2231 现场：master 产物与源差 9 处而平台**报绿** —— 带 `--autofix` 就会就地重生成再判，第二次一致 ⇒ 退 0，
     * 「修好了」与「本来就对」同形 ⇒ 漂移在 CI 隐形。产物搬出 git 后该格改判「本轮产物可不可用」，自动修旗标必须摘掉。
     * ⚠️ 只核那一行的 `script:`（整块里注释出现旗标字面量不等于这一格带着它），解析口径复用 `parseStageScripts()`。 */
    const script = parseStageScripts(readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8")).get(
      "每日 API 文档生成与自检",
    );
    expect(script, "配置里解析不出「每日 API 文档生成与自检」那一行的 script").toBeDefined();
    expect(
      script,
      "平台侧那一步又带上了 `--autofix` —— 产物不再进 git，没有「自动修完再提交」的对象",
    ).not.toContain("--autofix");
  });

  it("生成物**不再**提交进 git（判据对象换成了「这一轮生成的产物」）", () => {
    /* 上一版在这里断言的是「产物仍然提交进 git（判据对象没被 .gitignore 摘掉）」——
     * 判据的整个前提是「产物在仓库里」，而 ISSUE #2231 把那个前提撤了：产物进
     * `.gitignore`，于是「提交进 git 的那份与源同不同步」这个问题**没有对象**了。
     * 新的前提是「产物不在 git 里」—— 有人把它加回 git ⇒ 漂移那一族又活了。 */
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(
      ignore,
      "`.gitignore` 里没有 `docs/api/` —— 产物又被搬回 git 了 ⇒ 「提交进 git 的那份与源同" +
        "不同步」这个问题重新有对象，而那一格不再判它 ⇒ 漂移在 CI 上隐形（#2231 的现场）",
    ).toContain("docs/api/");
    /* 判据本身也不该再要求「产物目录事先存在」—— 它自己生成那一份。 */
    const script = readFileSync(DOCS_API, "utf8");
    expect(
      script,
      "判据里还留着「产物目录不存在 ⇒ 判红」那套 —— 产物不再进 git，判据自己生成一份",
    ).not.toContain("生成物本应提交进 git");
  });

  it("脚本头写明它现在由**平台侧**调用（挪了执行者，承诺要跟着改）", () => {
    /* 反向要求：这句话**现在**是真的（`.cnb.yml` 每日档里有那一步）。脚本头原先写的是
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
 * 桌面壳门禁接进 D 组（ISSUE #1597）。立案现场：`shell-gate.mjs` 在钩子里确有一行，但 `tests/shell-gate.test.ts`
 * 只有 `toContain`（注释行同样命中），而「钩子 ⇄ §13.1 清单」互核把两份同时抹掉（顺手改小 `D(N)` 计数）也会全绿
 * ⇒「摘回手动档」静默通过。它值一条判据：这一步是 AGENTS 硬规则 5（改壳必须重编）与 `src-tauri` 那批 `#[test]` 的唯一执行者。
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
 * 两步全库扫描的「输入面跳过」接进 D 组（ISSUE #1747）：D 组 56 步 / 18.9s 里 `check-ui-primitives` 3.6s 与
 * `check-format` 2.9s 合计占 34%，而扫描面只是全库子集；`check-format` 已随 #2010 挪平台，这里只钉前者。
 * `--staged` 是这一步能存在的前提：抹掉与「回到无条件全扫」等价，而**没有别的判据**会看见（只会慢一点，慢不报错）。
 */
const FORMAT_GATE = join(REPO_ROOT, "scripts", "check-format.cjs");
const UI_PRIMITIVES = join(REPO_ROOT, "scripts", "check-ui-primitives.cjs");

describe("全库扫描的输入面跳过接进 D 组（ISSUE #1747）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);

  it("UI 基元复用棘轮在钩子里带 --staged 条件触发", () => {
    const hit = steps.find((s) => s.cmd.includes("scripts/check-ui-primitives.cjs"));
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
    /* SAFETY: 类型断言已复核 */
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
 * oxfmt 格式（#2010 → #2610）：格式漂移无运行时症状、挡不住代码回归（§13.5.17），却要每次提交付冷缓存 ~21s / 热 ~4.5s。
 * 判五件、每件都是「没有别的判据会看见」的静默形态：① 钩子里有它、在 D0、带 `--staged`；② 平台侧仍有它（`--no-verify` / squash 只有这层在判）。
 * ③ 平台侧不带 `--staged` / `--autofix`（#2610 摘委托：实测 403，缺 `repo-cnb-trigger:rw`）；④ 本地出口 `pnpm check:all` 的 `format` 仍在；⑤ 脚本头自称指向两边。
 */
describe("oxfmt 格式：本地判 + 本地修，平台只判（ISSUE #2610）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);
  const config = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");

  it("钩子 D0 里有它、带 `--staged`，且**只在这一档**", () => {
    const d0Body = groupShBody(hook, "D0");
    expect(
      d0Body,
      "解析不出 D0 的 sh 正文 —— 判空是必须的：「读不到」当成「里面没步骤」" +
        "会让这一条永远绿（§13.5.12 那一族的静默降级）",
    ).not.toBe("");
    const hit = stepsInGroup(hook, "D0").find((s) => s.cmd.includes("scripts/check-format.cjs"));
    expect(
      hit,
      "D0 里找不到 `node scripts/check-format.cjs` —— #2610 的口径是「本地判 + 本地修」，" +
        "这一格是它唯一的本地执行者；不在 D0，格式红就又要白跑一次 CI",
    ).toBeTruthy();
    expect(
      hit?.cmd,
      "钩子那一步没带 `--staged`：只改文档 / 只动 `scripts/` 的提交会白扫一遍全库",
    ).toContain("--staged");
    /* 反向也钉：它不许在别的组里再出现一次（D0 已经付过 2s，D 组再跑一遍是纯重复，
     * 而「同一判据两个执行者各写一份参数」正是漂移的起点）。 */
    const elsewhere = steps.filter(
      (s) => s.cmd.includes("scripts/check-format.cjs") && !d0Body.includes(s.cmd),
    );
    expect(
      elsewhere.map((s) => s.cmd),
      "check-format 在 D0 之外还有一步 —— 同一档两个执行者，改参数时必漏一处",
    ).toEqual([]);
  });

  it("平台侧真的有这一步：2026-11-05 起执行者是 GA 的 `pr-gate.yml`（挪走 ≠ 没人跑）", () => {
    /* 这一格两次搬家：ISSUE #2010 从本地钩子到 CNB；2026-11-05 薄化再从 CNB 到 GA。
     * 判法跟着事实走：现在读 GA 的 workflow，而不是 CNB 的 stage 名 —— 继续对着
     * `COMFYAPP_CI_GATES` 问只会要求一个「没人执行的 stage 留在配置里」。 */
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "pr-gate.yml"), "utf8");
    expect(
      /run:\s*node scripts\/check-format\.cjs/.test(workflow),
      "`.github/workflows/pr-gate.yml` 里没有 `check-format.cjs` 这一步 —— 钩子撤掉 + " +
        "平台侧也没有 = 这条判据一个执行者都没有（§13.5.1.1 与 §13.5.17 同一条两半判法）",
    ).toBe(true);
    expect(
      registeredGateOrder(config),
      "`oxfmt 格式` 又回到了 COMFYAPP_CI_GATES —— 2026-11-05 起它由 GA 执行，这边没有任何" +
        "stage 会跑它；登记一份没人执行的格子会给「在场」记假账",
    ).not.toContain("oxfmt 格式");
  });

  it("GA 那一步是**只判的改动面档**：直接跑判据本体，带 --changed、不带 --staged / --autofix", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "pr-gate.yml"), "utf8");
    /* 断言取的是**那一行 `run:`**，不是整个 workflow（文件里写满了为什么这样排的理由），
     * 拿全文去 `not.toContain("--autofix")` 会红在自己的解释文字上。 */
    const scriptLine =
      /^[ \t]*run:\s*node scripts\/check-format\.cjs.*$/m.exec(workflow)?.[0] ?? "";
    expect(
      scriptLine,
      "GA 的工作流里找不到 `check-format.cjs` 的 `run:` 行 —— 读不到命令就当没带旗标，" +
        "是这条判据最坏的失效形态（它会把「挂了等于没挂」念成绿）",
    ).not.toBe("");
    expect(
      scriptLine,
      "GA 那一步带了 `--staged`：那是镜像仓的工作区、不是这次要判的改动面，" +
        "`--staged` 读的是「本次暂存」、恒为空 ⇒ 这一步恒跳过（挂了等于没挂）",
    ).not.toContain("--staged");
    expect(
      scriptLine,
      "GA 那一步没有 `--changed` —— 它必须判「这次 PR 的改动面 ∩ GLOBS」，" +
        "不带这个旗标会退化成全库扫描（白付一次）或什么都不判",
    ).toContain("--changed");
    expect(
      scriptLine,
      "GA 那一步不再点名判据本体 —— #2610 起它直接跑 check-format.cjs，" +
        "中间不再隔一层会写工作区的壳",
    ).toContain("scripts/check-format.cjs");
    /* #2610：`--autofix` 与委托回写整条摘掉。实测那一跳在 PR 事件上恒发不出去（令牌只有 repo-code:r，`start-build`
     * 回 403 / errcode 10023，缺 `repo-cnb-trigger:rw`），于是「就地修好」的改动每次都被丢在工作区，账面只剩
     * 「委托没发出去」。**修了但没人负责**比不修更坏（#2231 同型）。要恢复自动修，先得有能推出去的凭据（#2551）。 */
    expect(
      scriptLine,
      "平台侧又挂上 `--autofix` 了：委托回写没有能推出去的凭据，它就是「修了但没人负责」",
    ).not.toContain("--autofix");
    expect(
      scriptLine,
      "平台侧的命令又指向那个会写工作区的 format-fixup 外壳（已随 #2610 删除）",
    ).not.toMatch(/format-fixup|formatfix/);
    /* ISSUE #3011：判面必须与本地 `format:check` 是**同一事实源**。平台跑 `--changed`
     *（改动面 ∩ 扫描面），本地若仍扫全库，printWidth 迁移的存量欠账（当时 146 份、
     *  今天 117 份）就会被读成「工具/版本漂移」—— 而那一格在平台上一直是绿的。 */
    expect(
      scriptLine,
      "平台侧那一格不再带 `--changed`：判面漂回全库，本地 `format:check` 立刻与平台分叉",
    ).toContain("--changed");
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["format:check"], "本地 `format:check` 必须与平台格同一条命令").toBe(
      "node scripts/check-format.cjs --changed",
    );
    expect(pkg.scripts["format:report"], "存量盘点走 `--report`（只列清单、不阻断）").toBe(
      "node scripts/check-format.cjs --report",
    );
    expect(
      pkg.devDependencies.oxfmt,
      "oxfmt 必须是精确版本：范围写法会让本地与平台各装一份（ISSUE #3011）",
    ).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it("它不在**停用**清单里（那是另一件事：临时让位，不是挪执行者）", () => {
    /* `COMFYAPP_CI_DISABLED_GATES` 里同名的那条是 2026-10-16 的临时停用（让位给 E2E
     * 调试），恢复条件是「E2E 一绿 + 平台日志中文可读」。本轮它是被**挪过来接管**的，
     * 判据与执行者的关系变了 —— 于是「既在 GATES 又在 DISABLED」这句话会自相矛盾：
     * 停止清单里的档按定义不该跑，而这一步现在是它的唯一执行者。 */
    const disabled = registeredDisabledGates(config);
    expect(
      disabled,
      "`oxfmt 格式` 同时出现在 GATES 与 DISABLED_GATES 里 —— 它此刻是这条判据的" +
        "唯一执行者，停用清单里那一项是 2026-10-16 的临时让位，已随 ISSUE #2010 出网",
    ).not.toContain("oxfmt 格式");
  });

  it("本地出口还在（`pnpm check:all` 的 format 项）—— 挪执行者不等于删能力", () => {
    const gate = readFileSync(join(REPO_ROOT, "scripts", "quality-gate.mjs"), "utf8");
    expect(
      gate,
      "`pnpm check:all` 里没有 prettier 这一档了 —— 挪走执行者之后它成了" +
        "「只有平台侧跑」的一条，而本仓承诺的是「完整验证这一档照旧能本地跑一遍」",
    ).toContain("scripts/check-format.cjs");
  });

  it("脚本头把**两个**执行者都写明白（自称 ⇄ 实际，别让两份承诺一起过期）", () => {
    const script = readFileSync(FORMAT_GATE, "utf8");
    expect(
      script,
      "check-format.cjs 的头部没写明它由平台侧 `.cnb.yml` 调用 —— " +
        "脚本自称的执行者与实际不一致时，读的人会被指到别处去找一步不存在的步骤",
    ).toContain(".cnb.yml");
    /* #2610 反转了这条的第二半：以前它要求头部**不许**说钩子里有这一步（那时真没有）。
     * 现在 D0 有它，所以判据换成同一条纪律的正向版 —— 头部必须点名 `.githooks/pre-commit`，
     * 否则「只在平台跑」那句旧自我介绍会把下一个人支到错误的一档去改参数。 */
    expect(
      script,
      "check-format.cjs 的头部没写明它也在 `.githooks/pre-commit` 的 D0 里跑（带 --staged）" +
        " —— #2610 之后这是它的**第一个**执行者，头部只写平台侧就是一句过期的自我介绍",
    ).toMatch(/\.githooks\/pre-commit/);
    expect(
      script,
      "头部没写 `--staged` 那一半：两边只差这一个旗标，而它恰好是「平台侧带了就恒跳过」" +
        "「本地不带就白扫全库」的那处分野，写在头上比让读者去猜命令",
    ).toContain("--staged");
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
 * GA push 档 `master-gate.yml`（任务 3 并行期，2026-11-06 立）：文档链两格从 CNB push
 * 挪到镜像仓 master 的 push 上，与 CNB 侧并行跑。判法只问「两条命令逐字在场 + 触发/并发/
 * 检出面是 push 语义」—— 不在这份用例里问 CNB 三格（切换是下一笔 PR），也不问失败回传
 * （用户已定：不回传 CNB、不改 ship 判据）。
 */
describe("GA push 档 `master-gate.yml`：文档链两格的并行执行者（任务 3 并行期）", () => {
  const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "master-gate.yml");
  const workflow = readFileSync(WORKFLOW, "utf8");

  it("只在镜像仓 master 的 push 上跑，且每一笔都有自己的读数（不互相取消）", () => {
    expect(
      workflow.includes("on:\n  push:\n    branches: [master]"),
      "`master-gate.yml` 的触发不是 `on: push: branches: [master]` —— 镜像格推的是 " +
        "`HEAD:refs/heads/master`，触发口径与它对齐才能判到被推上去的那一笔",
    ).toBe(true);
    expect(
      workflow.includes("group: push-master") && workflow.includes("cancel-in-progress: false"),
      "并发口径不是「push-master 不互相取消」—— push 锁的语义是 master 上每一笔都要有" +
        "自己的读数，后一笔掐掉前一笔会让某次合并没有结论",
    ).toBe(true);
  });

  it("两条文档链命令逐字在场（与 CNB push 档同一入口、同一旗标）", () => {
    const renderLine =
      /^[ \t]*run:\s*node scripts\/render-doc-placeholders\.cjs --check --autofix[ \t]*$/m.exec(
        workflow,
      )?.[0] ?? "";
    expect(
      renderLine,
      "`master-gate.yml` 里找不到 `render-doc-placeholders.cjs --check --autofix` 那一行 —— " +
        "并行期的口径是「同一入口、同一旗标」，换旗标等于换判据（§13.5.33 的撤档纪律）",
    ).not.toBe("");
    const refsLine =
      /^[ \t]*run:\s*node scripts\/check-doc-references\.cjs[ \t]*$/m.exec(workflow)?.[0] ?? "";
    expect(
      refsLine,
      "`master-gate.yml` 里找不到 `check-doc-references.cjs` 那一行 —— 文档链第二格只有一个" +
        "执行者，这边读不到就等于挂了个空壳（与 §13.5.17「挪走 ≠ 没人跑」同一条判法）",
    ).not.toBe("");
  });

  it("检出面按文档链的真实输入收窄（浅克隆、无 LFS），且装依赖在场（不靠未验证的「无 node_modules 也能跑」）", () => {
    /* 2026-11-06 核对两格的真实输入面：`check-doc-references.cjs` 没有 git 调用、也不读文件内容
     * （只判引用路径在不在）；`render-doc-placeholders.cjs` 只 `readFileSync` 当前树的文档与源文件。
     * 两格都不做三点 diff，也不读字体 —— `.gitattributes` 的 LFS 面只有 `*.woff2` / `*.ttf`。
     * 所以 `fetch-depth: 0` + `lfs: true` 对它们没有输入贡献，浅克隆即可（GA 冷装读数）。 */
    expect(
      workflow.includes("fetch-depth: 1") && !workflow.includes("lfs: true"),
      "检出面不是 `fetch-depth: 1` 且不开 LFS —— 文档链两格只读 HEAD 树，不做三点 diff、" +
        "也不读字体等 LFS 对象；拉全历史 + LFS 对判据没有输入贡献",
    ).toBe(true);
    expect(
      workflow.includes("pnpm install --frozen-lockfile"),
      "`master-gate.yml` 里没有 `pnpm install --frozen-lockfile` —— 用户已定保留安装步，" +
        "不要为省时间引入「无 node_modules 能否真跑」的未验证前提",
    ).toBe(true);
    /* 反向钉：不复刻 CNB 的 `ifModify: docs/**`。按路径过滤会在「代码改动破坏文档引用」
     * 时漏判 —— 那类红的因在 docs 之外，而两条命令都是秒级文本读。 */
    expect(
      workflow.includes("paths:"),
      "`master-gate.yml` 加了路径过滤 —— 文档引用那格必须每次 push 都跑，" +
        "否则改脚本导致 docs 引用失效时这一侧恒绿",
    ).toBe(false);
  });
});

/**
 * 第二梯队全库扫描的「输入面跳过」接进 D 组（#1747 续）：14 步各扫全库一个子集，单项 0.27–1.85s、合计 ≈8.5s
 * （热缓存 8 核），扫描面全是固定前缀（`src/`、`src/lib`、`src/components`+`src/app`、`src-tauri/src`……）。抹掉
 * 一个 `--staged` 与「回到无条件全扫」等价，而**没有别的判据**会看见（只会慢一点，慢不报错）；`check-format` 那半已随 #2010 挪平台。
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
  ["内联样式注入", "check-inline-style.cjs", "node scripts/check-inline-style.cjs --staged"],
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
  ["浮层层级刻度硬闸", "check-overlay-z.cjs", "node scripts/check-overlay-z.cjs --staged"],
];

/**
 * **被聚合档接管的 6 条 AST 判据**（#1747 续，「第四笔账」）：此前各自在钩子里占一行、各自全量解析 `src/`，现在
 * 只剩 `node scripts/run-ast-gates.cjs --staged` 一行。两件的失效都是静默的：① 每条仍须实现 `--staged` 且短路在
 * `require("typescript")` 之前（聚合档 `loadGate()` 按此口径 require）；② 钩子里不许再各占一行（否则与聚合档跑两遍）。
 */
const AGGREGATED_AST_GATES: ReadonlyArray<string> = [
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

  it.for(SECOND_TIER)("%s 在钩子里带 --staged 条件触发", ([label, , expected]) => {
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
  });

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
    // 实测坑：`--staged` 若落在 `main()` 里、或 `require("typescript")` / 预加载 IIFE 之后，跳过那一支照样付开销
    // （TS 模块 ≈180ms、`check-dead-exports` 语料 ≈340ms）⇒「跳过」只剩形式上的绿，退出码看不出差别。
    // 判据：短路语句行号必须小于该脚本第一次 `require("typescript")` 那一行（没有就排在 `require("node:fs")` 之后）。
    for (const [, script] of SECOND_TIER) {
      const text = readFileSync(join(REPO_ROOT, "scripts", script), "utf8");
      const lines = text.split("\n");
      const skipAt = lines.findIndex((l) => l.includes("skipUnlessStagedTouches("));
      expect(skipAt, `${script} 找不到 --staged 短路语句`).toBeGreaterThanOrEqual(0);
      // 只认**真的** require 行：注释里出现的同一段字面不算（本仓的风格是
      // 在文件头解释「为什么这样加载」，那条注释必然含 `require("typescript")`）。
      const tsAt = lines.findIndex(
        (l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && /require\(\s*"typescript"\s*\)/.test(l),
      );
      if (tsAt === -1) {
        continue;
      } // 该步不加载 typescript
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

  it.for(AGGREGATED_AST_GATES)("%s 不再单独占钩子一行（否则与聚合档跑两遍）", (script) => {
    const dup = steps.filter((s) => s.cmd.includes(`scripts/${script}`));
    expect(
      dup.map((s) => s.label),
      `${script} 又单独占了一行钩子 —— 它会与聚合档各跑一遍，白付一次解析`,
    ).toEqual([]);
  });

  it.for(AGGREGATED_AST_GATES)(
    '%s 自己仍实现 --staged，且短路在 require("typescript") 之前',
    (script) => {
      const lines = readFileSync(join(REPO_ROOT, "scripts", script), "utf8").split("\n");
      const skipAt = lines.findIndex((l) => l.includes("skipUnlessStagedTouches("));
      expect(
        skipAt,
        `${script} 的 --staged 短路没了 —— 聚合档把这条单跑时它不再省时`,
      ).toBeGreaterThanOrEqual(0);
      const tsAt = lines.findIndex(
        (l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && /require\(\s*"typescript"\s*\)/.test(l),
      );
      if (tsAt === -1) {
        return;
      } // 该步不加载 typescript
      expect(
        skipAt,
        `${script} 的短路在第 ${skipAt + 1} 行、require("typescript") 在第 ${tsAt + 1} 行`,
      ).toBeLessThan(tsAt);
    },
  );
});

/**
 * 新鲜度账判决的**第二个执行者**（ISSUE #1979）：三档「每天首次自证」的判决只在本地钩子跑，执行脚本在平台侧
 * 从未被调用（`.cnb.yml` 生产构建跑裸 `pnpm run build` 而非 `artifact-run.mjs`）⇒ 绿只落日志、账面不变。判：① 平台侧那步在；
 * ② 刷新账的档必排在它之后（PR 那条一条都不许）；本地那半不许撤 —— 三档已登记 `ciStage`，只剩打读数与判账面形状。
 */
describe("新鲜度账：平台侧的第二个执行者（ISSUE #1979）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = hookGateSteps(hook);
  const config = readFileSync(join(REPO_ROOT, ".cnb.yml"), "utf8");

  it("每日侧有「每日新鲜度账」这一步，跑的是与钩子同一份脚本（主体=master）", () => {
    const hit = dailyStages().find((x) => x.name === "每日新鲜度账");
    expect(
      hit,
      "`.cnb.yml` 里没有「每日新鲜度账」这一步 —— 判据在平台侧没有执行者，而它要拦的" +
        "正是「谁都没跑它」这个静默形态（§13.5.17 同款两半判法）",
    ).toBeDefined();
    expect(hit?.stage, "那一步的原文块解析不出来（名字被改了？）").toBeTruthy();
    expect(
      hit?.stage,
      "每日侧那一步跑的不是 scripts/freshness-gate.mjs —— 两处各写一份判据必然分叉，" +
        "而分叉之后「本地绿、平台红」（或反过来）读起来像环境差异，不像判据不一致",
    ).toContain("scripts/freshness-gate.mjs");
    /* ⚠️ 主体那一行是这一格**存在的理由**（ISSUE #2300 主体分权）：主体=master ⇒
     * 判据读的是机器分支 `ci/freshness-ledger` 上**主干的权威账**；缺了它，每日这一格
     * 就会以 `"pr"` 上下文跑（读工作树那份），主干的账就没人判了。 */
    expect(
      hit?.stage,
      '每日侧那一步没有带 `COMFY_CI_SUBJECT: "master"` —— 主体不是 master ⇒ 它读的是' +
        "工作树那份账而不是主干的权威账（判据主体分权）",
    ).toContain("COMFY_CI_SUBJECT");
    expect(
      registeredGateOrder(config),
      "`新鲜度账` 还在 COMFYAPP_CI_GATES 里 —— 它 2026-10-23 撤到了每日档：PR 上下文读的是" +
        "主干的账，判的是「这台机器怎么被调度」而不是这次改动",
    ).not.toContain("新鲜度账");
  });

  it("每日那一条上凡刷新新鲜度账的档都排在「每日新鲜度账」之后（PR 那一条上一格都不许有）", () => {
    /* 不是风格：跑法脚本跑绿会刷新自己那笔账（`artifact-run.mjs` / `full-suite-run.mjs` / `e2e-run.mjs` 各写一份），
     * 而同分支 stage 共享工作区 —— 排在 `每日新鲜度账` 之前时它读到刚被改过的账，「账是旧的」永远判不出来。
     * ⚠️ 按**名字**认那三格：每日跑的是壳（`ci-daily-build.mjs` / `e2e-run.mjs` / `full-suite-run.mjs`），按 script 认会认不到 ⇒ 恒绿空转；改名同批改这里。 */
    const ledgerRefreshing = ["每日生产构建", "每日全量E2E", "每日单元测试"];
    const order = registeredDailyGateOrder(config);
    expect(order, "`每日新鲜度账` 不在每日清单里").toContain("每日新鲜度账");
    const freshAt = order.indexOf("每日新鲜度账");
    const daily = dailyStages().map((s, at) => ({ ...s, at }));
    const refreshers = daily.filter((s) => ledgerRefreshing.includes(s.name));
    /* 找到三格这件事本身要判：找不到就是「那一列变了」，而空数组会让下面那条恒绿。 */
    expect(
      refreshers.map((s) => s.name),
      "每日那三格（生产构建 / 全量E2E / 单元测试）没在每日清单里找到 —— 它们的跑法脚本会刷新账，" +
        "这一条的比较面因此空了（判据恒绿 = 静默失效）",
    ).toEqual(ledgerRefreshing);
    const beforeGate = refreshers.filter((s) => s.at < freshAt).map((s) => s.name);
    expect(
      beforeGate,
      `这些 stage 排在 \`每日新鲜度账\` 之前：${beforeGate.join(", ")} —— 它们的跑法脚本会先把账刷新，` +
        "于是这一步读到的是「刚被本次运行证过的账」，恒放行",
    ).toEqual([]);
    /* 半边二：`新鲜度账` 此刻**不许**在 PR 清单里 —— 2026-10-23 的挪档结论要写死成
     * 断言，而不是靠「恰好解析不出来」。它现在只在每日档（`每日新鲜度账`）。 */
    expect(
      registeredGateOrder(config),
      "`新鲜度账` 又回到 `COMFYAPP_CI_GATES` 了 —— 它 2026-10-23 撤到了每日档（ISSUE #2300 " +
        "主体分权：PR 上下文读的是主干的账，判的不是这次改动）",
    ).not.toContain("新鲜度账");
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
 * D0 形态前置档（钩子重构 1）：D 组 `set -e`，四组并行且全部等完（墙钟 = max = C），故 D 内重排不省时间。
 * 唯一能省的形状是在 A/B/C 启动前拿到这一档结论；它易被「顺手加一条 / 挪回 D」改掉，只表现为「又慢回去」（慢不报错）。
 * 判五件：D0 可解析；名单逐条在 D0、命令逐字；不许无声变长 / 换序；D0 与 D 不相交、等待点在 `run_group A` 前；读不到退出码即拦下。
 */
const FORM_PREPASS: ReadonlyArray<readonly [string, string]> = [
  ["CHANGELOG 碎片", "node scripts/check-changelog-fragments.cjs"],
  ["待发段落的来源锚 ⇄ 条目归属", "node scripts/check-changelog-versions.cjs"],
  /* 「改了文档源就得同批带上镜像」—— 这条从平台回到本地是有理由的（平台那格跑
   * `--check --autofix`，会就地修好，红只落在下一个动文档面的人身上），
   * 理由与被挪走的那两条（内容一致 / 引用权威）不同：那两条读全库内容，这条只读暂存清单。 */
  ["文档源 ⇄ 生成态镜像同批", "node scripts/check-doc-mirror-pairing.cjs --staged"],
  /* 「把判据自己的阈值调松」此前没有任何一格会红（ISSUE #2156）：它不读代码、只把
   * 源码里的具名常量与 scripts/.gate-thresholds.json 对账，毫秒级，而它必须落在
   * 「改阈值那一笔」上 —— 挪去平台侧等于把红推给下一个动判据的人（同上一条的理由）。 */
  ["判据自身的数值 ⇄ 账同批", "node scripts/check-gate-thresholds.cjs"],
  /* 「把凭据写进被跟踪的文字」这一格此前没有执行者（ISSUE #2157）：硬规则 17 那两层防线
   * 都在产物层与日志层，而 `docs/**` / `.cnb.yml` / 夹具里落一个真 token 本地与平台都不红。
   * 存量实测 0 命中 ⇒ 直接做成硬闸，没有基线、没有 `--allow`；命中只点名位置与形状，不回显内容。 */
  ["被跟踪文字里的凭据形状", "node scripts/check-tracked-secrets.cjs --staged"],
  ["每档都有主（新鲜度账：e2e / 全量单测 / 产物三档自证）", "node scripts/freshness-gate.mjs"],
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
  /* 格式判据回到本地（ISSUE #2610，业主口径 2026-10-29「本地判 + 本地修，平台只判」）。
   * 排最后是有意的：它命中时要扫全库（实测 ~2s），是本档最贵的一条，而这一档串行 ——
   * 前面那些毫秒级的先给结论，它殿后。红的出口是 `pnpm exec oxfmt <点名的文件>`。 */
  [
    "oxfmt 格式（动了 src/.storybook 才扫全库，红了只格式化点名的文件）",
    "node scripts/check-format.cjs --staged",
  ],
];

describe("D0 形态前置档：串行的那一条线（钩子重构 1）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const d0 = stepsInGroup(hook, "D0");
  const d = stepsInGroup(hook, "D");

  it("两个块都解析得出来（解析不出时其余各条会空转）", () => {
    // 「读不到块」与「块里没有那一步」在两处都长成同样的绿，所以先正面钉扫描面非空。
    expect(d0.length, "读不到 D0 块的 `run` 步骤 —— 组名或 `sh -c` 的引号形状变了").toBeGreaterThan(
      0,
    );
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
    const seg = hook.slice(hook.indexOf('wait "$D0_pid"'), hook.indexOf("run_group A "));
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
      expect(groupShBody(hook, id), `组 ${id} 没有 source 时钟，或那个块解析不出来`).toContain(
        '. "$COMFY_TIMING_SH"',
      );
    }
  });
});

/**
 * 复合执行者 `重档静态判据` 的登记面 ⇄ 执行面自证（2026-10-22）：2026-10-20（`0c6c8897`）把 4 条 stage 在 `.cnb.yml`
 * 注释掉、自称「收进聚合档」，而聚合档读钩子注册表，那几条 2026-10-16（`8d0d0b23`）已从钩子撤走 ⇒ 两次搬动对穿，
 * 4 条判据无人执行：`docs/api/**` 漂了 32 份，本地 check 退 1（491.2s）。当时只有「表 ⇄ 表」互核；本条判条目表 `argv` 逐字出现在钩子步骤行。
 */
describe("复合执行者 `重档静态判据`：条目表与执行面必须对得上（2026-10-22 立项）", () => {
  /* 用**运行时那个解析器**（`readHookSteps`），不是本文件惯用的 `runSteps` ——
   * 自证跑在 `scripts/ci-heavy-gates.mjs` 里，用另一个解析器验它等于验了另一件事
   * （两个解析器的口径差一处，这一处就恰好是「静默少读一步」的那种）。 */
  const hook = readFileSync(HOOK, "utf8");
  const steps = readHookSteps(HOOK);

  it("真仓自证通过：条目表里每一条，这一格都真会跑它", () => {
    const problems = heavyGateRegistryProblems(steps);
    expect(
      problems,
      `聚合档的条目表与钩子的执行面对不上：\n${problems.join("\n")}\n` +
        "—— 表上有而钩子里没有 = 那一格不会跑它，那条判据就此没有执行者",
    ).toEqual([]);
  });

  it("表里每一条的命令都在钩子的步骤行里（逐字）", () => {
    const cmds = new Set(steps.map((s) => s.argv.join(" ")));
    for (const gate of HEAVY_GATES) {
      expect(
        cmds.has(gate.argv.join(" ")),
        `条目「${gate.name}」的命令在钩子里找不到同一条 —— 它是登记面，不是执行面`,
      ).toBe(true);
    }
  });

  it("判据不是空转：喂进一份「表里有、钩子里没有」的步骤就红", () => {
    /* 反向验证：把钩子的步骤行换成一个空的集合，上面那条自证必须**报出**那一条 ——
     * 否则「自证通过」是恒真的（把函数实现成 `return []` 也能过）。 */
    const problems = heavyGateRegistryProblems([]);
    expect(problems.length, "空的钩子步骤集下自证必须逐条报出「表上有、钩子里没有」").toBe(
      HEAVY_GATES.length,
    );
  });

  it("钩子里带自动修旗标的步骤必须在条目表里（改工作区只有一处出处）", () => {
    const autofixSteps = steps.filter((s) => s.argv.join(" ").includes("--autofix"));
    const tableCmds = new Set(HEAVY_GATES.map((g) => g.argv.join(" ")));
    for (const step of autofixSteps) {
      expect(
        tableCmds.has(step.argv.join(" ")),
        `钩子里的「${step.label}」带自动修旗标却不在条目表里 —— ` +
          "「哪一档会自己改工作区」必须只有一处出处",
      ).toBe(true);
    }
  });

  it("钩子的步骤行本身还在（解析器没空转）", () => {
    expect(
      steps.length,
      `钩子里的步骤行解析出 ${steps.length} 条 —— 解析器失灵会让上面几条变成恒真`,
    ).toBeGreaterThan(0);
    expect(hook).toContain('run "');
  });
});
