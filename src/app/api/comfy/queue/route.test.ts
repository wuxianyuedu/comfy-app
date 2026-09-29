/**
 * `GET /api/comfy/queue` —— 底部状态栏「排队 / 在跑」那一格的轮询端点。
 *
 * 路由本身只有一行：把 `collectComfyQueueStatus()` 的结果原样发出去。所以这里守的是
 * **分工**，不是逻辑：
 *   · 「ComfyUI 不可达 → `online: false`」这条降级**归采集器**（`queue-status.server`），
 *     路由不再兜一层 —— 两处都兜就会出现「采集器说离线、路由说正常」的分叉；
 *   · 采集器抛错时路由**不吞**：静默 catch 会把「采集坏了」伪装成「队列是空的」，
 *     违反 AGENTS 硬规则 4（失败路径要有可见出口）；
 *   · `force-dynamic` 不能掉 —— GET 一旦被缓存，排队数与进度就停在第一次的快照上，
 *     而这正是用户盯着一批任务等的那个数字。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const collectComfyQueueStatus = vi.fn<() => Promise<unknown>>();

vi.mock("~/lib/comfyui/queue-status.server", () => ({
  collectComfyQueueStatus: () => collectComfyQueueStatus(),
}));

beforeEach(() => {
  collectComfyQueueStatus.mockReset();
});

describe("GET /api/comfy/queue", () => {
  it("原样转发采集结果（全局排队数 + 本应用在跑的任务）", async () => {
    const payload = {
      online: true,
      queued: 3,
      running: [
        {
          taskId: "t-1",
          workflow: "z-image",
          model: "dreamshaper",
          progress: 0.4,
        },
      ],
    };
    collectComfyQueueStatus.mockResolvedValueOnce(payload);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it("离线形状由采集器给出，路由不重新包装", async () => {
    collectComfyQueueStatus.mockResolvedValueOnce({ online: false, queued: 0 });
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({
      online: false,
      queued: 0,
    });
  });

  it("采集器抛错时不静默降级：错误照实抛出，而不是回一个「看起来正常」的空队列", async () => {
    collectComfyQueueStatus.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { GET } = await import("./route");
    await expect(GET()).rejects.toThrow("ECONNREFUSED");
  });

  it("必须 force-dynamic + nodejs（缓存住就等于进度停在第一次的快照）", async () => {
    const mod = await import("./route");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
