import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEIGHT,
  DEFAULT_SETTLE_MS,
  DEFAULT_WIDTH,
  SCREENSHOT_DIR,
  outputPathFor,
  parseArgs,
  slugForRoute,
  themeList,
  usage,
} from "../scripts/screenshot.mjs";

/**
 * `scripts/screenshot.mjs` 的判据（ISSUE #3780）：截图这件事此前**没有入口** ——
 * 本仓的截图能力其实早就有（`@playwright/test` + chromium + e2e 那 20 多份 spec），
 * 缺的只是「把某一屏拍下来」这一格，于是每次 UI 改动都以「当前无可用的图形化运行与
 * 截图环境」收场。这条用例钉住入口的**形状**：参数怎么读、图落哪、主题怎么取。
 */
describe("screenshot 参数解析", () => {
  it("缺省：路由 /、明暗两态、1440×900、自己起应用", () => {
    const args = parseArgs([]);
    expect(args.route).toBe("/");
    expect(args.theme).toBe("both");
    expect(args.width).toBe(DEFAULT_WIDTH);
    expect(args.height).toBe(DEFAULT_HEIGHT);
    expect(args.fullPage).toBe(false);
    expect(args.settleMs).toBe(DEFAULT_SETTLE_MS);
    expect(args.startServer).toBe(true);
    expect(args.help).toBe(false);
  });

  it("路由是第一个裸参数；带值的旗标不吃掉它", () => {
    expect(parseArgs(["/settings"]).route).toBe("/settings");
    expect(parseArgs(["/settings", "--theme", "dark"]).route).toBe("/settings");
    expect(parseArgs(["--theme", "dark", "/settings"]).route).toBe("/settings");
    expect(parseArgs(["--width", "800", "/settings"]).route).toBe("/settings");
    expect(parseArgs(["--out", String.raw`D:\tmp\a.png`, "/settings"]).route).toBe("/settings");
    /* 旗标的**值**不是路由（这条错了就会把 "dark" 当成路由去截）。 */
    expect(parseArgs(["--theme", "dark"]).route).toBe("/");
    expect(parseArgs(["--settle", "500"]).route).toBe("/");
  });

  it("主题档位只认 light / dark / both，其余回落 both", () => {
    expect(parseArgs(["--theme", "light"]).theme).toBe("light");
    expect(parseArgs(["--theme", "dark"]).theme).toBe("dark");
    expect(parseArgs(["--theme", "both"]).theme).toBe("both");
    expect(parseArgs(["--theme", "DARK"]).theme).toBe("dark");
    expect(parseArgs(["--theme", "neon"]).theme).toBe("both");
  });

  it("--no-server 表示「应用已经在跑，别自己起」", () => {
    expect(parseArgs(["--no-server"]).startServer).toBe(false);
    expect(parseArgs([]).startServer).toBe(true);
  });

  it("非法尺寸回落缺省值（不静默变成 0 宽）", () => {
    expect(parseArgs(["--width", "0"]).width).toBe(DEFAULT_WIDTH);
    expect(parseArgs(["--width", "abc"]).width).toBe(DEFAULT_WIDTH);
    expect(parseArgs(["--width", "1200"]).width).toBe(1200);
  });
});

describe("screenshot 落点与主题", () => {
  it("路由 → 文件名片段（/ → home）", () => {
    expect(slugForRoute("/")).toBe("home");
    expect(slugForRoute("/settings")).toBe("settings");
    expect(slugForRoute("/project/abc")).toBe("project-abc");
  });

  it("缺省落点：log/screenshots/<路由>-<主题>.png（log/ 不进库）", () => {
    const out = outputPathFor({ root: "/repo", route: "/settings", theme: "dark", out: null });
    expect(out).toBe(path.resolve("/repo", SCREENSHOT_DIR, "settings-dark.png"));
    expect(out).toContain(path.join("log", "screenshots"));
  });

  it("给了 --out 就用它（相对路径按仓库根解析）", () => {
    expect(
      outputPathFor({ root: "/repo", route: "/", theme: "light", out: String.raw`D:\tmp\a.png` }),
    ).toBe(String.raw`D:\tmp\a.png`);
    expect(outputPathFor({ root: "/repo", route: "/", theme: "light", out: "out/a.png" })).toBe(
      path.resolve("/repo", "out/a.png"),
    );
  });

  it("both 的取法：先暗后亮（暗色是本仓默认档）", () => {
    expect(themeList("both")).toEqual(["dark", "light"]);
    expect(themeList("dark")).toEqual(["dark"]);
    expect(themeList("light")).toEqual(["light"]);
  });
});

describe("screenshot 帮助文本", () => {
  it("把入口、落点与上传命令写出来（下一位读者只靠这段就能用）", () => {
    const text = usage();
    expect(text).toContain("pnpm screenshot");
    expect(text).toContain("--theme");
    expect(text).toContain("cnb issues upload-image");
    expect(text).toContain("log/screenshots");
  });
});
