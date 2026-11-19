/**
 * `bootDevServerStage` 的心跳续拍判据（#4413）：占坑时刻的心跳要撑到起服务之后的
 * 常驻 interval，中间夹着清缓存这段**无预算**的同步 rmSync —— 心跳一陈旧，并发
 * 启动互斥（ISSUE #4345）会把「启动中的编排器」当成死了的，第二个实例照样进来
 * 互抢端口。桥段入口与清缓存之后各续拍一次。行为用例：假 ctx 驱动真实现，
 * 事件序里 touchHeartbeat 必须出现在 syncNextCache 之前与之后各一次。
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { bootDevServerStage } from "../scripts/launcher-core/dev-boot.mjs";

/** 桥段契约要求真 ChildProcess（会话锚点记 pid、日志打 PID）：起一个立刻退出的
 *  node 子进程，不用类型断言造形状。 */
function realChild(): ChildProcess {
  return spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
}

function makeCtx() {
  const events: Array<string> = [];
  const ctx = {
    log: vi.fn(),
    root: "G:/fake-root",
    status: vi.fn(),
    spawned: [] as ChildProcess[],
    spawnedChildren: (): ChildProcess[] => [],
    appendRuntimeWarning: vi.fn(),
    syncNextCache: vi.fn(() => {
      events.push("cache");
      return { cleaned: false, reason: "指纹未变" };
    }),
    reconcilePnpmVersion: vi.fn(() => null),
    currentDirOf: (name: string) => `G:/fake-root/log/current/${name}`,
    pruneTimestampedLogs: vi.fn(),
    spawnDevServer: vi.fn(() => realChild()),
    recordPid: vi.fn(),
    spawnExecutorHost: vi.fn(() => undefined),
    resolveExecutorMode: vi.fn(() => ({ mode: "inline", unknown: null })),
    writeSession: vi.fn(),
    touchHeartbeat: vi.fn(() => {
      events.push("touch");
    }),
    spawnSchemaSync: vi.fn(() => ({ started: false, reason: "跳过（测试夹具）" })),
  };
  return { ctx, events };
}

describe("bootDevServerStage 的心跳续拍（#4413）", () => {
  it("入口与清缓存之后各续拍一次：清缓存长段两端都有活着的证据", () => {
    const { ctx, events } = makeCtx();
    bootDevServerStage(ctx, {
      port: 3200,
      host: "127.0.0.1",
      mode: "web",
      staleShell: null,
      runTimestamp: "20261119-0000",
      startedAt: Date.now(),
    });

    expect(events.filter((e) => e === "touch").length).toBeGreaterThanOrEqual(2);
    /* 顺序契约：入口拍 → 清缓存 → 缓存后拍。 */
    expect(events[0]).toBe("touch");
    const cacheAt = events.indexOf("cache");
    expect(cacheAt).toBeGreaterThan(0);
    expect(events.slice(cacheAt + 1)).toContain("touch");
  });
});
