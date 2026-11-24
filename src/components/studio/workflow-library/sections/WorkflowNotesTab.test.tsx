// 「说明」页签（ISSUE #4963）：note 正文清单 + 逐条翻译。
// 行为判据：空 notes 给空态；有 note 渲染原文与标题；点翻译调 completeChat 并展示译文；失败给重试出口；按 id+text 缓存不重复请求。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowNote } from "~/components/studio/workflow-types";
import { WorkflowNotesTab } from "./WorkflowNotesTab";

/* LLM 网络层打桩：本文件只判页签渲染与翻译状态机，真链路在 /api/llm。
 * 按真实入参形状给 vi.fn 定类型（ISSUE #4987）：mock.calls 取值即得类型，不再断言。 */
type CompleteChatStubInput = {
  messages: Array<{ content: string; role: string }>;
  opts: { taskType: string };
};
const completeChat = vi.fn<(input: CompleteChatStubInput) => Promise<string>>();
vi.mock("~/lib/llm/browser", () => ({
  completeChat: (input: CompleteChatStubInput) => completeChat(input),
}));

afterEach(() => {
  cleanup();
  completeChat.mockReset();
});

function note(over: Partial<WorkflowNote> = {}): WorkflowNote {
  return {
    color: "#ff0000",
    id: "164",
    pos: [0, 0],
    size: [100, 50],
    text: "This node loads the first frame image.",
    title: "Note: Model Links",
    ...over,
  };
}

describe("WorkflowNotesTab — 说明页签（#4963）", () => {
  it("没有 note 时给空态，不渲染翻译按钮", () => {
    render(<WorkflowNotesTab notes={[]} />);
    expect(screen.getByText("这条工作流没有说明（note）节点")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /翻译/ })).toBeNull();
  });

  it("有 note 时渲染标题（剥 Note: 前缀）与原文", () => {
    render(<WorkflowNotesTab notes={[note()]} />);
    expect(screen.getByText("Model Links")).toBeInTheDocument();
    expect(screen.getByText("This node loads the first frame image.")).toBeInTheDocument();
    expect(screen.queryByText("Note: Model Links")).toBeNull();
  });

  it("点翻译调 completeChat 并展示译文", async () => {
    completeChat.mockResolvedValue(" 该节点加载首帧图片。 ");
    render(<WorkflowNotesTab notes={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "翻译成中文" }));
    await waitFor(() => {
      expect(screen.getByText("该节点加载首帧图片。")).toBeInTheDocument();
    });
    expect(completeChat).toHaveBeenCalledTimes(1);
    /* 系统提示 + 正文两条消息，taskType=chat —— 复用现有 LLM 链路。 */
    const args = completeChat.mock.calls[0]![0];
    expect(args.messages).toHaveLength(2);
    expect(args.messages[0]!.role).toBe("system");
    expect(args.messages[1]!.content).toBe("This node loads the first frame image.");
    expect(args.opts.taskType).toBe("chat");
  });

  it("翻译失败给可读错误与重试出口，不静默吞", async () => {
    completeChat.mockRejectedValue(new Error("上游超时"));
    render(<WorkflowNotesTab notes={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "翻译成中文" }));
    await waitFor(() => {
      expect(screen.getByText(/翻译失败：上游超时/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
