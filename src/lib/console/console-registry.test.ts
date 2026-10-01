import { describe, expect, it, beforeEach } from "vitest";

import { MAX_HISTORY_ENTRIES } from "./console-limits";
import {
  consoleSlot,
  recordConsoleHistory,
  resetConsoleSlotForTest,
} from "./console-registry";

/** 造一条历史条目（只关心「计数与顺序」的判据）。 */
function entry(n: number) {
  return {
    runId: `r${n}`,
    command: `cmd-${n}`,
    exitCode: 0,
    killed: false,
    durationMs: n,
    finishedAt: n,
  };
}

describe("consoleSlot", () => {
  beforeEach(() => {
    resetConsoleSlotForTest();
  });

  it("同一进程内返回**同一个**槽（Next 热编译重求值也不能出现第二个）", () => {
    expect(consoleSlot()).toBe(consoleSlot());
  });

  it("重置后是新槽（用例之间不互相看见对方的命令与历史）", () => {
    const first = consoleSlot();
    recordConsoleHistory(first, entry(1));
    expect(consoleSlot().history).toHaveLength(1);
    resetConsoleSlotForTest();
    const second = consoleSlot();
    expect(second).not.toBe(first);
    expect(second.history).toEqual([]);
  });

  it("历史超过上限时丢**最旧**的（新的留在尾部，界面按倒序展示）", () => {
    const slot = consoleSlot();
    for (let i = 1; i <= MAX_HISTORY_ENTRIES + 5; i++) {
      recordConsoleHistory(slot, entry(i));
    }
    expect(slot.history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(slot.history[0]?.command).toBe(`cmd-6`);
    expect(slot.history.at(-1)?.command).toBe(`cmd-${MAX_HISTORY_ENTRIES + 5}`);
  });
});
