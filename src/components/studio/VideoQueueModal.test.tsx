/**
 * `VideoQueueModal` —— 队列只读视图的判据（ISSUE #2169，业主拍板）。
 *
 * 「批量提交」草稿页签整格撤掉：它长在内置模板通路被拆除之前，每条草稿只有
 * 提示词、没有必填的 `workflow`，这条通路**从来没成功过**（生产挂载从不播种
 * 草稿；新视频的唯一真实入口是创作台「视频」模式）。这里钉住撤掉后的形态：
 * 弹窗里**不再有**「批量提交」入口（radiogroup / 草稿行 / 提交按钮都没有），
 * 队列本身照常渲染。
 *
 * 旧的两组用例（批量提交出口的失败通道、队列视图切换的 radiogroup 形态）
 * 随通路一起退役 —— 它们判的对象已经不存在了。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { VideoQueueModal } from "./VideoQueueModal";
import type { VideoTask } from "~/lib/media/video-queue-client";

const fetchVideoTasksMock = vi.fn<() => Promise<VideoTask[]>>(async () => []);
vi.mock("~/lib/media/video-queue-client", () => ({
  fetchVideoTasks: () => fetchVideoTasksMock(),
}));

afterEach(cleanup);

function renderModal() {
  render(<VideoQueueModal open onClose={() => undefined} />);
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
    await waitFor(() => expect(fetchVideoTasksMock).toHaveBeenCalled());
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
    expect(
      await screen.findByText(/在创作台「视频」模式直接生成/),
    ).toBeVisible();
  });
});
