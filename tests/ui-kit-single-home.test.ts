/**
 * UI kit 的「单一驻地」契约（ISSUE #672 / 规范 16 §16.2.4）：历史上四套并行 —— `ui/`、`studio/ui`、`studio/shared`、
 * `DynamicWorkflowForm/sections`；后两处被 §16.2.3 棘轮整体豁免 ⇒ 存量不进基线、新增无判据（§3.6.1）。归并后钉这两个目录
 * 不应再存在、白名单外不得再现同名基元 —— 撤 `EXEMPT_DIRS` 挡不住 `mkdir studio/ui`，目录存在本身才是信号。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "components");

/** 已归并、不得复活的历史 UI kit 目录（规范 16 §16.2.4 台账）。 */
const RETIRED_KIT_DIRS = ["studio/ui", "studio/shared"];

/**
 * 允许放「通用 UI」的目录（白名单）。
 * `studio/workflow-form/` 的 `DimensionControl` / `WorkflowFormControls` 等是**工作流参数表单专属**的复合件
 * （域内共享，不是跨域基元），所以留在 studio 域内 —— §16.2.4 分工：跨功能复用进 `ui/`，域内复用留本域。
 */
const ALLOWED_UI_DIRS = new Set(["ui"]);

/** 递归收集目录下的所有 `.tsx`（跳过测试与快照）。 */
function collectTsx(dir: string, out: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__snapshots__" || entry.name === "__tests__") {
        continue;
      }
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
    const offenders: Array<string> = [];
    for (const abs of collectTsx(ROOT)) {
      const rel = relative(ROOT, abs);
      const top = rel.split(sep)[0];
      if (top !== undefined && top !== "" && ALLOWED_UI_DIRS.has(top)) {
        continue;
      }
      const base = rel
        .split(sep)
        .pop()!
        .replace(/\.tsx$/, "");
      if (uiNames.has(base)) {
        offenders.push(rel.split(sep).join("/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("归并后的 ui/ 不空（判据本身没被绕过）", () => {
    const entries = readdirSync(join(ROOT, "ui")).filter((n) => n.endsWith(".tsx"));
    expect(entries.length).toBeGreaterThan(20);
    expect(statSync(join(ROOT, "ui")).isDirectory()).toBe(true);
  });
});
