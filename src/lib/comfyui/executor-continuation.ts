/**
 * `executor-continuation.ts` — 调度层向外提供的两条回调总线（唯一注册点）
 * ===========================================================================
 *
 * 为什么需要它
 * ------------
 * executor 家族曾有一组**互相递归**的模块依赖（规范 12.7 禁止）：两条提交入口
 * （CLI 与 WS 通道）都流向收口层（complete / fail / finalize），收口层再流向
 * 调度层「让队列继续跑」，而调度层执行任务时又必须回到通道层与 CLI 层——三步
 * 首尾相接成环。当时只靠 `executor.ts` 的一句注释「加载期是安全的」维持，
 * **没有任何测试**。
 *
 * 解法是**依赖倒置**：调度层在模块加载时把实现注册进来，收口侧与通道侧只调本文件
 * 的两个出口，不再 import 调度层。依赖方向因此单向：
 *
 *     dispatch → {cli, ws, finalize} → continuation（叶子）
 *
 * 两条总线是同一件事的两个方向：
 *   • {@link kickQueue} —— 收口 / 取消之后「再领一次」（省掉等 2s 节拍）；
 *   • {@link announceToQueuedTasks} —— 通道层要告诉还在排队的任务「ComfyUI 正在
 *     自动启动 / 已就绪」，而「谁在排队」只有调度层知道（内存队列删掉之后，
 *     排队的真相在库里）。
 *
 * 为什么这样是安全的（不是「差不多能用」）
 * ----------------------------------------
 * - 注册发生在调度层模块体里，而任何收口/通道调用都晚于它：入口是
 *   `enqueue.ts → ./executor → ./executor-dispatch`，两侧的加载都先于第一次调用。
 *   `executor.ts` 特意再导出 dispatch 的三个入口，就是为了让这条注册**不依赖**
 *   `src/instrumentation.ts` 那条懒编译路径什么时候跑完。
 * - 注册缺失（例如被纯单测单独加载某个收口模块）时**不静默空转**：调度层还有
 *   2s 的常驻领取循环兜底，缺注册时各打一次 warn，避免「队列悄悄停住」无人察觉。
 *
 * @module comfyui/executor-continuation — 调度层的两条回调总线（唯一注册点）
 */
import { errorText } from "~/lib/error-message";
import { logger } from "~/lib/core/logger";
import type { LogEntry } from "./runner-state-shape";

type KickQueue = () => void | Promise<void>;

let kick: KickQueue | null = null;
let warnedMissing = false;

/** 往「还在库里排队」的任务上写一行广播的实现（由调度层注册）。 */
type Announce = (msg: string, level: LogEntry["level"]) => Promise<void>;

let announce: Announce | null = null;

/**
 * 注册「再领一次」的实现（调度层唯一的注册点）。
 *
 * 位置固定：调用点是 `executor-dispatch.ts` 的模块体，而不是某个函数内部 ——
 * 注册必须发生在任何任务被处理之前，放函数里会让「先收口后首次领取」的路径
 * 拿到 null。
 */
export function registerQueueKick(fn: KickQueue): void {
  kick = fn;
}

/**
 * 让队列继续跑（收口 / 取消结束后的统一续跑入口）。
 *
 * 语义 = 「做一次领取尝试，领不到就什么都不发生」：不抛、不 await（调用方保持
 * `void`）。它存在的唯一理由是**省掉等 2s 节拍**；正确性不依赖它——常驻领取循环
 * 才是兜底，所以本函数在注册缺失时也只是 warn 一次。
 */
export function kickQueue(): void {
  if (!kick) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        "[comfyui] 续跑回调未注册：领取将由常驻循环接管（若不出现，说明调度层未被加载）",
      );
    }
    return;
  }
  void Promise.resolve(kick()).catch((err: unknown) => {
    logger.warn(`[comfyui] ${errorText(err, "续跑出队失败")}`);
  });
}

/**
 * 注册「往排队的任务写一行广播」的实现（与 {@link registerQueueKick} 同一叶子、
 * 同一理由：通道层 `executor-ws` 需要告诉用户「ComfyUI 正在自动启动 / 已就绪」，
 * 而知道「谁在排队」的是调度层——通道层直接 import 调度层就是又造一条回边）。
 */
export function registerQueueAnnounce(fn: Announce): void {
  announce = fn;
}

/**
 * 给本进程归属片里仍在 `QUEUED` 的任务各写一行（ComfyUI 启动进度、就绪、失败…）。
 *
 * 未注册时**安静跳过并 warn 一次**：这些都是「让用户别以为连接断了」的辅助行，
 * 缺了不影响执行；但静默失效是另一种坏（没人知道自己少了提示）。
 */
export function announceToQueuedTasks(
  msg: string,
  level: LogEntry["level"] = "info",
): void {
  if (!announce) {
    logger.warn(
      `[comfyui] 排队任务广播未注册（提示「${msg.slice(0, 40)}」未写入任务日志）`,
    );
    return;
  }
  void Promise.resolve(announce(msg, level)).catch((err: unknown) => {
    logger.warn(`[comfyui] ${errorText(err, "排队任务广播失败")}`);
  });
}
