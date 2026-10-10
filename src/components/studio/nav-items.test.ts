// 导航注册表分区的规则单测：全局项 / 项目页签 / 项目入口三者互斥，且项目页签绝不进全局侧栏。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  globalNavItems,
  isProjectTab,
  NAV_ITEMS,
  PROJECTS_ENTRY,
  projectTabs,
  type WorkspaceView,
} from "./NavItems";

const GLOBAL_IDS: WorkspaceView[] = [
  "home",
  "models",
  "history",
  "queue",
  /* 设置从「workspace 内的全屏浮层」改成视图后进入全局项清单。排在 queue 之后、
     workflows 之前：尾部那一组（workflows + console）是「流程」链路的收尾，
     设置不属于那条链路，不该挤进去。 */
  "settings",
  "workflows",
  /* 这两个此前不在本清单里 —— 它们是「全局浮层入口」（`OVERLAY_NAV_ITEMS`），
     点开弹窗、不改视图，所以 `WorkspaceView` 里根本没有这两个值。改成视图页签后
     它们与别的项同一条渲染路径，于是必须出现在这份**有序**清单的准确位置上：
     跟在「流程」之后（契约口清单是工作流库配落点的依据、适配器是远端模型的字段
     映射，两件事都服务这条链路），在「控制台」之前。 */
  "model-adapters",
  "mode-contract",
  "console",
];
const PROJECT_TAB_IDS: WorkspaceView[] = [
  "project",
  "canvas",
  "workshop",
  "library",
  "outputs",
  "film",
];

describe("globalNavItems", () => {
  it("只含全局项，不含任何项目页签与项目入口", () => {
    const ids = globalNavItems().map((i) => i.id);
    expect(ids).toEqual(GLOBAL_IDS);
    for (const tab of PROJECT_TAB_IDS) expect(ids).not.toContain(tab);
    expect(ids).not.toContain(PROJECTS_ENTRY.id);
  });
});

describe("projectTabs", () => {
  it("恰好是那六个项目内视图（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）", () => {
    expect(projectTabs().map((i) => i.id)).toEqual(PROJECT_TAB_IDS);
  });

  it("主页排在最前（进入项目后的落点）", () => {
    expect(projectTabs()[0]?.id).toBe("project");
  });
});

describe("isProjectTab", () => {
  it("项目页签为真，全局项与项目入口为假", () => {
    for (const id of PROJECT_TAB_IDS) expect(isProjectTab(id)).toBe(true);
    /* `home`（应用首页）与 `project`（项目主页）是两个层级，前者不是项目页签 ——
     * 混了会让侧栏「首页」在项目界面里也被高亮。 */
    expect(isProjectTab("home")).toBe(false);
    expect(isProjectTab("project")).toBe(true);
    expect(isProjectTab("works")).toBe(false);
    expect(isProjectTab("models")).toBe(false);
  });
});

describe("PROJECTS_ENTRY", () => {
  it("项目入口是 works，且它本身不带 projectScoped（不进项目页签）", () => {
    expect(PROJECTS_ENTRY.id).toBe("works");
    expect(PROJECTS_ENTRY.projectScoped).toBeUndefined();
  });
});

describe("NAV_ITEMS（全量注册表）", () => {
  it("全局项 + 项目页签 + 项目入口 = 全量，无遗漏无重复", () => {
    const partition = [
      ...globalNavItems().map((i) => i.id),
      ...projectTabs().map((i) => i.id),
      PROJECTS_ENTRY.id,
    ];
    expect([...partition].sort()).toEqual(NAV_ITEMS.map((i) => i.id).sort());
    expect(new Set(partition).size).toBe(partition.length);
  });
});

describe("模型适配 / 模式契约：已经是全局视图（此前是浮层入口）", () => {
  it("两项按序落在「流程」之后、「控制台」之前，标签没漂", () => {
    /* 「按序 + 标签」是刻意的强度：新增一个全局入口时必须显式改这里，不能悄悄多出一项。
       这条继承自旧的 `OVERLAY_NAV_ITEMS`「恰好两项、按序」判据 —— 换了建模方式，
       那份「不许静默增删」的约束不能跟着丢。 */
    const ids = globalNavItems().map((i) => i.id);
    expect(
      ids.slice(ids.indexOf("workflows") + 1, ids.indexOf("console")),
    ).toEqual(["model-adapters", "mode-contract"]);
    const labels = Object.fromEntries(
      globalNavItems().map((i) => [i.id, i.label]),
    );
    expect(labels["model-adapters"]).toBe("模型适配");
    expect(labels["mode-contract"]).toBe("模式契约");
  });

  it("旧的「浮层入口」建模已经从 NavItems 的导出面上消失", () => {
    /* 读源码文本判，而不是只判运行时：`OverlayEntryId` / `OverlayNavItem` /
       `OVERLAY_NAV_ITEMS` 只要还留着**任意一处**，就还有人可以走第二条路 ——
       「点开弹窗、不改视图」与「切视图页签」并存时，同一个功能会有两种「开没开」
       的真相（侧栏那个布尔 vs 页签状态），而那正是这一刀要消掉的形状。
       运行时判据抓不到「导出了却没人用」，所以这里判字面量。 */
    const source = readFileSync(
      path.resolve(import.meta.dirname, "NavItems.tsx"),
      "utf8",
    );
    for (const retired of [
      "OverlayEntryId",
      "OverlayNavItem",
      "OVERLAY_NAV_ITEMS",
    ]) {
      expect(source, `NavItems 里还留着 ${retired}`).not.toContain(retired);
    }
  });
});
