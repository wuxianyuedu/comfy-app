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
    render(
      <PageHeader
        title="历史记录"
        description="所有生成任务与执行日志，按时间倒序排列。"
      />,
    );
    const line = screen.getByText("所有生成任务与执行日志，按时间倒序排列。");
    expect(line.tagName).toBe("P");
    expect(line.className).toContain("text-sm");
    expect(line.className).toContain("text-ink-muted");
  });

  it("动作组整组不收缩；同时它缺席时页头不渲染空壳容器", () => {
    const { container } = render(
      <PageHeader title="队列" actions={<button type="button">刷新</button>} />,
    );
    const header = container.querySelector<HTMLElement>(
      '[data-component="page-header"]',
    );
    const group = header?.lastElementChild as HTMLElement;
    expect(group.className).toContain("shrink-0");
    expect(header?.children).toHaveLength(2);

    cleanup();
    const bare = render(<PageHeader title="队列" />);
    expect(
      bare.container.querySelector<HTMLElement>(
        '[data-component="page-header"]',
      )?.children,
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
});
