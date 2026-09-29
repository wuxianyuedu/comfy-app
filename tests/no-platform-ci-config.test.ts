/**
 * 平台侧自动触发的流水线配置**不得出现在仓库里**，且这条决策必须在规范里留痕。
 *
 * 动因（不是假想，是已经撞到的形态）：规范 §13.5.3 的结论是「本仓库用不起平台侧
 * 流水线（免费额度撑不起每次提交都跑），配置已删除」，§13.5.4 进一步写明**不要为它写
 * `.cnb.yml`** —— 但仓库根后来被重新加回过一份（ISSUE #1229 已删掉它并写明根因：顶层
 * 直接写 `stages:` / `jobs:`，没有分支键与事件键，而 CNB 的形态是 `分支: { 事件: [流水线] }`，
 * 于是匹配不到任何事件）。判据是构建历史：每一条事件的 `event` 都是
 * `issue.comment@npc` / `pull_request.comment@npc`，没有一次 `push` / `pull_request`。
 * 「有配置文件」与「配置在跑」是两件事，前者会被后来人读成后者 —— 那正是 §11.7 要避免的
 * 「绿灯变得不可信」。而这件事此前**只有文档口径、没有判据**：把配置加回仓库不会让任何
 * 现有门禁变红，本文件补的就是这一层。
 *
 * 三条判据：
 *   1. **文件面**：仓库根不许存在任何自动触发型 CI 配置（按确切名字匹配，不用
 *      `*.yml` 通配 —— `pnpm-workspace.yaml` 会被通配误伤）；
 *   2. **反向锚点**：规范正文确实写着这条决策。所以判据是**一致性**而不是「禁止」：
 *      真要恢复平台侧，先改 §13.5.3 / §13.5.4 两节，改不动就说明还没想清楚；
 *   3. **不许登记成事实**：`scripts/doc-facts.cjs` 里 path 类事实的语义是「文档指向的
 *      文件必须存在」，登记一个刻意不存在的文件会让 `pnpm doc:check` 恒红。
 *
 * 扫描面本身由「判据不是空转」那组用例复算：掏空清单或把匹配逻辑改坏时，前两条
 * 用例会一起变成恒绿，那是本文件最坏的失效形态。它守的是全库级不变量，因此登记在
 * `scripts/affected-tests.mjs` 的固定清单里，每次提交都跑。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 自动触发型 CI 配置的仓库相对路径（确切名字，文件形态）。
 *
 * 只收「平台一读就无条件跑」的那些；`.cnb.yml` 是本仓库的历史形态，其余是「顺手换个
 * 平台」的等价形态 —— 判据要拦的是**这件事**，不是某一个文件名。
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

/** 规范里必须留痕的口径；缺失 = 决策被悄悄推翻，而文件面判据还没跟着变。 */
const DOC_ANCHORS: Array<{ file: string; mustContain: string[] }> = [
  {
    file: "docs/standards/13-提交与-code-review.md",
    mustContain: [
      "`.cnb.yml` 已删除，平台侧不跑任何流水线",
      "不要为它写 `.cnb.yml`",
    ],
  },
  {
    file: "docs/standards/11-测试与可观测性.md",
    mustContain: ["质量门禁（平台侧**当前未启用**）"],
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

describe("平台侧自动触发的流水线配置不出现在仓库（§13.5.3 / §13.5.4）", () => {
  it("仓库根没有自动触发型 CI 配置", () => {
    const present = ciConfigsAmong(repoTopLevel());
    expect(present).toEqual([]);
  });

  it("规范正文确实写着这条决策（反向锚点）", () => {
    const drifted: string[] = [];
    for (const { file, mustContain } of DOC_ANCHORS) {
      const missing = missingAnchors(file, mustContain);
      if (missing.length > 0)
        drifted.push(`${file} 缺：${missing.join(" / ")}`);
    }
    expect(drifted).toEqual([]);
  });

  it("doc-facts 没把刻意不存在的 CI 配置登记成 path 类事实", () => {
    const facts = readFileSync(
      path.join(ROOT, "scripts/doc-facts.cjs"),
      "utf8",
    );
    // 只查事实表里的 `source:` 行；注释里叙述这段历史是有意为之。
    const sourceLines = facts
      .split("\n")
      .filter((line) => /^\s*source:/.test(line));
    const ciSource = new RegExp(
      CI_CONFIG_FILES.map((name) => name.replace(/[.]/g, "\\$&")).join("|"),
    );
    const offenders = sourceLines.filter((line) => ciSource.test(line));
    expect(offenders.map((line) => line.trim())).toEqual([]);
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
    // ③ 扫描面清单本身不许被悄悄掏空 —— 掏空了上面两条用例就恒绿。
    expect(CI_CONFIG_FILES.length).toBeGreaterThanOrEqual(7);
    expect(CI_CONFIG_PATHS.length).toBeGreaterThanOrEqual(2);
    expect(DOC_ANCHORS.length).toBeGreaterThanOrEqual(2);
  });

  it("扫描面真的收到了仓库根（不是空数组假装通过）", () => {
    const top = repoTopLevel();
    // 仓库根一定存在的锚点文件：缺了说明 readdirSync 指错了地方。
    for (const anchor of ["package.json", "vitest.config.ts", ".githooks"]) {
      expect(top).toContain(anchor);
    }
  });
});
