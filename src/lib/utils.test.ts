import { describe, expect, it } from "vitest";

import { cn } from "~/lib/utils";

/**
 * `cn` 的**契约测试**（ISSUE #623 迁移到 `cn@0.3.0`）。
 *
 * 迁移前 `cn` 是 `twMerge(clsx(...))` 的组合：本文件不重复验证 `cn` 包的合并算法
 * （那是它自己的差异测试范围），只钉住**本仓库实际依赖的三件事**：
 *   ① 三种入参形态（条件串 / 数组 / 对象）都被接受；
 *   ② 后写的 Tailwind 冲突类胜出（`clsx` 只 join、不解决冲突的那一半）；
 *   ③ 项目自定义主题里真实出现过的写法（`w-(--panel-right-width)` 这类
 *      Tailwind v4 的 CSS 变量括号语法）不被当成「非 utility」而漏合并。
 *
 * 判据来源：迁移前对同一批输入跑 `twMerge(clsx(...))`，输出逐条一致；
 * 若将来新包升级改了口径，这里会先红，而不是等到界面样式悄悄跑偏。
 */
describe("cn（ISSUE #623 迁移到 cn@0.3.0 后的契约）", () => {
  it("接受 clsx 的三种入参形态：条件串、嵌套数组、对象", () => {
    const active = true;
    expect(
      cn("px-2 py-1", active && "bg-blue-500", { "text-white": active }),
    ).toBe("px-2 py-1 bg-blue-500 text-white");
    expect(cn("text-sm", ["px-1", ["py-2"]])).toBe("text-sm px-1 py-2");
    expect(cn("a", { b: true, c: false }, ["d"])).toBe("a b d");
  });

  it("丢弃 falsy 入参（undefined / null / false / 0 / NaN）", () => {
    expect(cn("", null, undefined, false, 0, NaN, "px-1")).toBe("px-1");
  });

  it("后写的冲突类胜出，不只是拼接", () => {
    expect(cn("p-2 p-4")).toBe("p-4");
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    // 修饰符不同的冲突类各自保留（hover 与基础态不是同一组）
    expect(cn("hover:bg-red-500", "bg-blue-500")).toBe(
      "hover:bg-red-500 bg-blue-500",
    );
  });

  it("合并项目自定义主题里的 v4 括号语法", () => {
    // 面板宽度走 CSS 变量，迁移前实测与旧实现同输出
    expect(cn("w-(--panel-right-width)", "w-full")).toBe("w-full");
    expect(cn("rounded-(--radius)", "rounded-md")).toBe("rounded-md");
    // 任意值与变体不应被拆散
    expect(cn("[&>svg]:size-4", "[&>svg]:shrink-0")).toBe(
      "[&>svg]:size-4 [&>svg]:shrink-0",
    );
  });
});
