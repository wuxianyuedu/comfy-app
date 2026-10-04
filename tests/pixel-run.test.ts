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
import { describe, expect, it } from "vitest";

import {
  PIXEL_JUDGE,
  VISUAL_DIR,
  classifyFailure,
  planRuns,
} from "../scripts/pixel-run.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("像素档按需通道：本次要跑什么（§11.8）", () => {
  it("默认跑两次：像素档 + 配对判据（少一次就等于没有像素判决）", () => {
    const runs = planRuns();
    expect(runs.map((r) => r.kind)).toEqual(["playwright", "vitest"]);

    const pixel = runs.find((r) => r.kind === "playwright");
    expect(pixel?.args).toEqual(["test", VISUAL_DIR]);
    // 默认**不带** --update：落盘是人的动作。
    expect(pixel?.args).not.toContain("--update-snapshots");

    const judge = runs.find((r) => r.kind === "vitest");
    expect(judge?.args).toEqual([PIXEL_JUDGE]);
  });

  it("--update 只多一个开关，不会顺手把判据那次丢掉", () => {
    const runs = planRuns({ update: true });
    expect(runs.map((r) => r.kind)).toEqual(["playwright", "vitest"]);
    expect(runs[0]?.args).toContain("--update-snapshots");
    expect(runs[1]?.args).toEqual([PIXEL_JUDGE]);
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
