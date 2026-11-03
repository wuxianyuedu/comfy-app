/**
 * `scripts/check-test-inventory.cjs` 的判据自证（2026-10-21 立档）。
 *
 * 这一步要拦的是「在盘上、但一条用例都不会被收集」的测试文件。它的失效方向是**静默的**：
 * 那份文件照样被 eslint / tsc / prettier 扫、照样出现在 PR 的 diff 里，只是再也没人跑它。
 * 立档当天是先由人跑了一遍 `vitest list` 与磁盘集合对差（794/794 全绿）才发现
 * **这件事此前没有任何判据在看**——本文件与它守护的那条判据一起把「人跑一次」换成
 * 「每次提交都判」。
 *
 * 四组探针，各自防一种「看起来还在、实际不判」：
 *
 *   ① **绿侧**：两边一致 ⇒ 退 0（判据不是恒放行的对照组）；
 *   ② **红侧**：磁盘有、收集面没有 ⇒ 退 1，且报出那个文件（判据真的会拦）；
 *   ③ **重叠侧**：两个档都接住 ⇒ 退 1（第二种收集面病害，漏了它 glob 写重没人知道）；
 *   ④ **fail-closed 侧**：配置解析不到 ⇒ 退 1，不许退回「没有档」＝判据静默消失。
 *
 * ⚠️ 判据**不跑** `vitest list`（那要起一次 vite，60s 量级，与钩子 D 组的墙钟预算冲突），
 * 它从 `vitest.config.ts` 的 `include` / `exclude` 离线算收集面。所以这里全部用
 * **自写的精简配置**做夹具 —— 用真仓库那份配置反而造不出「漏收」（`src/**` 全覆盖），
 * 而造不出红侧的判据自证等于没证（同 §11.12.1 那只绿侧对照组）。
 *
 * 夹具用 `tests/helpers/gate-repo.ts` 的 `defineGateRepo`（§11.16.1），不手搓临时仓库。
 */
import { describe, expect, it } from "vitest";

import { judgeCoverage } from "../scripts/check-test-inventory.cjs";
import { defineGateRepo } from "./helpers/gate-repo";

/**
 * 夹具用的 `vitest.config.ts` —— 形状与真配置同族（`projects` 两个档、
 * `include: DOM_TEST_GLOBS` 的标识符写法也保留），但 glob **故意写窄**，
 * 好让「漏收」与「重叠」都造得出来。
 *
 * ⚠️ 不 import `vitest/config`：判据只读这份文件的**文本**（`vitest-projects.cjs`
 * 的 `loadProjects()`），从不求值它；临时仓库里也没有 node_modules 可引。
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
