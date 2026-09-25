/**
 * `probe.ts` — 单点可达性探测（执行链/状态判定的**叶子**模块）
 * ===========================================================================
 *
 * 从 `client.ts` 抽出的两个「只发一次请求、不碰会话缓存」的探测单元：
 *   - {@link probeComfyAtPort}  探一个**已知**端口（不做进程表查询 / 端口扫描）
 *   - {@link probeBaseOnce}     对给定地址各发一次 `/system_stats`
 *
 * 抽出的理由是**断环**（规范 12.7）：`status.ts`（状态判定）需要
 * `probeComfyAtPort`，而 `client.ts` 又需要 `instance-port.ts` 的
 * `baseForLocalPort` / `queryInstanceByPath`，`instance-port.ts` 需要
 * `status.ts` 的注册表读取 —— 三方成环。把「零依赖（只有 fetch + 地址拼接）」
 * 的这一层下沉后，依赖方向变成单向：
 *
 *     client ─┐
 *     instance-port ─┼─→ probe（本模块，只有 fetch + 地址拼接）
 *     status ─┘
 *
 * 这里刻意**不 import 会话缓存**：探测必须是「按次事实」，不能污染
 * `client.ts` 里「本次会话连哪个地址」的粘性结论（ISSUE #344 的成因）。
 * 需要粘性语义的调用方（`client.probeComfyBase`）自己包一层缓存回滚。
 *
 * @module comfyui/probe — 单点可达性探测（执行链/状态判定的**叶子**模块）
 */
import { comfyUiBaseUrl } from "../endpoints";

/** 直接探一个已知端口，**不做**任何进程表查询 / 端口扫描。
 *
 * 给「进程级快照已经定位到实例与端口」的调用方用（设置页状态判定）：
 * 那种情况下 `probeComfyBase()` 是绕远路——它会先 `resolveComfyBase()`，
 * 而后者在配置了路径时又要查一遍进程表（PowerShell 枚举 `Win32_Process`，
 * 本机 ~2.5s），再决定探哪个地址，等于把已经拿到的事实重新推一遍。
 * 直接探快照给出的端口既省掉这段重复 IO，也比「按配置端口 + 偏移扫描」
 * 更准：快照里的端口就是该 PID 实际监听的端口（ISSUE #339 残留延迟）。 */
export async function probeComfyAtPort(port: number): Promise<string | null> {
  if (!Number.isInteger(port) || port <= 0) return null;
  /* `COMFYUI_BASE` 指向的是远端实例（不是本机进程），此时「快照给出的本机监听
   * 端口」与要连的地址根本不是一回事——把远端主机的端口换成本机端口会直接
   * 探错地方。这种情况下返回 null，交给调用方走通用探测（它会尊重
   * COMFYUI_BASE）。 */
  if (process.env.COMFYUI_BASE) return null;
  return probeBaseOnce(comfyUiBaseUrl(port));
}

/** 对指定地址各发一次 `/system_stats`，通了返回该地址。
 *
 *  超时按调用场景注入：单点确认（状态判定、启动等待）用默认 1500ms；
 *  端口扫描（配置地址 + 就近偏移连发多次）要压低单次超时，否则「未运行」
 *  场景要付完全部超时之和。判据只有一份——见下。 */
export async function probeBaseOnce(
  base: string,
  timeoutMs = 1500,
): Promise<string | null> {
  try {
    // 只发一次请求、不写会话缓存。存活判据是「端口有没有人应答」：**连上即存活**——
    // 包括 GPU 显存不足时 `/system_stats` 返回的 HTTP 500（CUDA OOM）。过去用
    // `r.ok` 把「接口异常」当「进程退出」，导致显存爆掉时设置页假报「未运行」
    // （ISSUE #685：用户看到红点、以为 ComfyUI 退出了，实际进程还活着）。
    // **这条判据是全库唯一口径**：client.ts 的端口扫描与 workshop MCP 通道的
    // 自扫描都走本函数，不许再各自 `res.ok`（同一实例「单点判活、扫描判死」
    // 是 #685 修完又被绕过的形态）。
    await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return base;
  } catch {
    return null;
  }
}
