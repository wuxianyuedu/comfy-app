import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ModelTestRunHistory } from "./ModelTestRunHistory";
import type { ModelTestRun } from "./model-test-runs";
import { formatClock } from "~/lib/time-format";

/* 计数桩：判「时刻走统一出口」+「同一组 props 重渲染不重复格式化」。 */
const clockMock = vi.hoisted(() => vi.fn((value: number) => `T${String(value)}`));
vi.mock("~/lib/time-format", () => ({ formatClock: clockMock }));

const run = (
  id: string,
  prompt: string,
  status: ModelTestRun["status"] = "succeeded",
): ModelTestRun => ({
  durationMs: 1250,
  endpoint: "http://127.0.0.1:11434/v1/chat/completions",
  error: status === "failed" ? "429 rate limit" : null,
  id,
  kind: "chat",
  mode: "CHAT",
  model: "qwen3-8b",
  result: status === "succeeded" ? { kind: "chat", text: "pong" } : null,
  referenceImages: [],
  sessionKey: "chat::CHAT::qwen3-8b",
  startedAt: 1_700_000_000_000,
  status,
  values: { prompt, seed: "42" },
});

afterEach(cleanup);

describe("ModelTestRunHistory", () => {
  it("没有运行记录时不渲染空面板", () => {
    render(
      <ModelTestRunHistory generating={false} onClear={vi.fn()} onRetry={vi.fn()} runs={[]} />,
    );
    expect(screen.queryByText("运行记录")).toBeNull();
  });

  it("勾选两次运行后展示参数差异、错误分类与耗时", () => {
    render(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={vi.fn()}
        runs={[run("new", "第二条", "failed"), run("old", "第一条")]}
      />,
    );
    expect(screen.getByText("限流或额度")).toBeTruthy();
    expect(screen.getAllByText(/1\.3 s · 2 项参数/)).toHaveLength(2);
    for (const box of screen.getAllByRole("checkbox").slice(0, 2)) {
      fireEvent.click(box);
    }
    expect(screen.getByText(/A \/ B 参数对比 · 1 项不同/)).toBeTruthy();
    const referenceRow = screen.getByText("参考图组").closest("tr");
    expect(referenceRow?.textContent).toContain("—");
    expect(referenceRow?.textContent).not.toContain("[object");
    expect(screen.getByText("第一条")).toBeTruthy();
    expect(screen.getByText("第二条")).toBeTruthy();
  });

  it("长参数只在展示截断后尾部不同，也计入真实差异", () => {
    const prefix = "x".repeat(200);
    render(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={vi.fn()}
        runs={[run("new", `${prefix}B`), run("old", `${prefix}A`)]}
      />,
    );
    for (const box of screen.getAllByRole("checkbox").slice(0, 2)) {
      fireEvent.click(box);
    }
    expect(screen.getByText(/A \/ B 参数对比 · 1 项不同/)).toBeTruthy();
    const promptRow = screen.getByText("prompt").closest("tr");
    expect(promptRow?.className).toContain("bg-warning/5");
  });

  it("参考图组按完整内容比较并随历史重跑原样交回", () => {
    const onRetry = vi.fn();
    const older = { ...run("old", "same"), referenceImages: ["data:image/png;base64,old"] };
    const newer = { ...run("new", "same"), referenceImages: ["data:image/png;base64,new"] };
    render(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={onRetry}
        runs={[newer, older]}
      />,
    );
    for (const box of screen.getAllByRole("checkbox").slice(0, 2)) {
      fireEvent.click(box);
    }
    expect(screen.getByText(/A \/ B 参数对比 · 1 项不同/)).toBeTruthy();
    expect(screen.getByText("参考图组")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "按此参数重跑" })[0]!);
    expect(onRetry).toHaveBeenCalledWith(newer);
  });

  it("参考图组差异判定每次渲染只做一次，且与差异计数共用同一结果", () => {
    const older = { ...run("old", "same"), referenceImages: ["data:image/png;base64,old"] };
    const newer = { ...run("new", "same"), referenceImages: ["data:image/png;base64,new"] };
    const stringify = vi.spyOn(JSON, "stringify");
    const { rerender } = render(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={vi.fn()}
        runs={[newer, older]}
      />,
    );
    for (const box of screen.getAllByRole("checkbox").slice(0, 2)) {
      fireEvent.click(box);
    }
    const afterSelection = stringify.mock.calls.length;
    // 参考图组是字符串数组，逐项比较不应产生任何 JSON.stringify；其它展示逻辑也不该序列化它。
    expect(
      stringify.mock.calls.some(
        ([value]) => Array.isArray(value) && value.includes("data:image/png;base64,old"),
      ),
    ).toBe(false);
    stringify.mockClear();
    rerender(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={vi.fn()}
        runs={[newer, older]}
      />,
    );
    // 同一组 props 重渲染时派生布尔仍由 useMemo 缓存，不重复计算。
    expect(stringify.mock.calls.length).toBe(0);
    expect(afterSelection).toBe(0);
    expect(screen.getByText(/A \/ B 参数对比 · 1 项不同/)).toBeTruthy();
    expect(screen.getByText("参考图组").closest("tr")?.className).toContain("bg-warning/5");
    stringify.mockRestore();
  });

  it("最多保留两个对比项，并支持按历史参数重跑与清空", () => {
    const onRetry = vi.fn();
    const onClear = vi.fn();
    const runs = [run("a", "A"), run("b", "B"), run("c", "C")];
    render(
      <ModelTestRunHistory generating={false} onClear={onClear} onRetry={onRetry} runs={runs} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[2]!);
    expect(
      screen.getAllByRole("checkbox").filter((box) => box.getAttribute("aria-checked") === "true"),
    ).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "按此参数重跑" })[1]!);
    expect(onRetry).toHaveBeenCalledWith(runs[1]);
    fireEvent.click(screen.getByRole("button", { name: "清空运行记录" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("时刻经 formatClock 统一出口，aria-label 与显示文本共用同一字符串", () => {
    clockMock.mockClear();
    render(
      <ModelTestRunHistory
        generating={false}
        onClear={vi.fn()}
        onRetry={vi.fn()}
        runs={[run("a", "A")]}
      />,
    );
    expect(formatClock).toHaveBeenCalledWith(1_700_000_000_000);
    expect(screen.getByText("T1700000000000")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "对比 T1700000000000 的运行" })).toBeTruthy();
  });

  it("同一组 props 重渲染不重复逐行格式化（行时刻纳入 useMemo 派生）", () => {
    const runs = [run("a", "A"), run("b", "B")];
    clockMock.mockClear();
    const view = render(
      <ModelTestRunHistory generating={false} onClear={vi.fn()} onRetry={vi.fn()} runs={runs} />,
    );
    expect(clockMock).toHaveBeenCalledTimes(2);
    view.rerender(
      <ModelTestRunHistory generating={false} onClear={vi.fn()} onRetry={vi.fn()} runs={runs} />,
    );
    expect(clockMock).toHaveBeenCalledTimes(2);
  });
});
