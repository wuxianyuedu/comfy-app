/**
 * `GET /api/comfy/state` —— 设置页那条「运行态变了」的长轮询通道。
 *
 * 路由本身只做两件事：把 `?since=` 翻成「从哪个纪元之后开始等」、把等待结果
 * 翻成 HTTP 帧。这里守的是**分工与三条出口**：
 *   · 有更新 → 200 + 那一次变化的载荷；
 *   · 窗口内没有更新 → 204（空体，客户端据此再发一轮，不是错误）；
 *   · 不带 `since` → 立刻拿到当前快照（首次调用 / 错过一次变化是同一段代码）；
 *   · `force-dynamic` 不能掉 —— 长轮询一旦被缓存就成了「永远回同一个答案」。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  noteComfyStateChange,
  resetComfyStateWatchForTest,
} from "~/lib/comfyui/state-watch";

beforeEach(() => {
  resetComfyStateWatchForTest();
});

async function get(query = ""): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/comfy/state${query}`));
}

describe("GET /api/comfy/state", () => {
  it("since 之后有更新 → 200 + 那次变化的载荷", async () => {
    noteComfyStateChange("ready", "ComfyUI 已就绪");
    const res = await get("?since=0");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      seq: 1,
      kind: "ready",
      detail: "ComfyUI 已就绪",
    });
  });

  it("不带 since → 立刻回当前快照（首帧与「错过一次变化」同一段代码）", async () => {
    noteComfyStateChange("start", "用户启动了 ComfyUI");
    const res = await get();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ seq: 1, kind: "start" });
  });

  it("坏参数（非数字 / 负数）当 0 处理，不抛错", async () => {
    noteComfyStateChange("exit", "ComfyUI 进程退出");
    await expect((await get("?since=abc")).json()).resolves.toMatchObject({
      seq: 1,
    });
    await expect((await get("?since=-3")).json()).resolves.toMatchObject({
      seq: 1,
    });
  });

  it("必须 force-dynamic + nodejs（缓存住 = 永远回同一个答案）", async () => {
    const mod = await import("./route");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
