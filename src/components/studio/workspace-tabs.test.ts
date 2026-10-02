// 视图页签的状态模型。四条规则（#1324 拍板）逐条钉死，另加持久化的"整份可用"判据。
import { describe, expect, it } from "vitest";

import {
  LEGACY_WS_VIEW_KEY,
  WS_TABS_KEY,
  closeViewTab,
  dropProjectTabs,
  findTab,
  homeTab,
  initialWorkspaceTabs,
  isTabClosable,
  makeTab,
  openViewTab,
  parseWorkspaceTabs,
  serializeWorkspaceTabs,
  tabKey,
  type WorkspaceTabsState,
} from "./workspace-tabs";
import { type WorkspaceView } from "./NavItems";

const VIEWS: WorkspaceView[] = [
  "home",
  "project",
  "canvas",
  "models",
  "works",
  "workshop",
  "library",
  "history",
  "queue",
  "film",
  "workflows",
  "outputs",
];

function state(
  tabs: [WorkspaceView, string | null][],
  active: [WorkspaceView, string | null],
): WorkspaceTabsState {
  const built = tabs.map(([view, projectId]) => makeTab(view, projectId));
  const activeTab = makeTab(active[0], active[1]);
  return {
    tabs: built.filter((tab): tab is NonNullable<typeof tab> => tab !== null),
    activeKey: activeTab?.key ?? homeTab().key,
  };
}

describe("页签身份 = (视图, 项目)", () => {
  it("同一视图在不同项目里是两个不同的页签", () => {
    expect(tabKey("workshop", "p1")).not.toBe(tabKey("workshop", "p2"));
  });

  it("全局视图不带项目身份：传了 projectId 也只认视图", () => {
    expect(makeTab("models", "p1")?.projectId).toBeNull();
    expect(makeTab("models", "p1")?.key).toBe(tabKey("models", null));
  });

  it("项目类视图没有活跃项目时开不出来（守卫只此一处）", () => {
    expect(makeTab("workshop", null)).toBeNull();
    expect(makeTab("canvas", null)).toBeNull();
    /* 开不出来时是**原样返回**，不会留下半个被改过的状态。 */
    const before = initialWorkspaceTabs();
    expect(openViewTab(before, "workshop", null)).toBe(before);
  });
});

describe("打开与聚焦", () => {
  it("新页签追加并成为当前页", () => {
    const next = openViewTab(initialWorkspaceTabs(), "queue", null);
    expect(next.tabs.map((tab) => tab.view)).toEqual(["home", "queue"]);
    expect(next.activeKey).toBe(tabKey("queue", null));
  });

  it("已存在就是聚焦，绝不产生第二页", () => {
    const once = openViewTab(initialWorkspaceTabs(), "workshop", "p1");
    const twice = openViewTab(once, "workshop", "p1");
    expect(twice.tabs).toHaveLength(once.tabs.length);
    expect(twice.tabs.filter((tab) => tab.view === "workshop")).toHaveLength(1);
    expect(twice.activeKey).toBe(tabKey("workshop", "p1"));
  });

  it("不同项目各开一页，互不覆盖", () => {
    const a = openViewTab(initialWorkspaceTabs(), "workshop", "p1");
    const b = openViewTab(a, "workshop", "p2");
    expect(b.tabs.filter((tab) => tab.view === "workshop")).toHaveLength(2);
  });
});

describe("关闭语义", () => {
  it("首页不可关", () => {
    expect(isTabClosable(homeTab())).toBe(false);
    const withQueue = openViewTab(initialWorkspaceTabs(), "queue", null);
    expect(closeViewTab(withQueue, homeTab().key)).toBe(withQueue);
  });

  it("关掉非当前页时，当前页不变", () => {
    const s = state(
      [
        ["home", null],
        ["queue", null],
        ["models", null],
      ],
      ["models", null],
    );
    const after = closeViewTab(s, tabKey("queue", null));
    expect(after.activeKey).toBe(tabKey("models", null));
    expect(after.tabs.map((tab) => tab.view)).toEqual(["home", "models"]);
  });

  it("关掉当前页落到左邻（按列表位置，不是按打开时间）", () => {
    const s = state(
      [
        ["home", null],
        ["queue", null],
        ["models", null],
        ["history", null],
      ],
      ["models", null],
    );
    const after = closeViewTab(s, tabKey("models", null));
    expect(after.activeKey).toBe(tabKey("queue", null));
  });

  it("关掉首页右侧第一页时落回首页", () => {
    const s = state(
      [
        ["home", null],
        ["queue", null],
      ],
      ["queue", null],
    );
    expect(closeViewTab(s, tabKey("queue", null)).activeKey).toBe(
      tabKey("home", null),
    );
  });

  it("关到只剩首页时状态仍然成立（不塌成另一种布局）", () => {
    let s = openViewTab(
      openViewTab(initialWorkspaceTabs(), "queue", null),
      "models",
      null,
    );
    s = closeViewTab(s, tabKey("queue", null));
    s = closeViewTab(s, tabKey("models", null));
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.view).toBe("home");
    expect(findTab(s.tabs, s.activeKey)?.view).toBe("home");
  });

  it("关一个不存在的键是空操作", () => {
    const s = initialWorkspaceTabs();
    expect(closeViewTab(s, "nope:")).toBe(s);
  });
});

describe("项目消失后的页签", () => {
  it("属于该项目的页签整批关掉", () => {
    let s = openViewTab(initialWorkspaceTabs(), "workshop", "p1");
    s = openViewTab(s, "canvas", "p1");
    s = openViewTab(s, "workshop", "p2");
    const after = dropProjectTabs(s, "p1");
    expect(after.tabs.map((tab) => tab.key)).toEqual([
      tabKey("home", null),
      tabKey("workshop", "p2"),
    ]);
  });

  it("当前页正是被关掉的页时落回首页", () => {
    let s = openViewTab(initialWorkspaceTabs(), "workshop", "p1");
    s = openViewTab(s, "queue", null);
    const after = dropProjectTabs(
      { tabs: s.tabs, activeKey: tabKey("workshop", "p1") },
      "p1",
    );
    expect(after.activeKey).toBe(tabKey("home", null));
  });

  it("没有该项目的页签时原样返回", () => {
    const s = initialWorkspaceTabs();
    expect(dropProjectTabs(s, "p1")).toBe(s);
  });
});

describe("持久化：整份可用，否则整份放弃", () => {
  it("序列化后能原样读回", () => {
    let s = openViewTab(initialWorkspaceTabs(), "workshop", "p1");
    s = openViewTab(s, "queue", null);
    expect(parseWorkspaceTabs(serializeWorkspaceTabs(s), VIEWS)).toEqual(s);
  });

  it("恢复时保证首页在位（存储里被抹掉也补回来）", () => {
    const raw = JSON.stringify({
      activeKey: tabKey("queue", null),
      tabs: [["queue", null]],
    });
    const out = parseWorkspaceTabs(raw, VIEWS);
    expect(out?.tabs.map((tab) => tab.view)).toEqual(["home", "queue"]);
  });

  it.each([
    ["坏 JSON", "{oops"],
    ["未知视图", JSON.stringify({ activeKey: "x:", tabs: [["nope", null]] })],
    [
      "activeKey 指向不存在的页",
      JSON.stringify({
        activeKey: tabKey("models", null),
        tabs: [["home", null]],
      }),
    ],
    [
      "重复页签",
      JSON.stringify({
        activeKey: tabKey("queue", null),
        tabs: [
          ["home", null],
          ["queue", null],
          ["queue", null],
        ],
      }),
    ],
    [
      "项目类视图丢了项目 id",
      JSON.stringify({
        activeKey: tabKey("workshop", null),
        tabs: [
          ["home", null],
          ["workshop", null],
        ],
      }),
    ],
    ["形状不对", JSON.stringify({ activeKey: "home:", tabs: "queue" })],
  ])("%s ⇒ 整份放弃（返回 null 由调用方回落初始态）", (_name, raw) => {
    expect(parseWorkspaceTabs(raw, VIEWS)).toBeNull();
  });

  it("空输入返回 null（调用方据此走初始态）", () => {
    expect(parseWorkspaceTabs(null, VIEWS)).toBeNull();
  });

  it("新键与旧单值键不是同一个（旧键只用于一次性迁移后即删）", () => {
    expect(WS_TABS_KEY).not.toBe(LEGACY_WS_VIEW_KEY);
    expect(WS_TABS_KEY).toContain("v2");
  });
});
