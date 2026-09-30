/**
 * `GET /api/comfy/stats` —— 底部状态栏显存/内存那一格的轮询端点。
 *
 * 它做两件事：**代理 ComfyUI `/system_stats`**，以及**在 HTTP 这一拍读不到时给出
 * 一个不会把「在跑」闪成「未运行」的降级包**。这条降级链是状态栏正确性的落点
 * （规范 §10 的降级要求），所以钉的四件事：
 *   1. 有数据时按采集器的形状转发，并补一个 `processAlive: true` —— 但**不许覆盖
 *      采集器自己的字段**（`{...stats}` 在前、`processAlive` 在后）；
 *   2. 读不到（`null`）时回落**进程级快照**：`{ online: false, processAlive: snap.running }`。
 *      为什么必须有这一路：ComfyUI 跑图 GPU 满载时 `/system_stats` 会连续超时，
 *      只认 HTTP 会把「正在生成」闪报成「未运行」；口径与 `/api/comfy/queue` 同源；
 *   3. 降级包**永远带 `online` 字段** —— 采集器类型是 `| null`，但 `undefined`
 *      也不能回出一个没有 `online` 的包（状态栏据此渲染，缺字段就是第三种状态）；
 *   4. 这个端点必须每次真探 —— `dynamic = "force-dynamic"` 一旦被去掉，
 *      Next 会把 GET 结果缓存住，状态栏就永远停在第一次采到的那个值。
 *      第 4 条是这条用例长期存在的理由：前三条写错会立刻显形，这条只会静默。
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
