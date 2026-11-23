// @vitest-environment jsdom
// 页签恢复与落盘的**装配**判据（纯状态规则在 workspace-tabs.test.ts 判不到
// 「恢复那一步与落盘那一步在同一 commit 的先后」—— 那正是刷新后被踢出项目的现场，
// ISSUE #1501 / #1727）。无 JSX：`.test.ts` + createElement 包 StrictMode，不为此破例成 .tsx。
//
// 另加一条：侧栏项的页签行为是**可配置**的（ISSUE #3623），这里判「配置真的驱动了
// 页签的退场」—— 判据落在装配层（判据从哪来），纯规则层在 workspace-tabs.test.ts。
import { act, cleanup, render } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeAppEvent } from "~/lib/app-events";
import { setActive } from "~/lib/project-canvas/canvas-store";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";
import { WS_TABS_KEY, parseWorkspaceTabs } from "../workspace-tabs";
import type { WorkspaceTabsController } from "./use-workspace-tabs";
import { WORKSPACE_VIEWS, useWorkspaceTabs } from "./use-workspace-tabs";

/* 配置面（侧栏项的页签行为）的替身：这一份 hook 只关心「判据从哪来」，不碰网络。 */
const configMock = vi.hoisted(() => ({
  config: undefined as Record<string, "independent" | "shared"> | undefined,
}));

vi.mock("./use-sidebar-tab-config", () => ({
  useSidebarTabConfigQuery: () => ({
    data: configMock.config === undefined ? undefined : { config: configMock.config },
    isPending: false,
  }),
}));

/* 刷新前的真实存储：首页 + 一个项目页。 */
const STORED = JSON.stringify({
  activeKey: "project:p1",
  tabs: [
    ["home", null],
    ["project", "p1"],
  ],
});

/** 最近一次渲染出来的 controller（探针把它挂在这儿，供用例调动作）。 */
let latest: WorkspaceTabsController | null = null;

/** 探针组件：只挂载被测 hook，不渲染任何东西。
 *  名字取 PascalCase 是为了过 `react-hooks/rules-of-hooks`（函数名不以大写开头
 *  时它不认这是个组件）。它在 `.ts` 文件里，不受文件命名规则约束。 */
function Probe() {
  latest = useWorkspaceTabs();
  return null;
}

/** 存储里的键还是不是那份项目页 —— 恢复没被初始态反冲的唯一判据。 */
function storedTabsSurvive(): boolean {
  const parsed = parseWorkspaceTabs(sessionStorage.getItem(WS_TABS_KEY), WORKSPACE_VIEWS);
  return parsed?.activeKey === "project:p1";
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  configMock.config = undefined;
  latest = null;
});

afterEach(() => {
  cleanup();
});

describe("页签恢复不被落盘反冲", () => {
  it("挂载即恢复：存储里的项目页仍在，且没被初始态冲掉", async () => {
    sessionStorage.setItem(WS_TABS_KEY, STORED);
    render(createElement(Probe));
    /* 等的是**存进 sessionStorage 的那个值**（不是 DOM 出现 / 消失），
       所以按 §11.14.3 走 `expect.poll`，不用 `waitFor`。 */
    await expect.poll(storedTabsSurvive).toBe(true);
    expect(sessionStorage.getItem(WS_TABS_KEY)).toBe(STORED);
  });

  /* 这一条是**本缺陷的复现条件**：React 开发态（Next dev 默认开 StrictMode）
   * 会把 effect 跑两遍（挂载 → 卸载 → 再挂载）。旧写法里恢复只把「跑过了」记成
   * 布尔量，而落盘与它在同一个 commit、拿到的是初始态 ⇒ 存储被冲成「只有首页」。
   * 反向验证过：改回旧写法必红。 */
  it("StrictMode 双挂载下同样不被冲掉", async () => {
    sessionStorage.setItem(WS_TABS_KEY, STORED);
    render(createElement(StrictMode, null, createElement(Probe)));
    await expect.poll(storedTabsSurvive).toBe(true);
    expect(sessionStorage.getItem(WS_TABS_KEY)).toBe(STORED);
  });
});

describe("storage 已有页签 → 挂载后恢复激活视图（ISSUE #4562）", () => {
  /* 这一组把「恢复」的判据从『存储没被冲掉』推进到『激活视图真的跟随存储』：
     reload 后用户该落回离开时的那一屏，而不是永远停在首页。 */

  it("恢复的 activeKey 成为当前视图（viewMode 跟随，不只存储存活）", async () => {
    sessionStorage.setItem(
      WS_TABS_KEY,
      JSON.stringify({
        activeKey: "workflows:",
        tabs: [
          ["home", null],
          ["workflows", null],
        ],
      }),
    );
    render(createElement(Probe));
    await expect.poll(() => latest?.viewMode).toBe("workflows");
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "workflows"]);
    expect(latest?.activeKey).toBe("workflows:");
  });

  it("存储里页签顺序不是首页在先也能恢复（读侧归一，不整份放弃）", async () => {
    /* ISSUE #4562 的原始读数：workflows 排在 home 前面。解析侧 `withHomeFirst`
       只补位、不因顺序不同而丢整份 —— 这条锁住该口径。 */
    sessionStorage.setItem(
      WS_TABS_KEY,
      JSON.stringify({
        activeKey: "workflows:",
        tabs: [
          ["workflows", null],
          ["home", null],
        ],
      }),
    );
    render(createElement(Probe));
    await expect.poll(() => latest?.viewMode).toBe("workflows");
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "workflows"]);
    expect(latest?.activeKey).toBe("workflows:");
  });

  it("恢复后再点侧栏仍能正常开新页（恢复态不是死的）", async () => {
    sessionStorage.setItem(
      WS_TABS_KEY,
      JSON.stringify({
        activeKey: "workflows:",
        tabs: [
          ["workflows", null],
          ["home", null],
        ],
      }),
    );
    render(createElement(Probe));
    await expect.poll(() => latest?.viewMode).toBe("workflows");

    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "workflows", "history"]);
    expect(latest?.activeKey).toBe("history:");
  });
});

describe("侧栏项的页签行为由配置面决定（ISSUE #3623）", () => {
  it("配置说「模型」是共享标签页时：切走它就退场", async () => {
    configMock.config = { models: "shared" };
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);
    act(() => {
      latest?.navigateTo("models");
    });
    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "history"]);
  });

  it("配置说「模型」是独立标签页时：切走它仍留着", async () => {
    configMock.config = { models: "independent" };
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);
    act(() => {
      latest?.navigateTo("models");
    });
    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "models", "history"]);
  });
});

describe("一项目一页签：项目级视图折叠 + 分区广播（ISSUE #4765）", () => {
  it("同一项目先开工坊再开画布：仍是一个页签，切换意图经 project:section 广播", async () => {
    const seen: Array<{ projectId?: string; section: string }> = [];
    const off = subscribeAppEvent("project:section", (p) => seen.push(p));
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);

    act(() => {
      setActive("p1");
      latest?.navigateTo("workshop");
    });
    act(() => {
      latest?.navigateTo("canvas");
    });

    expect(latest?.tabs.filter((tab) => tab.projectId === "p1")).toHaveLength(1);
    expect(latest?.activeKey).toBe("project:p1");
    expect(latest?.viewMode).toBe("project");
    /* 广播的是「视图 → 分区」的翻译结果：workshop 落流程起点，canvas 落画布。 */
    expect(seen).toEqual([
      { projectId: "p1", section: "script" },
      { projectId: "p1", section: "canvas" },
    ]);
    off();
  });

  it("切到别的项目页签时活跃项目跟着走（画布 / 工坊内部读的是 active id）", async () => {
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);

    act(() => {
      setActive("p1");
      latest?.navigateTo("project");
    });
    act(() => {
      setActive("p2");
      latest?.navigateTo("project");
    });
    /* 两个项目两页；把当前页切回 p1 那一页时，活跃项目必须同步回 p1 ——
     * 否则 p1 页里的画布 / 工坊会把内容写进 p2。 */
    act(() => {
      latest?.selectTab("project:p1");
    });
    expect(latest?.tabs.filter((tab) => tab.view === "project")).toHaveLength(2);
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe("p1");
    act(() => {
      latest?.selectTab("project:p2");
    });
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe("p2");
  });
});

describe("navigateTo 把壳的激活页带回主应用（ISSUE #4898）", () => {
  afterEach(() => {
    useShellTabs.setState({
      tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
      activeTabId: MAIN_TAB_ID,
    });
  });

  it("停在 ComfyUI iframe 页签上点导航：视图与壳激活页一起切回主应用", async () => {
    useShellTabs.setState({
      tabs: [
        { id: MAIN_TAB_ID, label: "主应用", url: null, closable: false },
        { id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true },
      ],
      activeTabId: "comfyui",
    });
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);
    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.activeKey).toBe("history:");
    /* 只改视图页签而不动壳的激活页，表现就是「点了没反应」——内容仍停在 iframe 上
     *（与 `selectTab` 同一口径，#4898 现场侧栏导航点了没反应的根因之一）。 */
    expect(useShellTabs.getState().activeTabId).toBe(MAIN_TAB_ID);
  });
});
