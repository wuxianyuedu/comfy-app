/**
 * 在线判定的连续失败迟滞（「该不该算在线」的状态机本体）
 *
 * ComfyUI 在跑图时，后端代理接口（`/system_stats`、`/queue`）会偶发变慢或单拍网络
 * 抖动，于是回包里带 `online:false` —— 但 ComfyUI 其实一直在线。若「一次失败就翻
 * 离线」，状态栏的「显存/内存」与「排队/当前执行」两格就会忽明忽暗（那是本次修复的
 * 原始症状）。这里把判据收口成一处：任一次在线立即清零；连续失败达阈值才提交离线，
 * 阈值之内处于容忍期。
 *
 * 为什么放在 `src/lib` 而不是某个 hook 文件里：这条判据有两类消费者 ——
 *   · 组件侧：状态栏/队列各自的轮询 hook（经 `useOfflineGate` 外壳，每实例一台）；
 *   · 非组件侧：系统指标的**全页单点持有者**（`~/lib/comfy/comfy-stats-store`）。
 * lib 不能反向 import `components/**`（硬规则 22），所以本体在这层，hook 只做外壳。
 *
 * 只负责状态机，不碰各自的 setState / 轮询节奏；调用方拿到 `observe` 的返回后自行
 * 决定「保留上一次好数据」还是「翻离线」。
 */

/** 默认连续失败阈值：3 次。stats 每 4s、queue 每 2s 轮询，3 次容忍分别约 12s / 6s
 *  才报离线 —— 既滤掉瞬时抖动，又不会在真掉线时拖太久。 */
export const DEFAULT_OFFLINE_THRESHOLD = 3;

/**
 * 造一台独立的迟滞计数机（各通道各自去抖，互不污染）。
 *
 * @param threshold 连续失败多少次才提交离线
 * @returns `observe(online)` 喂入本次探测结果，返回「此刻是否仍应视为在线」——
 *   在线时为 true；离线但在容忍期内时也为 true（调用方据此保留上一次好数据）；
 *   连续失败达阈值时返回 false（调用方翻离线）。
 */
export function createOfflineGate(
  threshold: number = DEFAULT_OFFLINE_THRESHOLD,
): (online: boolean) => boolean {
  let fails = 0;
  return (online: boolean) => {
    if (online) {
      fails = 0;
      return true;
    }
    fails += 1;
    return fails < threshold;
  };
}
