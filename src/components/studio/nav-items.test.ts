// 导航注册表分区的规则单测：全局项 / 项目页签 / 项目入口三者互斥，且项目页签绝不进全局侧栏。
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
  "train",
  "workflows",
];
const PROJECT_TAB_IDS: WorkspaceView[] = [
  "project",
  "canvas",
  "workshop",
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
  it("恰好是那五个项目内视图（主页 / 画布 / 工坊 / 产出 / 成片）", () => {
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
