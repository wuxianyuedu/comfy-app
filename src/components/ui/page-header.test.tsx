// 屏级页头的形状判据（规范 11.2：断言读者看得见的结构，不测内部实现细节）。
//
// 收口这件事的收益全在「各屏不许再各写一套」上，所以用例守的是**收口本身**：
//   · 标题必须走 `.u-title-page` 字阶档（P83 管住的那条，这里从 DOM 侧再钉一次）；
//   · **不传 `description` 就不渲染第二行** —— 这是 ISSUE #1423 那条「标题区过大」
//     在代码里的落点：同一件事写两个名字时，其中一个必然以副说明的形式存在；
//   · 标题右侧的补充文本与动作组各自的位置（动作组不收缩、标题可截断）；
//   · `as` 换标签名时仍是同一个结构（不因换标签丢字阶档）。
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PageHeader } from "./page-header";

afterEach(() => {
  cleanup();
});

describe("PageHeader（屏级页头）", () => {
  it("标题走屏级字阶档，且默认是 h1（每屏唯一、读屏按标题跳转）", () => {
    render(<PageHeader title="控制台" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("控制台");
    expect(heading.className).toContain("u-title-page");
  });

  it("不传 description 时不渲染副说明行（标题区不占第二行）", () => {
    const { container } = render(<PageHeader title="资源库" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("传了 description 时它走已定档的那一句（text-sm + text-ink-muted）", () => {
    render(<PageHeader description="所有生成任务与执行日志，按时间倒序排列。" title="历史记录" />);
    const line = screen.getByText("所有生成任务与执行日志，按时间倒序排列。");
    expect(line.tagName).toBe("P");
    expect(line.className).toContain("text-sm");
    expect(line.className).toContain("text-ink-muted");
  });

  it("动作组整组不收缩；同时它缺席时页头不渲染空壳容器", () => {
    const { container } = render(
      <PageHeader actions={<button type="button">刷新</button>} title="队列" />,
    );
    const header = container.querySelector<HTMLElement>('[data-component="page-header"]');
    const group = /* SAFETY: 类型断言已复核 */ header?.lastElementChild as HTMLElement;
    expect(group.className).toContain("shrink-0");
    expect(header?.children).toHaveLength(2);

    cleanup();
    const bare = render(<PageHeader title="队列" />);
    expect(
      bare.container.querySelector<HTMLElement>('[data-component="page-header"]')?.children,
    ).toHaveLength(1);
  });

  it("as 换标签名时字阶档不丢（标题是数据、屏级 h1 在别处的落点）", () => {
    render(<PageHeader as="p" title="雾中来信" />);
    const title = screen.getByText("雾中来信");
    expect(title.tagName).toBe("P");
    expect(title.className).toContain("u-title-page");
  });

  it("titleSuffix 与标题同基线，且它是补充文本不是第二个标题", () => {
    render(<PageHeader title="雾中来信" titleSuffix="· 视频成片工作室" />);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("· 视频成片工作室")).toBeTruthy();
  });

  /* ── 页签已经在说屏名时（ISSUE #1693）───────────────────────────────── */

  it("不传 title 时屏名不占视觉空间，但 h1 仍在（`sr-only`，读屏跳转的前提）", () => {
    const { container } = render(<PageHeader srTitle="队列" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("队列");
    /* 「不占空间」的判据是 `sr-only` —— 它把元素移出可视流。
       写成 `hidden` 反而会连读屏一起藏掉，那是另一个东西。 */
    expect(heading.className).toContain("sr-only");
    /* 不做成 `u-title-page` 的可见档：那一档是给看得见的标题用的。 */
    expect(heading.className).not.toContain("u-title-page");
    /* 左侧那一列（标题 + 副说明 + extra）整块不渲染 —— 页头里只剩那一个
       `sr-only` 的 `h1`，没有任何占位的空壳容器。 */
    const header = container.querySelector<HTMLElement>('[data-component="page-header"]');
    expect(header?.children).toHaveLength(1);
    expect(header?.firstElementChild?.tagName).toBe("H1");
  });

  it("没有可见标题时说明钮并进右侧动作组（不孤零零贴在页头最左边）", () => {
    const { container } = render(
      <PageHeader
        actions={<button type="button">刷新</button>}
        help="每 2 秒读一次本机后端。"
        srTitle="队列"
      />,
    );
    const header = container.querySelector<HTMLElement>('[data-component="page-header"]');
    /* 两个子元素：`sr-only` 的 h1 + 动作组（说明钮在动作组里）。 */
    expect(header?.children).toHaveLength(2);
    const group = /* SAFETY: 类型断言已复核 */ header?.lastElementChild as HTMLElement;
    expect(group.className).toContain("ml-auto");
    expect(group.contains(screen.getByRole("button", { name: "说明" }))).toBe(true);
  });

  it("有可见标题时说明钮跟着标题走（读者在「这屏叫什么」处顺路看见它）", () => {
    const { container } = render(<PageHeader help="每 2 秒读一次本机后端。" title="队列" />);
    const header = container.querySelector<HTMLElement>('[data-component="page-header"]');
    /* 只有一个子元素（标题那一列），说明钮在它里面。 */
    expect(header?.children).toHaveLength(1);
    const column = /* SAFETY: 类型断言已复核 */ header?.firstElementChild as HTMLElement;
    expect(column.contains(screen.getByRole("button", { name: "说明" }))).toBe(true);
  });

  it("省略 title 时不传 srTitle，就真的一个 h1 都没有（不凭空造标题）", () => {
    render(<PageHeader actions={<button type="button">刷新</button>} />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("`help` 把那句解释收成悬浮按钮，不占标题区那一行", () => {
    const { container } = render(<PageHeader help="每 2 秒读一次本机后端。" srTitle="队列" />);
    /* 正文里没有常驻的那一行 —— 这正是 ISSUE #1693 要的「说明的直接显示也去掉」。 */
    expect(container.querySelectorAll("p")).toHaveLength(0);
    const trigger = screen.getByRole("button", { name: "说明" });
    expect(trigger.dataset.slot).toBe("tooltip-trigger");
  });

  it("`description` 常驻优先：同时传时不渲染悬浮按钮（同一句话不说两遍）", () => {
    render(
      <PageHeader
        description="所有生成任务与执行日志，按时间倒序排列。"
        help="所有生成任务与执行日志，按时间倒序排列。"
        title="历史"
      />,
    );
    expect(screen.queryByRole("button", { name: "说明" })).toBeNull();
    /* 那句话只在常驻那一行出现一次（浮层内容未展开时不落 DOM）。 */
    expect(screen.getAllByText("所有生成任务与执行日志，按时间倒序排列。")).toHaveLength(1);
  });
});
