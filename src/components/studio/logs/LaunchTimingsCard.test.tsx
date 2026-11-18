import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { LaunchTimingsCard } from "./LaunchTimingsCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const payload = {
  phases: [
    {
      key: "toolchain",
      label: "环境与工具链",
      startMs: 0,
      endMs: 600,
      durationMs: 600,
      percent: 6.7,
    },
    {
      key: "wait-ready",
      label: "等待服务就绪",
      startMs: 700,
      endMs: 8900,
      durationMs: 8200,
      percent: 92.1,
    },
    {
      key: "db-sync",
      label: "后台建表",
      startMs: 700,
      endMs: null,
      durationMs: 800,
      percent: 9,
    },
  ],
  totalMs: 8900,
};

describe("启动耗时分解卡（#4327）", () => {
  it("逐行画出「阶段名 + 秒数 · 占比」，并给合计——替代启动页那条看不清的密彩条", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    render(<LaunchTimingsCard />);
    await waitFor(() => {
      expect(screen.getByText("环境与工具链")).toBeInTheDocument();
    });
    expect(screen.getByText("等待服务就绪").textContent).toBe("等待服务就绪");
    expect(screen.getByText("合计 8.9s").textContent).toBe("合计 8.9s");
    expect(screen.getByText("8.2s · 92.1%").textContent).toBe("8.2s · 92.1%");
  });

  it("进行中的段标注「进行中」", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    render(<LaunchTimingsCard />);
    await waitFor(() => {
      expect(screen.getByText(/（进行中）/)).toBeInTheDocument();
    });
  });

  it("没有读数（接口回 null）整卡不显示，不摆空态", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ phases: null, totalMs: null }), { status: 200 }),
    );
    const { container } = render(<LaunchTimingsCard />);
    await waitFor(() => {
      expect(screen.queryByText("启动耗时分解")).not.toBeInTheDocument();
    });
    expect(container.textContent).toBe("");
  });
});
