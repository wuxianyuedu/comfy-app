// 任务终态判据的回归测试。
//
// 这些判据是「收口后不许再被改写」这条规则的地基：执行器的进度/promptId
// 回写、SSE 的关流条件、取消端点的跳过条件、画布加载时的对账分支都靠它。
// 写漏一个状态的表现是「已经结束的任务还在被当成在跑」——DB 行从终态被打回
// RUNNING，SSE 已关的流不会重开，用户看到永远「生成中…」（ISSUE #733）。

import { describe, expect, it } from "vitest";
import {
  TERMINAL_TASK_STATUSES,
  isActiveTaskStatus,
  isTerminalFailureTaskStatus,
  isTerminalTaskStatus,
} from "./task-state";

describe("isTerminalTaskStatus", () => {
  it("三个终态都算终态", () => {
    for (const s of TERMINAL_TASK_STATUSES) {
      expect(isTerminalTaskStatus(s)).toBe(true);
    }
  });

  it("在飞状态不算终态", () => {
    expect(isTerminalTaskStatus("QUEUED")).toBe(false);
    expect(isTerminalTaskStatus("RUNNING")).toBe(false);
  });

  it("缺失行（null / undefined）不算终态 —— 还没开始跑", () => {
    expect(isTerminalTaskStatus(null)).toBe(false);
    expect(isTerminalTaskStatus(undefined)).toBe(false);
  });

  it("大小写敏感：小写别名不是本项目的状态字面量", () => {
    expect(isTerminalTaskStatus("succeeded")).toBe(false);
  });
});

describe("isTerminalFailureTaskStatus", () => {
  it("只有 FAILED / CANCELLED 算终态失败", () => {
    expect(isTerminalFailureTaskStatus("FAILED")).toBe(true);
    expect(isTerminalFailureTaskStatus("CANCELLED")).toBe(true);
    expect(isTerminalFailureTaskStatus("SUCCEEDED")).toBe(false);
    expect(isTerminalFailureTaskStatus("RUNNING")).toBe(false);
    expect(isTerminalFailureTaskStatus(null)).toBe(false);
  });
});

describe("isActiveTaskStatus", () => {
  it("与 isTerminalTaskStatus 互补", () => {
    for (const s of [...TERMINAL_TASK_STATUSES, "QUEUED", "RUNNING", null]) {
      expect(isActiveTaskStatus(s)).toBe(!isTerminalTaskStatus(s));
    }
  });
});
