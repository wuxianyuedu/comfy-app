import { formatClock } from "~/lib/time-format";

import type { AppServiceExitNotice } from "./app-service-exit";

/* ── 「应用服务状态」的单一事实（底部状态栏）────────────────────────────
 * 状态栏这一格回答的问题是**「应用服务（dev server）现在能不能应答」**，
 * 而不是「ComfyUI 能不能收任务」。
 *
 * 为什么改判据：旧实现这一格显示 ComfyUI 的连接态（未连接 / 连接中 / 已就绪），
 * 而 ComfyUI 是**可选**的创作后端——没装、没开、或根本没配路径时这一格永远
 * 停在「未连接」，用户读到的却是「应用有问题」。实际上「显存/内存不可用」
 * 本身就是 ComfyUI 没启动的表现（旁边那两项占用条同时隐藏 + 降级文案），
 * 信息重复；真正会卡住整个界面的失败是**应用服务没起来**——那种情况下页面
 * 会白屏 / 打不开，而旧状态栏恰好没有任何一格在说这件事。
 *
 * 判据（三态，都由「能不能应答」这一个事实派生，不依赖任何业务接口）：
 *   online   可达 → 应用服务在线（顺带说明「有没有真正重启」）；
 *   offline  已经探通过、而此刻抗抖动后不可达 → 进程不在了（服务停了 /
 *            窗口断开了）。**单拍失败不算**：冷编译 / 按需编译让某一拍超时是
 *            常态，抖动门槛见 `use-dev-server-liveness` 的
 *            `OFFLINE_CONFIRM_FAILURES`（取事实那一层滤，判据只管三态）；
 *   starting 尚未有过成功探测 → 首次探测还没回来，不冒充在线也不报故障。
 *
 * 纯函数、无 React、无 IO（规范 17 §17.2 第①层），可直接单测。
 */

/** 应用服务三态：尚未探通 / 在线 / 不可达。 */
export type DevServerState = "starting" | "online" | "offline";

export interface DevServerStatusInput {
  /** 本次会话是否曾成功探测到进程标识。 */
  everOnline: boolean;
  /**
   * 应用服务此刻**能不能应答**（抗抖动后的事实，见
   * `use-dev-server-liveness` 的 `OFFLINE_CONFIRM_FAILURES`）。
   *
   * 刻意不叫「最近一次探测是否成功」：单拍事实是 `probeOk`，而状态栏与消息
   * 中心要回答的是「服务现在能不能应答」——冷编译/按需编译让某一拍超时，并不
   * 让这个问题的答案变成「不能」。判据只管「怎么把事实翻成三态」，过滤抖动
   * 是取事实那一层的事，两边不互相知道。
   */
  reachable: boolean;
  /** 是否检测到**真正**重启（进程标识变化，见 use-dev-server-liveness）。 */
  restarted: boolean;
  /** 最近一次真正重启的时刻。 */
  lastRestartAt: number | null;
  /**
   * 上一次应用服务为什么结束（进程死的那一刻由启动编排落盘、服务恢复应答后读回，
   * 见 `~/lib/shell/app-service-exit`）。null = 没有原因可讲。
   */
  lastExit?: AppServiceExitNotice | null;
}

export interface DevServerStatus {
  state: DevServerState;
  /** 状态栏可读文案（短，供右下角窄位展示）。 */
  label: string;
  /** 悬停 `title`：一句话说明含义与此刻能做什么。 */
  title: string;
  /** 上一次结束的原因与动作；没有可讲的原因时为 null（视图据此决定要不要开口）。 */
  exitNotice: AppServiceExitNotice | null;
}

export function deriveDevServerStatus(
  input: DevServerStatusInput,
): DevServerStatus {
  const { everOnline, reachable, restarted, lastRestartAt } = input;
  const exitNotice = input.lastExit ?? null;

  if (!reachable && everOnline) {
    return {
      state: "offline",
      label: "应用服务已断开",
      /* 原因已知就**一定**说出来（规范 §10.3.1：降级不得静默）——用户盯着
       * 「已断开」四个字，唯一能问的就是「为什么」，而这条原因正躺在磁盘上。
       * 未知时保留原来那句「怎么恢复」：拿不到原因时至少要给一个出口，不能
       * 因为没原因可讲就退回一句现象陈述。 */
      title: exitNotice
        ? `${exitNotice.why}。${exitNotice.detail}。${exitNotice.action}`
        : "应用服务（dev server）当前不可达：页面里的查询与保存都会失败。应用窗口重新打开或服务重启后会自动恢复",
      exitNotice,
    };
  }

  if (!reachable) {
    return {
      state: "starting",
      label: "应用服务连接中",
      title: "正在连接应用服务（dev server）…",
      exitNotice: null,
    };
  }

  if (restarted) {
    const at =
      lastRestartAt === null ? "" : `（${formatClock(lastRestartAt)}）`;
    /* 重启的原因就在这里：`lastExit` 说的是**上一份**进程怎么结束的，而
     * 「刚重启」描述的正是那件事的后果。两句合起来才是一条完整的话——
     * 过去只有后果（「已重启」），用户仍不知道是崩溃还是被顶掉。 */
    return {
      state: "online",
      label: "应用服务已重启",
      title: exitNotice
        ? `应用服务刚重启过${at}：${exitNotice.why}。${exitNotice.detail}。当时进行中的任务已丢失，需要重新执行`
        : `应用服务刚重启过${at}：当时进行中的任务已丢失，需要重新执行`,
      exitNotice,
    };
  }

  return {
    state: "online",
    label: "应用服务运行中",
    title: "应用服务（dev server）在线：页面查询、保存与任务提交都走它",
    /* 在线且没刚重启过：上一次结束的原因与本格当前状态无关，不挂上去——
     * 否则一个几小时前的旧结论会一直贴在「运行中」后面。 */
    exitNotice: null,
  };
}
