/**
 * 像素层提交门禁（`scripts/visual-gate.mjs`）的判据。
 *
 * 这一步只在暂存改动命中像素层时才做事，所以**触发面**与**判决**两头都要判：
 *
 *   · 触发面窄了 = 改了像素层没人管，就是 #6538809 那个状态（删了 `-linux.png` 的两张
 *     基线，提交者从 `pnpm test:e2e` 的通过数读到「像素层没事」——而 `--grep @critical`
 *     一条视觉用例都不含，规范 §11.7 点名的正是它）。触发面宽了 = 每个普通提交都多跑一步。
 *   · 判决必须**被执行过**，不是「源码长这样」：同族事故 ISSUE #1356（抠源码正则当判决）
 *     与 #1345（把脚本自己打的 label 当执行记录）。这里由 `runGate` 的纯入口真跑两条分支。
 *
 * 另一半是「别自己重抄一份收窄规则」（§12.18）：本次清单必须来自 `affected-tests.mjs`
 * 的唯一出处，否则「C 组会跑什么」与「本步以为会跑什么」是两套答案。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PIXEL_JUDGE,
  PIXEL_LAYER_RE,
  plannedTests,
  runGate,
  touchesPixelLayer,
} from "../scripts/visual-gate.mjs";
import { FIXED_STRUCTURAL_TESTS } from "../scripts/affected-tests.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = ".githooks/pre-commit";
const GATE_SCRIPT = "scripts/visual-gate.mjs";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（行首锚定，注释掉的不算）。 */
function dGroupSteps(hookText: string) {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

describe("像素层提交门禁的触发面（§11.8）", () => {
  it("没碰像素层的改动：什么都不做（不给普通提交加时间）", () => {
    for (const staged of [
      ["src/lib/x.ts"],
      ["docs/standards/11-测试与可观测性.md"],
      ["tests/visual-baseline-pairing.test.ts"], // 判据自己的用例改动不算像素层
      ["e2e/smoke.spec.ts"], // 别的 e2e 层，不产像素基线
    ]) {
      expect(touchesPixelLayer(staged), staged.join(",")).toBe(false);
      expect(runGate({ staged, tests: [] }).exitCode, staged.join(",")).toBe(0);
    }
  });

  it("像素层输入：spec / 基线 PNG / playwright.config.ts 都算", () => {
    for (const f of [
      "e2e/visual/login.visual.spec.ts",
      "e2e/visual/login.visual.spec.ts-snapshots/login-desktop-chromium-win32.png",
      "playwright.config.ts",
    ]) {
      expect(PIXEL_LAYER_RE.test(f) || f === "playwright.config.ts", f).toBe(
        true,
      );
      expect(touchesPixelLayer([f]), f).toBe(true);
    }
  });

  it("形状边界：e2e 之外的 visual 目录名不算（只认 e2e/visual/ 这一处）", () => {
    for (const notPixel of [
      "docs/visual/x.png",
      "src/components/visual/x.tsx",
      "e2e-visual/x.spec.ts",
    ]) {
      expect(PIXEL_LAYER_RE.test(notPixel), notPixel).toBe(false);
    }
  });
});

describe("像素层提交门禁的判决（runGate 真跑两条分支）", () => {
  it("改了像素层 + 本次清单含像素判据 ⇒ 放行", () => {
    expect(
      runGate({
        staged: ["e2e/visual/login.visual.spec.ts"],
        tests: ["tests/affected-tests.test.ts", PIXEL_JUDGE],
      }),
    ).toEqual({ exitCode: 0, problem: null });
  });

  it("改了像素层 + 清单里**没有**像素判据 ⇒ 阻断，并把修法写在话术里", () => {
    const res = runGate({
      staged: [
        "e2e/visual/login.visual.spec.ts-snapshots/a-chromium-win32.png",
      ],
      tests: ["tests/affected-tests.test.ts"],
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain(PIXEL_JUDGE);
    // 话术要指出「e2e 的通过数不是结论」这一条，否则下一个人还会拿它当证据。
    expect(res.problem).toContain("e2e");
  });

  it("没改像素层 ⇒ 即便清单是空的也放行（空清单的判据不在这条链上）", () => {
    expect(runGate({ staged: ["README.md"], tests: [] }).exitCode).toBe(0);
  });
});

describe("像素层提交门禁与仓库现状不漂移", () => {
  it("像素判据真的在固定清单里（本步放行的前提，不是巧合）", () => {
    // 「每次提交都跑」那份清单是唯一出处：判据被摘出去时，本步会把**每一次**像素层
    // 改动都拦下 —— 这是有意的（好过静默放行），但要在这里说清依赖关系。
    expect(FIXED_STRUCTURAL_TESTS).toContain(PIXEL_JUDGE);
  });

  it("本次清单复用 affected-tests 的唯一出处，不另算一份收窄规则", () => {
    // 断言的是「与那份唯一出处同源」而不是某个具体条数：这个清单等于
    // `resolveAffectedTests` 的输出（固定清单必然并入，它就是 C 组要跑的东西）。
    // 条数不写死 —— 固定清单会长，抄一个数字进用例就是下一处会漂的地方。
    const tests = plannedTests(
      ["e2e/visual/login.visual.spec.ts"],
      { testFiles: [PIXEL_JUDGE], sourceFiles: [] },
      () => null,
    );
    expect(tests).toContain(PIXEL_JUDGE);
    for (const fixed of FIXED_STRUCTURAL_TESTS) {
      expect(tests, fixed).toContain(fixed);
    }
  });

  it("新增的门禁脚本必须同时接进 pre-commit（§11.7 那条规则）", () => {
    const steps = dGroupSteps(read(HOOK));
    const hit = steps.find((s) => s.cmd.includes(GATE_SCRIPT));
    // `cmd` 逐字相等而不是 `toContain`：把这一行注掉时 `dGroupSteps` 的行首锚定
    // 已经不认它（`hit` 会是 undefined）——「把这一步静音」正是这一族要拦的动作
    // （同 §13.5.8「在场判据要解析、不要 toContain」）。
    expect(hit?.cmd).toBe("node scripts/visual-gate.mjs");
  });
});
