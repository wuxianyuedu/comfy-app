/**
 * `scripts/check-test-inventory.cjs` 的判据自证（2026-10-21 立档）：拦「在盘上但永远不会被收集」的测试文件 —— 失效是静默
 * 的（照样被 lint/tsc 扫、照样进 diff，只是没人跑），当天对差 794/794 才发现此前无人看。四组探针：绿侧退 0、红侧漏收退 1
 * 并报文件、重叠退 1、fail-closed 退 1。判据不跑 `vitest list`（约 60s，超钩子 D 组预算），只离线读 `include`/`exclude`，夹具用自写精简配置。
 */
import { describe, expect, it } from "vitest";

import { judgeCoverage } from "../scripts/check-test-inventory.cjs";
import { defineGateRepo } from "./helpers/gate-repo";

/**
 * 夹具用的 `vitest.config.ts`：形状与真配置同族（`projects` 两档、`include: DOM_TEST_GLOBS` 写法保留），但
 * glob **故意写窄**，好让「漏收」与「重叠」都造得出来。
 * ⚠️ 不 import `vitest/config`：判据只读文本（`vitest-projects.cjs` 的 `loadProjects()`），从不求值，且临时仓库里没有 node_modules。
 */
const FIXTURE_CONFIG = `const DOM_TEST_GLOBS = [
  "src/components/**/*.test.{ts,tsx}",
];

export default {
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/lib/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          exclude: DOM_TEST_GLOBS,
        },
      },
      {
        test: {
          name: "happy-dom",
          environment: "happy-dom",
          include: DOM_TEST_GLOBS,
        },
      },
    ],
  },
};
`;

/** 一份内容合法的用例文件（判据只枚举文件名，不读内容 —— 这里仍写满，便于读夹具的人）。 */
const CASE = `import { describe, expect, it } from "vitest";

describe("夹具用例", () => {
  it("一条断言", () => {
    expect(1).toBe(1);
  });
});
`;

const { test } = defineGateRepo({
  script: "check-test-inventory.cjs",
  dirs: ["src", "tests"],
  workdir: "test-inventory-gate",
  files: { "vitest.config.ts": FIXTURE_CONFIG },
});

describe("check-test-inventory：收集面一致性", () => {
  test("两边一致 ⇒ 退 0（绿侧对照组）", ({ repo }) => {
    repo.write("src/lib/a.test.ts", CASE);
    repo.write("src/components/b.test.tsx", CASE);
    repo.write("tests/c.test.ts", CASE);

    const r = repo.run();

    expect(r.code).toBe(0);
    expect(r.output).toContain("3 份用例全部恰好落在一个档的收集面上");
    /* 档名从配置读、不写死在判据里 —— 这里顺带钉住「它报的是配置里那两个档」。 */
    expect(r.output).toContain("node / happy-dom");
  });

  test("磁盘有、收集面没有 ⇒ 退 1 并点名那个文件（红侧）", ({ repo }) => {
    repo.write("src/lib/a.test.ts", CASE);
    /* `src/orphan/` 不在夹具配置的任何 include 里 —— 正是要拦的形态。 */
    repo.write("src/orphan/dead.test.ts", CASE);

    const r = repo.run();

    expect(r.code).toBe(1);
    expect(r.output).toContain("src/orphan/dead.test.ts");
    expect(r.output).toContain("[漏收]");
    expect(r.output).toContain("1 处收集面问题");
  });

  test("两个档都接住 ⇒ 退 1（重叠侧）", ({ repo }) => {
    /* node 档的 include 放宽到整片 src、且**去掉 exclude** —— 于是 DOM 档那份
     * `src/components/**` 与它同时命中。刻意连 exclude 一起动：只放宽 include 的话，
     * node 档自己的 exclude（同一份 DOM_TEST_GLOBS）会把 components 挡掉，重叠就造不出来。 */
    repo.write(
      "vitest.config.ts",
      FIXTURE_CONFIG.replace(
        'include: ["src/lib/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],\n          exclude: DOM_TEST_GLOBS,',
        'include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],\n          exclude: [],',
      ),
    );
    repo.write("src/components/b.test.tsx", CASE);

    const r = repo.run();

    expect(r.code).toBe(1);
    expect(r.output).toContain("[重叠：node + happy-dom]");
  });

  test("`--report` 只压退出码，清单照打（盘点档不许假装没问题）", ({ repo }) => {
    repo.write("src/orphan/dead.test.ts", CASE);

    const r = repo.run(["--report"]);

    expect(r.code).toBe(0);
    expect(r.output).toContain("src/orphan/dead.test.ts");
    expect(r.output).toContain("盘点");
  });

  test("`projects` 解析不到 ⇒ 判失败，不退回「没有档」", ({ repo }) => {
    repo.write("vitest.config.ts", "export default { test: { globals: true } };\n");
    repo.write("src/lib/a.test.ts", CASE);

    const r = repo.run();

    expect(r.code).toBe(1);
    expect(r.output).toContain("解析 `vitest.config.ts` 的 `projects` 失败");
  });

  test("一个用例文件都枚举不到 ⇒ 判失败（空扫描面不是「没有问题」）", ({ repo }) => {
    /* fixture 只建了空的 src/ 与 tests/，一份用例都不放。 */
    const r = repo.run();

    expect(r.code).toBe(1);
    expect(r.output).toContain("一个用例文件都没枚举到");
  });
});

describe("judgeCoverage：判决内核（进程内喂夹具）", () => {
  const TIERS = [
    {
      name: "node",
      include: ["src/lib/**/*.test.{ts,tsx}", "src/both.test.ts"],
      exclude: [],
    },
    {
      name: "happy-dom",
      include: ["src/components/**/*.test.{ts,tsx}"],
      exclude: [],
    },
  ];

  it("绿侧：每份都恰好落在一个档", () => {
    const r = judgeCoverage(["src/lib/a.test.ts", "src/components/b.test.tsx"], TIERS);
    expect(r.dead).toEqual([]);
    expect(r.overlap).toEqual([]);
  });

  it("红侧：漏收与重叠各自被指出来", () => {
    const r = judgeCoverage(
      ["src/lib/a.test.ts", "src/orphan/dead.test.ts", "src/both.test.ts"],
      [
        ...TIERS,
        /* 第三个档只接 `src/both.test.ts` 一份 —— 于是它同时被 node 与 extra 接住，
         * 而 orphan 一份都不被接住。两条病害在同一批输入里各出现一次。 */
        { name: "extra", include: ["src/both.test.ts"], exclude: [] },
      ],
    );
    expect(r.dead).toEqual(["src/orphan/dead.test.ts"]);
    expect(r.overlap).toEqual([{ rel: "src/both.test.ts", tiers: ["node", "extra"] }]);
  });

  it("`exclude` 优先于 `include`：被排掉的那份算漏收", () => {
    const r = judgeCoverage(
      ["src/lib/a.test.ts"],
      [
        {
          name: "node",
          include: ["src/lib/**/*.test.{ts,tsx}"],
          exclude: ["src/lib/**"],
        },
      ],
    );
    expect(r.dead).toEqual(["src/lib/a.test.ts"]);
  });
});
