/**
 * UI kit 的「单一驻地」契约（ISSUE #672 / 规范 16 §16.2.4）。
 *
 * 背景：库里长期有**四套 UI kit 目录**并行 —— `components/ui/`（shadcn 基元）、
 * `components/studio/ui/`（第二套）、`components/studio/shared/`（第三套的
 * 通用件）、`DynamicWorkflowForm/sections/`（第四套）。同一个「按钮 / 下拉 /
 * 空态 / 加载态」因此各有多份实现，而 §16.2.3 的棘轮当时**整体豁免**了后两处
 * —— 豁免的理由是「它们是迁移对象」，代价是那两处的存量不进基线、新增也没有
 * 判据（正是 §3.6.1「豁免必须显式」要防的失效模式）。
 *
 * 归并完成后，本文件把「去向」钉成判据：
 *   1. 那两个目录**不应再存在**（新的通用件只能进 `components/ui/`）；
 *   2. 白名单外的目录里不得再出现「第二套基元」（同名于 ui/ 基元的组件）。
 *
 * 为什么是判据而不是注释：`EXEMPT_DIRS` 撤掉只保证「再放进去的东西会被数」，
 * 挡不住下一个人 `mkdir studio/ui` 起一套新的 —— 目录本身的存在才是信号。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "components");

/** 已归并、不得复活的历史 UI kit 目录（规范 16 §16.2.4 台账）。 */
const RETIRED_KIT_DIRS = [
  "studio/ui",
  "studio/shared",
];

/**
 * 允许放「通用 UI」的目录（白名单）。
 *
 * `studio/workflow-form/` 里的 `DimensionControl` / `WorkflowFormControls` 等
 * 是**工作流参数表单专属**的复合件（域内共享，不是跨域基元），所以它留在
 * studio 域内 —— 这正是 §16.2.4 的分工：跨功能复用进 `ui/`，域内复用留本域。
 */
const ALLOWED_UI_DIRS = new Set(["ui"]);

/** 递归收集目录下的所有 `.tsx`（跳过测试与快照）。 */
function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__snapshots__" || entry.name === "__tests__") continue;
      collectTsx(full, out);
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

describe("UI kit 目录只有一处（规范 16 §16.2.4）", () => {
  it("已退役的历史 UI kit 目录不得复活", () => {
    for (const dir of RETIRED_KIT_DIRS) {
      expect(
        existsSync(join(ROOT, dir)),
        `${dir}/ 已按 §16.2.4 归并（去 components/ui/ 或就地收进域内），` +
          `不要再建一套并行的 UI kit —— 新的通用件放 components/ui/`,
      ).toBe(false);
    }
  });

  it("components/ui/ 的基元文件是 kebab-case（§12.5 / §12.6 的 shadcn 约定）", () => {
    const uiDir = join(ROOT, "ui");
    const offenders = readdirSync(uiDir)
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
      .filter((name) => !name.includes(".test."))
      .filter((name) => /[A-Z]/.test(name));
    expect(offenders).toEqual([]);
  });

  it("除 ui/ 外，没有别的目录在放「与 ui/ 同名的基元」", () => {
    const uiNames = new Set(
      readdirSync(join(ROOT, "ui"))
        .filter((name) => name.endsWith(".tsx"))
        .filter((name) => !name.includes(".test."))
        .map((name) => name.replace(/\.tsx$/, "")),
    );
    const offenders: string[] = [];
    for (const abs of collectTsx(ROOT)) {
      const rel = relative(ROOT, abs);
      const top = rel.split(sep)[0];
      if (top && ALLOWED_UI_DIRS.has(top)) continue;
      const base = rel.split(sep).pop()!.replace(/\.tsx$/, "");
      if (uiNames.has(base)) offenders.push(rel.split(sep).join("/"));
    }
    expect(offenders).toEqual([]);
  });

  it("归并后的 ui/ 不空（判据本身没被绕过）", () => {
    const entries = readdirSync(join(ROOT, "ui")).filter((n) =>
      n.endsWith(".tsx"),
    );
    expect(entries.length).toBeGreaterThan(20);
    expect(statSync(join(ROOT, "ui")).isDirectory()).toBe(true);
  });
});
