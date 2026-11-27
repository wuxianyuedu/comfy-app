/** E2：schema 轮询的稳定态降速（2s → 30s）判据。此前该文件只测 `schemaSyncNotice`
 * 纯函数，节奏本身无人守；这里用假定时器数真实请求数，钉住「有事 2s、稳定 30s」。 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCHEMA_SYNC_IDLE_MS,
  SCHEMA_SYNC_POLL_MS,
  useSchemaSyncStatus,
} from "./use-schema-sync-status";

const schemaFetch = vi.hoisted(() => vi.fn());

beforeEach(() => {
  schemaFetch.mockReset();
  schemaFetch.mockResolvedValue(
    new Response(JSON.stringify({ phase: "ready", at: null, canPush: false }), { status: 200 }),
  );
  vi.stubGlobal("fetch", schemaFetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSchemaSyncStatus 的轮询节奏（E2）", () => {
  it("稳定态降到 30s：首拍探到 ready 后，2s 节奏不再重复打端点", async () => {
    vi.useFakeTimers();
    renderHook(() => useSchemaSyncStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEMA_SYNC_POLL_MS);
    });
    const afterReady = schemaFetch.mock.calls.length;
    expect(afterReady).toBeGreaterThan(0);
    expect(SCHEMA_SYNC_IDLE_MS).toBe(30_000);
    expect(SCHEMA_SYNC_POLL_MS).toBe(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEMA_SYNC_POLL_MS * 5);
    });
    expect(schemaFetch.mock.calls.length, "稳定后 10s 内不该再打 /api/schema").toBe(afterReady);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEMA_SYNC_IDLE_MS - SCHEMA_SYNC_POLL_MS);
    });
    expect(schemaFetch.mock.calls.length, "到 30s 兜底拍才再打一次").toBeGreaterThan(afterReady);
  });
});
