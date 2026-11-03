/**
 * 回归护栏：陈旧路由表自愈的「懒归因」——把一次代码改动翻成一句人话。
 *
 * 归因不是判据（判据是症状），所以本用例只钉两件事：
 *   1. 类目划分：只有**路由约定文件的增 / 删 / 改名**算改路由结构，内容改动
 *      （`M`）不算；中间件 / `next.config` / 依赖面 / 桌面壳各成一类，其余进 other；
 *   2. 文案：拿不到改动（`headChanged === false`）时说「未检测到代码改动」，且**不抛**。
 * 读不懂的 diff 行**静默跳过**：宁可少说一句，也不能因为一行怪格式把整条自愈
 * 路径拖进异常。
 */
import { describe, expect, it } from "vitest";

import {
  classifyChanges,
  describeChanges,
  parseDiffEntries,
} from "../scripts/launcher-core/sync-attribution.mjs";

describe("parseDiffEntries", () => {
  it("按 status 分列：M/A/D 两段、R/C 三段（旧路径 → 新路径）", () => {
    const out = parseDiffEntries(
      [
        "M\tsrc/a.ts",
        "A\tsrc/b.ts",
        "D\tsrc/c.ts",
        "R100\tsrc/old.ts\tsrc/new.ts",
        "C100\tsrc/x.ts\tsrc/y.ts",
      ].join("\n"),
    );
    expect(out).toEqual([
      { status: "M", oldPath: "", path: "src/a.ts" },
      { status: "A", oldPath: "", path: "src/b.ts" },
      { status: "D", oldPath: "", path: "src/c.ts" },
      { status: "R", oldPath: "src/old.ts", path: "src/new.ts" },
      { status: "C", oldPath: "src/x.ts", path: "src/y.ts" },
    ]);
  });

  it("空行与读不懂的行静默跳过；空输入 / 非字符串不抛", () => {
    expect(parseDiffEntries("\n\n   \n")).toEqual([]);
    expect(parseDiffEntries("garbage")).toEqual([]);
    // @ts-expect-error 故意传非法输入：验运行期不抛（防线比类型宽）
    expect(parseDiffEntries(null)).toEqual([]);
  });
});

describe("classifyChanges", () => {
  it("路由约定文件的增 / 删 / 改名计入 routes，M（内容改动）只算 other", () => {
    const c = classifyChanges(
      parseDiffEntries(
        [
          "A\tsrc/app/api/foo/route.ts",
          "D\tsrc/app/old/page.tsx",
          "R100\tsrc/app/a/page.tsx\tsrc/app/b/page.tsx",
          "M\tsrc/app/api/bar/route.ts",
        ].join("\n"),
      ),
    );
    expect(c.routes).toEqual({
      added: 1,
      removed: 1,
      renamed: 1,
      examples: ["src/app/api/foo/route.ts", "src/app/old/page.tsx"],
    });
    expect(c.other).toBe(1);
  });

  it("src/app 之外的同名文件不算路由；README.md 只进 other（负例）", () => {
    const c = classifyChanges(
      parseDiffEntries(["A\tsrc/widgets/page.tsx", "M\tREADME.md"].join("\n")),
    );
    expect(c.routes).toEqual({
      added: 0,
      removed: 0,
      renamed: 0,
      examples: [],
    });
    expect(c.other).toBe(2);
  });

  it("中间件 / next.config / 依赖面 / 桌面壳各归一类", () => {
    const c = classifyChanges(
      parseDiffEntries(
        [
          "M\tsrc/middleware.ts",
          "M\tnext.config.js",
          "M\tpnpm-lock.yaml",
          "A\tsrc-tauri/src/lib.rs",
        ].join("\n"),
      ),
    );
    expect(c.middleware).toBe(true);
    expect(c.nextConfig).toBe(true);
    expect(c.deps).toBe(true);
    expect(c.shell).toBe(true);
    expect(c.other).toBe(0);
  });

  it("examples 至多两条（文案里给的是例子，不是清单）", () => {
    const c = classifyChanges(
      parseDiffEntries(
        ["A\tsrc/app/a/route.ts", "A\tsrc/app/b/route.ts", "A\tsrc/app/c/route.ts"].join("\n"),
      ),
    );
    expect(c.routes.added).toBe(3);
    expect(c.routes.examples).toHaveLength(2);
  });
});

describe("describeChanges", () => {
  it("没有代码改动 → 说「偶发失效」，不编归因", () => {
    expect(describeChanges(classifyChanges([]), { headChanged: false })).toBe(
      "未检测到代码改动，属偶发失效",
    );
  });

  it("改了路由结构 → 说清增删改名并给一个例子", () => {
    const c = classifyChanges(parseDiffEntries(["A\tsrc/app/api/foo/route.ts"].join("\n")));
    const text = describeChanges(c, { headChanged: true });
    expect(text).toContain("改了路由结构");
    expect(text).toContain("新增 1");
    expect(text).toContain("src/app/api/foo/route.ts");
  });

  it("全是不相关文件 → 仍给一句（不判空、不抛）", () => {
    const c = classifyChanges(parseDiffEntries(["M\tREADME.md"].join("\n")));
    const text = describeChanges(c, { headChanged: true });
    expect(text).toContain("1 个文件");
  });
});
