/**
 * 像素档「按需通道」（`scripts/pixel-run.mjs`）的判据 —— 规范 §11.8。
 *
 * 这一层补的是 #1282 结尾留下的那条口径：`pnpm test:visual` 一直存在，但**没有任何
 * 地方说清「谁该在什么时候跑它、跑出来的红算什么」**。文档里写「按需跑」是一句无法
 * 观测的话，与 `visual-gate.mjs` 要拦的「拿 e2e 的通过数当像素层结论」是同一族的空洞。
 *
 * 所以判据分三头，缺一条这层就会退化成一句好看的话：
 *   ① **两次运行必须同批**：像素档 + 配对判据（`PIXEL_JUDGE`）。少一次 = 交出一批基线
 *      而「基线成套且入库」不在这一轮里判 —— 正是 #6538809 的形态。
 *   ② **默认不落盘**：基线是人工 review 的核心对象（§11.8），一条命令顺手把 PNG 改了
 *      等于把 review 对象变成执行副产品。`--update` 才写，且这台机器连跑两次要都绿。
 *   ③ **红的定性**：三条实测形态（缺这一档平台的基线 / 逐帧 chrome / 像素 diff）各有各的
 *      动作，混成一句「像素档红了」就会把人引去改业务代码（§11.13 那条「红先定性」）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

import {
  CHECK_UPDATE_MODE,
  PIXEL_JUDGE,
  VISUAL_DIR,
  checkLocalBaselines,
  classifyFailure,
  planRuns,
} from "../scripts/pixel-run.mjs";
import {
  checkRecordingEnv,
  recordingWebserverFor,
  webserverForEnv,
} from "../scripts/visual-baselines.mjs";
import {
  gateByEntry,
  parseMjsGates,
  parsePs1Gates,
} from "./helpers/quality-gate-gates";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("像素档按需通道：本次要跑什么（§11.8）", () => {
  it("默认跑两次：像素档 + 配对判据（少一次就等于没有像素判决）", () => {
    const runs = planRuns();
    expect(runs.map((r) => r.kind)).toEqual(["playwright", "vitest"]);

    const pixel = runs.find((r) => r.kind === "playwright");
    // 默认**不带** `--update-snapshots`：落盘是人的动作。
    expect(pixel?.args).not.toContain("--update-snapshots");
    // ⚠️ 但「不落盘」必须显式争取：Playwright 的 `updateSnapshots` 默认是 `'missing'`，
    // 缺基线时**不带开关也会写文件**。检查档因此必须显式关掉（这条断言是那个承诺的判据，
    // 少了它 `--update-snapshots=none` 被人顺手删掉时不会有任何东西变红）。
    expect(pixel?.args).toEqual([
      "test",
      VISUAL_DIR,
      `--update-snapshots=${CHECK_UPDATE_MODE}`,
    ]);
    expect(CHECK_UPDATE_MODE).toBe("none");

    const judge = runs.find((r) => r.kind === "vitest");
    expect(judge?.args).toEqual([PIXEL_JUDGE]);
  });

  it("--update 只多一个开关，不会顺手把判据那次丢掉", () => {
    const runs = planRuns({ update: true });
    expect(runs.map((r) => r.kind)).toEqual(["playwright", "vitest"]);
    expect(runs[0]?.args).toContain("--update-snapshots");
    // 录基线档走 preset（`changed`，含创建缺失的那些），不再额外指定档位。
    expect(runs[0]?.args).not.toContain(
      `--update-snapshots=${CHECK_UPDATE_MODE}`,
    );
    expect(runs[1]?.args).toEqual([PIXEL_JUDGE]);
  });

  it("本机这一档齐备时前置判决放行（真实检出上跑一次真清点）", () => {
    // 用真检出而不是夹具：这条同时证明「前置判决接的是真仓库」，夹具形态在
    // `tests/visual-baselines.test.ts` 里逐个答案都执行过。
    const missing = checkLocalBaselines({
      root: ROOT,
      platform: process.platform,
    });
    expect(missing).toBeNull();
  });

  it("本机这一档没登记时前置判决拦下并点名（换一档平台就看得见）", () => {
    const verdict = checkLocalBaselines({ root: ROOT, platform: "darwin" });
    expect(verdict).toContain("没有登记过像素基线");
    // 判卷要能区分「平台没登记」与「登记了但缺几张」两条分支
    expect(verdict).toContain("SUPPORTED_PLATFORMS");
  });

  it("本机 `CI` 与本档录制口径一致时放行（真实检出 + 真环境跑一次）", () => {
    // 与上面那条前置判决同族：用真检出 + 真 `CI` 跑一次。测试环境的 `CI` 与 linux 档
    // 登记的口径一致，所以这里应当是 null —— 若它是话术，说明**测试环境自己**就在
    // 一个与我改的东西无关的口径上（那要先定性，别改断言）。
    expect(
      checkRecordingEnv({ platform: process.platform, env: process.env }),
    ).toBeNull();
  });

  it("口径不符要给出「录的是另一种 chrome」+ 置法，且不指向业务代码", () => {
    // 这是录基线档此前**完全没校验**的一条：`--update` 刻意不受缺基线那闸拦（那是它的
    // 本分），而口径跟缺不缺基线无关 —— 两个方向都要拦。录错口径的 PNG 自洽、不会当场红。
    const verdict = checkRecordingEnv({
      platform: "win32",
      env: { CI: "true" },
    });
    expect(verdict).toContain("录制口径不一致");
    expect(verdict).toContain("不会当场红");
    expect(verdict).toContain("PLATFORM_RECORDING");
  });

  it("口径表实际落到像素档要用的那个真假判据上（不另立一份）", () => {
    // `playwright.config.ts` 判 `process.env.CI` 的真假 —— 登记表的口径换算必须与它
    // 同一条，否则「本机实走哪条」这件事会出现两套答案（§12.12）。
    for (const platform of ["win32", "linux"] as const) {
      const expected = recordingWebserverFor(platform);
      const sameEnv = expected === "dev" ? {} : { CI: "true" };
      const otherEnv = expected === "dev" ? { CI: "true" } : {};
      expect(checkRecordingEnv({ platform, env: sameEnv })).toBeNull();
      expect(checkRecordingEnv({ platform, env: otherEnv })).not.toBeNull();
      // 补一句：换算函数本身按「真假」判，空串落在 dev 侧（`CI` 空串是踩过的形态）。
      expect(webserverForEnv(otherEnv)).not.toBe(expected);
    }
  });

  it("像素档目录与 package.json 的 test:visual 同源（两处不许各写一份）", () => {
    // `scripts/pixel-run.mjs` 里那一份是唯一实现，`test:visual` 是它的历史入口。
    // 两边漂了的表现是「文档说跑这个目录、实际跑的是另一个」——不报错，只少跑。
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["test:visual"]).toContain(VISUAL_DIR);
    expect(pkg.scripts?.["check:visual"]).toContain("scripts/pixel-run.mjs");
  });

  it("配对判据真的存在，且是「每次提交都跑」那份清单的成员", () => {
    // 这条判据不在场的话，本条与它都是空转：像素档绿了也说明不了基线成套。
    expect(read(PIXEL_JUDGE)).toContain("SUPPORTED_PLATFORMS");
  });
});

describe("像素档按需通道：红的定性（§11.8 / §11.13）", () => {
  it("缺本平台基线 → 说「这台机器没有基线」，不指向业务代码", () => {
    const verdict = classifyFailure(
      "Error: A snapshot doesn't exist at /repo/e2e/visual/x-snapshots/login-desktop-chromium-linux.png, writing actual.",
    );
    expect(verdict).toContain("没有成套基线");
    expect(verdict).toContain("不是界面变形");
  });

  it("逐帧 chrome → 指向 mask，而不是放宽阈值", () => {
    const verdict = classifyFailure(
      "Error: Failed to take two consecutive stable screenshots.",
    );
    expect(verdict).toContain("mask");
    expect(verdict).toContain("阈值");
  });

  it("像素 diff → 这才是退化，动作是「看 diff 后决定重录还是改代码」", () => {
    const verdict = classifyFailure(
      "  775 pixels (ratio 0.02 of all image pixels) are different.",
    );
    expect(verdict).toContain("退化");
    expect(verdict).toContain("--update");
  });

  it("webServer 起不来 → 指向「CI 口径要先构建」，与像素无关", () => {
    const verdict = classifyFailure(
      "Error: Process from config.webServer was not able to start. Exit code: 1",
    );
    expect(verdict).toContain("webServer");
    expect(verdict).toContain("pnpm build");
  });

  it("认不出的形态 → 先隔离重跑定性，而不是猜（§11.13 那句硬动作）", () => {
    expect(classifyFailure("something unexpected")).toContain("§11.13");
  });
});

/**
 * 「像素档**不进** `check:all`」这条口径的执行者（规范 §11.8 / §13.5.4）。
 *
 * 这条此前是**文档里的一句话**：`quality-gate.mjs` 的 `GATES.visual` 带着 `run: false`，
 * `quality-gate.ps1` 那一块带着 `Run = $false`，两侧都写着「不在 all 里」的注释 ——
 * 而**没有任何判据按名字钉住它**。
 *
 * 实测的漏法（本条落地前）：把 `visual` 那块挪进默认档（去掉 `run: false`）、
 * 同时新增**任意一个**按需档，`tests/ps1-consistency.test.ts`（唯一会解析这张表的判据）
 * 照样全绿 —— 它盯的是「按需档集合非空、且两侧一致」，只要还剩一个按需档就成立。
 * 于是「像素档混进 `pnpm check:all`」这条改动**全绿通过**，代价是每次一键门禁都起
 * webServer + 浏览器（且结论只在录过基线的那台机器上有效），而没人会因此红。
 *
 * 判法按**入口**（`args` 里那个 `pixel-run.mjs`）而不是门禁名：改名就能绕过的判据等于
 * 没有 —— 这条与 `storybook-check.mjs` 的「不按 `xxxVariants` 命名判」同一条理由。
 * 两侧都判：`.mjs`（Linux / macOS / CI 的 `pnpm check:all`）与 `.ps1`
 * （Windows 双击入口）是**同一件事实的两份实现**，只钉一侧 = 另一侧可以静默漂。
 */
describe("像素档留在按需层：不进 check:all（§11.8 / §13.5.4）", () => {
  /** 入口脚本名 —— 与 `package.json` 的 `check:visual` 同一处落点。 */
  const ENTRY = "pixel-run.mjs";

  it("Node 侧：pixel-run 那一档带 run: false（按入口判，不按名字）", () => {
    const gates = parseMjsGates(read("scripts/quality-gate.mjs"));
    const gate = gateByEntry(gates, ENTRY);
    expect(
      gate,
      `quality-gate.mjs 的 GATES 里找不到入口为 ${ENTRY} 的门禁 —— ` +
        "解析器或那张表本身出了形状变化，别把这条判据放宽成「找不到就跳过」",
    ).not.toBeNull();
    expect(
      gate?.onDemand,
      `${ENTRY} 那一档没有 run: false —— 像素档因此会进 pnpm check:all。` +
        "像素档要起 webServer + 浏览器，且结论只在录过基线的那台机器上成立" +
        "（基线文件名带平台），属于 §13.5.4 的按需层（入口 pnpm check:visual）。",
    ).toBe(true);
  });

  it("Windows 侧：quality-gate.ps1 的同一档带 Run = $false", () => {
    const gates = parsePs1Gates(read("scripts/quality-gate.ps1"));
    const gate = gateByEntry(gates, ENTRY);
    expect(
      gate,
      `quality-gate.ps1 的门禁表里找不到入口为 ${ENTRY} 的门禁`,
    ).not.toBeNull();
    expect(
      gate?.onDemand,
      `${ENTRY} 那一档在 .ps1 侧没有 Run = $false —— 两个平台的 check:all 会给出不同结论`,
    ).toBe(true);
  });

  it("解析器不是空转：两侧都真找到了那一档，且默认档非空", () => {
    // 没有这三条，上面两条会在「解析器什么都没解析出来」时**恒绿**
    // （`gateByEntry` 返回 null 被 `not.toBeNull()` 挡住，但默认档非空这半从没被问过）。
    // 一个永远说「不在 check:all 里」的判据与没有判据是同一种东西。
    const mjs = parseMjsGates(read("scripts/quality-gate.mjs"));
    const ps1 = parsePs1Gates(read("scripts/quality-gate.ps1"));
    expect(mjs.length).toBeGreaterThan(0);
    expect(ps1.length).toBeGreaterThan(0);
    expect(mjs.filter((g) => !g.onDemand).length).toBeGreaterThan(0);
    expect(ps1.filter((g) => !g.onDemand).length).toBeGreaterThan(0);
    // 两侧的默认档集合必须一致（增减只改一侧 = 两个平台跑不同的门禁）。
    const defaults = (gs: typeof mjs) =>
      gs
        .filter((g) => !g.onDemand)
        .map((g) => g.name)
        .sort();
    expect(defaults(mjs)).toEqual(defaults(ps1));
  });
});
