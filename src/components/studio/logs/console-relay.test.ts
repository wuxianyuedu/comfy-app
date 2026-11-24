import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  drainPendingConsoleEntries,
  queueConsoleEntry,
  type PendingConsoleEntry,
} from "./console-relay";

/* 每个用例前清空模块级队列：用例之间不能互相看见对方的残留。 */
beforeEach(() => {
  drainPendingConsoleEntries(() => undefined);
});

describe("console 中继队列（ISSUE #4919）", () => {
  it("入队不碰 store：drain 之前 addEntry 一次也不被调", () => {
    const addEntry = vi.fn<(entry: PendingConsoleEntry) => void>();
    queueConsoleEntry({ level: "error", message: "渲染期的一条", source: "console", time: 1 });
    expect(addEntry).not.toHaveBeenCalled();
    drainPendingConsoleEntries(addEntry);
    expect(addEntry).toHaveBeenCalledTimes(1);
  });

  it("drain 按入队顺序逐条交给 addEntry，之后队列已空（再 drain 不重复）", () => {
    const addEntry = vi.fn<(entry: PendingConsoleEntry) => void>();
    queueConsoleEntry({ level: "info", message: "第一条", source: "console", time: 1 });
    queueConsoleEntry({ level: "warn", message: "第二条", source: "console", time: 2 });

    drainPendingConsoleEntries(addEntry);
    expect(addEntry).toHaveBeenCalledTimes(2);
    expect(addEntry.mock.calls.map((call) => call[0]?.message)).toEqual(["第一条", "第二条"]);

    drainPendingConsoleEntries(addEntry);
    expect(addEntry).toHaveBeenCalledTimes(2); // 没有重复入库
  });

  it("打印时刻在入队时定死：drain 晚了时间也不漂移", () => {
    const addEntry = vi.fn<(entry: PendingConsoleEntry) => void>();
    queueConsoleEntry({ level: "warn", message: "带时刻", source: "console", time: 1_234_567 });
    drainPendingConsoleEntries(addEntry);
    expect(addEntry.mock.calls[0]?.[0]).toMatchObject({ time: 1_234_567, message: "带时刻" });
  });

  it("队列封顶 1000：丢最旧、保留最新（面板长期不排空也不无界增长）", () => {
    const addEntry = vi.fn<(entry: PendingConsoleEntry) => void>();
    for (let i = 0; i < 1005; i += 1) {
      queueConsoleEntry({ level: "info", message: `第 ${i} 条`, source: "console", time: i });
    }
    drainPendingConsoleEntries(addEntry);
    expect(addEntry).toHaveBeenCalledTimes(1000);
    /* 最旧的 0~4 号被丢，5 号是留存的最早一条。 */
    expect(addEntry.mock.calls[0]?.[0]).toMatchObject({ message: "第 5 条" });
    expect(addEntry.mock.calls[999]?.[0]).toMatchObject({ message: "第 1004 条" });
  });
});
