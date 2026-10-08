/**
 * 全量 e2e「按需通道」（`scripts/e2e-run.mjs`）的判据 —— 规范 §11.8。
 *
 * 与 `tests/pixel-run.test.ts` 同族：那一档补的是「像素档谁来跑、红的算什么」，
 * 这一档补的是**全量 e2e** 的同一件事。两者的分工是互补而非替代 ——
 * 全量 e2e 覆盖功能链路（含 `@critical`），像素档覆盖「界面有没有变形」，
 * 而 `--grep @critical` 一条视觉用例都不含（视觉 spec 没有 `@critical` 标签）。
 *
 * 判据分三头，缺一条这层就会退化成一句好看的话：
 *   ① **跑什么**：一条命令跑 `e2e/`，且**不带任何落盘开关**（这一档只跑功能链路，
 *      基线落盘是 `pnpm check:visual:update` 的事，那里有「连跑两次都绿」的验收）；
 *   ② **红的定性**：四条实测形态（缺本平台基线 / webServer 起不来 / 超时 / 断言差异）
 *      各有各的动作，混成一句「e2e 红了」就会把人引去改业务代码（§11.13）；
 *   ③ **留在按需层**：不在 `check:all` 里 —— 且**两侧**都判（`.mjs` 与 `.ps1`
 *      是同一件事实的两份实现，只钉一侧 = 另一侧可以静默漂）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { E2E_DIR, classifyFailure, planRuns } from "../scripts/e2e-run.mjs";
import { E2E_LEDGER } from "../scripts/e2e-freshness-lib.mjs";
import { parseMjsGates, parsePs1Gates } from "./helpers/quality-gate-gates";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("全量 e2e 按需通道：跑什么（§11.8）", () => {
  it("默认跑一次 Playwright，目标是 e2e/ 目录", () => {
    const runs = planRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).toBe("playwright");
    // 不带目录参数时 `playwright test` 就是跑 `playwright.config.ts` 的 testDir，
    // 但那一处若被改成别的目录，本档会静默跑另一个套件 —— 所以这里点名目录：
    // 它必须与 `E2E_DIR`（= `pnpm test:e2e` 的目标）同一处落点。
    expect(E2E_DIR).toBe("e2e");
  });

  it("**不带任何落盘开关**：这一档只跑功能链路，不改基线", () => {
    // 像素基线的落盘是 `pnpm check:visual:update` 的事（那里有「连跑两次都绿」的验收）。
    // 全量档顺手写 PNG 等于把 review 对象变成执行副产品 —— 与 `pixel-run.mjs` 的
    // 默认不落盘是同一条纪律的另一半。
    for (const run of planRuns({ grep: null })) {
      expect(run.args).not.toContain("--update-snapshots");
    }
  });

  it("--grep 只多一个过滤参数，不会顺手换掉目标", () => {
    const runs = planRuns({ grep: "@critical" });
    expect(runs.map((r) => r.kind)).toEqual(["playwright"]);
    expect(runs[0]?.args).toEqual(["test", "--grep", "@critical"]);
  });

  it("e2e 目录与 playwright.config.ts 的 testDir 同源（两处不许各写一份）", () => {
    expect(read("playwright.config.ts")).toContain(`testDir: "./${E2E_DIR}"`);
  });

  it("入口只在 package.json 一处登记（判据话术点的就是它）", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:e2e"]).toBe("node scripts/e2e-run.mjs");
  });
});

describe("全量 e2e 按需通道：红的定性（§11.8 / §11.13）", () => {
  it("缺本平台基线 → 指向像素档，不指向业务代码", () => {
    const verdict = classifyFailure(
      "Error: A snapshot doesn't exist at /repo/e2e/visual/x-snapshots/login-desktop-chromium-linux.png, writing actual.",
    );
    expect(verdict).toContain("check:visual");
    expect(verdict).not.toContain("改代码：");
  });

  it("webServer 起不来 → 指向「CI 口径要先构建」，与用例无关", () => {
    for (const out of [
      "Error: webServer was not able to start",
      "Could not find a production build in the '.next' directory",
    ]) {
      expect(classifyFailure(out)).toContain("pnpm build");
    }
  });

  it("超时 → 先隔离重跑定性，不直接改代码", () => {
    const verdict = classifyFailure("Test timeout of 60000ms exceeded.");
    expect(verdict).toContain("隔离重跑");
  });

  it("断言差异 → 这才是功能退化", () => {
    expect(
      classifyFailure("  2 failed\n    expect(received).toBe(expected)"),
    ).toContain("功能退化");
  });

  it("认不出的形态 → 先隔离重跑定性，而不是猜", () => {
    expect(classifyFailure("something odd happened")).toContain("隔离重跑");
  });
});

/**
 * 全量 e2e 留在按需层：不进 check:all（§11.8 / §13.5.4）。
 *
 * 判法按**入口**（`args` 里那个 `e2e-run.mjs`）而不是门禁名：改名就能绕过的判据
 * 等于没有（同 `pixel-run.mjs` 那条的理由）。两侧都判。
 */
describe("全量 e2e 留在按需层：不进 check:all（§11.8 / §13.5.4）", () => {
  const ENTRY = "e2e-run.mjs";

  it("Node 侧：e2e 那一档带 run: false（按入口判，不按名字）", () => {
    const gates = parseMjsGates(read("scripts/quality-gate.mjs"));
    const gate = gates.filter((g) =>
      g.args.some((a) => a.replace(/\\/g, "/").endsWith(`/${ENTRY}`)),
    );
    expect(
      gate,
      `quality-gate.mjs 的 GATES 里找不到入口为 ${ENTRY} 的门禁 —— ` +
        "解析器或那张表本身出了形状变化，别把这条判据放宽成「找不到就跳过」",
    ).toHaveLength(1);
    expect(
      gate[0]?.onDemand,
      `${ENTRY} 那一档没有 run: false —— 全量 e2e 因此会进 pnpm check:all。` +
        "它要起 webServer + 真浏览器 + 假 ComfyUI，墙钟是十几分钟量级，" +
        "属于 §13.5.4 的按需层（入口 pnpm check:e2e）。",
    ).toBe(true);
  });

  it("Windows 侧：quality-gate.ps1 的同一档带 Run = $false", () => {
    const gates = parsePs1Gates(read("scripts/quality-gate.ps1"));
    const gate = gates.filter((g) =>
      g.args.some((a) => a.replace(/\\/g, "/").endsWith(`/${ENTRY}`)),
    );
    expect(
      gate,
      `quality-gate.ps1 的门禁表里找不到入口为 ${ENTRY} 的门禁`,
    ).toHaveLength(1);
    expect(
      gate[0]?.onDemand,
      `${ENTRY} 那一档在 .ps1 侧没有 Run = $false —— 两个平台的 check:all 会给出不同结论`,
    ).toBe(true);
  });

  it("解析器不是空转：两侧都真找到了那一档，且默认档非空", () => {
    const mjs = parseMjsGates(read("scripts/quality-gate.mjs"));
    const ps1 = parsePs1Gates(read("scripts/quality-gate.ps1"));
    expect(mjs.length).toBeGreaterThan(0);
    expect(ps1.length).toBeGreaterThan(0);
    expect(mjs.filter((g) => !g.onDemand).length).toBeGreaterThan(0);
    expect(ps1.filter((g) => !g.onDemand).length).toBeGreaterThan(0);
  });

  it(".ps1 侧的 -Mode 可选集合里真有 e2e（否则显式点名会被参数校验弹回去）", () => {
    expect(read("scripts/quality-gate.ps1")).toContain('"e2e"');
  });
});

describe("凭证账与像素那份不混（§11.8）", () => {
  it("`e2e-run.mjs` 记的是 e2e 那一本账", () => {
    const src = read("scripts/e2e-run.mjs");
    expect(src).toContain("recordRun");
    expect(E2E_LEDGER).toBe("scripts/.e2e-freshness.json");
    expect(src).not.toContain("visual-baseline-freshness");
  });

  it("**只有绿了才记**：记账发生在 `failed === null` 那一支里", () => {
    // 「跑过」与「跑绿过」是两件事 —— 红着的时候记一条「我跑过」，
    // 正是这条账要防的形态（同 `pixel-run.mjs` 的「红着不记」）。
    const src = read("scripts/e2e-run.mjs");
    const greenBranch = src.slice(src.indexOf("if (failed === null)"));
    expect(greenBranch).toContain("recordRun");
  });
});
