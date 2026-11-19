/**
 * `VideoQueueModal` —— 队列只读视图的判据（ISSUE #2169，业主拍板）：「批量提交」草稿页签整格撤掉，
 * 因那条通路（每条草稿只有提示词、没有必填 `workflow`）**从来没成功过**，新视频唯一入口是创作台
 * 「视频」模式。这里钉撤掉后的形态：弹窗里不再有该入口（radiogroup / 草稿行 / 提交按钮都没有），队列照常渲染。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { VideoQueueModal } from "./VideoQueueModal";
import type { VideoTask } from "~/lib/media/video-queue-client";

const fetchVideoTasksMock = vi.fn<() => Promise<Array<VideoTask>>>(() => Promise.resolve([]));
vi.mock("~/lib/media/video-queue-client", () => ({
  fetchVideoTasks: () => fetchVideoTasksMock(),
}));

afterEach(cleanup);

function renderModal() {
  render(<VideoQueueModal onClose={() => undefined} open />);
}

const oneTask: VideoTask = {
  id: "t1",
  status: "SUCCEEDED",
  prompt: "让镜头慢慢推进",
  workflowName: "t2v-animated",
  video: null,
  error: null,
};

describe("VideoQueueModal：队列只读视图（批量提交已整格撤掉，#2169）", () => {
  it("弹窗里不再有「批量提交」入口 —— 无 radiogroup、无草稿行、无提交按钮", async () => {
    renderModal();
    // 等首轮加载落地，避免「还没渲染完」被误读成「不存在」。
    await expect.poll(() => fetchVideoTasksMock.mock.calls.length).toBeGreaterThan(0);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio", { name: /批量提交/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /开始生成/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /添加一行/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /导入/ })).toBeNull();
  });

  it("队列任务照常渲染（只读视图本身不受撤页签影响）", async () => {
    fetchVideoTasksMock.mockResolvedValueOnce([oneTask]);
    renderModal();
    expect(await screen.findByText("让镜头慢慢推进")).toBeVisible();
    expect(screen.getByText("t2v-animated")).toBeVisible();
    // 详情入口还在（打开片段详情是本弹窗的另一半职责）。
    expect(screen.getByRole("button", { name: "详情" })).toBeVisible();
  });

  it("空队列的指引指向创作台（新视频的入口在那里，不在本弹窗）", async () => {
    renderModal();
    expect(await screen.findByText(/在创作台「视频」模式直接生成/)).toBeVisible();
  });
});
