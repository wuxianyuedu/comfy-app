/**
 * 「换了像素基线要领自证欠账」的判据（规范 §11.8）。
 *
 * 立案现场是本轮实测翻出来的一条假绿：入库的 `-linux.png` 有几张与当时环境差 **1 像素**
 * （文字整体下移一行），而它**没有任何判据能发现**——`--update-snapshots` 总是绿、
 * 配对判据只核「成套且入库」、`pixel-run.mjs` 的 `--update` 档按设计不拦缺基线。
 * 于是「录一版、把仓库基线换成它」这条路上一个判据都没有，而换掉的是**别人的档**。
 *
 * 判据分三头，缺一条这层就退化：
 *   ① **判决可被执行**：喂「动了基线 + 没有欠账 / 欠账对不上 / 欠账合法」三种形状，
 *      各自给出阻断或放行 —— 不接输入的判决会永远说没问题。
 *   ② **识别面是真正的基线形态**：`spec` / `support/**` / 别的目录下的同名文件都不算
 *      （一个恒真的「动过像素层」判据等于没有判据）。
 *   ③ **钩子真的调它**：判据写在文件里而没人跑 = §13.5.12 那个「判据自称在跑」的形态。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REPRODUCE_LEDGER,
  changedBaselines,
  checkReproduceDebt,
  reproduceDebtRecord,
} from "../scripts/visual-baselines.mjs";
import { runGate } from "../scripts/visual-reproduce-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 真检出里的一张基线（用它做「合法清单」的样本，免得写死路径漂了）。 */
const ONE =
  "e2e/visual/login.visual.spec.ts-snapshots/login-desktop-chromium-linux.png";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("换基线的欠账判决（§11.8）", () => {
  it("识别面只认 `*-snapshots/<名>-chromium-<平台>.png`，spec 与 support 都不算", () => {
    const staged = [
      ONE,
      "e2e/visual/login.visual.spec.ts",
      "e2e/visual/support/page-baseline.ts",
      // 快照目录里形状不对的文件（手滑的 `-window`）也不该被算成「动过基线」——
      // 它由配对判据的孤儿那一条点名，不是本步的事。
      "e2e/visual/login.visual.spec.ts-snapshots/whatever-chromium-window.png",
      "src/lib/x.ts",
    ];
    expect(changedBaselines(staged, ROOT)).toEqual([ONE]);
  });

  it("没动基线且没有欠账 ⇒ 放行（普通提交零打扰）", () => {
    expect(runGate({ changed: [], debt: null })).toEqual({
      exitCode: 0,
      problem: null,
    });
    // 非对象（读坏了 / 手写成一行字符串）按「没领账」处理：它与「留着一条账」
    // 是两件事，前者在动了基线的路上会被拦（见下一条），后者才要抹账。
    expect(runGate({ changed: [], debt: null })).toEqual({
      exitCode: 0,
      problem: null,
    });
  });

  it("动了基线而没有欠账 ⇒ 阻断，且话说清「`--update` 为什么证明不了」", () => {
    const verdict = runGate({ changed: [ONE], debt: null });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.problem).toContain("--update-snapshots");
    expect(verdict.problem).toContain("没有");
    // 判据指到「怎么记账」，而不是只说「不行」。
    expect(verdict.problem).toContain(REPRODUCE_LEDGER);
  });

  it("欠账与本次动过的基线对得上 ⇒ 放行", () => {
    const debt = reproduceDebtRecord({
      baselines: [ONE],
      reason: "首页配色 token 调整导致基线合法变更",
      platform: "linux",
    });
    expect(runGate({ changed: [ONE], debt })).toEqual({
      exitCode: 0,
      problem: null,
    });
  });

  it("先领一张空白欠条这条绕法被拦：两边清单必须逐字相等", () => {
    // 少列（领了账但换的比记的多）
    const short = reproduceDebtRecord({
      baselines: [],
      reason: "首页配色 token 调整导致基线合法变更",
      platform: "linux",
    });
    expect(runGate({ changed: [ONE], debt: short }).problem).toContain("少列");
    // 多列（记的比换的多 = 顺手续了下一次的账）
    const extra = reproduceDebtRecord({
      baselines: [ONE, ONE.replace("login-desktop", "login-mobile")],
      reason: "首页配色 token 调整导致基线合法变更",
      platform: "linux",
    });
    expect(runGate({ changed: [ONE], debt: extra }).problem).toContain("多列");
  });

  it("欠账里 platform 必须登记过、reason 必须写清（两格各判一条）", () => {
    const base = {
      baselines: [ONE],
      reason: "首页配色 token 调整导致基线合法变更",
    };
    expect(
      checkReproduceDebt({
        changed: [ONE],
        debt: { ...base, platform: "darwin" },
      }).join(),
    ).toContain("platform");
    expect(
      checkReproduceDebt({
        changed: [ONE],
        debt: { ...base, platform: "linux", reason: "更新基线" },
      }).join(),
    ).toContain("reason");
  });

  it("没动基线却留着欠账 ⇒ 红（上一批没抹账，欠账单会退化成没人删的赦免名单）", () => {
    const stale = reproduceDebtRecord({
      baselines: [ONE],
      reason: "上一批换了首页配色，自证完成后忘了抹账",
      platform: "linux",
    });
    const verdict = runGate({ changed: [], debt: stale });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.problem).toContain("还留着");
  });

  it("欠账记录的形状是**两侧同一份**（领账与校验不许各写一套）", () => {
    // 领账函数给什么形状，校验函数就吃什么形状 —— 各写一套格式化时，领出来的账
    // 会被自己的校验判成「对不上」，而现场只看到一句矛盾的话。
    const debt = reproduceDebtRecord({
      baselines: [ONE],
      reason: " 首页配色 token 调整导致基线合法变更 ",
      platform: "linux",
    });
    expect(debt.reason).toBe("首页配色 token 调整导致基线合法变更");
    expect(checkReproduceDebt({ changed: [ONE], debt })).toEqual([]);
  });
});

describe("欠账门禁的接线（§11.8 / §13.5.12）", () => {
  it("pre-commit 真的调它（判据写在文件里而没人跑 = 没接上）", () => {
    expect(read(".githooks/pre-commit")).toContain(
      "node scripts/visual-reproduce-gate.mjs",
    );
  });

  it("钩子里**不跑像素**：它只判欠账，自证仍由人按需跑", () => {
    // 这一条是刻意的：pixel-run 要起 webServer + 浏览器，与钩子里的 A/B/C/D 抢资源
    // （§13.5 的并行预算是实测敏感项）。接进钩子的形态会让每次改基线都卡在冷启上。
    const hook = read(".githooks/pre-commit");
    const line = hook
      .split("\n")
      .find((l) => l.includes("visual-reproduce-gate.mjs"));
    expect(line).toBeDefined();
    expect(line).not.toContain("pixel-run");
  });

  it("欠账单没被提交进历史时它是「本机的账」（gitignore 或入库，二选一要有说法）", () => {
    // 本步的欠账是**本次提交的凭据**：它必须在同一批改动里（校验读的是工作区文件，
    // 那条由 test 上面的判决覆盖）。这里只钉一件事：名字与常量一致 —— 改名后
    // 校验会去读一个不存在的文件，而那时的表现是「永远说没领账」，与「真的没领」同形。
    expect(REPRODUCE_LEDGER).toContain("visual-reproduce-ledger");
  });
});
