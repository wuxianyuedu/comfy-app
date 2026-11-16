import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVER_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
  TRACE_CATEGORIES,
  TRACE_DIR,
  outputPathFor,
  parseArgs,
  slugForRoute,
  usage,
} from "../scripts/devtools/perf-trace.mjs";

/**
 * `scripts/devtools/perf-trace.mjs` 的判据（ISSUE #3843）：性能取证这件事在 #3771 的排查里
 * 是第二次真实需要（第一次靠临时脚本），按 §12.20 收成有名字的入口。这条用例钉住
 * 入口的**形状**：参数怎么读、trace 落哪（按次命名，不覆盖旧证据）、录什么类别。
 */
describe("perf-trace 参数解析", () => {
  it("缺省：路由 /、静置 5s、自己起应用、不点击", () => {
    const args = parseArgs([]);
    expect(args.route).toBe("/");
    expect(args.settleMs).toBe(DEFAULT_SETTLE_MS);
    expect(args.startServer).toBe(true);
    expect(args.click).toBeNull();
    expect(args.out).toBeNull();
    expect(args.serverTimeoutMs).toBe(DEFAULT_SERVER_TIMEOUT_MS);
    expect(args.help).toBe(false);
  });

  it("路由是第一个裸参数；带值的旗标不吃掉它", () => {
    expect(parseArgs(["/settings"]).route).toBe("/settings");
    expect(parseArgs(["/settings", "--settle", "9000"]).route).toBe("/settings");
    expect(parseArgs(["--settle", "9000", "/settings"]).route).toBe("/settings");
    expect(parseArgs(["--out", String.raw`D:\tmp\a.json`, "/settings"]).route).toBe("/settings");
    expect(parseArgs(["--click", "text=删除", "/workspace"]).route).toBe("/workspace");
    /* 旗标的**值**不是路由（这条错了就会把 "9000" 当成路由去录）。 */
    expect(parseArgs(["--settle", "9000"]).route).toBe("/");
  });

  it("路由归一化：没带前导斜杠的补上（Git Bash 改写后的兜底，ISSUE #3843）", () => {
    expect(parseArgs(["settings"]).route).toBe("/settings");
    expect(parseArgs(["workspace"]).route).toBe("/workspace");
  });

  it("数值旗标：非法 / 非正回落缺省", () => {
    expect(parseArgs(["--settle", "abc"]).settleMs).toBe(DEFAULT_SETTLE_MS);
    expect(parseArgs(["--settle", "-5"]).settleMs).toBe(DEFAULT_SETTLE_MS);
    expect(parseArgs(["--settle", "1000"]).settleMs).toBe(1000);
    expect(parseArgs(["--timeout", "5000"]).serverTimeoutMs).toBe(5000);
  });

  it("--no-server 与 --help 各自独立", () => {
    expect(parseArgs(["--no-server"]).startServer).toBe(false);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("perf-trace 落点与录制类别", () => {
  it("slug：/ → home；非法字符收成连字符", () => {
    expect(slugForRoute("/")).toBe("home");
    expect(slugForRoute("/settings")).toBe("settings");
    expect(slugForRoute("/a/b?c=1")).toBe("a-b-c-1");
  });

  it("缺省落点在 log/profiles 下、按次命名（路由 + 时间戳），不覆盖旧证据", () => {
    const now = new Date("2026-11-15T08:09:10Z");
    const out = outputPathFor({ root: "/repo", route: "/settings", out: null, now });
    expect(out).toBe(path.resolve("/repo", TRACE_DIR, "trace-settings-20261115080910.json"));
  });

  it("给了 --out 就用它（相对路径按仓库根解析，绝对路径原样）", () => {
    expect(outputPathFor({ root: "/repo", route: "/", out: "trace.json", now: new Date() })).toBe(
      path.resolve("/repo", "trace.json"),
    );
    /* POSIX 形态的绝对路径在两平台都判「绝对」⇒ 原样使用。别用盘符路径断言：
     * `path.isAbsolute("D:\\…")` 在 Linux 是 false，会走相对解析分支（GA 首跑实测）。 */
    expect(
      outputPathFor({ root: "/repo", route: "/", out: "/tmp/trace.json", now: new Date() }),
    ).toBe("/tmp/trace.json");
  });

  it("录制类别含主线程任务与 CPU 采样（定位「哪段代码在烧主线程」的最低配置）", () => {
    expect(TRACE_CATEGORIES).toContain("devtools.timeline");
    expect(TRACE_CATEGORIES).toContain("disabled-by-default-v8.cpu_profiler");
  });

  it("usage 里带「怎么读」（perfetto / chrome://tracing）与边界说明", () => {
    const text = usage();
    expect(text).toContain("ui.perfetto.dev");
    expect(text).toContain("chrome://tracing");
    expect(text).toContain("按需取证");
    /* Git Bash 的 MSYS 路径改写实测坑过一次（/ → Git 安装根），提示要一直在。 */
    expect(text).toContain("MSYS_NO_PATHCONV=1");
  });

  it("动词是 perf:trace，不是 profile（pnpm 的内建命令会抢在仓库脚本前，ISSUE #3843）", () => {
    /* `pnpm profile` 撞 pnpm 内建命令（与 `pnpm docs` 同款坑）：内建命令优先，
     * 仓库脚本根本不跑（实测报 not yet implemented）。usage 是命令形状的权威，
     * 这里钉住它别再退回那个撞车的动词。 */
    expect(usage()).toContain("pnpm perf:trace");
    expect(usage()).not.toContain("pnpm profile");
  });
});
