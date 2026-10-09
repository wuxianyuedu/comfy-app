/**
 * 消息中心的键盘可达性（规范 06 §6.11）。
 *
 * 这条用例钉的是**收口前后的差别**：整行「点一下标记已读」此前是 `<li onClick>`，
 * 键盘用户能 Tab 到行内的删除按钮，却**没有任何路径**标记已读 —— 鼠标点得开、
 * 键盘进不来。收口改成原生 `<Button>` 后，Enter/Space 与焦点语义是免费给的。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageCenterPanel } from "./MessageCenterPanel";
import { useMessageCenterStore } from "./message-center-store";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

beforeEach(() => {
  useMessageCenterStore.setState({ open: true, messages: [] });
});

describe("MessageCenterPanel 键盘可达性", () => {
  it("消息行是原生按钮：Enter 也能标记已读（不是只有鼠标点得开）", async () => {
    useMessageCenterStore
      .getState()
      .push({ kind: "info", title: "标题甲", body: "正文甲" });
    const id = useMessageCenterStore.getState().messages[0]!.id;
    render(<MessageCenterPanel />);

    /* 行本身是按钮：可访问名取行内可见文本（标题 + 正文），
     * 所以按 role 取、再用标题过滤，不依赖实现里的 className。 */
    const row = screen.getByRole("button", { name: /标题甲/ });
    row.focus();
    expect(row).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(
      useMessageCenterStore.getState().messages.find((m) => m.id === id)?.read,
    ).toBe(true);
  });

  it("删除按钮是行的兄弟节点（不嵌在行按钮里 → HTML 合法、也各自可 Tab 到）", () => {
    useMessageCenterStore
      .getState()
      .push({ kind: "info", title: "标题乙", body: "正文乙" });
    render(<MessageCenterPanel />);

    const row = screen.getByRole("button", { name: /标题乙/ });
    const del = screen.getByRole("button", { name: "删除该消息" });

    expect(row.contains(del)).toBe(false);
  });

  it("删除按钮仍能独立触发（从行按钮里拆出来后事件没丢）", async () => {
    useMessageCenterStore
      .getState()
      .push({ kind: "info", title: "标题丙", body: "正文丙" });
    render(<MessageCenterPanel />);

    await userEvent.click(screen.getByRole("button", { name: "删除该消息" }));

    expect(useMessageCenterStore.getState().messages).toHaveLength(0);
  });
});
