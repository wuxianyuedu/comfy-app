/**
 * `SettingsShell` 的判据：外观形态 + **一页到底**（ISSUE #1694 / #1722 / #1872）。
 * 钉用户看得见的事实：① 没有「返回」出口；② 分区导航按 id 集合双向比对、一项不漏；
 * ③ 树的两层都在；④ 全部小节在同一根滚动容器里、每节有标题；⑤ 屏名不重复。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS, type Section } from "~/app/(main)/settings/hooks/use-settings-page";
import { isRecord } from "~/lib/is-record";

import { SettingsShell, sectionAnchorId } from "./SettingsShell";
import { SETTINGS_SCROLL_ORDER, TREE_GROUPS } from "./settings-section-summary";

afterEach(cleanup);

/** `Object.fromEntries` 只给到字符串索引 —— 用运行期补全校验收窄成外壳要的完整映射。 */
function isSectionChildren(v: unknown): v is Record<Section, React.ReactNode> {
  return isRecord(v) && SETTINGS_SECTIONS.every((item) => item.id in v);
}

/** 每个分区一段可辨识的正文（判「全量渲染」时按它找）。 */
function sectionsStub(): Record<Section, React.ReactNode> {
  const filled = Object.fromEntries(
    SETTINGS_SECTIONS.map((item) => [item.id, <p key={item.id}>正文-{item.id}</p>]),
  );
  if (!isSectionChildren(filled)) {
    throw new Error("SETTINGS_SECTIONS 未覆盖全部分区");
  }
  return filled;
}

function renderShell(section: Section = "llmLocal", onSelect = vi.fn()) {
  render(<SettingsShell onSelect={onSelect} section={section} sections={sectionsStub()} />);
  return onSelect;
}

/** 给定 `title` 时渲染 —— 复核「可见标题只在屏名没有别的出处时出现」。 */
function renderShellWithTitle(title: string | undefined) {
  render(
    <SettingsShell
      onSelect={vi.fn()}
      section="llmLocal"
      sections={sectionsStub()}
      {...(title === undefined ? {} : { title })}
    />,
  );
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

  it("导航树的展开顺序 = 页面滚动顺序，且恰好覆盖全部小节", () => {
    /* 一页到底之后导航是**目录**：目录的顺序与正文的顺序必须是同一个，否则
       用户按目录往下读、正文却跳到另一处。`SETTINGS_SCROLL_ORDER` 由
       `TREE_GROUPS` 派生，这一条把它与 `SETTINGS_SECTIONS` 对齐（不漏、不重）。 */
    const expected = SETTINGS_SECTIONS.map((item) => item.id);
    expect(new Set(SETTINGS_SCROLL_ORDER).size).toBe(SETTINGS_SCROLL_ORDER.length);
    expect([...SETTINGS_SCROLL_ORDER].sort()).toEqual([...expected].sort());

    /* 文档顺序也真的按它排：逐个读 `<section>` 的 id 与派生根比。 */
    renderShell();
    const domOrder = [...document.querySelectorAll("section[id^=settings-]")].map((el) =>
      el.id.replace(/^settings-/, ""),
    );
    expect(domOrder).toEqual([...SETTINGS_SCROLL_ORDER]);
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
    expect(nav().querySelectorAll('[data-slot="tree-children"]').length).toBe(groupLabels.length);
  });

  it("当前分区恰好一项带 aria-current，点击把分区交给调用方", async () => {
    const onSelect = renderShell("backup");
    const buttons = within(nav()).getAllByRole("button");
    const current = buttons.filter((el) => el.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("备份与恢复");

    const database = within(nav()).getByRole("button", { name: "数据库" });
    await userEvent.click(database);
    expect(onSelect).toHaveBeenCalledWith("database");
  });

  it("全部小节铺在同一页里，每节都有与导航同源的标题", () => {
    renderShell();
    /* 「一页到底」的判据：`SETTINGS_SECTIONS` 里每一节都有一个锚点节在位，
       且这一节里能读到**它自己的名字**（正文标题与导航项同源，都是
       `SETTINGS_SECTIONS` 的 label）。 */
    for (const item of SETTINGS_SECTIONS) {
      const node = document.getElementById(sectionAnchorId(item.id));
      expect(node).not.toBeNull();
      /* 标题是这一节里的 `h2`（区块标题档），不带分组名的干扰。 */
      expect(within(node!).getByRole("heading", { level: 2 })).toHaveTextContent(item.label);
    }
  });

  it("点导航是「滚过去」而不是「换内容」（scrollIntoView 落在那一节上）", async () => {
    /* DOM 档里没有 `scrollIntoView` 的实现 —— 不 stub 会直接抛。 */
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onSelect = renderShell("llmLocal");

    await userEvent.click(within(nav()).getByRole("button", { name: "日志" }));

    const target = document.getElementById(sectionAnchorId("logs"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    /* `this` 是被滚的那一节 —— 用 mock.instances 认它比读参数更直接。 */
    expect(scrollIntoView.mock.instances[0]).toBe(target);
    expect(onSelect).toHaveBeenCalledWith("logs");
  });

  it("跳转载荷：分区节挂好后**瞬时**滚到目标节，并回调消费", () => {
    /* DOM 档里没有 `scrollIntoView` 的实现 —— 不 stub 会直接抛。 */
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onJumpApplied = vi.fn();
    render(
      <SettingsShell
        jumpSection="comfyui"
        onJumpApplied={onJumpApplied}
        onSelect={vi.fn()}
        section="comfyui"
        sections={sectionsStub()}
      />,
    );
    /* 落点用 `behavior: "auto"`（瞬时）：平滑动画期间观察器会先报当前视图里
       那几节，高亮会闪一下再跳到位。 */
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "auto",
    });
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById(sectionAnchorId("comfyui")),
    );
    /* 真的滚过去了 ⇒ 回调消费载荷（容器据此清空一次性载荷）。 */
    expect(onJumpApplied).toHaveBeenCalledTimes(1);
  });

  it("三态外壳没有分区节：滚不过去，也就**不**消费跳转载荷", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onJumpApplied = vi.fn();
    render(
      <SettingsShell
        fallback={<p>正在读取设置…</p>}
        jumpSection="comfyui"
        onJumpApplied={onJumpApplied}
        onSelect={vi.fn()}
        section="comfyui"
      />,
    );
    /* 加载 / 失败壳里没有锚点 ⇒ 载荷先留着，等就绪外壳挂上后再落。 */
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(onJumpApplied).not.toHaveBeenCalled();
  });

  it("页签已在说屏名时不重复可见标题：屏名收进 sr-only（ISSUE #1872）", () => {
    renderShellWithTitle(undefined);
    /* 可见的那一行 `h1`（`.u-title-page`）不在 —— 页签 + 顶栏已经在写「设置」。 */
    expect(document.querySelector("h1.u-title-page")).toBeNull();
    /* 但这一屏仍有且只有一个可跳转的名字（读屏按标题跳转的前提，规范 06）。 */
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveClass("sr-only");
    expect(headings[0]).toHaveTextContent("设置");
    /* 那句副说明（「全部设置在一页里…」）连同这一行一起没了 —— 不重复读一遍
       「左边是目录、右边是一页」，那件事由导航树与唯一一根滚动条自己说。 */
    expect(screen.queryByText(/全部设置在一页里/)).toBeNull();
  });

  it("屏名没有别的出处时给可见标题（独立路由 /settings）", () => {
    renderShellWithTitle("设置");
    const h1 = document.querySelector("h1.u-title-page");
    expect(h1).not.toBeNull();
    expect(h1).toHaveTextContent("设置");
    /* 可见标题在位时不再叠一个 `sr-only` 的 `h1` —— 一屏一个，别两个。 */
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    /* 说明照旧不渲染（与是否有可见标题无关，ISSUE #1872）。 */
    expect(screen.queryByText(/全部设置在一页里/)).toBeNull();
  });

  it("给 fallback 时不渲染分区列表（三态占位只出现一次）", () => {
    render(<SettingsShell fallback={<p>正在读取设置…</p>} onSelect={vi.fn()} section="llmLocal" />);
    /* 导航仍在（外壳这一层照常渲染），右侧换成整块占位 ——
     * 「铺 9 份同样的占位」正是这一条要挡的形态。 */
    expect(nav()).toBeTruthy();
    expect(screen.getAllByText("正在读取设置…")).toHaveLength(1);
    for (const item of SETTINGS_SECTIONS) {
      expect(document.getElementById(sectionAnchorId(item.id))).toBeNull();
    }
  });
});
