/** 活动流视图（ISSUE #5208）：展示保存事件；无项目时不渲染。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ fetchProjectActivity: vi.fn() }));
vi.mock("~/lib/production/activity-client", () => ({
  fetchProjectActivity: mocks.fetchProjectActivity,
}));

import { ProjectActivityPanel } from "./ProjectActivityPanel";

afterEach(cleanup);

describe("ProjectActivityPanel", () => {
  it("无项目不渲染；有项目显示保存事件时间", async () => {
    const { container, rerender } = render(<ProjectActivityPanel />);
    expect(container.firstChild).toBeNull();

    mocks.fetchProjectActivity.mockResolvedValue([
      {
        event: "project_content_saved",
        id: "a1",
        createdAt: "2026-11-27T10:00:00.000Z",
        source: "d-win",
      },
    ]);
    rerender(<ProjectActivityPanel projectId="proj_1" />);
    expect(await screen.findByText("保存了剧本 / 角色 / 分镜")).toBeTruthy();
    expect(screen.getByText("2026-11-27 10:00")).toBeTruthy();
    expect(screen.getByText("来源 d-win")).toBeTruthy();
  });
});
