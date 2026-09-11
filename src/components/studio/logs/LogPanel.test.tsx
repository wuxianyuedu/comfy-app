// @vitest-environment jsdom
/**
 * 应用日志面板的**可见行为**（ISSUE #262）。
 *
 * 用户诉求逐条对应到断言：
 *   1. 「按时间顺序显示」——时间线由 store 保证，这里断言渲染出来的行首时刻
 *      是单调不减的；
 *   2. 「不能翻页、锁死 2000 条」——页脚给出「第 N / M 页」，翻到历史页能看到
 *      更早的日志且内容与第 1 页不同；
 *   3. 「query 刷满了、其他内容基本看不到」——来源筛选切到「应用」能滤掉启动行；
 *   4. 「看不出有没有新增」——停在历史页时页脚出现「有新的日志 · 回到最新」，
 *      点击后回到第 1 页。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LogPanel } from "./LogPanel";
import { LOG_PAGE_SIZE, useLogStore } from "./log-store";
import type { LogEntry } from "./log-store";

function makeEntry(index: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `e-${index}`,
    seq: index + 1,
    time: 1_700_000_000_000 + index * 1_000,
    level: "info",
    message: `事件 ${index}`,
    source: "system",
    ...overrides,
  };
}

function seed(count: number) {
  act(() =>
    useLogStore
      .getState()
      .appendFileLogs(Array.from({ length: count }, (_, i) => makeEntry(i))),
  );
}

beforeEach(() => {
  useLogStore.setState({
    logs: [],
    filteredLogs: [],
    filter: "all",
    origin: "all",
    search: "",
    isOpen: true,
    counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    sessionStart: null,
    page: 1,
    revision: 0,
    viewRevision: 0,
    viewLength: 0,
  });
});

afterEach(cleanup);

describe("LogPanel 日志面板", () => {
  it("渲染最新一页，并给出总页数（不再只有一个 2000 条的封顶页）", () => {
    seed(LOG_PAGE_SIZE + 50);
    render(<LogPanel />);

    expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument();
    // 最新一页包含时间最近的那条
    expect(screen.getByText(/事件 249/)).toBeInTheDocument();
  });

  it("翻到更早一页能看到第 1 页没有的日志", async () => {
    seed(LOG_PAGE_SIZE + 50);
    render(<LogPanel />);
    const user = userEvent.setup();

    expect(screen.queryByText(/事件 0$/)).not.toBeInTheDocument();
    await user.click(screen.getByTitle("更早的一页"));
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument();
    expect(screen.getByText(/事件 0$/)).toBeInTheDocument();
  });

  it("渲染的行按时刻升序（用户诉求「最基本的时间顺序」）", () => {
    seed(20);
    const { container } = render(<LogPanel />);
    const stamps = Array.from(container.querySelectorAll<HTMLElement>("time")).map(
      (el) => el.textContent ?? "",
    );
    expect(stamps).not.toHaveLength(0);
    const sorted = [...stamps].sort();
    expect(stamps).toEqual(sorted);
  });

  it("停在历史页时提示「有新的日志」并可一键回到最新", async () => {
    seed(LOG_PAGE_SIZE * 3);
    render(<LogPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByTitle("更早的一页"));

    act(() => useLogStore.getState().appendFileLogs([makeEntry(9_999, { message: "新来的" })]));
    const banner = screen.getByRole("button", { name: /有 1 条新的日志/ });
    await user.click(banner);

    expect(screen.getByText(/第 1 \//)).toBeInTheDocument();
    expect(screen.getByText(/新来的/)).toBeInTheDocument();
  });

  it("按来源筛选能滤掉启动行，只看应用运行日志", async () => {
    act(() =>
      useLogStore.getState().appendFileLogs([
        makeEntry(1, { message: "开发服务已就绪", origin: "dev" }),
        makeEntry(2, { message: "任务入队", origin: "app-runtime" }),
      ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByTitle(/按来源筛选/), "app-runtime");
    expect(screen.getByText(/任务入队/)).toBeInTheDocument();
    expect(screen.queryByText(/开发服务已就绪/)).not.toBeInTheDocument();
  });

  it("搜索命中时高亮关键词，并只留下命中的行", async () => {
    act(() =>
      useLogStore.getState().appendFileLogs([
        makeEntry(1, { message: "ComfyUI 启动完成" }),
        makeEntry(2, { message: "任务入队" }),
      ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/搜索日志/), "ComfyUI");
    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("ComfyUI");
  });

  it("连续重复行被折叠成一条「重复 N 次」说明", () => {
    act(() =>
      useLogStore.getState().appendFileLogs(
        Array.from({ length: 40 }, (_, i) =>
          makeEntry(i, { message: "ComfyUI 未就绪，等待中" }),
        ),
      ),
    );
    render(<LogPanel />);
    expect(screen.getByText(/以上内容连续重复 35 次/)).toBeInTheDocument();
  });

  it("无匹配日志时给出明确的空状态文案", async () => {
    seed(3);
    render(<LogPanel />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/搜索日志/), "不存在的关键字");
    const body = screen.getByText(/暂无匹配的日志/);
    expect(body).toBeInTheDocument();
    expect(within(body.parentElement!).queryByText(/事件/)).toBeNull();
  });
});
