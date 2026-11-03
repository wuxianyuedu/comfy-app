import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import { ViewTabStrip, type OpenableView } from "~/components/studio/ViewTabStrip";
import { tabKey, type ViewTab } from "~/components/studio/workspace-tabs";

/**
 * 视图页签条（`studio/` 的一等公民：取代退役的 `ProjectTabBar`）。纯 props、无 tRPC 无运行期；
 * 关键是页签数据要真（`key` 走 `tabKey()` 唯一编码处）。看两件真机易分叉的事：三态在两种摆放
 * 位置下一致（`inTitleBar` 只换背景层级）；关闭按钮是页签内部按钮，点它不能连带切页签（`stopPropagation`）。
 */
const PROJECTS: Record<string, string> = {
  p_8f2a1c: "角色一致性",
  p_0b77e4: "城市夜景",
};

const projectNameOf = (projectId: string | null): string | null =>
  projectId === null ? null : (PROJECTS[projectId] ?? null);

/** 真机上一条典型的页签组合：两个全局视图 + 两个项目内视图。 */
const TABS: Array<ViewTab> = [
  { key: tabKey("home", null), view: "home", projectId: null },
  { key: tabKey("models", null), view: "models", projectId: null },
  { key: tabKey("canvas", "p_8f2a1c"), view: "canvas", projectId: "p_8f2a1c" },
  {
    key: tabKey("workshop", "p_0b77e4"),
    view: "workshop",
    projectId: "p_0b77e4",
  },
];

const OPENABLE: Array<OpenableView> = [
  { view: "home", label: "首页" },
  { view: "models", label: "模型库" },
  { view: "queue", label: "队列" },
  { view: "history", label: "历史" },
];

/** 适配件：页签条是受控组件（选中 / 关闭都要真发生），story 自己持状态。 */
function InteractiveStrip({ inTitleBar, tabs }: { inTitleBar: boolean; tabs: Array<ViewTab> }) {
  const [state, setState] = useState({
    tabs,
    activeKey: tabs[2]?.key ?? "",
    /* SAFETY: 类型断言已复核 */
    closed: [] as Array<string>,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className={inTitleBar ? "bg-canvas border-border border-b pb-2" : ""}>
        <ViewTabStrip
          activeKey={state.activeKey}
          inTitleBar={inTitleBar}
          onClose={(key) => {
            setState((s) => ({
              ...s,
              tabs: s.tabs.filter((t) => t.key !== key),
              closed: [...s.closed, key],
            }));
          }}
          onOpenView={() => undefined}
          onSelect={(key) => {
            setState((s) => ({ ...s, activeKey: key }));
          }}
          openableViews={OPENABLE}
          projectNameOf={projectNameOf}
          tabs={state.tabs}
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
