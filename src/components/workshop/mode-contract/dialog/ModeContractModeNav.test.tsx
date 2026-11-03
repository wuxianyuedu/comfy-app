/**
 * `ModeContractModeNav` 的判据：**模式清单收成树形页签**（ISSUE #1870）。形态改坏不会让功能断言变红，判据落在用户看得见的事实上：① 一个模式都不漏
 *（按 `CONTRACT_MODES` 的 code 集合与渲染行**双向比对**，失效模式正是静默漏项）；② 类别父行 + 模式子行两个层级；③ 单选语义（`radiogroup`/`radio`，
 * `aria-checked` 只落在当前模式）；④「已改」标记跟 `storedCustomized` 走；⑤ 每类可折叠（见下）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTRACT_MODES, contractModeTree } from "../mode-contract-config";
import { ModeContractModeNav } from "./ModeContractModeNav";

/** 一个类别（父行）的开关按钮 —— 按 `data-category` 认身份，不按可访问名。 */
function categoryTrigger(category: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${category}`),
  });
}

/** 某类下的模式行（按 `data-mode` 认，`data-category` 是它的容器）。 */
function modesOf(container: HTMLElement, category: string): Array<Element> {
  const slot = container.querySelector(`[data-category="${category}"]`);
  return [...(slot?.closest('[data-slot="disclosure"]')?.querySelectorAll("[data-mode]") ?? [])];
}

afterEach(cleanup);

/** 一个「什么都不选、什么都不标已改」的最小 props（折叠用例只关心类别那一层）。 */
function navProps() {
  return {
    activeMode: null,
    storedCustomized: () => false,
    onSelect: vi.fn(),
  };
}

function renderNav(
  activeMode: string | null = null,
  storedCustomized: (mode: string) => boolean = () => false,
  onSelect = vi.fn(),
) {
  render(
    <ModeContractModeNav
      activeMode={activeMode}
      onSelect={onSelect}
      storedCustomized={storedCustomized}
    />,
  );
  return onSelect;
}

describe("模式导航的树形结构（ISSUE #1870）", () => {
  it("渲染出全部模式，且不重复（按 code 集合双向比对）", () => {
    renderNav();
    const rendered = screen.getAllByRole("radio").map((el) => el.dataset.mode);
    expect(new Set(rendered)).toEqual(new Set(CONTRACT_MODES.map((t) => t.code)));
    expect(rendered.length).toBe(CONTRACT_MODES.length);
  });

  it("每个类别都是一个父行 + 它的子行集合", () => {
    const { container } = render(
      <ModeContractModeNav activeMode={null} onSelect={vi.fn()} storedCustomized={() => false} />,
    );
    const tree = contractModeTree();
    for (const group of tree) {
      /* 父行按类别名可认（它的可读名就在触发按钮里）。 */
      expect(screen.getByText(group.label)).toBeTruthy();
      /* 挂在这一类下的模式数就是 `contractModeTree` 给的那几条 —— 不写字面量。 */
      expect(modesOf(container, group.category).length).toBe(group.modes.length);
    }
    expect(container.querySelectorAll('[data-slot="tree-children"]').length).toBe(tree.length);
  });

  it("当前模式带 aria-checked，其余不带", () => {
    const first = CONTRACT_MODES[0]!;
    renderNav(first.code);
    const active = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(active.map((el) => el.dataset.mode)).toEqual([first.code]);
  });

  it("点一个模式把它的 code 上抛（不自己改选中态）", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const target = CONTRACT_MODES[1]!;
    /* 按 `data-mode` 取行而不是按可访问名：模式中文名互为子串（「图生图」是
       「参考图生图」「图文混合条件生图」的一部分），按名字找会命中多枚。 */
    const { container } = render(
      <ModeContractModeNav activeMode={null} onSelect={onSelect} storedCustomized={() => false} />,
    );
    const row = container.querySelector(`[data-mode="${target.code}"]`);
    expect(row).toBeTruthy();
    /* SAFETY: 类型断言已复核 */
    await user.click(row as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(target.code);
  });

  it("「已改」标记只出现在注册表里改过的模式上", () => {
    const only = CONTRACT_MODES[0]!;
    renderNav(null, (code) => code === only.code);
    const badges = screen.getAllByText("已改");
    expect(badges.length).toBe(1);
    expect(badges[0]!.closest<HTMLElement>("[data-mode]")?.dataset.mode).toBe(only.code);
  });
});

/**
 * 第二刀：**每一类可折叠**。判据落在折叠本身，不锁样式：① 每类都有开关（`aria-expanded` 可变）且默认展开（默认折着等于把当前模式藏起来）；
 * ② 收起一类只动那一类；③ 收起是**折叠**不是**移除**：面板留在 DOM 带 `hidden="until-found"`（保住「浏览器页内查找自动展开命中内容」的语义）。
 */
describe("每个类别可折叠（ISSUE #1870 第二刀）", () => {
  it("默认每个类别都展开（开关 aria-expanded=true）", () => {
    render(<ModeContractModeNav {...navProps()} />);
    for (const group of contractModeTree()) {
      expect(categoryTrigger(group.label).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("点父行收起它，再点展开；另一类不受影响", async () => {
    const user = userEvent.setup();
    const { container } = render(<ModeContractModeNav {...navProps()} />);
    const [first, second] = contractModeTree();
    const firstTrigger = categoryTrigger(first!.label);

    await user.click(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    /* 只动这一类的**开关**：另一类的开关仍是展开，它的模式行也仍在。 */
    expect(categoryTrigger(second!.label).getAttribute("aria-expanded")).toBe("true");
    expect(modesOf(container, second!.category).length).toBe(second!.modes.length);

    await user.click(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("收起后那一摞留在 DOM 里带 hidden=until-found（折叠不是移除）", async () => {
    const user = userEvent.setup();
    const { container } = render(<ModeContractModeNav {...navProps()} />);
    const first = contractModeTree()[0]!;
    const categorySlot = container.querySelector(`[data-category="${first.category}"]`);
    const panel = categorySlot
      ?.closest('[data-slot="disclosure"]')
      ?.querySelector('[data-slot="disclosure-panel"]');

    expect(panel?.getAttribute("hidden")).toBeNull();
    await user.click(categoryTrigger(first.label));
    expect(panel?.getAttribute("hidden")).toBe("until-found");
    /* 子行容器与模式行都还在（折叠，不是条件渲染掉）。 */
    expect(modesOf(container, first.category).length).toBe(first.modes.length);
  });
});
