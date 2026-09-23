// @vitest-environment jsdom
// RunControlBarView 各状态渲染（Phase 6 · P6-3）：纯展示，喂假 controller 断按钮/文案。
import { cleanup, render, screen } from "@testing-library/react";
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
});
