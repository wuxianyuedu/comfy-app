/**
 * `executor-scheduler.ts` — 队列调度与心跳（executor 的调度层）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「调度器」模块（batch 4）：
 *   - {@link processQueue}      出队 + 提交（两种格式统一交 comfy-cli）
 *   - startHeartbeat            3s 安全网心跳，防止边缘场景队列卡死
 *
 * 提交**只有一条路径**：{@link executeViaComfyCli}。RAW 原件由 cli 做权威的
 * UI→API 转换与子图展开，API 图由 cli 直接提交（提交前的旁路/静音收拾在
 * executor-cli 里完成）。此前 API 走 postPrompt、RAW 走 cli，两条路径各自
 * 维护一套提交与报错口径，同一份工作流换个格式就有不同的文案。
 *
 * @module comfyui/executor-scheduler — 队列调度与心跳（executor 的调度层）
 */
import WebSocket from "ws";
import { logger } from "~/lib/core/logger";
import { state, log, MAX_CONCURRENCY } from "./runner-state";
import { registerQueueKick } from "./executor-continuation";
import { executeViaComfyCli } from "./executor-cli";
import { finalizeFailure } from "./executor-finalize";
import { connect } from "./executor-ws";

/* 把「续跑出队」注册进叶子总线（唯一注册点，规范 12.7 断环）：
 * 收口侧（finalize / ws）此前直接 import 本模块的 processQueue，形成
 * `cli/ws → finalize → scheduler → cli/ws` 的环。改由本模块在**加载时**注册，
 * 收口侧只调 kickQueue()，依赖方向因此单向。
 *
 * 放在模块体（不放进函数）的原因：注册必须先于任何任务处理 —— 入口链是
 * `enqueue → ./executor → ./executor-scheduler`，调度层模块体先求值完毕，
 * 任务才可能被收口。 */
registerQueueKick(processQueue);

export async function processQueue() {
  const s = state();
  if (s.active >= MAX_CONCURRENCY) return;
  if (s.ws?.readyState !== WebSocket.OPEN) {
    // WS 尚未就绪：任务会留在队列里等 connect() 重连成功后再出队。此前这段
    // 等待对用户完全不可见——前端只见「等待日志…」，不知是 ComfyUI 未运行、
    // 自动启动中，还是连不上。这里给每个排队任务写一条一次性提示（wsWaitLogged
    // 防心跳每 3s 刷屏），让用户看到任务在等什么。
    for (const job of s.queue) {
      if (s.wsWaitLogged.has(job.taskId)) continue;
      s.wsWaitLogged.add(job.taskId);
      log(
        job.taskId,
        "warn",
        "⏳ 等待 ComfyUI WebSocket 连接就绪；若 ComfyUI 未运行且已开启自动启动，将自动拉起并在此后继续执行…",
      );
    }
    void connect();
    return;
  }
  const job = s.queue.shift();
  if (!job) return;
  s.active += 1;

  /* 完整输入参数入日志：任务日志是复现与排障的唯一现场（dev server 重启
   * 后内存队列出清，落库的日志行是唯一遗留），把本次提交的 workflowInputs
   * 全量打进日志——执行日志面板与历史回放都能看到当时到底填了什么。 */
  if (job.overrides?.length) {
    log(
      job.taskId,
      "info",
      `输入参数（workflowInputs，${job.overrides.length} 项）：\n` +
        JSON.stringify(job.overrides, null, 2),
    );
  }

  /* 两种格式统一交给 comfy-cli（见模块头注释）。
   *
   * fire-and-forget + `.catch`：`executeViaComfyCli` 若 reject（resolveComfyBase
   * throw、writeFile EACCES、spawn ENOENT on a missing Python binary…），不加
   * `.catch` 会变成 unhandled rejection —— 没有任何 fail()/finalizeFailure()
   * 跑过，`s.active` 永远停在 1，此后所有 enqueue 都被这个假占用的槽位堵死
   * （界面表现：任务永远 QUEUED 0%）。所以必须把 rejection 兜进统一收口路径。 */
  void executeViaComfyCli(job).catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(job.taskId, "error", `工作流启动异常：${msg}`);
    try {
      await finalizeFailure(job.taskId, "", msg);
    } catch (inner) {
      /* finalizeFailure 自己也可能抛（数据库挂了）—— 不要再嵌一层 catch 递归，
       * 只记日志 + 手动归还并发槽，让队列继续往前走。 */
      log(
        job.taskId,
        "error",
        `finalizeFailure 二次失败：${inner instanceof Error ? inner.message : String(inner)}`,
      );
      if (s.startedAt.has(job.taskId)) s.startedAt.delete(job.taskId);
      s.lastNodeByTask.delete(job.taskId);
      s.active = Math.max(0, s.active - 1);
      void processQueue();
    }
  });
}
/* 兜底心跳。`processQueue()` 正常由三处驱动：
 *    (a) 用户点「生成」后的 enqueue()
 *    (b) WS open
 *    (c) finalizeFailure / cancelTask（在 active-- 之后）
 *
 *  少数边界情形下这三处都不会及时触发：
 *    - 第一次 WS 尝试在 `new WebSocket()` 阶段就失败，随后
 *      `scheduleReconnect` 推迟下一次尝试；在这段退避期里，躺在 `s.queue`
 *      里的任务没有任何触发器。
 *    - 本该在 `executeViaComfyCli` 里调 processQueue 的那段逻辑跑了，但
 *      comfy-cli 进程 spawn 成功、JS 的 `spawn` Promise 直接 resolve，
 *      从未发出 "queued" → 没有别的生命周期会再触发它。
 *  没有心跳时，用户会永远看到 "QUEUED 0%" —— 哪怕槽是空的、WS 也是通的。
 *  这里每 3s 轮一次，只要还有推进空间（队列非空、槽为空、WS 已 OPEN）就重跑
 *  processQueue。幂等 —— 没事可做时 processQueue 是空操作。
 *
 *  用全局标志避免 HMR 下模块被重新 import 时起两条心跳。 */
const HEARTBEAT_MS = 3000;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
function startHeartbeat() {
  if (heartbeatHandle) return;
  heartbeatHandle = setInterval(() => {
    try {
      const s = state();
      if (s.queue.length > 0 && s.active < MAX_CONCURRENCY) {
        void processQueue();
      }
    } catch (err) {
      logger.warn(
        `[comfyui] heartbeat processQueue 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, HEARTBEAT_MS);
}
startHeartbeat();
