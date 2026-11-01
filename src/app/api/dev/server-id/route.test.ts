// `/api/dev/server-id` 的契约：它是探活唯一的存活通道，回两样东西——
//   · `bootId`：认**进程**（每次冷启动重新生成），判「进程换没换」；
//   · `runId`：认**启动**（launcher 单点产出），消息中心靠它把历史消息按
//     「每一次启动」分组（手验反馈：多次启动的记录混在了一起）。
//
// 两者必须**在同一次应答里**回来：它们都只在服务应答时才拿得到，分成两次请求
// 会在「服务刚恢复」那一刻还拿着旧 runId，把恢复那条消息盖到上一组去。

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "./route";

beforeEach(() => {
  process.env.COMFYAPP_RUN_ID = "a1b2c3";
});

afterEach(() => {
  delete process.env.COMFYAPP_RUN_ID;
});

async function get(): Promise<{ bootId: unknown; runId: unknown }> {
  /* SAFETY: 类型断言已复核 */
  return (await (await GET()).json()) as {
    bootId: unknown;
    runId: unknown;
  };
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
