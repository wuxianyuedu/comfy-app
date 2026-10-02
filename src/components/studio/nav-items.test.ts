// 导航注册表分区的规则单测：全局项 / 项目页签 / 项目入口三者互斥，且项目页签绝不进全局侧栏。
import { describe, expect, it } from "vitest";

import {
  globalNavItems,
  isProjectTab,
  NAV_ITEMS,
  OVERLAY_NAV_ITEMS,
  PROJECTS_ENTRY,
  projectTabs,
  type WorkspaceView,
} from "./NavItems";

const GLOBAL_IDS: WorkspaceView[] = [
  "home",
  "models",
  "history",
  "queue",
  "workflows",
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

describe("OVERLAY_NAV_ITEMS（全局浮层入口）", () => {
  it("恰好三项、按序：模型适配 / 模式契约 / 控制台", () => {
    /* 「恰好 + 按序」是刻意的强度：新增一个全局浮层入口时必须显式改这里，
       不能悄悄多出一个侧栏项。`aa3ee904` 加了「控制台」却没回头改这条，
       于是它在主干上确定性红 —— 补全的同时不降判据。 */
    expect(OVERLAY_NAV_ITEMS.map((i) => i.overlay)).toEqual([
      "model-adapters",
      "mode-contract",
      "console",
    ]);
    expect(OVERLAY_NAV_ITEMS.map((i) => i.label)).toEqual([
      "模型适配",
      "模式契约",
      "控制台",
    ]);
  });

  it("它们不是视图：id 空间与 WorkspaceView 无交集", () => {
    /* 用 `overlay` 而不是 `id` 建模，就是为了让「当前视图」不出现两个到不了的值。
       这条钉住两者确实各走各的命名空间 —— 混进 WorkspaceView 会让 TopBar 反查到
       一个永远不 active 的标题、page.tsx 的视图白名单也要跟着塞两个假值。 */
    const viewIds: string[] = NAV_ITEMS.map((i) => i.id);
    for (const item of OVERLAY_NAV_ITEMS) {
      expect(viewIds).not.toContain(item.overlay);
    }
  });

  it("位置紧跟「流程」：全局项末尾之后就是它们", () => {
    /* 契约口清单是工作流库配落点的依据、适配器是远端模型的字段映射，两件事都服务
       「流程」这条链路 —— 所以它们的入口贴着「流程」，不与其它全局项混排。 */
    const ids = [...globalNavItems().map((i) => i.id)];
    expect(ids[ids.length - 1]).toBe("workflows");
  });
});
