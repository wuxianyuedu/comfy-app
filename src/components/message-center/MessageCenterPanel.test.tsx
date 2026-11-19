/**
 * 消息中心的键盘可达性（规范 06 §6.11）+ 按「每一次启动」分组的显示。
 * 键盘这条钉收口前后的差别：`<li onClick>` 时键盘用户没有任何路径标记已读，原生
 * `<Button>` 免费给 Enter/Space。分组这条钉「分隔 + 标出本次」真的渲染出来。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageCenterPanel } from "./MessageCenterPanel";
import { useMessageCenterStore } from "./message-center-store";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

beforeEach(() => {
  useMessageCenterStore.setState({
    open: true,
    messages: [],
    currentRunId: null,
  });
});

describe("MessageCenterPanel 键盘可达性", () => {
  it("消息行是原生按钮：Enter 也能标记已读（不是只有鼠标点得开）", async () => {
    useMessageCenterStore.getState().push({ kind: "info", title: "标题甲", body: "正文甲" });
    const id = useMessageCenterStore.getState().messages[0]!.id;
    render(<MessageCenterPanel />);

    /* 行本身是按钮：可访问名取行内可见文本（标题 + 正文），
     * 所以按 role 取、再用标题过滤，不依赖实现里的 className。 */
    const row = screen.getByRole("button", { name: /标题甲/ });
    row.focus();
    expect(row).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(useMessageCenterStore.getState().messages.find((m) => m.id === id)?.read).toBe(true);
  });

  it("删除按钮是行的兄弟节点（不嵌在行按钮里 → HTML 合法、也各自可 Tab 到）", () => {
    useMessageCenterStore.getState().push({ kind: "info", title: "标题乙", body: "正文乙" });
    render(<MessageCenterPanel />);

    const row = screen.getByRole("button", { name: /标题乙/ });
    const del = screen.getByRole("button", { name: "删除该消息" });

    expect(row.contains(del)).toBe(false);
  });

  it("删除按钮仍能独立触发（从行按钮里拆出来后事件没丢）", async () => {
    useMessageCenterStore.getState().push({ kind: "info", title: "标题丙", body: "正文丙" });
    render(<MessageCenterPanel />);

    await userEvent.click(screen.getByRole("button", { name: "删除该消息" }));

    expect(useMessageCenterStore.getState().messages).toHaveLength(0);
  });
});

describe("MessageCenterPanel 按「每一次启动」分组", () => {
  /** 按顺序推几条（最新在后推的会被排到更前，这里直接用 runId 显式表达批次）。 */
  function pushBatch(runId: string | null, titles: Array<string>) {
    for (const title of titles) {
      useMessageCenterStore.getState().push({ kind: "info", title, body: "b", runId });
    }
  }

  it("两次启动之间有分隔头，且标出哪一组是「本次启动」", () => {
    useMessageCenterStore.setState({ currentRunId: "b2b2b2" });
    /* 先推旧的那一批（此刻它在最前），再推新的——新的会被排到最前。 */
    pushBatch("a1a1a1", ["旧组甲"]);
    pushBatch("b2b2b2", ["新组甲"]);
    render(<MessageCenterPanel />);

    expect(screen.getByText("本次启动")).toBeTruthy();
    expect(screen.getByText("上一次启动")).toBeTruthy();
    /* 分隔头带上启动标识，用户能直接拿去和 log/runs/ 下的目录对号。 */
    expect(screen.getByText("a1a1a1")).toBeTruthy();
    expect(screen.getByText("b2b2b2")).toBeTruthy();
  });

  it("没有消息时不出现任何组头（空态仍是「暂无系统消息」）", () => {
    render(<MessageCenterPanel />);
    expect(screen.queryByText("未标记启动")).toBeNull();
    expect(screen.queryByText("本次启动")).toBeNull();
    expect(screen.getByText("暂无系统消息")).toBeTruthy();
  });

  it("组头带条数（同一次启动里的几条能一眼数出来）", () => {
    useMessageCenterStore.setState({ currentRunId: "b2b2b2" });
    pushBatch("b2b2b2", ["甲", "乙", "丙"]);
    render(<MessageCenterPanel />);
    expect(screen.getByText("· 3 条")).toBeTruthy();
  });

  it("写不出 runId 的消息归「未标记启动」，不并进当前那一组", () => {
    useMessageCenterStore.setState({ currentRunId: "b2b2b2" });
    pushBatch(null, ["老消息"]);
    pushBatch("b2b2b2", ["新消息"]);
    render(<MessageCenterPanel />);

    expect(screen.getByText("本次启动")).toBeTruthy();
    expect(screen.getByText("未标记启动")).toBeTruthy();
  });
});
