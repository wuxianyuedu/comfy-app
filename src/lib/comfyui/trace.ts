/**
 * `trace.ts` — ComfyUI 原始回执通道（trace.log）
 * ===========================================================================
 *
 * 用途（ISSUE #216）：出问题时用户只看到「✗ 生成失败：未找到生成结果」这样一句
 * 结论，而**没有**任何 ComfyUI 侧的原始证据——comfy-cli 的 stdout/stderr、
 * 结构化的执行错误、/history 里到底有什么、/queue 里还剩什么，全都没落盘。
 * 没有现场就无法定位到底是「CLI 没回传 prompt_id」「history 空」还是
 * 「工作流跑完但输出被丢」。
 *
 * 因此这里开一条**独立于任务日志面板**的通道：把 ComfyUI 路径上的关键事件按
 * `组件 [taskId] 内容` 逐行追加写 `log/comfyui/comfyui-trace.log`。
 *
 * 为什么独立于 `runner-state.ts` 的 `log()`：
 *   - 任务日志要进面板，必须精简（见规范 07 §7.13/§7.14）；这里要的是**完整**，
 *     包括多行 JSON 原文与每个 stdout/stderr 原始 chunk。
 *   - 与 `app-runtime.log` 同属「追加写 + 面板可轮询」的 runtime 家族（规范 07
 *     §7.11），但更底层：COMfyUI 通信层所有原始回执，与业务操作日志解耦，便于
 *     单独归档/上传做支持。
 *   - 行格式与 `comfyui-runtime.log` 等 runtime 一致：
 *     `[YYYY-MM-DD HH:mm:ss.mmm] [级别] [子组件] 组件 [taskId] 内容`
 *     （子组件为 `cli` / `ws` / `http` / `history` / `session`，见 {@link TraceChannel}），
 *     同一文件按需再细分。
 *
 * 硬约束：
 *   - **写入失败绝不阻塞或抛出**：trace 是诊断通道，不能因为磁盘/权限把生成带崩。
 *   - **内容显式截断**：单行上限 {@link TRACE_MAX_LINE}，超出标记 `…(truncated)`，
 *     避免一个巨大 payload 把文件写成几 MB。
 *   - **路径来自 `log-paths`**（唯一事实来源），不在本文件手拼 `log/` 目录。
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";

import { redactSecretShaped } from "~/lib/core/redact-secret";
import { COMFYUI_TRACE_LOG } from "~/lib/log-paths";

/** trace 子组件：同一 trace 文件中用来区分消息来自哪条通道。 */
export type TraceChannel = "cli" | "ws" | "http" | "history" | "session";

/** 单行内容上限（字符）。JSON 原文按此截断，避免把诊断文件写成数十 MB。 */
export const TRACE_MAX_LINE = 8000;

/** 本地时间戳（YYYY-MM-DD HH:mm:ss.mmm）——与 runtime 家族日志同口径。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
  );
}

/** 把任意值转成可读文本（对齐规范 07 §7.10：Error 取 stack，循环引用兜底）。 */
export function traceStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (value instanceof Error)
    return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      /* 循环引用 / BigInt 等：退化为带类型的占位，避免 "[object Object]" */
      return `[unserializable ${Object.prototype.toString.call(value)}]`;
    }
  }
  if (typeof value === "symbol") return Symbol.prototype.toString.call(value);
  if (typeof value === "function")
    return `[function ${value.name || "anonymous"}]`;
  /* 此处 value 已是 string/number/boolean/bigint（其余分支均已 return）。 */
  return `${value as string | number | boolean | bigint}`;
}

/** 单行截断（保留头部，尾部标注省略）。 */
function clampLine(text: string): string {
  return text.length > TRACE_MAX_LINE
    ? `${text.slice(0, TRACE_MAX_LINE)}…(truncated, 原始 ${text.length} 字符)`
    : text;
}

/**
 * 追加写一条 trace。`taskId` 可为空（会话级事件，如协议探测/连接会话）。
 *
 * `blocked` 用于跳过循环引用对象——JSON.stringify 失败后至少不让结果为空。
 */
export function trace(
  channel: TraceChannel,
  taskId: string | null,
  message: unknown,
  meta?: Record<string, unknown>,
): void {
  try {
    const dir = path.dirname(COMFYUI_TRACE_LOG);
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
    // 唯一脱敏实现（规范 07 §7.18.2.1）：本通道直写文件、不经 pino，
    // 因此必须在写入边界自己过一次值形状守卫，否则原始回执里的密钥（路径上的
    // Authorization / token、工作流里的 apiKey 参数）会明文落盘。
    const text = clampLine(traceStringify(redactSecretShaped(message)));
    const metaText =
      meta && Object.keys(meta).length
        ? ` ${clampLine(JSON.stringify(redactSecretShaped(meta)))}`
        : "";
    const line = `[${localTimestamp()}] [INFO] [trace] ${channel} [${taskId ?? "-"}] ${text}${metaText}\n`;
    fs.appendFileSync(
      /*turbopackIgnore: true*/ COMFYUI_TRACE_LOG,
      line,
      "utf-8",
    );
  } catch {
    /* trace 写入失败绝不阻塞业务主流程（可能是只读盘 / 路径被占）。 */
  }
}

/* ── 结构化回执的摘要（供任务日志面板使用，避免刷屏）────────────────────
 * 完整原文进 trace 文件，面板只给「一段就能看懂」的摘要（规范 07 §7.14：
 * 周期性/大块输出先聚合再落面板）。 */

/** ComfyUI /history 条目的关键结论，用于「有没有结果」的日志与判定。 */
export type HistoryVerdict = {
  /** history 里是否有本 prompt 的条目。 */
  found: boolean;
  /** 条目的 outputs 里有多少个节点带输出。 */
  outputNodeCount: number;
  /** `status.status_str`（`success` / `error` / 缺失）。 */
  statusStr?: string;
  /** `status.completed`（布尔，缺失为 undefined）。 */
  completed?: boolean;
  /** 从 `status.messages` 里取到的 execution_error 说明（有则说明是执行失败）。 */
  executionError?: string;
};

function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * 从 /history 条目里提炼「有没有结果、为什么没有」的结论（纯函数，便于单测）。
 *
 * 只读 ComfyUI 已文档化的字段：`outputs` / `status.status_str` /
 * `status.completed` / `status.messages[type=execution_error].exception_message`。
 */
export function historyTraceSummary(
  promptId: string,
  hist: Record<string, unknown> | null | undefined,
): HistoryVerdict {
  const entry =
    hist && promptId
      ? (hist[promptId] as Record<string, unknown> | undefined)
      : undefined;
  if (!entry) {
    return { found: false, outputNodeCount: 0 };
  }
  const outputs = (entry.outputs ?? {}) as Record<string, unknown>;
  const status = (entry.status ?? {}) as Record<string, unknown>;
  const messages = status.messages;
  let executionError: string | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!Array.isArray(msg) || msg[0] !== "execution_error") continue;
      const payload = msg[1] as Record<string, unknown> | null | undefined;
      const ex =
        payload && typeof payload === "object"
          ? (payload.exception_message ?? payload.message)
          : undefined;
      if (typeof ex === "string" && ex.trim()) {
        executionError = ex;
        break;
      }
    }
  }
  return {
    found: true,
    outputNodeCount: Object.keys(outputs).length,
    ...(typeof status.status_str === "string"
      ? { statusStr: status.status_str }
      : {}),
    ...(typeof status.completed === "boolean"
      ? { completed: status.completed }
      : {}),
    ...(executionError ? { executionError } : {}),
  };
}

/**
 * 从 /history 条目里收集「哪些节点产出了什么键」——失败排查最常问的一句是
 * 「跑完了，但输出去哪了」。这里列出每个带输出的节点与它输出的键名，
 * 以及是否有节点存在但 outputs 为空。
 */
export function historyOutputKeys(
  hist: Record<string, unknown> | null | undefined,
  promptId: string,
): { nodeId: string; keys: string[] }[] {
  const entry =
    hist && promptId
      ? (hist[promptId] as Record<string, unknown> | undefined)
      : undefined;
  const outputs = entry?.outputs;
  if (!outputs || typeof outputs !== "object") return [];
  return Object.entries(outputs).map(([nodeId, v]) => ({
    nodeId,
    keys: v && typeof v === "object" ? Object.keys(v as object) : [],
  }));
}

/** /queue 快照摘要（在飞 + 排队 的 prompt_id 列表），用于「任务还在跑吗」。 */
export function queueTraceSummary(qd: unknown): {
  running: string[];
  pending: string[];
} {
  /* ComfyUI /queue 的条目是 `[number, prompt_id, prompt, extra, outputs]` 元组；
   *  也曾出现过 `{prompt_id}` 对象形态（第三方构建），两种都认。 */
  const pick = (v: unknown): string[] => {
    if (!nonEmptyArray(v)) return [];
    const ids: string[] = [];
    for (const it of v as unknown[]) {
      if (Array.isArray(it)) {
        if (typeof it[1] === "string" && it[1]) ids.push(it[1]);
      } else if (it && typeof it === "object") {
        const id = (it as { prompt_id?: unknown }).prompt_id;
        if (typeof id === "string" && id) ids.push(id);
      }
    }
    return ids;
  };
  const o = (qd ?? {}) as { queue_running?: unknown; queue_pending?: unknown };
  return { running: pick(o.queue_running), pending: pick(o.queue_pending) };
}
