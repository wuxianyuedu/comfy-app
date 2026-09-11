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
 * 判据（三态，都由「一次探测有没有拿到 bootId」派生，不依赖任何业务接口）：
 *   online   探测成功拿到进程标识 → 应用服务在线（顺带说明「有没有真正重启」）；
 *   offline  网络层失败且已有过一次成功 → 进程不可达（服务停了 / 窗口断开了）；
 *   starting 尚未有过成功探测 → 首次探测还没回来，不冒充在线也不报故障。
 *
 * 纯函数、无 React、无 IO（规范 17 §17.2 第①层），可直接单测。
 */

/** 应用服务三态：尚未探通 / 在线 / 不可达。 */
export type DevServerState = "starting" | "online" | "offline";

export interface DevServerStatusInput {
  /** 本次会话是否曾成功探测到进程标识。 */
  everOnline: boolean;
  /** 最近一次探测是否成功。 */
  lastProbeOk: boolean;
  /** 是否检测到**真正**重启（进程标识变化，见 use-dev-server-liveness）。 */
  restarted: boolean;
  /** 最近一次真正重启的时刻。 */
  lastRestartAt: number | null;
}

export interface DevServerStatus {
  state: DevServerState;
  /** 状态栏可读文案（短，供右下角窄位展示）。 */
  label: string;
  /** 悬停 `title`：一句话说明含义与此刻能做什么。 */
  title: string;
}

export function deriveDevServerStatus(input: DevServerStatusInput): DevServerStatus {
  const { everOnline, lastProbeOk, restarted, lastRestartAt } = input;

  if (!lastProbeOk && everOnline) {
    return {
      state: "offline",
      label: "应用服务已断开",
      title:
        "应用服务（dev server）当前不可达：页面里的查询与保存都会失败。应用窗口重新打开或服务重启后会自动恢复",
    };
  }

  if (!lastProbeOk) {
    return {
      state: "starting",
      label: "应用服务连接中",
      title: "正在连接应用服务（dev server）…",
    };
  }

  if (restarted) {
    const at =
      lastRestartAt === null
        ? ""
        : `（${new Date(lastRestartAt).toLocaleTimeString("zh-CN", { hour12: false })}）`;
    return {
      state: "online",
      label: "应用服务已重启",
      title: `应用服务刚重启过${at}：当时进行中的任务已丢失，需要重新执行`,
    };
  }

  return {
    state: "online",
    label: "应用服务运行中",
    title: "应用服务（dev server）在线：页面查询、保存与任务提交都走它",
  };
}
