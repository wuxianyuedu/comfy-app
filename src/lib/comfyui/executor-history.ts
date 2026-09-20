/**
 * `executor-history.ts` — /history 轮询与队列现场（执行链的**叶子**诊断模块）
 * ===========================================================================
 *
 * 从 `executor-ws.ts` 抽出的两个「只读 ComfyUI、不改状态机」的单元：
 *   - {@link fetchHistoryEntry}  轮询 `GET /history/{prompt_id}` 直到拿到结果
 *   - {@link traceComfyQueue}    探测 `/queue` 快照并落 trace
 *   - {@link ComfyHistoryEntry}  最小结构视图（finalize 侧也要用）
 *
 * 抽出的理由是**断环**（规范 12.7）：`executor-finalize` 需要这两个函数，
 * 而 `executor-ws` 需要 finalize 的 `complete` / `fail` —— 两边互相 import
 * 成环。把「谁都不依赖、只依赖 client + runner-state」的部分下沉成本层叶子后，
 * 依赖方向变成单向的 `finalize → history`、`ws → history`。
 *
 * 共享类型也在这里（§18：需要被多个 lib 模块共用的类型下沉到类型模块）。
 *
 * @module comfyui/executor-history — /history 轮询与队列现场（执行链的**叶子**诊断模块）
 */
import { getHistory, resolveComfyBase } from "./client";
import { HISTORY_RETRIES, HISTORY_RETRY_DELAY_MS, state } from "./runner-state";
import { queueTraceSummary, trace } from "./trace";
import { sleep } from "~/lib/with-timeout";

/**
 * ComfyUI `GET /history/{prompt_id}` 单条条目的最小结构视图
 * （外部输入，字段仅取本层与 finalize / outputs 层实际读取的部分；
 * 结构对照 0.33.1：`outputs`、`status.status_str`、`status.messages`、
 * `prompt`（prompt graph 数组，`prompt[2]` 为 API graph））。
 */
export type ComfyHistoryEntry = {
  outputs?: Record<string, unknown>;
  status?: {
    status_str?: string;
    messages?: unknown[];
  };
  prompt?: unknown;
};

/** 轮询 history —— ComfyUI 是「先广播完成、后写 history」，直接读会扑空。
 *
 *  ISSUE #216：本函数返回 null 时调用方只会写一句「未找到生成结果」，用户没有任何
 *  现场可查。因此这里在**每个终局分支**都把原始回执写进 trace（comfyui/trace.ts）：
 *  promptId 是什么、轮询了几轮、最后一轮 /history 的原始 JSON、以及 ComfyUI 的
 *  实时 /queue 快照（回答「任务其实还在跑吗」）。 */
export async function fetchHistoryEntry(
  promptId: string,
): Promise<ComfyHistoryEntry | null> {
  let lastRaw: Record<string, unknown> | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < HISTORY_RETRIES; i++) {
    try {
      const hist = await getHistory(promptId);
      lastRaw = hist;
      lastErr = null;
      const entry = hist?.[promptId] as ComfyHistoryEntry | undefined;
      // outputs 落盘也可能晚一拍，等到有 outputs 或明确报错为止。
      if (entry && (entry.outputs || entry.status?.status_str)) {
        /* 拿到结果也原样记一份：成功路径同样需要「ComfyUI 回了什么」的现场。 */
        trace(
          "history",
          taskTraceIdForPrompt(promptId),
          `history 命中（第 ${i + 1} 轮）`,
          {
            promptId,
            entry,
          },
        );
        return entry;
      }
      if (entry && i >= 3) {
        trace(
          "history",
          taskTraceIdForPrompt(promptId),
          `history 有条目但 outputs/status 一直为空（第 ${i + 1} 轮），不再干等`,
          { promptId, entry },
        );
        return entry;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(HISTORY_RETRY_DELAY_MS);
  }
  /* 12 轮都没等到：把「最后一轮原始响应 / 最后一次网络错误 / ComfyUI 当前队列」
   * 一起落盘，否则「未找到生成结果」这个结论无法再往下追。 */
  const taskId = taskTraceIdForPrompt(promptId);
  trace(
    "history",
    taskId,
    `history 拉取失败（重试 ${HISTORY_RETRIES} 轮，promptId=${promptId || "(空)"}）`,
    {
      promptId,
      lastRaw,
      lastError: lastErr instanceof Error ? lastErr.message : lastErr,
    },
  );
  await traceComfyQueue(taskId);
  return null;
}

/**
 * promptId → taskId（仅用于 trace 行归属）。trace 只做展示，拿不到就写 `-`。
 * 直接读共享状态而不引入新参数：本函数所有调用方都来自同一条执行链。
 */
function taskTraceIdForPrompt(promptId: string): string | null {
  if (!promptId) return null;
  return state().promptToTask.get(promptId) ?? null;
}

/**
 * 探测 ComfyUI 的 /queue 与 /history 概览并落 trace（失败不抛出）。
 *
 * 失败收口前调用：区分「任务还排在 ComfyUI 队列里（只是没跑完）」与
 * 「ComfyUI 压根没收到这个 prompt」这两种完全不同的现场。 */
export async function traceComfyQueue(taskId: string | null): Promise<void> {
  let base = "";
  try {
    base = await resolveComfyBase();
    const r = await fetch(`${base}/queue`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!r.ok) {
      trace("http", taskId, `/queue 探测失败 HTTP ${r.status}`, { base });
      return;
    }
    const qd = (await r.json()) as unknown;
    const sum = queueTraceSummary(qd);
    trace("http", taskId, "ComfyUI /queue 快照", { base, ...sum, raw: qd });
  } catch (err) {
    trace("http", taskId, "ComfyUI /queue 探测不可达", {
      base,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
