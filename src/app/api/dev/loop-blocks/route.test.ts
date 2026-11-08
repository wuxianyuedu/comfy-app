// `/api/dev/loop-blocks` 的契约（ISSUE #3369）：回进程内观测到的事件循环阻塞记录。
// 与 last-exit 同一族的「读不到」语义——没阻塞过/观测没启动回空数组而不是 404，
// 那是正常状态，不该被显示成接口故障。

import { afterEach, describe, expect, it } from "vitest";

import {
  eventLoopBeat,
  latestEventLoopBlocks,
  resetEventLoopWatchForTests,
} from "~/lib/log/event-loop-watch.server";
import { isRecord } from "~/lib/is-record";

import { GET } from "./route";

afterEach(() => {
  resetEventLoopWatchForTests();
});

async function get(): Promise<{ running: unknown; blocks: unknown[] }> {
  const res = GET();
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const raw: unknown = await res.json();
  if (!isRecord(raw)) {
    throw new Error("响应体不是对象");
  }
  if (!Array.isArray(raw.blocks)) {
    throw new Error("blocks 不是数组");
  }
  return { running: raw.running, blocks: raw.blocks };
}

describe("GET /api/dev/loop-blocks", () => {
  it("没有任何记录：回空数组 + running 标记（观测未启动也是合法状态）", async () => {
    resetEventLoopWatchForTests();
    const { running, blocks } = await get();
    expect(running).toBe(false);
    expect(blocks).toEqual([]);
  });

  it("有阻塞记录：按观测侧的时间序原样带出", async () => {
    eventLoopBeat(1_000);
    eventLoopBeat(6_000); // 一次 4s 阻塞
    eventLoopBeat(7_000);
    eventLoopBeat(20_000); // 又一次（漂移 12s）
    const { blocks } = await get();
    expect(blocks).toEqual(latestEventLoopBlocks());
    expect(blocks).toHaveLength(2);
  });
});
