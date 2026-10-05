/**
 * 像素基线清点内核 + 「本机有没有基线」前置判决的判据（规范 §11.8）。
 *
 * 这一层补的是 #1282 结尾留下的那半：「本机没有基线」此前**只能在付完
 * webServer + 浏览器的代价之后**、从 Playwright 的输出里读出来，而且它会顺手把
 * 缺的 PNG 写进 `*-snapshots/`（Playwright 的 `updateSnapshots` 默认是 `'missing'`）。
 *
 * 判据分两头，缺一条这层就会退化成「永远说本机有基线」：
 *   ① **清点内核真的接输入**：用一次性夹具造出「缺一张 / 整档没登记 / 齐备」三种形态，
 *      断言它各自数出正确的文件名 —— 不接输入的清点会让 ② 的那一闸恒开。
 *   ② **前置判决三种答案各自的动作**：没登记 / 缺几张 / 齐备对应三句不同的话
 *      （混成一句「像素档红了」就会把人引去改业务代码，§11.13 那条硬动作）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkLocalBaselines } from "../scripts/pixel-run.mjs";
import {
  declaredShotNames,
  isPlatformRegistered,
  missingBaselinesForPlatform,
  parseBaseline,
  untrackedBaselines,
  visualSpecs,
} from "../scripts/visual-baselines.mjs";

/**
 * 造一份最小的一次性检出：一份 spec（截图名由调用方给，**不从文件名反推** ——
 * 反推的话「新增了截图名而没录」这种形态就造不出来，而它正是要判的）+
 * 若干基线 PNG（内容无所谓，判据只看名字与在不在）。
 */
function fixtureCheckout(opts: {
  shots: string[];
  files: string[];
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-baselines-"));
  const spec = "e2e/visual/demo.visual.spec.ts";
  fs.mkdirSync(path.join(root, path.dirname(spec)), { recursive: true });
  fs.writeFileSync(
    path.join(root, spec),
    opts.shots
      .map(
        (name) =>
          `await expect(page).toHaveScreenshot("${name}.png", { fullPage: true });`,
      )
      .join("\n"),
  );
  for (const rel of opts.files) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.join(path.dirname(abs)), { recursive: true });
    fs.writeFileSync(abs, "png");
  }
  return root;
}

/** 快照目录（与 spec 同名 + `-snapshots`）。 */
const SHOT_DIR = "e2e/visual/demo.visual.spec.ts-snapshots";

/** 三张基线在夹具里的相对路径。 */
function shotsOf(...names: string[]): string[] {
  return names.map((n) => `${SHOT_DIR}/${n}`);
}

describe("像素基线清点内核（§11.8）", () => {
  it("扫的是 spec 里声明的截图名，不是文件名", () => {
    expect(
      declaredShotNames(
        'toHaveScreenshot("a.png");\ntoHaveScreenshot(\'b.png\', { fullPage: true });',
      ),
    ).toEqual(["a", "b"]);
  });

  it("平台↔名字的双向解析只认登记形状", () => {
    expect(parseBaseline("demo-chromium-linux.png")).toEqual({
      name: "demo",
      platform: "linux",
    });
    expect(parseBaseline("demo-chromium-docker.png")).toBeNull();
  });

  it("平台口径认得 win32 / linux，不认没登记过的档", () => {
    expect(isPlatformRegistered("win32")).toBe(true);
    expect(isPlatformRegistered("linux")).toBe(true);
    expect(isPlatformRegistered("darwin")).toBe(false);
  });

  it("缺基线要按**文件名**点名（只回一句「本机没基线」等于让人去猜缺哪张）", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop", "demo-mobile"],
      files: shotsOf(
        "demo-desktop-chromium-win32.png",
        "demo-mobile-chromium-win32.png",
      ),
      // linux 档完全没录 —— 「整档没登记」的形态
    });
    expect(missingBaselinesForPlatform(root, "win32")).toEqual([]);
    expect(missingBaselinesForPlatform(root, "linux")).toEqual(
      shotsOf(
        "demo-desktop-chromium-linux.png",
        "demo-mobile-chromium-linux.png",
      ),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("缺一张（新增截图名后没录）与整档没录是两种形态，内核都能数准", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop", "demo-mobile"],
      files: shotsOf(
        "demo-desktop-chromium-win32.png",
        "demo-mobile-chromium-win32.png",
        "demo-desktop-chromium-linux.png",
      ),
      // mobile 的 linux 那张缺
    });
    expect(missingBaselinesForPlatform(root, "linux")).toEqual(
      shotsOf("demo-mobile-chromium-linux.png"),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("扫描面非空 + spec 声明非空（空输入上的绿是假绿）", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop"],
      files: shotsOf("demo-desktop-chromium-win32.png"),
    });
    const specs = visualSpecs(root);
    expect(specs.length).toBe(1);
    expect(specs[0]?.names.length).toBeGreaterThan(0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("未入库那条要 git，前置判决不要 —— 两条各用各的输入", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop"],
      files: shotsOf("demo-desktop-chromium-win32.png"),
    });
    // 一次性目录不是 git 仓库 —— `git ls-files` 会非零退出（这条断言记下这个事实：
    // 「未入库」那条必须跑在真检出里，配对判据正是如此）。前置判决只读盘，不受影响：
    // 它必须在**任何**机器上都能答，不能反过来要求先有个 git 检出。
    expect(() => untrackedBaselines(root)).toThrow();
    expect(missingBaselinesForPlatform(root, "win32")).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("「本机有没有基线」前置判决（§11.8）", () => {
  it("齐备 → 放行（返回 null，不打扰）", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop", "demo-mobile"],
      files: shotsOf(
        "demo-desktop-chromium-win32.png",
        "demo-mobile-chromium-win32.png",
      ),
    });
    expect(checkLocalBaselines({ root, platform: "win32" })).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("整档没登记 → 说清「先录再同批登记」，而不是「像素档红了」", () => {
    // 用没登记过的那一档（`darwin`）：`linux` 已在口径里，它的缺基线走「补录」
    // 那条分支 —— 两条分支的区别正是「平台登记在不在」，测试要点名它们各自成立。
    const root = fixtureCheckout({
      shots: ["demo-desktop"],
      files: shotsOf("demo-desktop-chromium-linux.png"),
    });
    const verdict = checkLocalBaselines({ root, platform: "darwin" });
    expect(verdict).toContain("没有登记过像素基线");
    expect(verdict).toContain("check:visual:update");
    expect(verdict).toContain("SUPPORTED_PLATFORMS");
    // 缺的文件要逐个点名，否则人还是得去猜（点的是这一档的文件名）
    expect(verdict).toContain("demo-desktop-chromium-darwin.png");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("登记了但缺几张 → 指向补录，不提「登记平台」", () => {
    const root = fixtureCheckout({
      shots: ["demo-desktop", "demo-mobile"],
      files: shotsOf("demo-desktop-chromium-linux.png"),
      // mobile 那张缺
    });
    const verdict = checkLocalBaselines({ root, platform: "linux" });
    expect(verdict).toContain("缺");
    expect(verdict).toContain("demo-mobile-chromium-linux.png");
    expect(verdict).not.toContain("没有登记过像素基线");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
