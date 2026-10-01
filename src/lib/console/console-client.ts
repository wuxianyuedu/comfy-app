// ── 应用内控制台的**浏览器侧客户端**（规范 17 §17.2 第②层的网络部分）───────
//
// 视图层不出现 `fetch`（硬规则 10 / 门禁 S1）：这条 SSE 的发起、逐帧解析、
// 断流与主动中止全部收在这里，`hooks/use-console.ts` 只消费解析好的事件。
//
// ## 为什么用 `fetch` + `ReadableStream` 而不是 `EventSource`
//
// `EventSource` 只发 GET、不能带请求体 —— 而控制台的命令是**请求体**（不让
// 命令进 URL：它会出现在日志、浏览器历史与反代的访问记录里，而命令里可能有
// 路径与 token）。所以走 `fetch` POST + 手工读 `body.getReader()` 的形态，
// 与其余「有头有尾的流」同源（见路由文件头对「POST 回流」的说明）。

import { isRecord } from "~/lib/is-record";
import { readApiError, readJsonBody } from "~/lib/api-error";
import { MAX_OUTPUT_CHARS } from "./console-limits";

/** 客户端看到的一条命令事件（与路由发的帧一一对应）。 */
export type ConsoleClientEvent =
  | {
      type: "start";
      runId: string;
      command: string;
      cwd: string;
      startedAt: number;
    }
  | { type: "out"; stream: "stdout" | "stderr"; text: string }
  | {
      type: "exit";
      code: number | null;
      signal: string | null;
      killed: boolean;
      truncatedNote: string | null;
      durationMs: number;
    }
  | { type: "error"; message: string };

export interface RunConsoleOptions {
  command: string;
  /** 每收到一帧回调一次（**按到达顺序**，调用方不要在这里做重排）。 */
  onEvent: (event: ConsoleClientEvent) => void;
  /** 中止（用户点「停止」/ 关界面）：会断开请求，服务端据此回收整棵进程树。 */
  signal?: AbortSignal;
}

/** 一次请求的结局：跑完 / 被拒 / 断了，三种都要能区分（界面文案不同）。 */
export type RunConsoleOutcome =
  | { kind: "ok" }
  | { kind: "rejected"; reason: string }
  | { kind: "aborted" }
  | { kind: "failed"; reason: string };

/** 把一帧 `data:` 载荷收窄成事件；认不出的形状返回 null（静默丢，不猜）。 */
export function parseConsoleFrame(payload: unknown): ConsoleClientEvent | null {
  if (!isRecord(payload)) return null;
  switch (payload.type) {
    case "start":
      if (typeof payload.runId !== "string") return null;
      return {
        type: "start",
        runId: payload.runId,
        command: typeof payload.command === "string" ? payload.command : "",
        cwd: typeof payload.cwd === "string" ? payload.cwd : "",
        startedAt:
          typeof payload.startedAt === "number"
            ? payload.startedAt
            : Date.now(),
      };
    case "out": {
      if (typeof payload.text !== "string") return null;
      return {
        type: "out",
        stream: payload.stream === "stderr" ? "stderr" : "stdout",
        text: payload.text,
      };
    }
    case "exit":
      return {
        type: "exit",
        code: typeof payload.code === "number" ? payload.code : null,
        signal: typeof payload.signal === "string" ? payload.signal : null,
        killed: payload.killed === true,
        truncatedNote:
          typeof payload.truncatedNote === "string"
            ? payload.truncatedNote
            : null,
        durationMs:
          typeof payload.durationMs === "number" ? payload.durationMs : 0,
      };
    case "error":
      return {
        type: "error",
        message:
          typeof payload.message === "string"
            ? payload.message
            : "命令执行失败",
      };
    default:
      return null;
  }
}

/**
 * 把一段 SSE 文本按 `\n\n` 切帧并逐帧回调；返回**最后一个不完整帧**的残余
 * （供下一次 chunk 续接）。
 *
 * 单独抽出来是为了它能被直接单测 —— 「半个 JSON 被当成一帧丢掉」是这类解析器
 * 最经典的静默缺陷（表现是输出偶尔缺一行，而没有任何报错）。
 */
export function consumeSseChunk(
  buffer: string,
  onFrame: (payload: unknown) => void,
): string {
  let rest = buffer;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) return rest;
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const body = line.slice("data:".length).trim();
      if (!body) continue;
      try {
        onFrame(JSON.parse(body) as unknown);
      } catch {
        /* 半帧不可能到这里（已按 \n\n 切过），真畸形就丢掉这一帧 ——
         * 解析失败不该让整条输出流中断。 */
      }
    }
  }
}

/**
 * 跑一条命令，逐帧回调。
 *
 * 三条出口都要能区分：
 *   · 服务端拒绝（403 非本机 / 401 未登录 / 400 命令不合法 / 409 已有命令在跑）
 *     → `rejected` + 服务端给的可读文案（它是**用户能修**的，必须原样展示）；
 *   · 用户中止 → `aborted`（界面显示「已停止」，不是「失败」）；
 *   · 其它（网络断、解析不出响应体）→ `failed` + 可读文案。
 */
export async function runConsoleCommand(
  opts: RunConsoleOptions,
): Promise<RunConsoleOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/console/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: opts.command }),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (isAbortError(e)) return { kind: "aborted" };
    return {
      kind: "failed",
      reason: e instanceof Error ? e.message : "请求失败",
    };
  }

  if (!res.ok) {
    const reason =
      readApiError(await readJsonBody(res)) ??
      `服务端拒绝执行（HTTP ${res.status}）`;
    return { kind: "rejected", reason };
  }
  if (!res.body) return { kind: "failed", reason: "服务端没有返回输出流" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseChunk(buffer, (payload) => {
        const event = parseConsoleFrame(payload);
        if (event) opts.onEvent(event);
      });
    }
    // 冲刷不完整帧：服务端正常关闭时不会留半帧，但断流时会 —— 丢了它等于
    // 丢最后一行（通常正是失败原因）。
    buffer += decoder.decode();
    if (buffer.trim()) {
      consumeSseChunk(`${buffer}\n\n`, (payload) => {
        const event = parseConsoleFrame(payload);
        if (event) opts.onEvent(event);
      });
    }
    return { kind: "ok" };
  } catch (e) {
    if (isAbortError(e)) return { kind: "aborted" };
    return {
      kind: "failed",
      reason: e instanceof Error ? e.message : "读取输出流失败",
    };
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/**
 * 输出缓冲的**唯一**截断口径（与界面上的「已截断」提示同源）。
 *
 * 界面按帧追加文本，长时间运行的命令会攒出很大一坨字符串；这里给它一个上限，
 * 超出从**头部**裁（尾部才是结论 —— 与「日志看尾巴」同一判据）。
 */
export function clampOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `…（更早的输出已裁剪）\n${text.slice(text.length - MAX_OUTPUT_CHARS)}`;
}
