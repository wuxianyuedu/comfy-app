import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clampLogTime, resolveSessionStart } from "@/lib/log-session-scope";
// fileMtimeMs 是 Node-only IO，拆到 .server 模块（客户端 bundle 不得含 node:fs）。
import { fileMtimeMs } from "@/lib/log-session-scope.server";

const BASE = 1_700_000_000_000; // 任意固定时刻，避免测试依赖真实时间

describe("resolveSessionStart 会话起点", () => {
  it("显式起点优先于锚点", () => {
    expect(resolveSessionStart(BASE, BASE - 60_000)).toBe(BASE - 60_000);
  });

  it("无显式起点时用锚点", () => {
    expect(resolveSessionStart(BASE, null)).toBe(BASE);
  });

  it("都缺时返回 null（调用方退化为不截断）", () => {
    expect(resolveSessionStart(null, null)).toBeNull();
  });
});

describe("fileMtimeMs", () => {
  let dir = "";
  let file = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-session-scope-"));
    file = path.join(dir, "app-runtime.log");
    fs.writeFileSync(file, "old\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("返回文件修改时间（毫秒）", () => {
    const mtime = fileMtimeMs(file);
    expect(mtime).not.toBeNull();
    expect(Math.abs((mtime ?? 0) - fs.statSync(file).mtimeMs)).toBeLessThan(1);
  });

  it("文件不存在返回 null（不抛错）", () => {
    expect(fileMtimeMs(path.join(dir, "missing.log"))).toBeNull();
  });
});

describe("clampLogTime", () => {
  it("钳进 [0, now]：读不到时间的边界行不污染时间线", () => {
    const now = BASE + 1_000;
    expect(clampLogTime(BASE, now)).toBe(BASE);
    expect(clampLogTime(now + 60_000, now)).toBe(now);
    expect(clampLogTime(-1, now)).toBe(0);
  });
});
