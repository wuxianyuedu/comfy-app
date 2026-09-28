/* ── 底部状态栏系统指标的网络客户端（第②层网络部分）──────────────────
 * 通过 `/api/comfy/stats`（服务端代理 ComfyUI /system_stats）轮询
 * 显存与内存占用。此前逻辑要在视图里裸 fetch，收口到这里后
 * BrowserStatusBar 只关心「读到的 stats 与是否在线」。
 */

export interface ComfyStatsPayload {
  online: boolean;
  /** 进程级判活：ComfyUI 进程还活着（`online:false` 但此项为 true = 在跑、
   *  只是这一拍 HTTP 没应答）。路由侧经进程快照判定；HTTP 成功时恒为 true。
   *  与 `/api/comfy/queue` 的在线口径同源（queue-status.server.ts 的快照回落）。 */
  processAlive?: boolean;
  gpuName?: string;
  vramUsed: number;
  vramFree: number;
  vramTotal: number;
  smiVramUsed?: number;
  smiVramTotal?: number;
  ramUsed: number;
  ramTotal: number;
}

/** 拉取一次系统指标；请求失败（路由不可达等）也返回 online:false 便于降级。 */
export async function fetchComfyStats(): Promise<ComfyStatsPayload> {
  try {
    const res = await fetch(`/api/comfy/stats`, {
      cache: "no-store",
      // 宽松的客户端超时：只兜住病态挂死的连接、给轮询一个上界。不能设得比
      // 服务端自身延迟还紧——getSystemStats 对 ComfyUI 有 2.5s 超时、还要跑
      // nvidia-smi，正常回包可能 3~4s，卡太紧反而会制造「误离线」。
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      return {
        online: false,
        vramUsed: 0,
        vramFree: 0,
        vramTotal: 0,
        ramUsed: 0,
        ramTotal: 0,
      };
    return (await res.json()) as ComfyStatsPayload;
  } catch {
    return {
      online: false,
      vramUsed: 0,
      vramFree: 0,
      vramTotal: 0,
      ramUsed: 0,
      ramTotal: 0,
    };
  }
}
