/**
 * ScriptMarkdownEditor 的渲染期成本契约（#4341）：预览关闭时每个按键**不得**再跑
 * 全量 markdown 管线——`markdownToHtml` 只在预览开着时才计算（`showPreview` 进
 * memo 依赖）；页脚「N 行 · M 字符」统计收敛进 memo 后读数仍是可见行为（随输入
 * 更新）。管线用 mock 换掉：计数是判据，真实解析成本不在用例的量程里。
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { markdownToHtmlMock } = vi.hoisted(() => ({
  markdownToHtmlMock: vi.fn((value: string) => `<p>${value}</p>`),
}));

vi.mock("~/lib/markdown", () => ({
  markdownToHtml: markdownToHtmlMock,
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
});

afterEach(() => {
  cleanup();
});

describe("ScriptMarkdownEditor 渲染期成本（#4341）", () => {
  it("预览关闭时每个按键都不跑 markdown 管线（此前每键全量 parse+sanitize）", async () => {
    const user = userEvent.setup();
    render(<Harness initial={INITIAL} />);
    expect(markdownToHtmlMock).not.toHaveBeenCalled();

    const editor = screen.getByRole("textbox");
    await user.type(editor, "!");
    expect(markdownToHtmlMock, "预览关着，value 变化也不得解析").not.toHaveBeenCalled();

    // 打开预览才真正计算一次（value 未变，showPreview 进依赖触发重算），
    // 且拿到的是**最新**的 value。
    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(markdownToHtmlMock).toHaveBeenCalledTimes(1);
    expect(markdownToHtmlMock).toHaveBeenCalledWith(`${INITIAL}!`);
  });

  it("关掉预览后继续打字仍不跑管线；页脚统计随输入更新", async () => {
    const user = userEvent.setup();
    render(<Harness initial={INITIAL} />);
    expect(screen.getByText("3 行 · 15 字符")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(markdownToHtmlMock).toHaveBeenCalledTimes(1);

    const editor = screen.getByRole("textbox");
    await user.type(editor, "x");
    expect(markdownToHtmlMock, "回到编辑态后继续打字不解析").toHaveBeenCalledTimes(1);
    expect(screen.getByText("3 行 · 16 字符")).toBeInTheDocument();
  });
});
