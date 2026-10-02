/* ── ComfyUI 存活判断的**判据**：事件驱动为主、轮询为兜底（ISSUE #1351）──
 *
 * 用户的原始诉求：「现在的状态只靠轮询来判断，需要优化。真正的崩溃靠事件，
 * 不靠轮询」。此前整条存活链只有**一个**判据 —— 客户端按固定间隔打
 * `/api/comfy/stats`（4s）与 `/api/comfy/queue`（2s）。于是：
 *
 *   1. **崩溃要被下一拍发现**：进程在第 0.1s 死了，用户最晚 4s 后才看到红点，
 *      而这一拍之前界面一直报「在线」（上限就是轮询间隔）；
 *   2. **出图高峰期的最坏组合**：`/system_stats` 内部会调
 *      `torch.cuda.mem_get_info`，不是纯内存读取。生成高峰期每 2s 打一次，
 *      等于往已经排队的 aiohttp 里再插请求 —— 既拖慢用户出图，又更容易触发
 *      超时假阳性（**你越担心它死了，就越可能把它测死**）。
 *
 * 本模块是这一层的**纯判据**（无 IO、无时钟、可逐分支钉死），三件事各一处：
 *
 *   · {@link classifyLivenessPhase} —— 此刻处在哪个阶段（启动等待 / 空闲 /
 *     出图 / 隐藏 / 收到崩溃信号后的复核）；
 *   · {@link livenessIntervalMs} —— 该阶段该以多快轮询（**按阶段给频率，
 *     不用一个固定值**）；
 *   · {@link createCrashLatch} —— 连续 3 次失败才判 crash（单次只累加、
 *     成功即清零）。
 *
 * 为什么三条要放在一起而不是各回各处：它们同属**一条判据链**（阶段 → 频率 →
 * 判决），拆开会让人只看得到「这一处的间隔」而看不到它与 `verifyOnce` 的关系
 * —— 而这正是本次修复要消灭的形态。
 *
 * 机制侧（事件从哪来、SSE 怎么推）在 `./liveness-signal` 与
 * `~/lib/comfy/comfy-liveness-client`；本模块只回答「拿到事实之后怎么判」。
 */

/** 存活判据此刻所处的阶段。 */
export type LivenessPhase =
  /** 启动等待：进程在跑、HTTP 还没就绪，用户在盯着转圈。 */
  | "starting"
  /** 稳定空闲：在跑且没活儿。纯粹是「它还在吗」的保险。 */
  | "idle"
  /** 出图 / 队列执行中：GPU 繁忙，HTTP 会排队。 */
  | "generating"
  /** 窗口隐藏 / 最小化：用户看不见。 */
  | "hidden"
  /** 收到崩溃信号后的单次复核：事件驱动，不等下一拍。 */
  | "verifying";

/** 分类所需的**事实**（全部由调用方从已有状态里读，本模块不做 IO）。 */
export interface LivenessFacts {
  /** HTTP 这一拍回答了吗（`/system_stats` 连上即算，含 CUDA OOM 的 500，见 probe.ts）。 */
  up: boolean;
  /** 进程在跑（进程级快照），但 HTTP 还没就绪 —— 即「正在启动」。 */
  starting: boolean;
  /** 队列里有活儿（本应用在跑 / ComfyUI 自己排着队）。 */
  busy: boolean;
  /** 窗口不可见（页面隐藏 / 桌面壳失焦）。 */
  hidden: boolean;
  /** 刚收到进程退出事件、正在做那次单次复核。 */
  verifying: boolean;
}

/**
 * 此刻该按哪个阶段给频率。
 *
 * 判据顺序有意如此（**最紧急的排最前**）：
 *   1. `verifying` —— 崩溃复核不等下一拍，这一拍必须立刻发；
 *   2. `hidden` —— 用户看不见，先降到省资源档（此时发不发都不影响观感，
 *      但**不该**因为「反正没人看」就完全不判活：最小化后 GPU 崩了、
 *      切回来才发现，比慢一拍更坏）；
 *   3. `starting` —— 用户在盯着转圈，越快越好，且此时没有别的负载；
 *   4. `generating` —— GPU 繁忙，降压；
 *   5. 其余 = `idle`。
 *
 * 「启动中」压在「出图」之前：一个刚拉起、模型还没加载完的实例队列里可能已经
 * 有活儿（`busy` 为真），但此刻的**主诉**是「转圈要结束了吗」，而它没有生成
 * 负载 —— 用出图档的 30s 会把「就绪」拖成半分钟。
 */
export function classifyLivenessPhase(facts: LivenessFacts): LivenessPhase {
  if (facts.verifying) return "verifying";
  if (facts.hidden) return "hidden";
  if (facts.starting) return "starting";
  if (facts.busy) return "generating";
  return "idle";
}

/* ── 分阶段频率：每个数都注明它被什么约束 ─────────────────────────────────
 *
 * 与 `~/lib/retry-policy` 的具名策略同款：不是「统一取值」，而是把「为什么是
 * 这个数」从散落的字面量收成一处能读懂的定义。改任何一个数之前先读它的理由。
 */

/** 启动等待：进程在跑、HTTP 未就绪。 */
export const LIVENESS_STARTING = {
  /** 前 10s 用 400ms 一探：用户在盯着转圈，越快越好，此时也没别的负载
   *  （ComfyUI 还在 import torch / 加载模型，没有生成请求在排队）。 */
  fastMs: 400,
  /** 快档持续多久。10s 覆盖不了加载大模型的冷启动，之后降到 1s。 */
  fastWindowMs: 10_000,
  /** 10s 之后的档：仍是「用户在看」，但不必 400ms 一探。 */
  slowMs: 1000,
} as const;

/** 稳定空闲：10~15s 一探，纯粹是「它还在吗」的保险。取中值 15s。 */
export const LIVENESS_IDLE_MS = 15_000;

/** 出图 / 队列执行中：暂停或降到 30s。
 *
 *  最终选 **30s 而不是暂停**：暂停意味着「生成期间它对崩溃完全无知」，而
 *  生成正是最可能 OOM 崩掉的时段 —— 一次 30s 的探测对它几乎无成本（相对
 *  分钟级的出图），却在崩掉时能及时翻状态。进度本身走 WS 推送，不走这里
 *  （见 `executor-cli-stream`）。 */
export const LIVENESS_GENERATING_MS = 30_000;

/** 窗口隐藏 / 最小化：降到 60s（不直接停，理由见 {@link classifyLivenessPhase}）。 */
export const LIVENESS_HIDDEN_MS = 60_000;

/** 收到崩溃信号后的**单次**复核：立即发，不等下一拍（返回 0 表达「现在就跑」）。 */
export const LIVENESS_VERIFY_MS = 0;

/**
 * 该阶段该以多快轮询（毫秒）。返回 `0` 表示「立刻发这一拍」，`null` 表示
 * 「不轮询」（本模块不产出 `null` —— 五个阶段都有频率，别让调用方以为有
 * 「可以不管」的档）。
 *
 * `elapsedInStartingMs` 只在 `starting` 档参与判断（快档 → 慢档的切换点）
 * —— 其它阶段传什么都一样。
 */
export function livenessIntervalMs(
  phase: LivenessPhase,
  elapsedInStartingMs = 0,
): number {
  switch (phase) {
    case "verifying":
      return LIVENESS_VERIFY_MS;
    case "hidden":
      return LIVENESS_HIDDEN_MS;
    case "starting":
      return elapsedInStartingMs < LIVENESS_STARTING.fastWindowMs
        ? LIVENESS_STARTING.fastMs
        : LIVENESS_STARTING.slowMs;
    case "generating":
      return LIVENESS_GENERATING_MS;
    case "idle":
      return LIVENESS_IDLE_MS;
  }
}

/** 崩溃判决的三态。 */
export type CrashVerdict =
  /** 这一拍通了 —— 活着，且连续失败已清零。 */
  | "alive"
  /** 这一拍失败，但还没到阈值 —— 容忍期，**不得**改状态。 */
  | "tolerating"
  /** 连续失败达阈值 —— 可以判 crash 了。 */
  | "crashed";

/** 判 crash 前要连续失败几次。 */
export const CRASH_FAILURE_THRESHOLD = 3;

/**
 * 「连续几次失败才判 crash」的状态机。
 *
 * 铁律（ISSUE #1351）：**连续 3 次失败才判 crash**。单次失败只累加计数、
 * 成功一次就清零。出图高峰期单次超时太常见了（`/system_stats` 在 GPU 满载时
 * 会连续超时，`/queue` 同理），**一次失败就重启会把用户跑到一半的图杀掉**。
 *
 * 为什么与 `~/lib/offline-gate` 不合并：那个是**同一个语义的另一份实现**吗？
 * 不是 —— 两者判据同形，但**语义不同**且**必须各自持机**：
 *   · `offline-gate` 判的是「**这一格读数**还该不该按在线渲染」（UI 降温，
 *     阈值 3、容忍期内保留旧数据）；
 *   · 本模块判的是「**进程是不是崩了**」（要不要通知用户 / 触发重启提示）。
 * 共用一台计数机的话，两条通道（stats 4s / queue 2s）里先跑的那条会把另一条
 * 的失败清零 —— 而这正是 `use-offline-gate.ts` 文件头已经点明的坑。
 *
 * 判据也不该合并成「一个更通用的 gate」：`offline-gate` 的返回是布尔
 * （「此刻是否仍视为在线」），崩溃判决需要**三态**（`alive` / `tolerating` /
 * `crashed`）—— 压成布尔就分不出「刚失败一次」与「已经崩了」。同形不同义，
 * 各自留在自己的域里。
 */
export function createCrashLatch(
  threshold: number = CRASH_FAILURE_THRESHOLD,
): (ok: boolean) => CrashVerdict {
  let fails = 0;
  return (ok: boolean) => {
    if (ok) {
      fails = 0;
      return "alive";
    }
    fails += 1;
    return fails >= threshold ? "crashed" : "tolerating";
  };
}

/** 给用例：阈值必须 ≥1，否则第一次失败就 `fails >= 0` 恒真 —— 静默退化成
 *  「一次失败就判死」，而那正是本条要拦的形态。 */
export function assertCrashThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("CRASH_FAILURE_THRESHOLD 必须是不小于 1 的整数");
  }
}

assertCrashThreshold(CRASH_FAILURE_THRESHOLD);
