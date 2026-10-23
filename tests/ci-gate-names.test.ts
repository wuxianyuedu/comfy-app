/**
 * 「PR 上跑什么」那份清单里的每个名字，**执行者是谁**（`scripts/ci-gate-names.mjs`）。
 *
 * 这一族治的是 ISSUE #2227 的现场：清单里那几个名字**以注释形态留在 `.gates` 里**
 * （停用形态与「换执行者」形态在配置里长得一模一样 ⇒ 机器分不出两者），于是
 * 「执行者没了」这件事没人守 ——
 * 把 `tests/core-spine-single-source.test.ts` 从固定清单里删掉，
 * `core 骨架单一事实源` 的**唯一执行者消失**，而清单照旧说它在 PR 上跑 ⇒ **账面全绿**。
 *
 * 这里钉的是「**这一格能红**」：每一条都拿夹具造一份配置把判据逼红 ——
 * 一条只会绿的判据就是又一条恒绿判据（这一族最贵的形态：判据在场、结论静默变成放行）。
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readHookSteps } from "../scripts/base-check/hook-steps.mjs";
import { HEAVY_GATES } from "../scripts/ci-heavy-gates.mjs";
import {
  parseStageScripts,
  readCnbConfig,
} from "../scripts/ci-autofix-duties.mjs";
import {
  commentedStageNames,
  gateNameExecutorProblems,
  registeredElsewhereGates,
  scriptPaths,
} from "../scripts/ci-gate-names.mjs";
import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";

/** 造一份配置夹具（形状与 `.cnb.yml` 的 env 段同款）。 */
function fakeCnb(opts: {
  gates: string[];
  disabled?: string[];
  elsewhere?: string[];
  commented?: boolean;
}): string {
  const lines = [
    "master:",
    "  env:",
    "    COMFYAPP_CI_GATES: >-",
    `      ${opts.gates.join(", ")}`,
    "    # 真配置里每个 env 键后面紧跟的是注释行（折叠标量的正文到那儿为止）。",
  ];
  if (opts.disabled) {
    lines.push(
      "    COMFYAPP_CI_DISABLED_GATES: >-",
      `      ${opts.disabled.join(", ")}`,
      "    # 停用登记的说明注释。",
    );
  }
  if (opts.elsewhere) {
    lines.push(
      "    COMFYAPP_CI_GATES_ELSEWHERE: >-",
      `      ${opts.elsewhere.join(", ")}`,
      "    # 「执行者在别处」的说明注释。",
    );
  }
  lines.push(
    "  pull_request:",
    "    - name: 活的",
    "      script: node scripts/live.cjs",
  );
  if (opts.commented) {
    lines.push(
      "  # - name: 注释形态",
      "  #   script: node scripts/commented.cjs",
    );
  }
  return lines.join("\n");
}

/** 一份「执行面」：复合档条目 + 固定清单用例 + 钩子步骤。 */
const SURFACE = {
  liveStages: ["活的"],
  heavyGates: [
    { argv: ["node", "scripts/check-reformat-only.cjs", "--staged"] },
  ],
  fixedTests: ["tests/core-spine-single-source.test.ts"],
  hookSteps: [{ argv: ["node", "scripts/live.cjs"] }],
};

describe("ci-gate-names —— 解析", () => {
  it("「执行者在别处」那张表：名字 → 入口路径（多个用 `|` 分隔）", () => {
    const got = registeredElsewhereGates(
      fakeCnb({
        gates: ["活的"],
        elsewhere: ["core 骨架单一事实源=tests/core-spine-single-source.test.ts"],
      }),
    );
    expect(got.get("core 骨架单一事实源")).toEqual([
      "tests/core-spine-single-source.test.ts",
    ]);
  });

  it("注释形态的 stage 名能被列出来（停用形态与换执行者形态都是它）", () => {
    expect([
      ...commentedStageNames(fakeCnb({ gates: ["活的"], commented: true })),
    ]).toEqual(["注释形态"]);
  });

  it("入口路径只认执行面那三处（脚本 / 入口 / 用例）", () => {
    expect(
      scriptPaths("node scripts/a.cjs -- node_modules/.bin/vitest run tests/b.test.ts"),
    ).toEqual(["scripts/a.cjs", "tests/b.test.ts"]);
  });
});

describe("ci-gate-names —— 判据能红", () => {
  it("正向：清单里的名字有活 stage ⇒ 通过", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({ gates: ["活的"] }),
      ...SURFACE,
    });
    expect(problems).toEqual([]);
  });

  it("正向：名字登记了「执行者在别处」，且入口真在执行面里 ⇒ 通过", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({
        gates: ["活的", "core 骨架单一事实源"],
        elsewhere: ["core 骨架单一事实源=tests/core-spine-single-source.test.ts"],
      }),
      ...SURFACE,
    });
    expect(problems).toEqual([]);
  });

  it("**执行者没了 ⇒ 红**（#2227 的现场：固定清单里那份用例被删掉）", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({
        gates: ["活的", "core 骨架单一事实源"],
        elsewhere: ["core 骨架单一事实源=tests/core-spine-single-source.test.ts"],
      }),
      ...SURFACE,
      fixedTests: [], // ← 那个用例从固定清单里消失了
    });
    expect(problems.join("\n")).toContain("core 骨架单一事实源");
    expect(problems.join("\n")).toContain("core-spine-single-source.test.ts");
  });

  it("既没有活 stage、又没登记执行者 ⇒ 红", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({ gates: ["活的", "没人执行"] }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("没人执行");
  });

  it("反向：登记的名字不在清单里 ⇒ 红", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({
        gates: ["活的"],
        elsewhere: ["没在清单里=tests/core-spine-single-source.test.ts"],
      }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("没在清单里");
  });

  it("反向：登记的入口路径没有任何执行面会跑 ⇒ 红", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({
        gates: ["活的", "指向空处"],
        elsewhere: ["指向空处=scripts/nobody-runs-this.cjs"],
      }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("指向空处");
  });

  it("反向：既有活 stage、又登记「执行者在别处」⇒ 红（重复登记）", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({
        gates: ["活的"],
        elsewhere: ["活的=scripts/live.cjs"],
      }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("重复登记");
  });

  it("既在清单里、又在停用登记里 ⇒ 红（既跑又停）", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({ gates: ["活的", "单元测试"], disabled: ["单元测试"] }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("既跑又停");
  });

  it("注释形态残留：既不在清单、也不在任何登记里 ⇒ 红", () => {
    const problems = gateNameExecutorProblems({
      cnbText: fakeCnb({ gates: ["活的"], disabled: [], commented: true }),
      ...SURFACE,
    });
    expect(problems.join("\n")).toContain("注释形态");
  });

  it("真配置：仓库里这一格是绿的（正向读数，也是它能红的对照）", () => {
    /* 这一条读的是仓库里**真的**那份配置与**真的**执行面（钩子注册表 / 复合档条目 /
     * 固定清单），不是夹具 —— 它回答的是「此刻这一格是不是绿的」。
     * 它不是「判据在场」的证据：上面那几条才是。 */
    const root = path.resolve(__dirname, "..");
    const cnbText = readCnbConfig(root);
    const problems = gateNameExecutorProblems({
      cnbText,
      liveStages: [...parseStageScripts(cnbText).keys()],
      heavyGates: HEAVY_GATES,
      fixedTests: FIXED_STRUCTURAL_TESTS,
      hookSteps: readHookSteps(path.join(root, ".githooks", "pre-commit")),
    });
    expect(problems).toEqual([]);
  });
});
