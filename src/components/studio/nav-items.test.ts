// 首页隐藏项目作用域导航（画布 / 工坊）的规则单测。
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, visibleNavItems } from "./NavItems";

const ids = (active: Parameters<typeof visibleNavItems>[0]) =>
  visibleNavItems(active).map((i) => i.id);

describe("visibleNavItems", () => {
  it("首页隐藏画布与工坊", () => {
    const home = ids("home");
    expect(home).not.toContain("canvas");
    expect(home).not.toContain("workshop");
    // 首页仍保留主页导航与非项目工具
    expect(home).toEqual(
      expect.arrayContaining(["home", "works", "models", "film", "workflows"]),
    );
  });

  it("进入项目视图后恢复画布与工坊", () => {
    const canvas = ids("canvas");
    expect(canvas).toContain("canvas");
    expect(canvas).toContain("workshop");
  });

  it("首页与非首页只差那两个项目作用域项", () => {
    const projectScoped = NAV_ITEMS.filter((i) => i.projectScoped).map(
      (i) => i.id,
    );
    expect(projectScoped.sort()).toEqual(["canvas", "workshop"]);
    const diff = NAV_ITEMS.map((i) => i.id).filter(
      (id) => !ids("home").includes(id),
    );
    expect(diff.sort()).toEqual(projectScoped.sort());
  });
});
