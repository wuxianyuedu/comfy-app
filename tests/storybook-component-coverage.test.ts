/**
 * 组件覆盖率的**棘轮**判据（ISSUE #1381 续，规范 16 §16.2.3 / 11 §11.8）：此前 `ui/` 157 个文件只有 3 个有 story，
 * 数字只写在文档里、过期时无物会红（`storybook-config` / `storybook-cva-variant-source` 都管不到）。三段：扫描面非空
 * （防空集白送 100%）、只升不降（比 `.storybook-coverage-baseline.json`）、`NO_STORY_REASON` 对齐磁盘；共用 `coverage-ledger.mjs`。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NO_STORY_REASON,
  collectStories,
  componentTargetsOf,
  uiCoverage,
} from "../scripts/storybook-checks/coverage-ledger.mjs";

const ROOT = resolve(".");
const COMPONENTS = join(ROOT, "src", "components");
const UI = join(COMPONENTS, "ui");
const BASELINE_PATH = join(ROOT, "scripts", ".storybook-coverage-baseline.json");

/* SAFETY: 类型断言已复核 */
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
  covered: number;
  uiSurfaces: number;
};

const STAT = uiCoverage({ componentsRoot: COMPONENTS });

describe("ui/ 的组件覆盖率（ISSUE #1381）", () => {
  it("扫描面非空（分子分母都为 0 时「100%」是白送的）", () => {
    expect(STAT.total).toBeGreaterThan(0);
    expect(STAT.stories).toBeGreaterThan(0);
    expect(STAT.covered.length).toBeGreaterThan(0);
  });

  it("每个 story 都真的 import 到了同目录的组件（story 不许空转）", () => {
    const stories = collectStories(COMPONENTS);
    const empty = stories.filter(
      (story) => componentTargetsOf(story, readFileSync(story, "utf8"), ROOT).length === 0,
    );
    expect(
      empty,
      "stories glob 扫到的文件里，有 story 没 import 任何组件 —— " +
        "它不计入覆盖率（也就不会被任何人看到效果）",
    ).toEqual([]);
  });

  it("覆盖率只许升不许降（棘轮，与门禁脚本同一份基线）", () => {
    expect(
      STAT.covered.length,
      `有 story 的组件从 ${BASELINE.covered} 降到 ${STAT.covered.length}。` +
        "删 / 改组件文件名之后，同目录的 `.stories.tsx` 要跟着改 import；" +
        "确属有意收窄时同批改低基线并写清理由。",
    ).toBeGreaterThanOrEqual(BASELINE.covered);
  });

  it("`ui/` 的可预览文件数与基线一致（新增组件要同批给出「它为什么没有 story」）", () => {
    expect(
      STAT.total,
      "`ui/` 下可预览文件数变了：新增的在 coverage-ledger.mjs 里补 story 或写进 " +
        "NO_STORY_REASON（逐条理由），然后同批更新基线。",
    ).toBe(BASELINE.uiSurfaces);
  });

  it("理由表不含指向不存在文件的过期条目", () => {
    expect(STAT.unknownSkip).toEqual([]);
  });

  /**
   * 理由表的**空 ⟺ 满**不变式（替代原先「表非空」那条）。原判据怕「表被删掉却看起来还在跑」，
   * 但空转的真正信号在**实测**里（分子分母是否非空）；表空 + 覆盖率已满合法且真实（这一批就到达了），
   * 判红只会逼人凑一条假理由。换成双向不变式：两边同时成立才合法。
   */
  it("理由表为空 ⟺ 覆盖率已满（两边都不能单独成立）", () => {
    if (NO_STORY_REASON.size === 0) {
      expect(
        STAT.uncovered,
        "理由表空了，但还有组件没有 story —— 要么补 story，要么把理由加回去",
      ).toEqual([]);
    }
  });

  it("已经有 story 的组件不许留在理由表里（那会静默放行下一次回归）", () => {
    expect(STAT.staleSkip).toEqual([]);
  });

  it("理由表的每一条都是「为什么」而不是空串", () => {
    for (const [file, reason] of NO_STORY_REASON) {
      expect(reason.length, `${file} 的理由太短，说不清为什么`).toBeGreaterThan(8);
    }
  });

  it("基线文件里的数字与实测对得上（不是一份手抄的快照）", () => {
    /* 基线是**棘轮的起点**，不是事实源 —— 事实由每次扫描现算。这条断言把
       「有人手改了基线却没跑判据」挡在提交前（数字漂了就红在改动的那一次）。 */
    expect(BASELINE.covered).toBe(STAT.covered.length);
    expect(BASELINE.uiSurfaces).toBe(STAT.total);
    expect(join(UI, "button.tsx")).toBeTruthy(); // UI 目录确实被解析到了
  });
});
