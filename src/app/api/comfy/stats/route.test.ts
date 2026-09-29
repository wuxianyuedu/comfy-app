/**
 * `GET /api/comfy/stats` —— 底部状态栏显存/内存那一格的轮询端点。
 *
 * 它只做一件事：代理 ComfyUI `/system_stats`，并在**探不到时回 `{ online: false }`**。
 * 这条兜底是整个状态栏降级链的落点：`BrowserStatusBar` 靠它把「离线」显示出来，
 * 而不是留一个空白格或抛错（规范 §10 的降级要求）。所以这里要钉的是三件事：
 *   1. 有数据时**原样转发**，不重新包装字段（前端按采集器的形状渲染）；
 *   2. 采集器回 `null` / `undefined`（ComfyUI 没跑）时回 `{ online: false }`；
 *   3. 这个端点必须每次真探 —— `dynamic = "force-dynamic"` 一旦被去掉，
 *      Next 会把 GET 结果缓存住，状态栏就永远停在第一次采到的那个值。
 *      第 3 条是这条用例存在的主要理由：前两条几乎不会写错，而第 3 条是
 *      「删一行配置就静默坏掉」的那种。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSystemStats = vi.fn<() => Promise<unknown>>();

vi.mock("~/lib/comfyui/client", () => ({
  getSystemStats: () => getSystemStats(),
}));

beforeEach(() => {
  getSystemStats.mockReset();
});

describe("GET /api/comfy/stats", () => {
  it("ComfyUI 在线时原样转发采集结果", async () => {
    const payload = {
      online: true,
      memory: { gib_used: 6.5, gib_total: 8 },
      system: { os: "windows" },
    };
    getSystemStats.mockResolvedValueOnce(payload);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it("采集器回 null → { online: false }（状态栏据此显示离线，而不是空白或抛错）", async () => {
    getSystemStats.mockResolvedValueOnce(null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ online: false });
  });

  it("采集器回 undefined 时同样降级（?? 而不是 ||，两者在这里等价但只有一处实现）", async () => {
    getSystemStats.mockResolvedValueOnce(undefined);
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({ online: false });
  });

  it("空对象不被当成「离线」覆盖掉 —— 兜底只在 null/undefined 时生效", async () => {
    // `{}` 是「采到了但没字段」，把它替换成 online:false 会撒谎；
    // 而把 null 放过去会让前端读到 undefined 字段。两条边界各指一个方向。
    getSystemStats.mockResolvedValueOnce({});
    const { GET } = await import("./route");
    await expect((await GET()).json()).resolves.toEqual({});
  });

  it("必须 force-dynamic：GET 被缓存就等于状态栏停在第一次的数", async () => {
    const mod = await import("./route");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
