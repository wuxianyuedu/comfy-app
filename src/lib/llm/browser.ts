"use client";

import type { LLMMessage, LLMRequestOptions } from "./types";
import { readApiError, readJsonBody } from "~/lib/api-error";
import { errorMessage } from "~/lib/error-message";

interface ChatArgs {
  messages: LLMMessage[];
  opts?: LLMRequestOptions;
  /** 每收到一个流式 token 就回调一次（仅流式模式）。 */
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/* 经服务端代理（/api/llm）做流式对话。API 密钥由服务端藏住，
 * 浏览器永远看不到它。SSE 分片形如 `{ token }`，
 * 末尾以 `[DONE]` 标记结束整条流。
 */
export async function streamChat({
  messages,
  opts,
  onToken,
  signal,
}: ChatArgs): Promise<string> {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true, ...opts }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `LLM 请求失败 (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  /* 一帧的处置：`[DONE]` 之后不再产出 token；`error` 帧必须**抛出去**。
   *
   * 此前这里是 `try { … if (json.error) throw new Error(json.error) } catch (e)
   * { if (/LLM|请求|fetch/i.test(e.message)) throw e }` —— 抛出的 Error 被**同一个**
   * catch 重新接住，而该 catch 只在文案命中那三个词时才 rethrow，于是
   * `data: {"error":"上游鉴权失败"}` 被静默丢弃、前面收到的半截正文作为**正常回答**
   * 返回（用户看到「模型答到一半就没了」且界面上没有任何报错）。
   *
   * 现在把「解析」与「处置」分开：解析失败（坏帧）跳过并继续，语义错误（服务端
   * 明确报错）立刻中断整条流。 */
  const handleFrame = (data: string): void => {
    if (data === "[DONE]") return;
    let json: { error?: unknown; token?: unknown };
    try {
      json = JSON.parse(data) as { error?: unknown; token?: unknown };
    } catch {
      /* 纯语法坏帧：跳过它，不因为一行坏 JSON 丢掉整条回答。 */
      return;
    }
    if (typeof json.error === "string" && json.error !== "") {
      throw new Error(json.error);
    }
    const token = typeof json.token === "string" ? json.token : "";
    if (token) {
      full += token;
      onToken?.(token);
    }
  };

  /** 按行分发缓冲里的完整帧；返回剩余的半行（留到下一片）。 */
  const drainLines = (text: string, flush: boolean): string => {
    const lines = text.split("\n");
    // flush=true（流已结束）时**不能**把最后一段当半行丢掉：末帧常常没有
    // 换行符，此前整条被 `break` 丢弃，用户可见表现是「回答最后一个字丢了」。
    const rest = flush ? "" : (lines.pop() ?? "");
    // 流已结束时最后可能留一个空尾段（`…\n` 切分后会多出一个 `""`），丢掉它。
    if (flush && lines.at(-1)?.trim() === "") lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      handleFrame(trimmed.slice(5).trim());
    }
    return rest;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = drainLines(buffer, false);
  }
  drainLines(buffer, true);

  return full;
}

/* 非流式的一次性对话。 */
export async function completeChat({
  messages,
  opts,
}: ChatArgs): Promise<string> {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: false, ...opts }),
  });
  /* 错误信封的读法收在一处（规范 16 §16.2.4.35）。 */
  const json = (await readJsonBody(res)) as {
    content?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(readApiError(json) ?? `LLM 请求失败 (${res.status})`);
  return json.content ?? "";
}

export interface RemoteProbeResult {
  ok: boolean;
  detail: string;
  /** 服务端模型清单（/models 拉取成功时返回），供「添加模型」弹窗点选。 */
  models?: string[];
}

/**
 * 设置页「添加模型」弹窗：测试 OpenAI 兼容接口连通性并顺带拉取模型清单。
 * baseUrl / apiKey 留空时由服务端回落到已保存的全局配置（「留空则用全局」语义）。
 * 任何失败都返回 ok:false + 可读 detail，不抛异常——探测失败不是硬错误。
 */
export async function probeRemoteApi(input: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<RemoteProbeResult> {
  let res: Response;
  try {
    res = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      detail: errorMessage(e, "网络请求失败"),
    };
  }
  const json = (await readJsonBody(res)) as {
    ok?: unknown;
    detail?: unknown;
    error?: unknown;
    models?: unknown;
  };
  /* `detail` 优先（它是这条路由的**业务字段**：探测结论的说明），
   * 错误信封交唯一读法（规范 16 §16.2.4.35）。 */
  const detail =
    typeof json.detail === "string"
      ? json.detail
      : (readApiError(json) ?? `请求失败 (${res.status})`);
  return {
    ok: json.ok === true,
    detail,
    models: Array.isArray(json.models)
      ? json.models.filter(
          (m): m is string => typeof m === "string" && m !== "",
        )
      : undefined,
  };
}
