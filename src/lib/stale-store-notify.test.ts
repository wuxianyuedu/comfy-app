// 「陈旧实例」告警的送达契约：只有真的观测到陈旧实例、且页面确实跑过一段
// 代码更新时才送达一次；同一次会话里的重复观测必须被去重（否则一次白屏能刷出
// 一屏相同的 toast）。

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reportCodeUpdatedSinceLoad,
  reportStaleStoreAction,
  resetStaleStoreNotify,
  registerStaleStoreDeliver,
} from "./stale-store-notify";

afterEach(() => {
  resetStaleStoreNotify();
});

describe("stale-store-notify 送达通道", () => {
  it("代码更新过 + 观测到动作缺失 → 送达一次，带完整「怎么办」", () => {
    const seen: unknown[] = [];
    registerStaleStoreDeliver((n) => seen.push(n));
    reportCodeUpdatedSinceLoad();

    expect(reportStaleStoreAction("missing-store-action")).toBe(true);
    expect(seen).toHaveLength(1);
    expect((seen[0] as { body: string }).body).toContain("怎么做：");
  });

  it("同一次会话重复观测只送达一次（去重）", () => {
    const deliver = vi.fn();
    registerStaleStoreDeliver(deliver);
    reportCodeUpdatedSinceLoad();

    expect(reportStaleStoreAction("missing-store-action")).toBe(true);
    expect(reportStaleStoreAction("missing-store-action")).toBe(false);
    expect(reportStaleStoreAction("missing-store-action")).toBe(false);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("没跑过代码更新时不上报（把「重载」当结论会误导）", () => {
    const deliver = vi.fn();
    registerStaleStoreDeliver(deliver);

    expect(reportStaleStoreAction("missing-store-action")).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("还没注册送达器时不抛错（Provider 尚未挂载的窗口期）", () => {
    reportCodeUpdatedSinceLoad();
    expect(() => reportStaleStoreAction("missing-store-action")).not.toThrow();
  });
});
