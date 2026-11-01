/**
 * `ui/tabs` 的交互契约与命名钩子。
 *
 * 这份封装此前**没有同名用例**（`docs/DESIGN.md` 的 Known Gaps 记的就是这一格：
 * 故事面全覆盖，但故事不比断言）。它本身只是薄封装，所以这里钉的三件事都不是
 * 「base-ui 会不会动」，而是**这个仓库依赖的东西**：
 *
 * 1. **`data-slot` / `data-orientation` / `data-variant` 四个名字与两根轴在位** ——
 *    下游全靠它们找元素：`globals.css` 末尾的 `prefers-reduced-motion` 降级块按
 *    `data-slot` 选浮层，样式里那一串 `group-data-[variant=*]/tabs-list` 与
 *    `group-data-vertical/tabs:*` 按另两根轴分叉。名字改一个字，样式与降级同时
 *    静默失效（界面上「还在」，只是不再响应）。
 * 2. **键盘换页签**（方向键 + Home/End）—— 页签是 `role="tab"` 的**非原生交互元素**，
 *    鼠标能点不等于键盘能用；这条也是规范 06 的 roving tabindex 口径。
 * 3. **两档形态互斥**：`default` 出药丸底、`line` 必须透明底（否则详情页顶部那条
 *    「线」会骑在一颗灰胶囊上）。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/* 卸载由 `tests/setup.ts` 里的全局 `afterEach(cleanup)` 负责（它是幂等的），
   这里不再自己写一份清理 —— 同一件事两个来源正是规范 §11.17.1.2 那条「冗余」的同族。 */

function Demo({
  initialValue = "params",
  onValueChange,
  variant = "default",
  orientation,
}: {
  initialValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  variant?: "default" | "line";
}) {
  return (
    <Tabs defaultValue={initialValue} onValueChange={onValueChange} orientation={orientation}>
      <TabsList variant={variant}>
        <TabsTrigger value="params">参数</TabsTrigger>
        <TabsTrigger value="nodes">节点</TabsTrigger>
        <TabsTrigger value="history">历史</TabsTrigger>
      </TabsList>
      <TabsContent value="params">参数区</TabsContent>
      <TabsContent value="nodes">节点区</TabsContent>
      <TabsContent value="history">历史区</TabsContent>
    </Tabs>
  );
}

/** 取页签列表容器（`role="tablist"`）上的那个 `data-slot="tabs-list"` 元素。 */
function listEl(): HTMLElement {
  const list = screen.getByRole("tablist");
  expect(list.dataset.slot).toBe("tabs-list");
  return list;
}

describe("ui/tabs 的命名钩子", () => {
  it("四个 data-slot 与两根轴都在位（下游样式与 reduced-motion 降级块按名字找元素）", () => {
    render(<Demo orientation="vertical" variant="line" />);

    const root = document.querySelector<HTMLElement>('[data-slot="tabs"]')!;
    const list = listEl();
    const triggers = screen.getAllByRole("tab");
    const panels = document.querySelectorAll('[data-slot="tabs-content"]');

    expect(root.dataset.orientation).toBe("vertical");
    expect(list.dataset.variant).toBe("line");
    /* 三枚页签都在 list 里：`has-data-[icon=inline-end]`、
       `group-data-vertical/tabs:w-full` 那一串选择器都以「页签是 list 的直接子级」
       为前提，包一层就全丢。 */
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger.dataset.slot).toBe("tabs-trigger");
      expect(trigger.parentElement).toBe(list);
    }
    /* ⚠️ 实测只有**选中项**那一块面板在 DOM 里（base-ui 1.8 默认卸载非活动面板）。
       所以这里钉的是「在位的那块必须挂 root、带对的 data-slot」，而不是数到 3 ——
       数到 3 会把它误写成「三块常驻」，而面板常驻与否直接影响调用处能不能把
       表单状态放在面板里（卸载即丢）。切换后在位的那块跟着换，见下面那条用例。 */
    expect(panels).toHaveLength(1);
    /* SAFETY: 类型断言已复核 */
    const panel = panels[0] as HTMLElement;
    expect(panel.parentElement).toBe(root);
    expect(panel.textContent).toContain("参数区");
  });

  it("只有选中项的面板在 DOM 里，切换后在位的那块跟着换（卸载非活动面板是现状）", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    /* `selected` 这个选项在 `role="tabpanel"` 上不适用（aria-selected 不属于 panel），
       面板的「在位」本身就等于它是选中项的面板。 */
    expect(screen.getByRole("tabpanel", { name: "参数" })).toBeInTheDocument();
    expect(screen.queryByText("节点区")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "节点" }));
    expect(screen.getByText("节点区")).toBeInTheDocument();
    expect(screen.queryByText("参数区")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="tabs-content"]')).toHaveLength(1);
  });

  it(`orientation 不传时默认 horizontal（\`group-data-horizontal/tabs:h-8\` 只在横向成立）`, () => {
    render(<Demo />);
    expect(document.querySelector<HTMLElement>('[data-slot="tabs"]')?.dataset.orientation).toBe(
      "horizontal",
    );
  });

  it("两档形态互斥：default 出药丸底，line 必须透明底且带下划线那条 after", () => {
    const { unmount } = render(<Demo />);
    expect(listEl().className).toContain("bg-muted");
    expect(listEl().className).not.toContain("bg-transparent");
    unmount();

    render(<Demo variant="line" />);
    const lineList = listEl();
    expect(lineList.className).toContain("bg-transparent");
    expect(lineList.className).not.toContain("bg-muted");
    /* 下划线只在「当前项」上出现：它靠 `group-data-[variant=line]/tabs-list:data-active:after:opacity-100`
       取胜，所以标记必须同时存在于页签自身那一串类里。 */
    const selected = screen.getByRole("tab", { selected: true });
    expect(selected.className).toContain(
      "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
    );
  });
});

describe("ui/tabs 的键盘换页签", () => {
  /**
   * 实测出来的口径（base-ui 1.8，本仓不传任何 activation 类 prop）：
   * **方向键只移动焦点、不换选中，选中要 Enter**（Space 实测不接管）—— 即 ARIA 的
   * manual activation。这条值得钉，因为它对用户的表现是「方向键按了没反应」，
   * 只有鼠标与键盘不对称；哪天有人把「自动激活」加回来（或基元升版改了默认），
   * 这条会红，而那是一次**需要签字的交互变化**，不是顺手的小优化。
   */
  it("方向键只移动焦点：选中与面板都不跟着换", async () => {
    const user = userEvent.setup();
    render(<Demo />);

    const params = screen.getByRole("tab", { name: "参数" });
    const nodes = screen.getByRole("tab", { name: "节点" });
    await user.click(params);
    expect(params).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(nodes).toHaveFocus();
    expect(nodes).toHaveAttribute("aria-selected", "false");
    expect(params).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("参数区")).toBeVisible();
  });

  it("Enter 把焦点项变成选中项，面板跟着换；Home / End 在首尾之间跳焦点", async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole("tab", { name: "参数" }));
    await user.keyboard("{ArrowRight}{Enter}");
    const nodes = screen.getByRole("tab", { name: "节点" });
    expect(nodes).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("节点区")).toBeInTheDocument();

    await user.keyboard("{End}");
    const history = screen.getByRole("tab", { name: "历史" });
    expect(history).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(history).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("历史区")).toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "参数" })).toHaveFocus();
  });

  it("鼠标点击是直接选中（与键盘的 manual activation 不对称，这是现状）", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getByRole("tab", { name: "历史" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("历史区")).toBeVisible();
  });

  it("非原生元素要有键等价物：tabIndex 只在选中项上是 0，其余 -1 仍可 Tab 进列表", async () => {
    /* 规范 06 §6.11 那一族的正面形态：`role="tab"` 不是原生 button，
       键路径必须由基元接上，否则鼠标能用而键盘不能。 */
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.getByRole("tab", { name: "参数" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "节点" })).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(screen.getByRole("tab", { name: "参数" })).toHaveFocus();
  });

  it("受控用法：点击只回传，面板由 value 决定（组件自己不换）", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Tabs onValueChange={onValueChange} value="params">
        <TabsList>
          <TabsTrigger value="params">参数</TabsTrigger>
          <TabsTrigger value="nodes">节点</TabsTrigger>
        </TabsList>
        <TabsContent value="params">参数区</TabsContent>
        <TabsContent value="nodes">节点区</TabsContent>
      </Tabs>,
    );

    await user.click(screen.getByRole("tab", { name: "节点" }));
    /* 第二个实参是基元的事件细节（含 activationDirection / reason），
       断言只钉第一个实参 —— 形状归基元，「回传的是哪个值」归本仓。 */
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe("nodes");
    /* 没人改 `value`，所以内容不换 —— 这是「受控」这个词在这里的全部含义。 */
    expect(screen.getByRole("tab", { name: "参数" })).toHaveAttribute("aria-selected", "true");
  });
});
