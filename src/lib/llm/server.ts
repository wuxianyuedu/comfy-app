import "server-only";
import type { ZodType } from "zod";
import { llmConfigRepository } from "@/lib/core/repository";
import type { LLMConfig, LLMMessage, LLMRequestOptions, LLMProviderType, TaskType } from "./types";

const ENV_DEFAULTS: LLMConfig = {
  provider: (process.env.LLM_PROVIDER as LLMProviderType) || "local",
  baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
  model: process.env.LLM_MODEL ?? "llama3.1",
  extraModels: null,
  apiKey: process.env.LLM_API_KEY ?? null,
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2048),
};

/**
 * Resolve the effective LLM config by layering:
 *   1. process.env (defaults)
 *   2. DB singleton row (user overrides via the settings UI)
 *   3. per-request override (rarely used; the browser never sends apiKey)
 *
 * 温度解析优先级：override.taskType → override.temperature → DB.taskType → DB.temperature → ENV
 */
export async function getLLMConfig(override?: LLMRequestOptions): Promise<LLMConfig> {
  const cfg: LLMConfig = { ...ENV_DEFAULTS };

  try {
    const row = await llmConfigRepository.findSingleton();
    if (row) {
      if (row.provider) cfg.provider = row.provider as LLMProviderType;
      if (row.baseUrl) cfg.baseUrl = row.baseUrl;
      if (row.model) cfg.model = row.model;
      // 候选模型列表(Json 字段，prisma 生成类型不含该列，先以 unknown 收窄)
      const rawExtra = (row as Record<string, unknown>).extraModels;
      if (Array.isArray(rawExtra)) {
        cfg.extraModels = rawExtra.filter((m): m is string => typeof m === "string" && m.trim() !== "");
      }
      if (row.apiKey) cfg.apiKey = row.apiKey;
      if (row.temperature != null) cfg.temperature = row.temperature;
      // temperatureByTask 是 Json 字段，prisma generate 后类型会自动包含；先用 any 绕过
      const raw = row as Record<string, unknown>;
      if (raw.temperatureByTask) cfg.temperatureByTask = raw.temperatureByTask as Record<TaskType, number>;
      if (row.maxTokens != null) cfg.maxTokens = row.maxTokens;
    }
  } catch {
    // DB unavailable — fall back to env defaults
  }

  if (override) {
    if (override.provider) cfg.provider = override.provider;
    if (override.baseUrl) cfg.baseUrl = override.baseUrl;
    if (override.model) cfg.model = override.model;
    // 按任务类型查找覆盖温度，没有则回退到显式 temperature 或全局默认
    if (override.taskType && cfg.temperatureByTask?.[override.taskType] != null) {
      cfg.temperature = cfg.temperatureByTask[override.taskType];
    } else if (override.temperature != null) {
      cfg.temperature = override.temperature;
    }
    if (override.maxTokens != null) cfg.maxTokens = override.maxTokens;
  }

  return cfg;
}

function headersFor(cfg: LLMConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.provider === "remote" && cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

/** One-shot (non-streaming) completion. */
export async function completeLLM(cfg: LLMConfig, messages: LLMMessage[]): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headersFor(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: false,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming completion. Calls `onToken` with each delta and resolves with the
 * full concatenated text. Works with Ollama, LM Studio, vLLM, and OpenAI —
 * all emit SSE chunks shaped like `{ choices: [{ delta: { content } }] }`.
 */
export async function streamLLM(
  cfg: LLMConfig,
  messages: LLMMessage[],
  onToken: (token: string) => void
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headersFor(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${res.status}): ${detail.slice(0, 200)}`);
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
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token: string = json.choices?.[0]?.delta?.content ?? "";
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // ignore malformed keep-alive chunks
      }
    }
  }

  return full;
}

/**
 * 结构化（JSON）补全：强制 JSON 输出并用 Zod schema 校验，
 * 端到端类型安全，避免手写 JSON.parse + 类型断言导致解析失败。
 */
export async function completeLLMStructured<T>(
  cfg: LLMConfig,
  messages: LLMMessage[],
  schema: ZodType<T>,
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headersFor(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("LLM 返回非 JSON，无法解析结构化结果");
  }
  return schema.parse(parsed);
}
