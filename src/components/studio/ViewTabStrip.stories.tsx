import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import {
  ViewTabStrip,
  type OpenableView,
} from "~/components/studio/ViewTabStrip";
import { tabKey, type ViewTab } from "~/components/studio/workspace-tabs";

/**
 * 视图页签条（`studio/` 的一等公民：它取代了退役的 `ProjectTabBar`）。
 *
 * 它是**纯 props** 的 —— `tabs` / `activeKey` / 三个回调都由调用处给，
 * 没有 tRPC、没有浏览器运行期。所以这里没有注入层的事：关键是**页签的数据要真**
 *（`key` 走 `tabKey()` 那个唯一编码处、`view` 用真的 `WorkspaceView` 字面量），
 * 而不是随手捏几个字符串让高亮看起来对。
 *
 * 要看的是两件在真机上容易分叉的事：
 *  · **选中 / 悬停 / 焦点三态在两种摆放位置下一致**（`inTitleBar` 只是换背景层级）；
 *  · 关闭按钮是**页签内部**的按钮，点它不能连带切页签（`stopPropagation`）。
 */
const PROJECTS: Record<string, string> = {
  p_8f2a1c: "角色一致性",
  p_0b77e4: "城市夜景",
};

const projectNameOf = (projectId: string | null): string | null =>
  projectId === null ? null : (PROJECTS[projectId] ?? null);

/** 真机上一条典型的页签组合：两个全局视图 + 两个项目内视图。 */
const TABS: ViewTab[] = [
  { key: tabKey("home", null), view: "home", projectId: null },
  { key: tabKey("models", null), view: "models", projectId: null },
  { key: tabKey("canvas", "p_8f2a1c"), view: "canvas", projectId: "p_8f2a1c" },
  {
    key: tabKey("workshop", "p_0b77e4"),
    view: "workshop",
    projectId: "p_0b77e4",
  },
];

const OPENABLE: OpenableView[] = [
  { view: "home", label: "首页" },
  { view: "models", label: "模型库" },
  { view: "queue", label: "队列" },
  { view: "history", label: "历史" },
];

/** 适配件：页签条是受控组件（选中 / 关闭都要真发生），story 自己持状态。 */
function InteractiveStrip({
  inTitleBar,
  tabs,
}: {
  inTitleBar: boolean;
  tabs: ViewTab[];
}) {
  const [state, setState] = useState({
    tabs,
    activeKey: tabs[2]?.key ?? "",
    closed: [] as string[],
  });
  return (
    <div className="flex flex-col gap-3">
      <div
        className={inTitleBar ? "bg-canvas border-border border-b pb-2" : ""}
      >
        <ViewTabStrip
          tabs={state.tabs}
          activeKey={state.activeKey}
          projectNameOf={projectNameOf}
          onSelect={(key) => setState((s) => ({ ...s, activeKey: key }))}
          onClose={(key) =>
            setState((s) => ({
              ...s,
              tabs: s.tabs.filter((t) => t.key !== key),
              closed: [...s.closed, key],
            }))
          }
          openableViews={OPENABLE}
          onOpenView={() => undefined}
          inTitleBar={inTitleBar}
        />
      </div>
      <p className="text-ink-muted text-xs">
        当前：<span className="font-mono">{state.activeKey || "（空）"}</span>
        {state.closed.length > 0 && (
          <>
            {" "}
            · 已关：
            <span className="font-mono">{state.closed.join(" / ")}</span>
          </>
        )}
      </p>
    </div>
  );
}

const meta = {
  title: "Studio/ViewTabStrip",
  component: InteractiveStrip,
  args: { inTitleBar: false, tabs: TABS },
  argTypes: {
    inTitleBar: {
      control: { type: "boolean" },
      description: "壳内嵌入窗口标题行（去边框、换背景层级）",
    },
  },
} satisfies Meta<typeof InteractiveStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 浏览器 / dev 形态：自带一条下边框与背景。 */
export const Default: Story = {};

/** 壳形态（`inTitleBar`）：边框与底色交给标题行统一持有。 */
export const InTitleBar: Story = {
  args: { inTitleBar: true },
};

/**
 * 只有一个页签：**不可关闭**（`isTabClosable` 的判据 —— 关掉最后一个页签会让
 * 工作区没有可显示的东西，所以那一颗 ✕ 刻意不出现）。
 */
export const SingleTab: Story = {
  args: {
    tabs: [{ key: tabKey("home", null), view: "home", projectId: null }],
  },
};

/**
 * 项目名查不到时（项目已被删 / 还没加载出来）退化成**只显示视图名** ——
 * 不显示 projectId，也不显示 `undefined`。
 */
export const UnknownProject: Story = {
  args: {
    tabs: [
      { key: tabKey("home", null), view: "home", projectId: null },
      {
        key: tabKey("canvas", "p_gone"),
        view: "canvas",
        projectId: "p_gone",
      },
    ],
  },
};
