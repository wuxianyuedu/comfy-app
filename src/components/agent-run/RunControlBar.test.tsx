// RunControlBarView 各状态渲染（Phase 6 · P6-3）：纯展示，喂假 controller 断按钮/文案。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeProductionRun,
  type ProductionRun,
} from "~/lib/production/run-types";
import type { AgentRunController } from "./use-agent-run";
import { RunControlBarView } from "./RunControlBar";

function controller(
  over: Partial<AgentRunController> = {},
): AgentRunController {
  const run = normalizeProductionRun(null);
  return {
    projectId: "proj_1",
    run,
    action: { kind: "idle" },
    busy: false,
    error: "",
    goal: "",
    setGoal: vi.fn(),
    approvalMode: "stage",
    setApprovalMode: vi.fn(),
    autoReview: false,
    setAutoReview: vi.fn(),
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    ...over,
  };
}

function withStatus(status: ProductionRun["status"]): AgentRunController {
  return controller({ run: { ...normalizeProductionRun(null), status } });
}

afterEach(cleanup);

describe("RunControlBarView", () => {
  it("无活跃项目 → 不渲染", () => {
    const { container } = render(
      <RunControlBarView c={controller({ projectId: "" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("idle → 展示启动面板（目标 + 确认粒度 + 启动按钮）", () => {
    render(<RunControlBarView c={withStatus("idle")} />);
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy();
    expect(screen.getByText("AI 自主成片")).toBeTruthy();
  });

  it("idle → 「生图后自动评审」复选框，点选回抛 setAutoReview(true)", () => {
    const setAutoReview = vi.fn();
    render(
      <RunControlBarView
        c={controller({ autoReview: false, setAutoReview })}
      />,
    );
    expect(screen.getByText("生图后自动评审")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(setAutoReview).toHaveBeenCalledWith(true);
  });

  it("running → 暂停 / 取消，并显示下一步", () => {
    render(
      <RunControlBarView
        c={{ ...withStatus("running"), action: { kind: "generate_script" } }}
      />,
    );
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.getByText(/下一步：生成剧本/)).toBeTruthy();
  });

  it("awaiting_approval → 「确认，继续」", () => {
    render(<RunControlBarView c={withStatus("awaiting_approval")} />);
    expect(screen.getByRole("button", { name: "确认，继续" })).toBeTruthy();
  });

  it("paused → 继续 / 取消", () => {
    render(<RunControlBarView c={withStatus("paused")} />);
    expect(screen.getByRole("button", { name: "继续" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  });

  it("failed → 展示原因 + 重新开始", () => {
    render(
      <RunControlBarView
        c={{
          ...withStatus("failed"),
          run: {
            ...normalizeProductionRun(null),
            status: "failed",
            error: "启动失败：配额不足",
          },
        }}
      />,
    );
    expect(screen.getByText("重新开始")).toBeTruthy();
    expect(screen.getByText(/配额不足/)).toBeTruthy();
  });

  it("有执行日志 → 渲染每步（含失败标记）", () => {
    render(
      <RunControlBarView
        c={{
          ...withStatus("running"),
          run: {
            ...normalizeProductionRun(null),
            status: "running",
            log: [
              {
                ts: "2026-01-01T08:00:00.000Z",
                kind: "generate_script",
                ok: true,
                detail: "已生成剧本（1240 字）",
              },
              {
                ts: "2026-01-01T08:00:05.000Z",
                kind: "render_images",
                ok: false,
                detail: "逐镜生图：0 成功 / 1 失败",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("已生成剧本（1240 字）")).toBeTruthy();
    expect(screen.getByText("逐镜生图：0 成功 / 1 失败")).toBeTruthy();
    expect(screen.getByLabelText("执行日志")).toBeTruthy();
  });
});
