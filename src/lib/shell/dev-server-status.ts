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
 * 判据（四态，都由「探活那一次得到了什么」这一个事实派生，不依赖任何业务接口）：
 *   online   可达 → 应用服务在线（顺带说明「有没有真正重启」）；
 *   offline  已经探通过、而此刻抗抖动后不可达 → 进程不在了（服务停了 /
 *            窗口断开了）。**单拍失败不算**：冷编译 / 按需编译让某一拍超时是
 *            常态，抖动门槛见 `use-dev-server-liveness` 的
 *            `OFFLINE_CONFIRM_FAILURES`（取事实那一层滤，判据只管四态）；
 *   stale    探活端点答了 **404** → 进程在应答，但这条端点不在编译图里
 *            （陈旧路由表 / Turbopack 会话级路由失效）。它与「不可达」是两件事：
 *            页面往往还被同一个进程正常服务着，而正解是重启应用；
 *   starting 尚未有过成功探测、也没得到 404 → 首次探测还没回来，不冒充在线
 *            也不报故障。
 *
 * `stale` 为什么必须单独成态（它此前被并进 `starting`）：`everOnline` 在整场都
 * 探不通时会永远为假，于是状态栏**永久**停在「应用服务连接中」——而用户眼前正好
 * 摆着一个由该进程正常渲染的页面。那句话在这个场景里是谎话，且它把唯一的出口
 * （重启应用）藏了起来：用户只会继续等一个不会到来的转机。
 *
 * 纯函数、无 React、无 IO（规范 17 §17.2 第①层），可直接单测。
 */

/** 应用服务四态：尚未探通 / 在线 / 不可达 / 探活端点 404。 */
export type DevServerState = "starting" | "online" | "offline" | "stale";

export type DevServerStatusInput = {
  /** 本次会话是否曾成功探测到进程标识。 */
  everOnline: boolean;
  /**
   * 上一次应用服务为什么结束（进程死的那一刻由启动编排落盘、服务恢复应答后读回，
   * 见 `~/lib/shell/app-service-exit`）。null = 没有原因可讲。
   */
  lastExit?: AppServiceExitNotice | null;
  /** 最近一次真正重启的时刻。 */
  lastRestartAt: number | null;
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
  /**
   * 最近一次探测得到 404：进程在应答，但这条端点不在编译图里
   * （见 `use-dev-server-liveness` 的 `routeTableStale`）。
   */
  routeTableStale?: boolean;
};

export type DevServerStatus = {
  /** 上一次结束的原因与动作；没有可讲的原因时为 null（视图据此决定要不要开口）。 */
  exitNotice: AppServiceExitNotice | null;
  /** 状态栏可读文案（短，供右下角窄位展示）。 */
  label: string;
  state: DevServerState;
  /** 悬停 `title`：一句话说明含义与此刻能做什么。 */
  title: string;
};

export function deriveDevServerStatus(input: DevServerStatusInput): DevServerStatus {
  const { everOnline, lastRestartAt, reachable, restarted } = input;
  const exitNotice = input.lastExit ?? null;

  /* 探活端点答了 404：服务活着，坏的是路由表。**排在连通性两档之前**——它比
   * 「不可达」更具体（我们确实拿到了一个应答），也比「连接中」更贴事实。 */
  if (input.routeTableStale && !reachable) {
    return {
      label: "应用服务路由异常",
      state: "stale",
      /* 只说两件用户能做的：重启应用；重启不管用再删 .next。判据与措辞同
       * `docs/standards/launch-and-build.md` §5 里那条 Turbopack 会话级路由失效
       * —— 它是上游问题，本地唯一的解就是重建路由表。 */
      exitNotice,
      title:
        "应用服务在应答，但它的探活端点返回 404：这一次启动的路由表不完整（Turbopack 会话级路由失效）。" +
        "关闭应用窗口重新启动即可重建路由表；仍不行则删掉项目根目录的 .next 再启动",
    };
  }

  if (!reachable && everOnline) {
    return {
      label: "应用服务已断开",
      state: "offline",
      /* 原因已知就**一定**说出来（规范 §10.3.1：降级不得静默）——用户盯着
       * 「已断开」四个字，唯一能问的就是「为什么」，而这条原因正躺在磁盘上。
       * 未知时保留原来那句「怎么恢复」：拿不到原因时至少要给一个出口，不能
       * 因为没原因可讲就退回一句现象陈述。 */
      exitNotice,
      title: exitNotice
        ? `${exitNotice.why}。${exitNotice.detail}。${exitNotice.action}`
        : "应用服务（dev server）当前不可达：页面里的查询与保存都会失败。应用窗口重新打开或服务重启后会自动恢复",
    };
  }

  if (!reachable) {
    return {
      exitNotice: null,
      label: "应用服务连接中",
      state: "starting",
      title: "正在连接应用服务（dev server）…",
    };
  }

  if (restarted) {
    const at = lastRestartAt === null ? "" : `（${formatClock(lastRestartAt)}）`;
    /* 重启的原因就在这里：`lastExit` 说的是**上一份**进程怎么结束的，而
     * 「刚重启」描述的正是那件事的后果。两句合起来才是一条完整的话——
     * 过去只有后果（「已重启」），用户仍不知道是崩溃还是被顶掉。 */
    return {
      exitNotice,
      label: "应用服务已重启",
      state: "online",
      title: exitNotice
        ? `应用服务刚重启过${at}：${exitNotice.why}。${exitNotice.detail}。当时进行中的任务已丢失，需要重新执行`
        : `应用服务刚重启过${at}：当时进行中的任务已丢失，需要重新执行`,
    };
  }

  return {
    label: "应用服务运行中",
    state: "online",
    title: "应用服务（dev server）在线：页面查询、保存与任务提交都走它",
    /* 在线且没刚重启过：上一次结束的原因与本格当前状态无关，不挂上去——
     * 否则一个几小时前的旧结论会一直贴在「运行中」后面。 */
    exitNotice: null,
  };
}
