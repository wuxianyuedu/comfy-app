// 画布历史面板查询客户端单测。重点是「探测失败不算错误」这条降级规则：
// 探测只服务于「查看全部记录」引导，挂了不该让整个侧栏报错。

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchHistoryTasks,
  probeGlobalTaskCount,
} from "./history-panel-client";
import type { HistoryTaskRow } from "./history-panel-types";

const taskListQuery = vi.fn();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    task: {
      list: { query: (...args: unknown[]) => taskListQuery(...args) as never },
    },
  },
}));

afterEach(() => {
  taskListQuery.mockReset();
});

/** 一条合法的行（Zod 校验通过所需的最小字段）。 */
function row(over: Partial<HistoryTaskRow> = {}): HistoryTaskRow {
  return {
    id: "t-1",
    type: "image",
    workflowName: "wf",
    status: "SUCCEEDED",
    prompt: "一只猫",
    createdAt: "2026-01-01T00:00:00.000Z",
    cover: null,
    mediaType: "image",
    projectId: "p-1",
    progress: 100,
    error: null,
    ...over,
  };
}

describe("fetchHistoryTasks", () => {
  it("透传查询参数，并按契约校验后返回行", async () => {
    taskListQuery.mockResolvedValue({ tasks: [row()] });
    const out = await fetchHistoryTasks({
      take: 80,
      projectId: "p-1",
      media: "video",
    });
    expect(taskListQuery).toHaveBeenCalledWith({
      take: 80,
      projectId: "p-1",
      media: "video",
    });
    // 不再「原样透传」：行经 Zod 校验后返回（缺字段会被补齐默认值）
    expect(out).toEqual([row()]);
  });

  it("行缺可选字段 → 按默认值补齐（不把 undefined 漏给下游）", async () => {
    // 只给最小必填：id / createdAt。其余由 schema 的 default 补齐。
    taskListQuery.mockResolvedValue({
      tasks: [{ id: "t-9", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    const out = await fetchHistoryTasks({ take: 10 });
    expect(out).toEqual([
      expect.objectContaining({
        id: "t-9",
        mediaType: "image",
        progress: 0,
        prompt: "",
        error: null,
      }),
    ]);
  });

  it("非法行被丢弃而不是硬塞（类型说有 prompt，实际可能是 undefined）", async () => {
    taskListQuery.mockResolvedValue({
      tasks: [
        row({ id: "good" }),
        { id: 123 }, // id 不是字符串 → 非法
        null,
        "not-an-object",
      ],
    });
    const out = await fetchHistoryTasks({ take: 10 });
    expect(out.map((r) => r.id)).toEqual(["good"]);
  });

  it("mediaType 非法值 → 该行被丢弃（枚举是硬约束，不静默兜底）", async () => {
    taskListQuery.mockResolvedValue({
      tasks: [
        row({ id: "ok" }),
        { ...row({ id: "bad" }), mediaType: "hologram" },
      ],
    });
    const out = await fetchHistoryTasks({ take: 10 });
    expect(out.map((r) => r.id)).toEqual(["ok"]);
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
