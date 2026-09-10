/* ── 「就绪」语义的单一事实（底部状态栏）────────────────────────────────
 * ISSUE #121 反馈「右下角的就绪是什么含义现在不清楚」：旧实现是一个写死的
 * 「就绪 + 绿点」，从不变化、也没有任何判据。这里把语义定义成单一事实，
 * 供状态栏（视图）与测试共同消费，避免文案与判据各自漂移。
 *
 * 判据取「ComfyUI 是否已连接且可读指标」：
 *   本应用并不把「队列空闲」当作就绪条件——就绪回答的是「这个创作后端现在
 *   能不能收任务」，空队列是「现在没事干」而不是「可用」。若把队列空闲并入
 *   判据，正在跑图时状态栏会退回「未就绪」，恰好是用户最需要确认后端可用的
 *   时刻给出否定信号。队列空闲与否由任务列表/执行日志表达，不挤进这个指示位。
 *
 * 纯函数、无 React、无 IO（规范 17 §17.2 第①层），可直接单测。
 */

/** 就绪三态：未连接 / 已连接但指标尚未到达 / 已就绪。 */
export type ComfyReadinessState = "offline" | "connecting" | "ready";

export interface ComfyReadiness {
  state: ComfyReadinessState;
  /** 状态栏可读文案（短，供右下角窄位展示） */
  label: string;
  /** 悬停 `title`：一句话说明含义，并显式写出「队列空闲不参与判据」 */
  title: string;
}

/** 由「是否在线 + 是否已有指标」派生就绪态。
 *  `hasStats` 为 false 表示连接已建立但首个采样还没回来（首帧/轮询空窗）。 */
export function deriveComfyReadiness(
  online: boolean,
  hasStats: boolean,
): ComfyReadiness {
  if (!online) {
    return {
      state: "offline",
      label: "未连接",
      title: "ComfyUI 未运行，无法读取显存/内存，也无法提交任务",
    };
  }
  if (!hasStats) {
    return {
      state: "connecting",
      label: "连接中",
      title: "已连上 ComfyUI，正在读取显存/内存指标",
    };
  }
  return {
    state: "ready",
    label: "已就绪",
    title:
      "ComfyUI 已就绪：已连接且能实时读取显存/内存，可以提交任务（不代表队列空闲）",
  };
}
