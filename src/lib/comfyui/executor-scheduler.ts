/**
 * `executor-scheduler.ts` — 队列调度与心跳（executor 的调度层）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「调度器」模块（batch 4）：
 *   - {@link processQueue}      出队 + 提交 ComfyUI /prompt（含 raw 路径分流）
 *   - startHeartbeat            3s 安全网心跳，防止边缘场景队列卡死
 *
 * 提交的两种路径：
 *   - API 格式 graph（常规）：prepareGraphForExecution → postPrompt
 *   - raw UI-format（liblib 子图）：交给 executor-cli 的 executeViaComfyCli
 *
 * @module comfyui/executor-scheduler
 */
import WebSocket from "ws";
import { taskRepository } from "../core/repository";
import { logger } from "~/lib/core/logger";
import { postPrompt } from "./client";
import { prepareGraphForExecution } from "./raw";
import { extractValidationErrors } from "./validation";
import { state, log, CLIENT_ID, MAX_CONCURRENCY } from "./runner-state";
import { registerQueueKick } from "./executor-continuation";
import { executeViaComfyCli } from "./executor-cli";
import { fail, finalizeFailure } from "./executor-finalize";
import { connect, armWatchdog } from "./executor-ws";
import { buildPromptError } from "./executor-errors";

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

  try {
    // raw UI-format 工作流（含 liblib 子图 wrapper）：交给 comfy-cli 做
    // UI→API 转换 + 子图展开，原生客户端 graphToPrompt，绕开 UUID class_type。
    // the previous `void executeViaComfyCli(job)`
    // (no .catch) was a *latent* active-slot deadlock.  If
    // `executeViaComfyCli` rejected synchronously (resolveComfyBase
    // throw, writeFile EACCES, spawn ENOENT on a missing Python
    // binary…), the rejection became an unhandled promise, no
    // fail()/finalizeFailure() ever ran, and `s.active` stayed
    // pegged at 1 forever.  That pegged slot then blocked every
    // later enqueue — task visible in the UI as "QUEUED 0%",
    // stuck indefinitely.  We now `.catch` the rejection and
    // funnel it through the same `finalizeFailure` path that
    // every other failure mode uses, so `s.active--` always fires
    // and the next queued job gets a chance.
    if (job.rawJson) {
      void executeViaComfyCli(job).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(job.taskId, "error", `raw 工作流启动异常：${msg}`);
        try {
          await finalizeFailure(job.taskId, "", msg);
        } catch (inner) {
          /* finalizeFailure may itself throw (DB down) — don't
           *  recurse into another catch, just log and release
           *  the slot manually so the queue keeps moving. */
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
      return;
    }
    // 提交前剔除 bypass / mute / 纯前端节点(Reroute/Primitive/Note)，
    // 并对连线做穿透，严格对齐 ComfyUI 真实执行语义（P1：mode/Reroute）。
    const prep = prepareGraphForExecution(job.prompt!);
    // 记下本次实际提交给 ComfyUI 的 graph（已展开、已穿透），
    // 任务完成落盘为 workflow.json 供完整复现。
    s.executedWorkflow.set(job.taskId, prep.graph);
    if (!Object.keys(prep.graph).length) {
      await fail(job.taskId, "", "工作流没有可执行的节点（可能全部被禁用）");
      return;
    }
    if (prep.removed.length) {
      log(
        job.taskId,
        "info",
        `执行前跳过 ${prep.removed.length} 个禁用/纯前端节点` +
          (prep.droppedInputs ? `，丢弃 ${prep.droppedInputs} 个悬空输入` : ""),
      );
    }
    // explicit pre-submit log so the user
    // sees a clear "→ 提交" line right before the HTTP POST to
    // ComfyUI.  Useful when /prompt hangs or rejects — without this
    // the user only ever sees the post-submit "✓ 已接收" line, which
    // makes it impossible to tell whether the request was ever sent.
    const nodeCount = Object.keys(prep.graph).length;
    log(
      job.taskId,
      "info",
      `→ 准备提交到 ComfyUI /prompt（${nodeCount} 节点）`,
    );
    const res = await postPrompt(prep.graph, CLIENT_ID);
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      // carry the flattened `node_errors` into the task
      // so the UI can show "节点 X · 字段 Y：消息" instead of just the
      // "Workflow has N validation error(s)" summary.
      const validationErrors = extractValidationErrors(res, prep.graph);
      // mirror the raw-path branch's behaviour
      // (lines 1199-1224) — surface the structured list as per-line
      // log entries so the user sees "节点 X (KSampler) · 字段 cfg：…"
      // in the log panel *before* the closing "✗ 生成失败" line, and
      // not just the English summary from `buildPromptError`.  Without
      // this, a user staring at the panel saw one line ("✗ 生成失败:
      // Workflow has 6 validation error(s) against server") and no
      // way to identify which of the 6 fields to fix.  Capped at 12 to
      // match the raw branch and avoid blowing up the DB row when a
      // workflow drifts badly.
      if (validationErrors.length) {
        log(
          job.taskId,
          "error",
          `✗ ComfyUI 报 ${validationErrors.length} 条校验错误（见下方逐条 + 红框清单）`,
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            job.taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`,
          );
        });
        if (validationErrors.length > 12) {
          log(
            job.taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框 / 重新执行工作流查看完整清单）`,
          );
        }
      }
      await fail(
        job.taskId,
        "",
        buildPromptError(res, prep.graph),
        validationErrors,
      );
      return;
    }
    // prompt_id 缺失时保持原行为（undefined 透传给 markRunning / watchdog），
    // 这里仅做类型收口，不改变运行时取值。
    const promptId = res.prompt_id!;
    s.promptToTask.set(promptId, job.taskId);
    await taskRepository.markRunning(job.taskId, promptId);
    // richer post-submit log so the user
    // can correlate the prompt_id they see in the panel with the
    // /history/{prompt_id} ComfyUI URL when investigating hangs.
    log(
      job.taskId,
      "info",
      `✓ ComfyUI 已接收（prompt_id: ${promptId}），等待首个 executing 事件…`,
    );
    armWatchdog(job.taskId, promptId);
  } catch (e) {
    await fail(
      job.taskId,
      "",
      (e as { message?: unknown } | null | undefined)?.message ?? "提交失败",
    );
  }
}

/* safety-net heartbeat. `processQueue()`
 *  is normally driven by:
 *    (a) enqueue() right after the user clicks 生成
 *    (b) WS open  (line 181)
 *    (c) finalizeFailure / cancelTask (after active--)
 *
 *  In a few edge cases, none of these fire promptly:
 *    - The very first WS attempt fails during `new WebSocket()`,
 *      then `scheduleReconnect` defers the next attempt; during
 *      the back-off, a job sitting in `s.queue` has no trigger.
 *    - The handler that's supposed to call processQueue inside
 *      `executeViaComfyCli` runs, but the comfy-cli process spawn
 *      succeeds and the JS `spawn` promise resolves without ever
 *      emitting "queued" → no other life cycle re-fires it.
 *  Without a heartbeat, the user sees "QUEUED 0%" forever even
 *  though the slot is free and the WS is up.  We poll every 3s
 *  and re-run processQueue if it can make progress (queue non-
 *  empty, slot free, WS OPEN).  Idempotent — `processQueue` is a
 *  no-op when there's nothing to do.
 *
 *  Global flag to avoid double-heartbeats if the module is
 *  re-imported under HMR. */
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
