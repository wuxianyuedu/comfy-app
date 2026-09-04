// 画布历史面板查询客户端单测。重点是「探测失败不算错误」这条降级规则：
// 探测只服务于「查看全部记录」引导，挂了不该让整个侧栏报错。

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHistoryTasks, probeGlobalTaskCount } from "./history-panel-client";
import type { HistoryTaskRow } from "./history-panel-types";

const taskListQuery = vi.fn();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    task: { list: { query: (...args: unknown[]) => taskListQuery(...args) as never } },
  },
}));

afterEach(() => {
  taskListQuery.mockReset();
});

describe("fetchHistoryTasks", () => {
  it("原样透传查询参数并返回 tasks", async () => {
    const rows = [{ id: "t-1" }] as unknown as HistoryTaskRow[];
    taskListQuery.mockResolvedValue({ tasks: rows });
    const out = await fetchHistoryTasks({ take: 80, projectId: "p-1", media: "video" });
    expect(taskListQuery).toHaveBeenCalledWith({ take: 80, projectId: "p-1", media: "video" });
    expect(out).toBe(rows);
  });

  it("tasks 缺失 → 空数组（视图按空态渲染，不做额外判空）", async () => {
    taskListQuery.mockResolvedValue({});
    expect(await fetchHistoryTasks({ take: 80 })).toEqual([]);
    taskListQuery.mockResolvedValue({ tasks: null });
    expect(await fetchHistoryTasks({ take: 80 })).toEqual([]);
  });

  it("查询失败向外抛（错误文案由 hook 统一兜底）", async () => {
    taskListQuery.mockRejectedValue(new Error("未登录"));
    await expect(fetchHistoryTasks({ take: 80 })).rejects.toThrow("未登录");
  });
});

describe("probeGlobalTaskCount", () => {
  it("返回条数", async () => {
    taskListQuery.mockResolvedValue({ tasks: [{ id: "t-1" }] });
    expect(await probeGlobalTaskCount()).toBe(1);
    expect(taskListQuery).toHaveBeenCalledWith({ take: 1 });
  });

  it("tasks 非数组 → 0（不把非法响应当成错误）", async () => {
    taskListQuery.mockResolvedValue({ tasks: undefined });
    expect(await probeGlobalTaskCount()).toBe(0);
  });

  it("探测失败返回 null（引导不显示，主流程不受影响）", async () => {
    taskListQuery.mockRejectedValue(new Error("网络错误"));
    expect(await probeGlobalTaskCount()).toBeNull();
  });
});
