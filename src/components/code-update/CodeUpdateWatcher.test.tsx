// @vitest-environment jsdom
// 容器层的可见行为：陈旧实例发生时，用户**确实收到**一条带「怎么办」的通知，
// 且 toast 与消息中心都拿到同一件事（前者靠一闪而过，后者可回看）。
// 这里只断言对外可见结果，不断言内部 hook 细节（规范 11.2）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { CodeUpdateWatcher } from "./CodeUpdateWatcher";
import { useMessageCenterStore } from "~/components/message-center/message-center-store";
import {
  reportCodeUpdatedSinceLoad,
  reportStaleStoreAction,
  resetStaleStoreNotify,
} from "~/lib/shell/stale-store-notify";

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: toastInfo,
    loading: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
// 观测器本身另有独立用例；这里把它换成空实现，只测「送达」这一段。
vi.mock("./hooks/use-code-update-watch", () => ({
  useCodeUpdateWatch: () => undefined,
}));

beforeEach(() => {
  resetStaleStoreNotify();
  useMessageCenterStore.setState({ open: false, messages: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CodeUpdateWatcher", () => {
  it("陈旧实例发生时，toast 与消息中心各收到一条带「怎么做」的通知", () => {
    render(<CodeUpdateWatcher />);
    reportCodeUpdatedSinceLoad();

    expect(reportStaleStoreAction("missing-store-action")).toBe(true);

    // toast：标题 + 概要，并明确告知「完整步骤在消息中心」
    expect(toastInfo).toHaveBeenCalledTimes(1);
    const [title, summary] = toastInfo.mock.calls[0]! as [string, string];
    expect(title).toContain("重载");
    expect(summary).toContain("消息中心");

    // 消息中心：留底，正文含可照着做的步骤
    const { messages } = useMessageCenterStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.title).toBe(title);
    expect(messages[0]!.body).toContain("怎么做：");
    expect(messages[0]!.read).toBe(false);
  });

  it("没有代码更新时不打扰用户（不弹 toast、不留消息）", () => {
    render(<CodeUpdateWatcher />);

    expect(reportStaleStoreAction("missing-store-action")).toBe(false);
    expect(toastInfo).not.toHaveBeenCalled();
    expect(useMessageCenterStore.getState().messages).toHaveLength(0);
  });
});
