/**
 * ScriptMarkdownEditor 的渲染期成本契约（#4341 + #4384）：预览关闭时**不得**跑
 * 全量 markdown 管线——`showPreview` 同时是 `useMarkdownHtml` 的输入闸（空串
 * 早退）；预览开着才经按需渲染地基**动态加载**渲染器并计算。管线用 mock 换掉：
 * 计数是判据，真实解析成本不在用例的量程里。#4384 起加载是异步的——断言用
 * `waitFor` 等到（这正是该单拍板接受的交互差异：预览首开一拍异步出画）。
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { markdownToHtmlMock, loadRendererMock } = vi.hoisted(() => ({
  markdownToHtmlMock: vi.fn((value: string) => `<p>${value}</p>`),
  loadRendererMock: vi.fn(async () => ({ markdownToHtml: markdownToHtmlMock })),
}));

vi.mock("~/lib/markdown", () => ({
  loadMarkdownRenderer: loadRendererMock,
}));

import { ScriptMarkdownEditor } from "./ScriptMarkdownEditor";

/** 受控宿主：真实用法里 value 由父组件持有（onChange 回写 state）。 */
function Harness({ initial }: { initial: string }) {
  const [value, setValue] = React.useState(initial);
  return <ScriptMarkdownEditor onChange={setValue} value={value} />;
}

/** 三行非空行；`trim().length = 15`（trim 只去首尾，中间的换行计入字符数）。 */
const INITIAL = "# 标题\n\n正文行1\n正文行2";

beforeEach(() => {
  markdownToHtmlMock.mockClear();
  loadRendererMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ScriptMarkdownEditor 渲染期成本（#4341 / #4384）", () => {
  it("预览关闭时每个按键都不跑 markdown 管线；打开预览才动态加载并计算一次", async () => {
    const user = userEvent.setup();
    render(<Harness initial={INITIAL} />);
    expect(markdownToHtmlMock).not.toHaveBeenCalled();
    expect(loadRendererMock).not.toHaveBeenCalled();

    const editor = screen.getByRole("textbox");
    await user.type(editor, "!");
    expect(markdownToHtmlMock, "预览关着，value 变化也不得解析").not.toHaveBeenCalled();
    expect(loadRendererMock, "渲染器也不该被加载").not.toHaveBeenCalled();

    // 打开预览才动态加载渲染器并计算一次，且拿到的是**最新**的 value
    //（#4384：加载异步，断言等它落地）。
    await user.click(screen.getByRole("button", { name: "预览" }));
    await waitFor(() => {
      expect(markdownToHtmlMock).toHaveBeenCalledTimes(1);
    });
    expect(markdownToHtmlMock).toHaveBeenCalledWith(`${INITIAL}!`);
  });

  it("关掉预览后继续打字仍不跑管线；页脚统计随输入更新", async () => {
    const user = userEvent.setup();
    render(<Harness initial={INITIAL} />);
    expect(screen.getByText("3 行 · 15 字符")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览" }));
    await waitFor(() => {
      expect(markdownToHtmlMock).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(markdownToHtmlMock).toHaveBeenCalledTimes(1);

    const editor = screen.getByRole("textbox");
    await user.type(editor, "x");
    expect(markdownToHtmlMock, "回到编辑态后继续打字不解析").toHaveBeenCalledTimes(1);
    expect(loadRendererMock, "关着预览不再加载渲染器").toHaveBeenCalledTimes(1);
    expect(screen.getByText("3 行 · 16 字符")).toBeInTheDocument();
  });
});
