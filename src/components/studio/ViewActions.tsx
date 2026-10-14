"use client";

/**
 * 视图动作槽 —— 把「本屏的动作按钮」渲染到**顶栏**里，而不是在屏内另起一行。
 *
 * 要治的是「每屏最上面一大片空白」（ISSUE #1871）：屏名已经由页签给出之后
 * （ISSUE #1693 撤掉了屏内重复标题），`PageHeader` 那一行就只剩**右对齐的几颗
 * 按钮** —— 左边四分之三是一整行空气；再叠上容器上内距与那行的下边距，首屏上沿
 * 白白吃掉约 80px。用户的原话正是「点开后最上方部分都是大块空白」。
 *
 * 为什么是「槽」而不是「注册表」：这些按钮的动作（刷新 / 清空 / 上传 / 搜索框的
 * 受控值）都长在**各视图自己的 controller** 上，注册表只能装声明、装不了处理器。
 * 所以这里传的是**已经渲染好的子树**（handler 跟着它一起走），宿主在哪由
 * `AppShell` 决定 —— 与 `ViewHelp` 那个注册表同一个动机，只是那一件传的是纯文案、
 * 可以由注册表承载。
 *
 * 传送机制本身在 `ui/slot-outlet`（`createPortal` 是 `react-dom` 的 API，
 * 散在视图层里各写一遍就没人说得清「项目里哪些地方在传送、为什么」）。
 * 本文件只剩三件应用级的知识：**落点是顶栏**、**非当前页签不显示**、
 * **没落点时退化成从前那一行**。
 */
import { createContext, useContext, type ReactNode } from "react";

import {
  SlotContent,
  SlotOutlet,
  SlotOutletProvider,
} from "~/components/ui/slot-outlet";

/**
 * 「这一屏现在是当前页签吗」—— 由 `WorkspaceViewStack` 按页签逐个提供。
 *
 * 为什么必须有它：页签的意义是**切走不卸载**（见 `WorkspaceViewStack` 文件头），
 * 于是所有打开过的屏都同时活着、都会把动作送进同一个落点 —— 不过滤就变成
 * 「四屏的按钮挤在顶栏里」。缺省 `true`：不挂壳的渲染路径（`/models`、Storybook、
 * 组件用例）没有页签这回事，按「就是当前屏」处理，行为与从前一致。
 */
const ViewTabActiveContext = createContext(true);

/** 给一个页签内容标上「是不是当前页」。 */
export function ViewTabActiveProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <ViewTabActiveContext.Provider value={active}>
      {children}
    </ViewTabActiveContext.Provider>
  );
}

/** 提供者 —— 挂在 `AppShell` 上（顶栏与所有视图都是它的后代）。 */
export function ViewActionsProvider({ children }: { children: ReactNode }) {
  return <SlotOutletProvider>{children}</SlotOutletProvider>;
}

/**
 * 落点 —— 渲染在 `TopBar` 的右侧控件组里，位置在全局控件（搜索 / 主题 / 消息 /
 * 菜单）**之前**：本屏的动作与「这一屏是什么」挨着读，全局控件始终在最右端，
 * 位置不随视图变。
 */
export function ViewActionsHost() {
  return <SlotOutlet />;
}

/**
 * 视图一侧：把本屏的动作交给顶栏。
 *
 * 没挂落点时（`/models` 独立路由页、Storybook、组件用例）退化成从前那一行
 * —— 右对齐 + 下边距，与交给 `PageHeader` 的 `actions` 时逐像素相同。
 */
export function ViewActions({ children }: { children: ReactNode }) {
  const active = useContext(ViewTabActiveContext);

  return (
    <SlotContent
      fallback={
        /* 非当前页签：屏幕上本来就没它（`hidden`），渲染出来反而会把兄弟屏的
           按钮塞进顶栏 —— 所以这一档是「什么都不渲染」，不是「就地渲染」。 */
        active ? (
          <div
            data-slot="view-actions-inline"
            className="mb-6 flex flex-wrap items-center justify-end gap-2"
          >
            {children}
          </div>
        ) : null
      }
    >
      {active ? children : null}
    </SlotContent>
  );
}
