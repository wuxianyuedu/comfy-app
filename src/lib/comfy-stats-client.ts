/* ── 底部状态栏系统指标的网络客户端（第②层网络部分）──────────────────
 * 通过 `/api/comfy/stats`（服务端代理 ComfyUI /system_stats）轮询
 * 显存与内存占用。此前逻辑要在视图里裸 fetch，收口到这里后
 * BrowserStatusBar 只关心「读到的 stats 与是否在线」。
 */

export interface ComfyStatsPayload {
  online: boolean;
  gpuName?: string;
  vramUsed: number;
  vramTotal: number;
  ramUsed: number;
  ramTotal: number;
}

/** 拉取一次系统指标；请求失败（路由不可达等）也返回 online:false 便于降级。 */
export async function fetchComfyStats(): Promise<ComfyStatsPayload> {
  try {
    const res = await fetch(`/api/comfy/stats`, {
      cache: "no-store",
    });
    if (!res.ok)
      return {
        online: false,
        vramUsed: 0,
        vramTotal: 0,
        ramUsed: 0,
        ramTotal: 0,
      };
    return (await res.json()) as ComfyStatsPayload;
  } catch {
    return {
      online: false,
      vramUsed: 0,
      vramTotal: 0,
      ramUsed: 0,
      ramTotal: 0,
    };
  }
}
