/**
 * `GET /api/comfy/stats` —— 状态栏显存/内存格的轮询端点（规范 §10 降级要求的落点）。钉四件：有数据按采集器形状转发并补 `processAlive: true` 但不许覆盖采集器字段；
 * 读不到时回落进程级快照 `{ online:false, processAlive: snap.running }`（跑图 GPU 满载时 `/system_stats` 连续超时，只认 HTTP 会把「正在生成」闪报成「未运行」），降级包永远带 `online`；
 * `force-dynamic` 不能掉（被缓存后状态栏永远停在第一次的值 —— 只会静默坏，是本用例长期存在的理由）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSystemStats = vi.fn<() => Promise<unknown>>();
const getComfyRuntimeSnapshot = vi.fn<() => Promise<unknown>>();

vi.mock("~/lib/comfyui/client", () => ({
  getSystemStats: () => getSystemStats(),
}));
vi.mock("~/lib/comfyui/status", () => ({
  getComfyRuntimeSnapshot: () => getComfyRuntimeSnapshot(),
}));

beforeEach(() => {
  getSystemStats.mockReset();
  getComfyRuntimeSnapshot.mockReset();
  // 默认「进程也不在」：只有专门验回落的用例才需要覆盖它。
  getComfyRuntimeSnapshot.mockResolvedValue({ running: false });
});

describe("GET /api/comfy/stats", () => {
  it("在线：转发采集结果并补 processAlive，且不覆盖采集器自己的字段", async () => {
    const payload = {
      online: true,
      vramUsed: 1,
      memory: { gib_used: 6.5, gib_total: 8 },
      system: { os: "windows" },
    };
    getSystemStats.mockResolvedValueOnce(payload);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ...payload,
      processAlive: true,
    });
    // 这一拍根本不该去查进程表（HTTP 已经给出结论）
    expect(getComfyRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("空对象不算「离线」： `{}` 是「采到了但没字段」，仍走在线档", async () => {
    getSystemStats.mockResolvedValueOnce({});
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({
      processAlive: true,
    });
  });

  it("采不到 + 进程在跑 → { online:false, processAlive:true }（跑图满载不该闪成未运行）", async () => {
    getSystemStats.mockResolvedValueOnce(null);
    getComfyRuntimeSnapshot.mockResolvedValueOnce({ running: true });
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({
      online: false,
      processAlive: true,
    });
  });

  it("采不到 + 进程也不在 → 两个都假（状态栏据此显示离线，而不是空白或抛错）", async () => {
    getSystemStats.mockResolvedValueOnce(null);
    getComfyRuntimeSnapshot.mockResolvedValueOnce({ running: false });
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({
      online: false,
      processAlive: false,
    });
  });

  it("采集器回 undefined 也给完整降级包（判据按真值走，不能回出一个没有 online 字段的结果）", async () => {
    // 类型上 `getSystemStats(): Promise<… | null>` 不该给 undefined，但这里读的
    // 是外部 HTTP 的收口：少一个字段就会让状态栏出现第三种状态。
    getSystemStats.mockResolvedValueOnce(undefined);
    getComfyRuntimeSnapshot.mockResolvedValueOnce({ running: false });
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({
      online: false,
      processAlive: false,
    });
  });

  it("必须 force-dynamic：GET 被缓存就等于状态栏停在第一次的数", async () => {
    const mod = await import("./route");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
