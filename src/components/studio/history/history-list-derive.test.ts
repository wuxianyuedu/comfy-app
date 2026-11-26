// 历史记录列表的筛选/排序/分组/分页规则单测（纯函数，无 render、无网络）。

import { describe, expect, it } from "vitest";

import {
  activityAtOf,
  countByStatus,
  emptyStateText,
  filterTasks,
  groupByDate,
  hasActiveTasks,
  modeLabelOf,
  modelLabelOf,
  paginateGroups,
  sortTasks,
} from "./history-list-derive";
import type { TaskItem } from "./history-types";

function task(id: string, status: string, createdAt: string): TaskItem {
  return {
    id,
    type: "workflow",
    workflowName: "wf",
    status,
    prompt: "",
    createdAt,
    cover: null,
  };
}

/** 相对当前时间构造 ISO 串，保证「今天/昨天」分组稳定。 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("filterTasks", () => {
  const tasks = [task("a", "SUCCEEDED", daysAgo(0)), task("b", "FAILED", daysAgo(0))];

  it("ALL 不过滤", () => {
    expect(filterTasks(tasks, "ALL")).toHaveLength(2);
  });

  it("按 status 精确过滤", () => {
    const out = filterTasks(tasks, "FAILED");
    expect(out.map((t) => t.id)).toEqual(["b"]);
  });

  it("无命中返回空数组", () => {
    expect(filterTasks(tasks, "CANCELLED")).toEqual([]);
  });
});

describe("sortTasks", () => {
  const tasks = [task("old", "SUCCEEDED", daysAgo(3)), task("new", "SUCCEEDED", daysAgo(0))];

  it("newest 时间倒序", () => {
    expect(sortTasks(tasks, "newest").map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("oldest 时间正序", () => {
    expect(sortTasks(tasks, "oldest").map((t) => t.id)).toEqual(["old", "new"]);
  });

  it("不改入参（返回新数组）", () => {
    const input = [...tasks];
    sortTasks(input, "newest");
    expect(input.map((t) => t.id)).toEqual(["old", "new"]);
  });

  it("按最近活动时刻排序：完成过的旧任务排在没有完成时刻的新任务之前（#5076）", () => {
    const rows = [
      { ...task("submitted-now", "SUCCEEDED", daysAgo(1)) },
      { ...task("finished-now", "SUCCEEDED", daysAgo(3)), finishedAt: daysAgo(0) },
    ];
    expect(sortTasks(rows, "newest").map((t) => t.id)).toEqual(["finished-now", "submitted-now"]);
  });
});

describe("activityAtOf（#5076 最近活动时刻）", () => {
  it("三档回落：finishedAt → claimedAt → createdAt", () => {
    const base = task("t", "SUCCEEDED", "2026-01-01T00:00:00.000Z");
    expect(activityAtOf({ ...base, finishedAt: "2026-01-03T00:00:00.000Z" })).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    expect(activityAtOf({ ...base, claimedAt: "2026-01-02T00:00:00.000Z" })).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(activityAtOf(base)).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("countByStatus", () => {
  it("ALL 为总数，其余按 status 累加", () => {
    const counts = countByStatus([
      task("a", "SUCCEEDED", daysAgo(0)),
      task("b", "SUCCEEDED", daysAgo(0)),
      task("c", "RUNNING", daysAgo(0)),
    ]);
    expect(counts).toEqual({ ALL: 3, SUCCEEDED: 2, RUNNING: 1 });
  });

  it("空列表时 ALL 为 0", () => {
    expect(countByStatus([])).toEqual({ ALL: 0 });
  });
});

describe("groupByDate", () => {
  it("同日任务归到同一桶，桶内保持输入顺序", () => {
    const groups = groupByDate([
      task("a", "SUCCEEDED", daysAgo(0)),
      task("b", "SUCCEEDED", daysAgo(0)),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("跨天任务分成多个桶，且「今天」在最前（输入已排序）", () => {
    const groups = groupByDate([
      task("today", "SUCCEEDED", daysAgo(0)),
      task("old", "SUCCEEDED", daysAgo(5)),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe("今天");
    expect(groups[1]?.items.map((t) => t.id)).toEqual(["old"]);
  });

  it("按完成时刻分组而非提交时刻（#5076）", () => {
    const groups = groupByDate([
      { ...task("submitted-old", "SUCCEEDED", daysAgo(5)) },
      { ...task("finished-today", "SUCCEEDED", daysAgo(5)), finishedAt: daysAgo(0) },
    ]);
    const today = groups.find((group) => group.key === "今天");
    expect(today?.items.map((t) => t.id)).toEqual(["finished-today"]);
  });
});

describe("paginateGroups", () => {
  const groups = [
    {
      key: "今天",
      items: [task("a", "SUCCEEDED", daysAgo(0)), task("b", "SUCCEEDED", daysAgo(0))],
    },
    { key: "昨天", items: [task("c", "SUCCEEDED", daysAgo(1))] },
  ];

  it("displayCount 覆盖全部时一次性展示", () => {
    const out = paginateGroups(groups, 10);
    expect(out.visibleTotal).toBe(3);
    expect(out.canLoadMore).toBe(false);
  });

  it("displayCount 不足时截断后续分组", () => {
    const out = paginateGroups(groups, 2);
    expect(out.visibleGroups).toHaveLength(1);
    expect(out.visibleTotal).toBe(2);
    expect(out.canLoadMore).toBe(true);
  });

  it("分组内按剩余额度切片，不越过分组边界", () => {
    const out = paginateGroups(groups, 1);
    expect(out.visibleGroups[0]?.items.map((t) => t.id)).toEqual(["a"]);
    expect(out.canLoadMore).toBe(true);
  });

  it("displayCount 为 0 时不展示任何分组", () => {
    const out = paginateGroups(groups, 0);
    expect(out.visibleGroups).toEqual([]);
    expect(out.visibleTotal).toBe(0);
    expect(out.canLoadMore).toBe(true);
  });
});

describe("emptyStateText", () => {
  it("ALL 用「一条都没有」文案", () => {
    expect(emptyStateText("ALL", "").title).toBe("暂无任务记录");
  });

  it("具体筛选带上状态名，并提示切回全部", () => {
    const out = emptyStateText("FAILED", "失败");
    expect(out.title).toBe("暂无失败任务");
    expect(out.hint).toContain("全部");
  });
});

describe("modeLabelOf / modelLabelOf（ISSUE #4619：按测试模型的封装形式认任务）", () => {
  it("模式名称：任务类型码走工作流类型表的中文标签", () => {
    expect(modeLabelOf("T2I")).toBe("文生图");
    expect(modeLabelOf("I2V")).toBe("单图生视频");
  });

  it("类型表没有的码如实回落原码，不编名字", () => {
    expect(modeLabelOf("txt2img")).toBe("txt2img");
  });

  it("模型名称：优先工作流上挂的模型标签", () => {
    expect(modelLabelOf({ modelName: "minimax_h3", workflowName: "image_minimax" })).toBe(
      "minimax_h3",
    );
  });

  it("模型名称：没挂标签（null / 空串 / 纯空白）回落工作流名", () => {
    expect(modelLabelOf({ modelName: null, workflowName: "image_z" })).toBe("image_z");
    expect(modelLabelOf({ modelName: "  ", workflowName: "image_z" })).toBe("image_z");
    expect(modelLabelOf({ workflowName: "image_z" })).toBe("image_z");
  });
});

describe("hasActiveTasks（ISSUE #4619：有进行中任务才轮询）", () => {
  it("QUEUED / RUNNING 算进行中，终态不算", () => {
    expect(hasActiveTasks([task("a", "RUNNING", daysAgo(0))])).toBe(true);
    expect(hasActiveTasks([task("a", "QUEUED", daysAgo(0))])).toBe(true);
    expect(hasActiveTasks([task("a", "SUCCEEDED", daysAgo(0))])).toBe(false);
    expect(hasActiveTasks([task("a", "FAILED", daysAgo(0))])).toBe(false);
    expect(hasActiveTasks([])).toBe(false);
  });

  it("混排时只要有一条进行中就是 true", () => {
    expect(
      hasActiveTasks([task("a", "SUCCEEDED", daysAgo(0)), task("b", "RUNNING", daysAgo(0))]),
    ).toBe(true);
  });
});
