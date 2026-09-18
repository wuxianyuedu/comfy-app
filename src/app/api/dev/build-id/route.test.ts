// `/api/dev/build-id` 的契约：它回答「运行中的这棵模块图是不是加载时那一棵」，
// 必须对源码改动敏感（本项目最常见的是「边改边看、还没提交」），同时对读不到
// 的文件保持稳定（不制造假变化）。

import { describe, expect, it } from "vitest";

import { GET } from "./route";

async function buildId(): Promise<string> {
  const res = await GET();
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const data = (await res.json()) as { buildId?: unknown };
  expect(typeof data.buildId).toBe("string");
  return data.buildId as string;
}

describe("GET /api/dev/build-id", () => {
  it("同一进程内连续读取稳定（不会自己抖出假变化）", async () => {
    const [a, b] = [await buildId(), await buildId()];
    expect(a).toBe(b);
  });

  it("标识里带进程启动标识，应用服务重启即可被识别", async () => {
    const { getServerBootId } = await import("~/lib/shell/dev-server-id");
    expect(await buildId()).toContain(getServerBootId());
  });

  it("包含被观测模块的指纹（源码改动可被识别）", async () => {
    const id = await buildId();
    expect(id).toContain("WorkflowStores.tsx");
  });
});
