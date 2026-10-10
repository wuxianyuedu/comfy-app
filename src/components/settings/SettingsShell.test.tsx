/**
 * `SettingsShell` 的三条硬判据。
 *
 * 这一刀改的是**形态**：设置页头部那枚「← 返回」被删掉、分区导航从横排 chip 带
 * 换成左侧一棵竖向的树（ISSUE #1694）。两件事都不会让任何功能断言变红 ——
 * 删掉一个按钮只会让「点得到」的用例少一条，换掉导航布局则什么都不影响。
 * 所以判据直接落在**用户看得见的事实**上：
 *
 *   1. **没有「返回」出口**：设置在本应用里是一页页签，退出交给页签的关闭按钮
 *      与侧栏；多一枚箭头就是第二条退出路径，而它在独立路由 `/settings` 下
 *      还会把用户带回上一页（同一个动作两个入口两种含义）；
 *   2. **分区导航一项不漏、且 `aria-current` 只落在当前项上**：分组表
 *      （`TREE_GROUPS`）是视图里新增的一份映射，它的失效模式是**静默漏项**
 *      （某个分区从导航上消失，而页面还能通过页签 / 快捷键进不去），
 *      所以按 `SETTINGS_SECTIONS` 的 id 集合双向比对，不写字面量清单；
 *   3. **树的两个层级都在**：分组名是父行（不是可点目标），分区项是子行 ——
 *      这正是 ISSUE #1694 的点（横排那张带子上两者平权，读不出层级）。
 *      判据比的是「父行文案集合 == `TREE_GROUPS` 的 label 集合」，而不是数节点个数。
 *
 * 不锁样式类：选中态判的是 `aria-current`（读屏与 CSS 同源的那一个属性），
 * 颜色改了不该让用例红。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SETTINGS_SECTIONS,
  type Section,
} from "~/app/(main)/settings/hooks/use-settings-page";

import { SettingsShell } from "./SettingsShell";
import { TREE_GROUPS } from "./settings-section-summary";

afterEach(cleanup);

function renderShell(section: Section = "llmLocal", onSelect = vi.fn()) {
  render(
    <SettingsShell section={section} onSelect={onSelect}>
      <p>内容</p>
    </SettingsShell>,
  );
  return onSelect;
}

/** 分区导航（一个 `<nav>`，里面每个分组一段）。 */
const nav = () => screen.getByRole("navigation", { name: "设置分区" });

describe("SettingsShell", () => {
  it("不再提供「返回」出口（设置是一页页签，退交给页签与侧栏）", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "返回" })).toBeNull();
  });

  it("分区导航一项不漏、一项不重（按 id 集合双向比对）", () => {
    renderShell();
    const labels = within(nav())
      .getAllByRole("button")
      .map((el) => el.textContent?.trim());
    /* 集合式比对是**刻意**的：分组可以把项排成另一段（「诊断」段就与
       `SETTINGS_SECTIONS` 的自然顺序无关），但**一项都不许丢、一项都不许重**。
       只比集合就够 —— 每个 `<Button>` 的文案唯一对得上一个分区。 */
    const expected = SETTINGS_SECTIONS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect([...labels].sort()).toEqual([...expected].sort());
  });

  it("分组名是父行、分区项是子行（树的两层都在，且父行不可点）", () => {
    renderShell();
    const groupLabels = TREE_GROUPS.map((g) => g.label);
    /* 父行不是按钮 —— 每一段的分组名都不在可点目标里（横排那版把两者排成
       同一种词，这一条正是为了「层级读得出来」而立的）。 */
    const buttonTexts = within(nav())
      .getAllByRole("button")
      .map((el) => el.textContent?.trim() ?? "");
    for (const label of groupLabels) {
      expect(buttonTexts).not.toContain(label);
      expect(nav().textContent).toContain(label);
    }
    /* 每个分组的子行集合都挂在自己的父行下面（树的行与子行绑成一对，
       §16.2.4.39）—— 数一数 `tree-children` 容器等于分组数。 */
    expect(nav().querySelectorAll('[data-slot="tree-children"]').length).toBe(
      groupLabels.length,
    );
  });

  it("当前分区恰好一项带 aria-current，点击把分区交给调用方", async () => {
    const onSelect = renderShell("backup");
    const buttons = within(nav()).getAllByRole("button");
    const current = buttons.filter(
      (el) => el.getAttribute("aria-current") === "true",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("备份与恢复");

    const database = within(nav()).getByRole("button", { name: "数据库" });
    await userEvent.click(database);
    expect(onSelect).toHaveBeenCalledWith("database");
  });
});
