import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEIGHT,
  DEFAULT_SETTLE_MS,
  DEFAULT_WIDTH,
  SCREENSHOT_DIR,
  isMsysMangledRoute,
  normalizeRoute,
  outputPathFor,
  parseArgs,
  shouldDetachServer,
  slugForRoute,
  themeList,
  usage,
} from "../scripts/devtools/screenshot.mjs";

/**
 * `scripts/devtools/screenshot.mjs` 的判据（ISSUE #3780）：截图这件事此前**没有入口** ——
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

  it("给了 --out 就用它（绝对路径原样、相对路径按仓库根解析）", () => {
    /* ⚠️ 绝对路径的判据是**平台相关**的（`path.isAbsolute`）⇒ 用当前平台的绝对路径
     * 来断言，别把 Windows 的盘符形态写死进用例 —— 那在 Linux runner 上必然红
     * （`D:\…` 在 POSIX 上不是绝对路径，会被解析成仓库根下的相对路径）。 */
    const absolute = path.resolve(path.sep, "tmp", "a.png");
    expect(outputPathFor({ root: "/repo", route: "/", theme: "light", out: absolute })).toBe(
      absolute,
    );
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
    /* --repo 必须显式在提示里：cli 的 --repo 缺省回落 CNB_REPO_SLUG，本检出通常
     * 没设它，缺了会报误导性的 Resource not found（ISSUE #4162）。 */
    expect(text).toContain("--repo moon-read/comfy-app-t3");
    expect(text).toContain("log/screenshots");
  });
});

describe("normalizeRoute —— Git Bash 的 MSYS 路径转换恢复（ISSUE #4161）", () => {
  it("被转换的形状（盘符冒号开头）从 MSYS 安装根标记后恢复", () => {
    expect(normalizeRoute("D:/Program Files/Git/settings")).toBe("/settings");
    expect(normalizeRoute("C:/Git/settings")).toBe("/settings");
    expect(normalizeRoute("D:/PortableGit/settings")).toBe("/settings");
    /* 用户路由恰好以 /git 开头：first-match 落在安装根上，仍完整恢复。 */
    expect(normalizeRoute("D:/Program Files/Git/git/settings")).toBe("/git/settings");
  });

  it("用户只传了「/」被翻成安装根 → 缺省路由", () => {
    expect(normalizeRoute("D:/Program Files/Git")).toBe("/");
    expect(normalizeRoute("C:/Git")).toBe("/");
  });

  it("恢复不了的改写保持原样（run() 据此给指向 MSYS_NO_PATHCONV 的报错）", () => {
    expect(normalizeRoute("D:/tools/msys64/settings")).toBe("D:/tools/msys64/settings");
    expect(isMsysMangledRoute("D:/tools/msys64/settings")).toBe(true);
  });

  it("缺斜杠 / 双斜杠 / 空值 / 正常路由", () => {
    expect(normalizeRoute("settings")).toBe("/settings");
    expect(normalizeRoute("//settings")).toBe("/settings");
    expect(normalizeRoute("/settings")).toBe("/settings");
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("/")).toBe("/");
    expect(isMsysMangledRoute("/settings")).toBe(false);
  });

  it("parseArgs 的路由出口经过同一份归一化", () => {
    expect(parseArgs(["D:/Program Files/Git/settings"]).route).toBe("/settings");
    expect(parseArgs(["settings"]).route).toBe("/settings");
    expect(parseArgs(["//settings"]).route).toBe("/settings");
  });
});

/**
 * #4816：截图收尾只杀单进程、留 next dev 孤儿的那条链。核心修复在「起应用时自建进程组」——
 * POSIX 上不 detached 的话，dev.mjs 与截图脚本同组，`killProcessTree` 的防自杀判据会拒绝走
 * 组路径、退化成单杀 leader，子进程成孤儿占端口，下次截图「复用」到僵尸应用卡 120s 超时。
 */
describe("startDevServer —— 起应用自建进程组（ISSUE #4816）", () => {
  it("POSIX 自建进程组、Windows 不建（detached 是整树回收的前提）", () => {
    // 平台作为形参传入，两侧都测得到（真机只跑一半判据的老问题在这里收掉）。
    expect(shouldDetachServer("linux")).toBe(true);
    expect(shouldDetachServer("darwin")).toBe(true);
    expect(shouldDetachServer("freebsd")).toBe(true);
    expect(shouldDetachServer("win32")).toBe(false);
  });
});
