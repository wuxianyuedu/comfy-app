/* ── 「ComfyUI 为什么退出了」的判据与监督 ──────────────────────────────
 *
 * 用户的原始诉求：「comfyui 是由什么退出的需要能在日志中体现出来，有时候莫名
 * 就退出了」。此前能看到的只有一句 `ComfyUI 进程退出（code=null）`，而且：
 *
 *   1. **只记 `code`，丢了 `signal`** —— 「被 SIGKILL 强杀」与「自己 exit 1」
 *      是完全不同的两件事（前者是外部动作：任务管理器 / Job Object / OOM；
 *      后者是它自己的异常），日志里却长得一模一样；
 *   2. **保活模式压根没有退出事件** —— 进程是 `Start-Process` 的孙进程（Windows）
 *      或已 `unref`（POSIX），拿不到句柄，于是「它什么时候没的」根本不知道，
 *      只能等下一次状态轮询发现「不在了」；
 *   3. **不区分「用户点的关闭」与「自己挂了」** —— `stopRequested` 只喂给启动
 *      等待循环，不喂给退出回调。
 *
 * 本模块补前两条的判据与监督（第 3 条由调用方把 `stopRequested` 传进来）：
 *   · `describeComfyExit(facts)` —— 纯判决表，把 code / signal / 上下文翻成
 *     「一句话结论 + 结构化行 + 可行动作」；
 *   · `startComfyExitWatcher(deps)` —— 保活模式的外部监督：轮询进程表，进程消失
 *     即回调（依赖注入，可在测试里直接把时钟与进程表当参数喂）。
 *
 * 为什么监督放在**应用侧**而不是进程侧：保活模式的进程故意脱离进程树（应用退出
 * 后它还要活着），所以只能从外面看。代价是「应用也一起死了」那一档看不到 ——
 * 那由 `log/services/comfyui-last-exit.json` 的**跨会话对账**兜（见 lifecycle.ts）。
 */

/** 一次 ComfyUI 会话的退出事实。 */
export interface ComfyExitFacts {
  /** 退出码（`exit` / `close` 事件的第一个参数）。 */
  code: number | null;
  /** 终止信号（第二个参数）。**Windows 上绝大多数情况是 null** —— Node 在
   *  Windows 只在少数路径能报出信号，被 `taskkill /F` 杀掉就是 null。 */
  signal: string | null;
  /** 用户点了「关闭 ComfyUI」（与「自己挂了」分开讲）。 */
  stopRequested: boolean;
  /** 已知 pid（保活模式由监督器记住）。 */
  pid: number | null;
  /** 进程存活时长（毫秒）；未知为 null。 */
  uptimeMs: number | null;
  /** 会话模式 —— 决定「拿不到退出码」这句话该怎么讲。
   *  `studio` 是 Drizzle Studio（它复用同一套退出原语，见 lifecycle-wait）。 */
  mode: "keepAlive" | "bound" | "cli" | "studio";
}

export interface ComfyExitReport {
  /** 一句话结论（进 `[exit]` 行与会话横幅）。 */
  reason: string;
  /** 结构化明细（key=value，便于事后 grep 与贴给别人看）。 */
  detail: string;
  /** 值得额外做的动作（null = 不需要）。 */
  advice: string | null;
}

/** 时长 → `1h02m` / `3m20s` / `42s`（日志里读着顺即可，不做精度承诺）。 */
export function formatUptime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "未知";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;
}

/** 判断「被信号杀掉」时，最值得提醒用户去查的那几种。 */
const SIGNAL_ADVICE: Record<string, string> = {
  SIGKILL:
    "SIGKILL 是外部动作、不给进程留遗言：常见于任务管理器结束进程、Windows 上编排器/Job Object 关闭时的连带杀树、或系统内存不足被 OOM 杀手挑中。",
  SIGTERM: "SIGTERM 是请求退出：常见于关机/注销、或外部脚本调用 kill。",
  SIGINT: "SIGINT 来自 Ctrl+C：通常是有人在跑它的窗口里按了中断。",
};

/**
 * 把退出事实翻成「为什么退出」。
 *
 * 判据顺序有意如此：`stopRequested` 最先（那是我们自己发起的），信号其次
 * （外部动作，最需要说清），最后才是退出码。**两者都有时以信号为准** ——
 * 被信号杀掉的进程，退出码是派生物，不是原因。
 */
export function describeComfyExit(facts: ComfyExitFacts): ComfyExitReport {
  const tail =
    `pid=${facts.pid ?? "未知"} 存活=${formatUptime(facts.uptimeMs)}` +
    ` code=${facts.code ?? "null"} signal=${facts.signal ?? "null"} 模式=${facts.mode}`;

  if (facts.stopRequested) {
    return {
      reason: "用户主动关闭",
      detail: tail,
      advice: null,
    };
  }

  if (facts.signal !== null) {
    return {
      reason: `被信号终止（${facts.signal}）`,
      detail: tail,
      advice:
        SIGNAL_ADVICE[facts.signal] ??
        `进程被信号 ${facts.signal} 终止 —— 它自己不会发这个信号，通常是外部动作。`,
    };
  }

  if (facts.code === 0) {
    return {
      reason: "正常收工（exit 0）",
      detail: tail,
      advice:
        "退出码 0 说明它自己认为跑完了。若你并没有关它，留意是不是被别的入口（另一个实例 / 脚本）接管或顶掉了。",
    };
  }

  if (facts.code !== null) {
    return {
      reason: `异常退出（exit ${facts.code}）`,
      detail: tail,
      advice:
        "看它崩溃前的最后几行输出（本文件上方与本行的 [out]/[err]），Python 侧异常、缺依赖、显存不足都会以非零码退出。",
    };
  }

  /* 保活模式拿不到退出码（进程不是我们的子进程）——如实说清，别编一个原因。 */
  return {
    reason: "进程消失（保活模式拿不到退出码）",
    detail: tail,
    advice:
      "保活模式的进程故意脱离进程树，应用只能从外面看到它不在了。要看退出码请改用「关闭应用时连带关闭 ComfyUI」（bound 模式，直连 stdio 与退出事件）。",
  };
}

/* ── 保活模式的退出监督 ─────────────────────────────────────────────── */

export interface ComfyExitWatcherDeps {
  /** 查「跑着 main.py 的进程」的 pid；找不到返回 null。 */
  findPid: () => Promise<number | null>;
  /** 确定退出时回调一次（之后监督器自停）。 */
  onExit: (facts: { pid: number | null; uptimeMs: number | null }) => void;
  /** 用户是否已请求关闭（主动关就不报「莫名退出」）。 */
  isStopped: () => boolean;
  /** 轮询间隔（默认 10s：这是「事后发现」，不需要启动期那种 2s 密度）。 */
  intervalMs?: number;
  /** 注入时钟（测试用）。 */
  now?: () => number;
  /** 连续多少次查不到才判死（默认 2，与启动期同口径 —— 单次查询在冷启动高负载
   *  下可能超时误报）。 */
  missThreshold?: number;
  /** 定时器工厂（测试传入可控实现）。 */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearTimer?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * 轮询进程表，发现「跑着 main.py 的进程」消失时报一次退出。
 *
 * 保活模式没有子进程句柄（见文件头第 2 条），这是**唯一**能拿到退出时刻的途径。
 * 它回答的是「什么时候没的、活了多久」，拿不到退出码 —— 那件事由
 * `describeComfyExit` 如实讲明，而不是编一个 code。
 *
 * @returns `{ stop }`：宿主在「用户主动关」或「重新拉起」时必须调用，否则监督器
 *   会把下一次拉起当成「上一次还在跑」。
 */
export function startComfyExitWatcher(deps: ComfyExitWatcherDeps): {
  stop: () => void;
} {
  const interval = deps.intervalMs ?? 10_000;
  const now = deps.now ?? Date.now;
  const missThreshold = deps.missThreshold ?? 2;
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearInterval(h));

  let stopped = false;
  let startedAt: number | null = null;
  let seenPid: number | null = null;
  let missCount = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer(handle);
  };

  const tick = async () => {
    if (stopped) return;
    /* 主动关闭：监督器的职责到此为止，不报「莫名退出」（那条退出记录由关闭
     * 路径自己落）。 */
    if (deps.isStopped()) {
      stop();
      return;
    }
    const pid = await deps.findPid().catch(() => null);
    if (stopped) return;

    if (pid === null) {
      /* 还没第一次见到它 → 可能是「拉起失败」而不是「退出」：那种情况启动等待
       * 循环会自己报错，这里不抢答。 */
      if (startedAt === null) return;
      missCount += 1;
      if (missCount < missThreshold) return;
      stop();
      deps.onExit({
        pid: seenPid,
        uptimeMs: startedAt === null ? null : now() - startedAt,
      });
      return;
    }

    seenPid = pid;
    missCount = 0;
    startedAt ??= now();
  };

  const handle = setTimer(() => {
    void tick();
  }, interval);
  /* 监督器不该成为「进程退不出去」的原因（Node 里未 unref 的 interval 会吊住
   * 事件循环）。 */
  if (typeof handle === "object" && handle !== null && "unref" in handle) {
    (handle as { unref: () => void }).unref();
  }

  return { stop };
}

/** 一次会话的落盘标记（`log/services/comfyui-last-session.json`）。 */
export interface ComfySessionMark {
  pid: number | null;
  mode: ComfyExitFacts["mode"];
  /** 会话开始时刻（ISO）。 */
  startedAt: string;
  /** 退出记录；null = **有开始没结束**。 */
  exited: { at: string; reason: string } | null;
}

/**
 * 对账：上一次会话是不是「有开始没结束」。
 *
 * 这是**应用自己也一起没了**那一档的唯一出口 —— 编排器退出时 Windows 的
 * Job Object 会连带静默杀树、强制关机、任务管理器结束进程，这些情况下没有任何
 * 活着的进程能写日志，只能在下一次启动时对照上一次的标记反推。
 *
 * @returns 该提醒的一句话；一切正常（没有标记 / 上次有始有终）返回 null
 */
export function describeStaleSession(
  mark: ComfySessionMark | null,
): string | null {
  /* `mark?.exited !== null` 同时覆盖「没有标记」（undefined ≠ null）与「已结束」
   * 两种该闭嘴的情况。 */
  if (mark?.exited !== null) return null;
  return (
    `上一次 ComfyUI 会话（pid=${mark.pid ?? "未知"}，${mark.mode} 模式）` +
    `开始于 ${mark.startedAt}，却没有退出记录 —— 说明应用或系统在它之前就结束了` +
    "（编排器退出时的连带杀树、强制关机、任务管理器结束进程都会这样）。"
  );
}

/**
 * 保活模式「进程消失了」的落盘：判据 + 横幅 + `[exit]` 两行。
 *
 * 单独抽出来是因为它与 bound 的退出回调**长得像但不等价**：这里 code / signal
 * 都拿不到（进程不是我们的子进程），能给的只有「什么时候没的、活了多久」。
 * 把「拿不到就说拿不到」写在同一个出口里，免得下一处顺手编一个 `code=0`。
 */
export function reportKeepAliveExit(opts: {
  facts: { pid: number | null; uptimeMs: number | null };
  stopRequested: boolean;
  appendSessionBanner: (banner: string) => void;
  appendRuntimeLog: (line: string) => void;
  log: (msg: string) => void;
}): ComfyExitReport {
  const report = describeComfyExit({
    code: null,
    signal: null,
    stopRequested: opts.stopRequested,
    pid: opts.facts.pid,
    uptimeMs: opts.facts.uptimeMs,
    mode: "keepAlive",
  });
  opts.appendSessionBanner(`■ ComfyUI 保活进程已退出：${report.reason}`);
  opts.appendRuntimeLog(`[exit] ${report.reason}（${report.detail}）`);
  if (report.advice !== null) {
    opts.appendRuntimeLog(`[exit] ↩ ${report.advice}`);
  }
  opts.log(`ComfyUI 保活进程已退出：${report.reason}`);
  return report;
}
