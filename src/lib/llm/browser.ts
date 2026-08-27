"use client";

import type { LLMMessage, LLMRequestOptions } from "./types";

interface ChatArgs {
  messages: LLMMessage[];
  opts?: LLMRequestOptions;
  /** Called on each streamed token (streaming mode only). */
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/**
 * Streaming chat via the server proxy (/api/llm). The server hides the API
 * key, so the browser never sees it. SSE chunks are shaped `{ token }` and a
 * final `[DONE]` marker ends the stream.
 */
export async function streamChat({ messages, opts, onToken, signal }: ChatArgs): Promise<string> {
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { error?: string; token?: string };
        if (json.error) throw new Error(json.error);
        const token: string = json.token ?? "";
        if (token) {
          full += token;
          onToken?.(token);
        }
      } catch (e) {
        if (e instanceof Error && /LLM|请求|fetch/i.test(e.message)) throw e;
      }
    }
  }

  return full;
}

/** Non-streaming one-shot chat. */
export async function completeChat({ messages, opts }: ChatArgs): Promise<string> {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: false, ...opts }),
  });
  const json = (await res.json()) as { content?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `LLM 请求失败 (${res.status})`);
  return json.content ?? "";
}
