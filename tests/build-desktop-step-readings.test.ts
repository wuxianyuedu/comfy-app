/**
 * `scripts/build-desktop.mjs` 的步骤读数 —— 「念得出每一步多久」的执行者（ISSUE #2574）。
 *
 * 为什么要有这一条：装配那一大段（standalone 整树 `cpSync` → 顶层白名单剔除 → 载荷实体化
 * → 体积护栏 → 出厂计数）从第一步到最后一步**一个耗时都不念**，几百 MB 的一跳期间屏幕上
 * 没有任何新行 —— 在 CI 上长得和「卡死 / 超时前兆」一模一样，而脚本正在正常干活。
 * 本仓已经为此误判过一次（E2E 那格 36 分钟被平台按 stage 超时 kill），当时能用来分辨
 * 「在跑」与「挂了」的只有平台那一格的 duration（整格一个数，且它是**毫秒** —— #2442）。
 *
 * 面：这些断言读的是**磁盘文本**（`readFileSync`），不在任何 import 图里 ——
 * 改 `build-desktop.mjs` 不会让增量面把本文件带上去，而「有人把读数删掉 / 改成不参与判决
 * 的判定」恰好都不在改动面上。所以它登记进 `scripts/fixed-structural-tests.mjs` 固定跑
 * （与 `tests/env-import-meta-shape.test.ts`、`tests/eslint-gate-canary.test.ts` 同因）。
 *
 * 钉的是**语义**而不是行形状：哪一步念了时长、那一跳的计数口径是什么、读数不许变成判定、
 * 时长格式化只有一份。逐字比 `console.log` 的文案会随引号形态漂，所以按调用站点取。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDurationMs } from "~/lib/time-format";

const SCRIPT = "scripts/build-desktop.mjs";
const src = readFileSync(join(process.cwd(), SCRIPT), "utf8");

/**
 * 把源码里每一条 `console.log(...)` 调用抠出来。
 * 非贪婪到第一个 `);` —— 本文件的日志语句里没有嵌套的 `);`（模板串里的括号不成对出现），
 * 所以这一层不需要真解析器；口径写在这里，改动文案时不会悄悄少抠一条。
 */
const logCalls = (text: string): Array<string> => text.match(/console\.log\([\s\S]*?\);/g) ?? [];

describe("build-desktop 念得出每一步多久（ISSUE #2574）", () => {
  /* 按**计时变量的归属**判，不按步骤标号的字面位置判：`3/4` 那一跳的时长念在
   * `sidecar: … MB，复制耗时 …` 那一行里，行内并不出现「3/4」三个字 ——
   * 拿标号做逐字比就是钉行形状，改文案就红、而读数其实还在（本仓同族教训：
   * 「整档搜字面量的断言没有语义作用域」）。变量与步骤一一对应，才是那句话的语义。 */
  const STEPS: Array<[string, string]> = [
    ["1/4 pnpm build", "step1At"],
    ["2/4 组装 static", "step2At"],
    ["3/4 sidecar", "step3At"],
    ["4/4 全程", "scriptStartedAt"],
  ];

  it("四个大步骤各念一行耗时，且各只念一次", () => {
    const logs = logCalls(src);
    expect(
      logs.length,
      "这条判据依赖「按 console.log 调用站点取」的取法，取空了就是量具坏了",
    ).toBeGreaterThan(10);
    for (const [label, variable] of STEPS) {
      const withTime = logs.filter((l) => l.includes(`elapsedSince(${variable})`));
      expect(
        withTime.length,
        `「${label}」那一步的耗时（变量 ${variable}）应当恰好念一次，实读 ${withTime.length} 次`,
      ).toBe(1);
    }
  });

  it("每一步都在自己的起点附近掐表（变量声明在场，不是拿全程冒充分步）", () => {
    for (const [, variable] of STEPS) {
      if (variable === "scriptStartedAt") {
        continue;
      } // 全程那一个声明在文件头
      expect(src, `${variable} 没有起点声明`).toMatch(
        new RegExp(`const ${variable} = performance\\.now\\(\\)`),
      );
    }
  });

  /* `filter` 的计数口径是这条读数的全部价值：白名单在场时「挡得对不对」只有这两个数能证。
   * ⚠️ `cpSync` 的 filter 对**每一个将要复制的路径**（目录与文件都算）各调一次，
   * 所以念的是「条目数」。谁把它改口成「文件数」，这条当场红 —— 那不是一个字之差，
   * 是把一个证不实的数写成证得实的数。 */
  it("standalone 整树那一跳念「过 filter 多少条 / 挡掉多少条 + 多久」，且不许冒充文件数", () => {
    const line = logCalls(src).find((l) => l.includes("cpSeen"));
    expect(line, "cpSync 那一跳没有读数").toBeDefined();
    expect(line).toContain("cpRejected");
    expect(line, "挡掉的条数必须念出来，白名单生效了几条才看得见").toContain("挡掉");
    expect(line, "耗时也在这同一跳上").toContain("elapsedSince(");
    expect(line, "口径：这是条目数（目录 + 文件），不是文件数").not.toMatch(/文件/);
  });

  it("时长格式化只有一份：用 src/lib/time-format 那一处，不在脚本里再写一份", () => {
    // 脚本侧从 .mjs 引 .ts 的先例是 `scripts/ci-build-readout.mjs:96`，同一形态。
    expect(src).toContain('from "../src/lib/time-format.ts"');
    expect(src, "不许在本文件里长出第二份时长格式化").not.toMatch(
      /(function|const)\s+formatDuration/,
    );
    expect(src).not.toMatch(/Math\.round\([^)]*\/\s*1000\)\s*\}/);
  });

  /* #2442 的那一格单位读数钉在这里：平台与 Node 给的时长字段都是毫秒，
   * 而读的人按秒读 —— 旧写法把一次 15m30s 的格子念成 `930916s`（≈10.7 天）。
   * 本脚本的读数走同一个函数，所以这条既是对共享件的断言，也是「这条链念出来的
   * 时长该长什么样」的标本。 */
  it("念出来的是时长而不是毫秒数（#2442 的那一格单位）", () => {
    expect(formatDurationMs(930_916)).toBe("15m31s");
    expect(formatDurationMs(47_161)).toBe("47s");
    // 取不到时不许假装是 0 —— 调用方（本脚本）明说「取不到时长」。
    expect(formatDurationMs(null)).toBeNull();
    expect(src).toContain("取不到时长");
  });

  /* 期望 3：读数是读数。做成硬闸的直接后果是「为了过闸去改读数」，
   * 与 `pnpm ship` 阶段 0 那三行同口径 —— 所以这条钉的是「时长不进判决路径」。 */
  it("读数不参与退码：fail() 的话术里不许出现时长", () => {
    const fails = src.match(/fail\([\s\S]*?\);/g) ?? [];
    expect(fails.length, "本脚本的失败出口应当是 fail()，取空了说明取法漂了").toBeGreaterThan(5);
    for (const f of fails) {
      expect(f, "时长进了失败话术 = 把读数升级成判定").not.toContain("elapsedSince(");
    }
    expect(src).not.toMatch(/process\.exit\(\s*elapsedSince/);
  });

  it("三条「不要这么修」写在文件头（免得下一个人照常见建议动手）", () => {
    const header = src.slice(0, src.indexOf("import {"));
    for (const needle of [
      "不换 `fs.cp`（异步版）",
      "不加 `BUILD_MAX_PARALLELISM` 夹取",
      "不为「表达意图」而全表钉死",
    ]) {
      expect(header, `文件头缺这一条：${needle}`).toContain(needle);
    }
  });
});
