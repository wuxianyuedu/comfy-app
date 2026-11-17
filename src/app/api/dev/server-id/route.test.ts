// `/api/dev/server-id` 的契约：探活唯一存活通道，回 `bootId`（认进程，每次冷启动重生成）
// 与 `runId`（认启动，消息中心按它把历史消息按每次启动分组）。两者必须在同一次应答里回来 ——
// 分两次请求会在「服务刚恢复」那一刻还拿着旧 runId，把恢复那条消息盖到上一组去。
// 另一组（ISSUE #4195）：「另一张环回卡」跨源探活的 CORS 回显，只放行「回环主机 +
// 与本服务同端口」的来源。

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

import { GET, loopbackCorsHeaders } from "./route";

beforeEach(() => {
  process.env.COMFYAPP_RUN_ID = "a1b2c3";
});

afterEach(() => {
  delete process.env.COMFYAPP_RUN_ID;
});

const URL_ = "http://127.0.0.1:3797/api/dev/server-id";

async function get(init?: RequestInit): Promise<{ bootId: unknown; runId: unknown }> {
  const raw: unknown = await GET(new Request(URL_, init)).json();
  if (!isRecord(raw)) {
    throw new Error("响应体不是对象");
  }
  return { bootId: raw.bootId, runId: raw.runId };
}

describe("GET /api/dev/server-id", () => {
  it("回 bootId 与本次启动的 runId（同一份应答）", async () => {
    const data = await get();
    expect(typeof data.bootId).toBe("string");
    expect(data.bootId).not.toBe("");
    expect(data.runId).toBe("a1b2c3");
  });

  it("bootId 在同一次进程里恒定（判「进程换没换」的基准）", async () => {
    const first = await get();
    const second = await get();
    expect(second.bootId).toBe(first.bootId);
  });

  it("拿不到 COMFYAPP_RUN_ID 时 runId 为 null（纯手工 pnpm dev，不编一个值）", async () => {
    delete process.env.COMFYAPP_RUN_ID;
    expect((await get()).runId).toBeNull();
  });

  it("空串的 COMFYAPP_RUN_ID 同样当没有（不是一次启动标识）", async () => {
    process.env.COMFYAPP_RUN_ID = "";
    expect((await get()).runId).toBeNull();
  });
});

describe("GET /api/dev/server-id — 跨源探活的 CORS 放行（ISSUE #4195）", () => {
  it("页面在 localhost、服务在 127.0.0.1：应答回显 Origin，探活读得到 bootId", async () => {
    const data = await get({ headers: { origin: "http://localhost:3797" } });
    expect(data.runId).toBe("a1b2c3");
  });

  it("同源调用（无 Origin 头）照常应答", async () => {
    const data = await get();
    expect(data.bootId).not.toBe("");
  });
});

describe("loopbackCorsHeaders — 放行判据（纯函数）", () => {
  it("同端口环回来源回显 Origin", () => {
    expect(loopbackCorsHeaders("http://localhost:3797", "3797")).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:3797",
      Vary: "Origin",
    });
    expect(loopbackCorsHeaders("http://127.0.0.1:3797", "3797")).toEqual({
      "Access-Control-Allow-Origin": "http://127.0.0.1:3797",
      Vary: "Origin",
    });
  });

  it("端口不一致的来源不放行", () => {
    expect(loopbackCorsHeaders("http://localhost:9999", "3797")).toEqual({});
  });

  it("非环回主机不放行", () => {
    expect(loopbackCorsHeaders("http://evil.example:3797", "3797")).toEqual({});
    expect(loopbackCorsHeaders("http://192.168.1.5:3797", "3797")).toEqual({});
  });

  it("无 Origin / 非法 Origin 不带 CORS 头", () => {
    expect(loopbackCorsHeaders(null, "3797")).toEqual({});
    expect(loopbackCorsHeaders("", "3797")).toEqual({});
    expect(loopbackCorsHeaders("not-a-url", "3797")).toEqual({});
  });
});
