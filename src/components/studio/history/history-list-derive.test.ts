// 历史记录列表的筛选/排序/分组/分页规则单测（纯函数，无 render、无网络）。

import { describe, expect, it } from "vitest";

import {
  countByStatus,
  emptyStateText,
  filterTasks,
  groupByDate,
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
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe("filterTasks", () => {
  const tasks = [
    task("a", "SUCCEEDED", daysAgo(0)),
    task("b", "FAILED", daysAgo(0)),
  ];

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
  const tasks = [
    task("old", "SUCCEEDED", daysAgo(3)),
    task("new", "SUCCEEDED", daysAgo(0)),
  ];

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
});

describe("paginateGroups", () => {
  const groups = [
    {
      key: "今天",
      items: [
        task("a", "SUCCEEDED", daysAgo(0)),
        task("b", "SUCCEEDED", daysAgo(0)),
      ],
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
