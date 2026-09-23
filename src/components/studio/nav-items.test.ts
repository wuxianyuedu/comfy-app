// 首页隐藏项目作用域导航（画布 / 工坊 / 产出 / 成片）的规则单测。
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, visibleNavItems } from "./NavItems";

const ids = (active: Parameters<typeof visibleNavItems>[0]) =>
  visibleNavItems(active).map((i) => i.id);

describe("visibleNavItems", () => {
  it("首页隐藏项目作用域工具（画布 / 工坊 / 产出 / 成片）", () => {
    const home = ids("home");
    expect(home).not.toContain("canvas");
    expect(home).not.toContain("workshop");
    expect(home).not.toContain("outputs");
    expect(home).not.toContain("film");
    // 首页仍保留全局导航与非项目工具
    expect(home).toEqual(
      expect.arrayContaining([
        "home",
        "works",
        "models",
        "workflows",
        "history",
      ]),
    );
  });

  it("进入项目视图后恢复全部项目作用域项", () => {
    const canvas = ids("canvas");
    expect(canvas).toContain("canvas");
    expect(canvas).toContain("workshop");
    expect(canvas).toContain("outputs");
    expect(canvas).toContain("film");
  });

  it("首页与非首页只差那四个项目作用域项", () => {
    const projectScoped = NAV_ITEMS.filter((i) => i.projectScoped).map(
      (i) => i.id,
    );
    expect([...projectScoped].sort()).toEqual([
      "canvas",
      "film",
      "outputs",
      "workshop",
    ]);
    const diff = NAV_ITEMS.map((i) => i.id).filter(
      (id) => !ids("home").includes(id),
    );
    expect([...diff].sort()).toEqual([...projectScoped].sort());
  });
});
