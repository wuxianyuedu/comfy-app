/**
 * `executor-continuation.ts` — 出队续跑的回调总线（唯一注册点）
 * ===========================================================================
 *
 * 为什么需要它
 * ------------
 * executor 家族曾有一组**互相递归**的模块依赖（规范 12.7 禁止）：
 *
 * 两条提交入口（CLI 与 WS 通道）都流向收口层（complete / fail / finalize），
 * 收口层再流向调度层（processQueue）继续出队；而调度层执行任务时又必须回到
 * 通道层与 CLI 层 —— 这三步首尾相接，构成一个环。
 *
 * 环的**真实成因**只有一类边：`finalize` / `ws` 收口结束后要「让队列继续跑」，
 * 因此 `import { processQueue } from "./executor-scheduler"`。而调度层反过来必须
 * import 它们才能执行任务 —— 于是三方成环，此前只靠 `executor.ts` 的一句注释
 * 「加载期是安全的」维持，**没有任何测试**。
 *
 * 现在把这条「向后收口 → 向前续跑」的边改为**依赖倒置**：续跑动作由调度层在
 * 模块加载时注册进来，收口侧只调 {@link kickQueue}，不再 import 调度层。
 * 依赖方向因此变成单向的
 *
 *     scheduler → {cli, ws, finalize} → continuation（叶子）
 *
 * 为什么这样是安全的（不是「差不多能用」）
 * ----------------------------------------
 * - `kickQueue` 在调度层**模块体**里注册，而调度层的加载先于任何任务执行：
 *   入口是 `enqueue.ts → ./executor → ./executor-scheduler`，出队/提交都发生在
 *   该模块被求值之后。因此收口路径调用时回调必已就位。
 * - 即便注册因故缺失（例如被纯单测单独加载某个收口模块），`kickQueue` 也**不是
 *   静默空转**：调度层另有一处 3s 安全网心跳（`startHeartbeat`）会重新出队，
 *   等价于旧行为里的兜底。缺注册时打一次 warn，避免「队列悄悄停住」无人察觉。
 *
 * @module comfyui/executor-continuation — 出队续跑的回调总线（唯一注册点）
 */
import { errorText } from "~/lib/error-message";
import { logger } from "~/lib/core/logger";

type KickQueue = () => void | Promise<void>;

let kick: KickQueue | null = null;
let warnedMissing = false;

/**
 * 注册「继续出队」的实现（调度层唯一的注册点）。
 *
 * 位置固定：调用点是 `executor-scheduler.ts` 的模块体，而不是某个函数内部 ——
 * 注册必须发生在任何任务被处理之前，放函数里会让「先收口后首次出队」的路径
 * 拿到 null。
 */
export function registerQueueKick(fn: KickQueue): void {
  kick = fn;
}

/**
 * 让队列继续跑（收口结束后的统一续跑入口）。
 *
 * 语义与旧的直接调用 `processQueue()` **逐字一致**：一次出队尝试、失败不抛出
 * （调度层的实现自己吞并记录）。`void` 语义由调用方保持（旧代码也是 `void
 * processQueue()`），因此这里把返回值原样透传给调用方决定是否 await。
 */
export function kickQueue(): void {
  if (!kick) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        "[comfyui] 续跑回调未注册：出队将由 3s 安全网心跳接管（若不出现，说明调度层未被加载）",
      );
    }
    return;
  }
  void Promise.resolve(kick()).catch((err: unknown) => {
    logger.warn(`[comfyui] ${errorText(err, "续跑出队失败")}`);
  });
}
