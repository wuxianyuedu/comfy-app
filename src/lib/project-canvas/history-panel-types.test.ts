// 画布历史面板的纯派生函数单测（第①层配置）。
// 这部分以前内联在 HistoryPanel.tsx 里，只能靠渲染组件才能验；抽出来后
// 时间格式化、标题回落、可拖拽判定这些边界可以直接断言。

import { describe, expect, it } from "vitest";

import {
  FILTER_TABS,
  countActive,
  isDraggableCover,
  timeAgo,
  titleOf,
  type HistoryTaskRow,
} from "./history-panel-types";

function row(over: Partial<HistoryTaskRow> = {}): HistoryTaskRow {
  return {
    id: "t-abcdefghijkl",
    type: "image",
    workflowName: "",
    status: "SUCCEEDED",
    prompt: "",
    createdAt: new Date().toISOString(),
    cover: null,
    mediaType: "image",
    projectId: null,
    progress: 100,
    error: null,
    ...over,
  };
}

describe("titleOf", () => {
  it("优先提示词，超 40 字截断并加省略号", () => {
    expect(titleOf(row({ prompt: "一只猫" }))).toBe("一只猫");
    const long = "猫".repeat(45);
    expect(titleOf(row({ prompt: long }))).toBe(`${"猫".repeat(40)}…`);
  });

  it("提示词只有空白时视为空，回落到工作流名", () => {
    expect(titleOf(row({ prompt: "   ", workflowName: "文生图" }))).toBe("文生图");
  });

  it("两者都空时回落到任务 id 前 12 位", () => {
    expect(titleOf(row())).toBe("t-abcdefghij");
  });

  it("提示词刚好 40 字不加省略号（边界）", () => {
    const exact = "猫".repeat(40);
    expect(titleOf(row({ prompt: exact }))).toBe(exact);
  });
});

describe("timeAgo", () => {
  it("一分钟内 → 刚刚", () => {
    expect(timeAgo(new Date(Date.now() - 30_000).toISOString())).toBe("刚刚");
  });

  it("分钟内 / 小时内 / 天内分档", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(timeAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3 小时前");
    expect(timeAgo(new Date(Date.now() - 5 * 86_400_000).toISOString())).toBe("5 天前");
  });

  it("超过 30 天落到具体日期（不再是「xx 天前」）", () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const out = timeAgo(old);
    expect(out).not.toContain("天前");
    expect(out).toMatch(/\d/);
  });
});

describe("countActive", () => {
  it("只数 RUNNING 与 QUEUED", () => {
    expect(
      countActive([
        row({ status: "RUNNING" }),
        row({ status: "QUEUED" }),
        row({ status: "SUCCEEDED" }),
        row({ status: "FAILED" }),
        row({ status: "CANCELLED" }),
      ]),
    ).toBe(2);
  });

  it("空列表 → 0", () => {
    expect(countActive([])).toBe(0);
  });
});

describe("isDraggableCover", () => {
  it("image / video 有封面才可拖到画布", () => {
    expect(isDraggableCover(row({ cover: "/a.png", mediaType: "image" }))).toBe(true);
    expect(isDraggableCover(row({ cover: "/a.mp4", mediaType: "video" }))).toBe(true);
  });

  it("audio 不可拖（没有可视封面）", () => {
    expect(isDraggableCover(row({ cover: "/a.mp3", mediaType: "audio" }))).toBe(false);
  });

  it("无封面一律不可拖", () => {
    expect(isDraggableCover(row({ cover: null, mediaType: "image" }))).toBe(false);
  });
});

describe("FILTER_TABS", () => {
  it("四个页签，第一个是「全部」（视图默认选中它）", () => {
    expect(FILTER_TABS).toHaveLength(4);
    expect(FILTER_TABS[0]).toEqual({ id: "all", label: "全部" });
  });
});
