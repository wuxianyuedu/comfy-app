/**
 * `ModeContractModeNav` 的判据：**模式清单收成树形页签**（ISSUE #1870）。
 *
 * 这一刀改的是**形态** —— 平铺的 chip 带换成「父行 = 输出类别 + 子行 = 模式」的
 * 竖向树。形态改坏不会让任何功能断言变红，所以判据落在用户看得见的事实上：
 *
 *   1. **一个模式都不漏**：按 `CONTRACT_MODES` 的 code 集合与渲染出的单选行
 *      **双向比对**（不写字面量清单）—— 分组表是视图里新增的一份映射，它的失效
 *      模式正是**静默漏项**（某个模式从导航上消失，而其它地方都不会说）；
 *   2. **两个层级都在**：类别是父行（不可点，`aria-hidden`），模式是可点的子行
 *      —— 这正是「树形」相对「一排 chip」的差别（chip 带上两者平权、读不出层级）；
 *   3. **单选语义**：`role="radiogroup"` / `role="radio"`，`aria-checked` 只落在
 *      当前模式上，点一枚把它的 code 上抛；
 *   4. **「已改」标记**跟着 `storedCustomized` 走（注册表里有该模式才出现）。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTRACT_MODES, contractModeTree } from "../mode-contract-config";
import { ModeContractModeNav } from "./ModeContractModeNav";

afterEach(cleanup);

function renderNav(
  activeMode: string | null = null,
  storedCustomized: (mode: string) => boolean = () => false,
  onSelect = vi.fn(),
) {
  render(
    <ModeContractModeNav
      activeMode={activeMode}
      storedCustomized={storedCustomized}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe("模式导航的树形结构（ISSUE #1870）", () => {
  it("渲染出全部模式，且不重复（按 code 集合双向比对）", () => {
    renderNav();
    const rendered = screen
      .getAllByRole("radio")
      .map((el) => el.getAttribute("data-mode"));
    expect(new Set(rendered)).toEqual(
      new Set(CONTRACT_MODES.map((t) => t.code)),
    );
    expect(rendered.length).toBe(CONTRACT_MODES.length);
  });

  it("每个类别都是一个父行 + 它的子行集合（父行不可点）", () => {
    const { container } = render(
      <ModeContractModeNav
        activeMode={null}
        storedCustomized={() => false}
        onSelect={vi.fn()}
      />,
    );
    const tree = contractModeTree();
    /* 父行的可读名不进可访问树（`aria-hidden`）—— 它只回答「这几项属于一类」，
       不是导航目标；模式的归属由子行自己的位置表达。 */
    for (const group of tree) {
      expect(within(container).getByText(group.label)).toBeTruthy();
    }
    expect(
      container.querySelectorAll('[data-slot="tree-children"]').length,
    ).toBe(tree.length);
  });

  it("当前模式带 aria-checked，其余不带", () => {
    const first = CONTRACT_MODES[0]!;
    renderNav(first.code);
    const active = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(active.map((el) => el.getAttribute("data-mode"))).toEqual([
      first.code,
    ]);
  });

  it("点一个模式把它的 code 上抛（不自己改选中态）", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const target = CONTRACT_MODES[1]!;
    /* 按 `data-mode` 取行而不是按可访问名：模式中文名互为子串（「图生图」是
       「参考图生图」「图文混合条件生图」的一部分），按名字找会命中多枚。 */
    const { container } = render(
      <ModeContractModeNav
        activeMode={null}
        storedCustomized={() => false}
        onSelect={onSelect}
      />,
    );
    const row = container.querySelector(`[data-mode="${target.code}"]`);
    expect(row).toBeTruthy();
    await user.click(row as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(target.code);
  });

  it("「已改」标记只出现在注册表里改过的模式上", () => {
    const only = CONTRACT_MODES[0]!;
    renderNav(null, (code) => code === only.code);
    const badges = screen.getAllByText("已改");
    expect(badges.length).toBe(1);
    expect(badges[0]!.closest("[data-mode]")?.getAttribute("data-mode")).toBe(
      only.code,
    );
  });
});
