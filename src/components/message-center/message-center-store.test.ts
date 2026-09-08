import { describe, it, expect, beforeEach } from "vitest";
import { useMessageCenterStore } from "./message-center-store";

function reset() {
  useMessageCenterStore.setState({ open: false, messages: [] });
}

beforeEach(reset);

describe("message-center-store 消息中心状态", () => {
  it("初始状态：未打开、无消息", () => {
    const s = useMessageCenterStore.getState();
    expect(s.open).toBe(false);
    expect(s.messages).toEqual([]);
  });

  it("push 新增未读消息并排到最前", () => {
    useMessageCenterStore.getState().push({ kind: "update", title: "A", body: "a" });
    useMessageCenterStore.getState().push({ kind: "restart", title: "B", body: "b" });
    const { messages } = useMessageCenterStore.getState();
    expect(messages).toHaveLength(2);
    // 最新在前
    expect(messages[0]!.title).toBe("B");
    expect(messages[0]!.read).toBe(false);
    expect(messages[0]!.kind).toBe("restart");
    expect(messages[0]!.time).toBeGreaterThan(0);
    expect(messages[0]!.id.length).toBeGreaterThan(0);
  });

  it("toggleOpen / setOpen 控制面板开关", () => {
    const s = useMessageCenterStore.getState();
    s.toggleOpen();
    expect(useMessageCenterStore.getState().open).toBe(true);
    useMessageCenterStore.getState().setOpen(false);
    expect(useMessageCenterStore.getState().open).toBe(false);
  });

  it("markRead 仅将目标消息置为已读", () => {
    useMessageCenterStore.getState().push({ kind: "update", title: "A", body: "a" });
    useMessageCenterStore.getState().push({ kind: "update", title: "B", body: "b" });
    const first = useMessageCenterStore.getState().messages[0]!;
    useMessageCenterStore.getState().markRead(first.id);
    const { messages } = useMessageCenterStore.getState();
    expect(messages.find((m) => m.id === first.id)!.read).toBe(true);
    expect(messages.filter((m) => !m.read)).toHaveLength(1);
  });

  it("markAllRead 全部置为已读", () => {
    useMessageCenterStore.getState().push({ kind: "update", title: "A", body: "a" });
    useMessageCenterStore.getState().push({ kind: "update", title: "B", body: "b" });
    useMessageCenterStore.getState().markAllRead();
    const { messages } = useMessageCenterStore.getState();
    expect(messages.every((m) => m.read)).toBe(true);
  });

  it("remove 删除指定消息", () => {
    useMessageCenterStore.getState().push({ kind: "update", title: "A", body: "a" });
    const first = useMessageCenterStore.getState().messages[0]!;
    useMessageCenterStore.getState().remove(first.id);
    expect(useMessageCenterStore.getState().messages).toHaveLength(0);
  });

  it("clear 清空全部消息", () => {
    useMessageCenterStore.getState().push({ kind: "update", title: "A", body: "a" });
    useMessageCenterStore.getState().push({ kind: "update", title: "B", body: "b" });
    useMessageCenterStore.getState().clear();
    expect(useMessageCenterStore.getState().messages).toEqual([]);
  });
});
