import "server-only";
import type { ZodType } from "zod";
import { llmConfigRepository } from "@/lib/core/repository";
import { normalizeExtraModels, resolveTaskTemperature } from "./types";
import type { LLMConfig, LLMMessage, LLMRequestOptions, LLMProviderType, TaskType } from "./types";

const ENV_DEFAULTS: LLMConfig = {
  provider: (process.env.LLM_PROVIDER as LLMProviderType) || "local",
  baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
  model: process.env.LLM_MODEL ?? "",
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
 * 温度解析优先级：override.taskType 的用户覆盖 → override.temperature →
 * 该任务类型的推荐默认（TASK_TYPES.defaultTemperature）→ DB.temperature（全局）
 *
 * 模型解析：override.model 命中 extraModels 里带独立 baseUrl / apiKey 的远端
 * 条目时，本次请求改走该条目的连接参数（未配置的继续用全局值）。
 */
export async function getLLMConfig(override?: LLMRequestOptions): Promise<LLMConfig> {
  const cfg: LLMConfig = { ...ENV_DEFAULTS };

  try {
    const row = await llmConfigRepository.findSingleton();
    if (row) {
      if (row.provider) cfg.provider = row.provider as LLMProviderType;
      if (row.baseUrl) cfg.baseUrl = row.baseUrl;
      if (row.model) cfg.model = row.model;
      // 候选模型列表(Json 字段，兼容旧纯字符串与新条目对象两种形状)
      cfg.extraModels = normalizeExtraModels((row as Record<string, unknown>).extraModels);
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
    if (override.model) {
      cfg.model = override.model;
      // 工坊 / 设置页按名字切换模型：命中带独立连接参数的候选条目时改走该条目
      const entry = cfg.extraModels?.find(
        (e) => e.name === override.model && !!(e.baseUrl ?? e.apiKey),
      );
      if (entry) {
        if (entry.baseUrl) cfg.baseUrl = entry.baseUrl;
        if (entry.apiKey) cfg.apiKey = entry.apiKey;
      }
    }
    cfg.temperature = resolveTaskTemperature({
      taskType: override.taskType,
      explicitTemperature: override.temperature,
      overrides: cfg.temperatureByTask ?? null,
      fallback: cfg.temperature,
    });
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


/** 判断目标服务是否为本地回环（localhost / 127.x / [::1]） */
function isLoopback(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.|\[::1\])/i.test(url.trim());
}

/** 把 Node fetch 的网络层 TypeError（如 `fetch failed`）翻译成可操作的人话。
 *  历史 bug：Ollama 未启动 / 远端不可达时，用户只看到一句 `fetch failed`，
 *  既不知道是连不上本地 Ollama 还是远端 Key 无效，也没提示怎么处理。 */
function describeFetchFailure(e: unknown, cfg: LLMConfig): string {
  if (!(e instanceof TypeError)) return e instanceof Error ? e.message : "网络请求失败";
  const cause = (e as { cause?: unknown }).cause;
  const causeMsg =
    cause instanceof Error ? String(cause.message) : cause ? String(cause) : "";
  const base = cfg.baseUrl.replace(/\/$/, "");
  const local = cfg.provider === "local" || isLoopback(base);
  // 常见 Node undici 底层错误码
  if (/ECONNREFUSED|ECONNRESET/.test(causeMsg)) {
    return local
      ? `连不上本地服务（${base}）：连接被拒绝。请确认本地 ${cfg.model ? "Ollama/LM Studio" : "模型服务"} 已启动，或检查 Base URL 端口是否正确。`
      : `连不上远端服务（${base}）：连接被拒绝。请检查网络、Base URL 是否正确，或服务是否在运行。`;
  }
  if (/ENOTFOUND|getaddrinfo|DNS|EAI_AGAIN/.test(causeMsg)) {
    return `域名解析失败（${base}）：地址不存在或网络未连通，请检查 Base URL 与网络。`;
  }
  if (/ETIMEDOUT|timeout|timed out/i.test(causeMsg)) {
    return `连接超时（${base}）：服务无响应。本地请确认 Ollama 已启动；远端请检查网络与接口可达性。`;
  }
  if (local) {
    return `调用本地模型失败（${base}）：${causeMsg || "无法连接"}。请确认本地 Ollama/LM Studio 已启动且已拉取模型 ${cfg.model || ""}。`;
  }
  return `调用远端模型失败（${base}）：${causeMsg || e.message}。请检查 Base URL / API Key / 网络。`;
}

/** 统一的上游 /chat/completions 请求：网络层失败给出可读原因，HTTP 非 2xx 带状态码与响应片段。 */
async function upstreamChat(cfg: LLMConfig, body: Record<string, unknown>): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: headersFor(cfg),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(describeFetchFailure(e, cfg));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 401/403 大概率是 Key 无效 / 未授权 —— 给个更明确的提示，而不是只给状态码。
    const hint =
      res.status === 401 || res.status === 403
        ? "（API Key 无效或未授权，请检查后重试）"
        : "";
    const snippet = detail.trim() ? `：${detail.slice(0, 200)}` : "";
    throw new Error(`LLM 请求失败 (${res.status})${hint}${snippet}`);
  }
  return res;
}

/** 模型未配置（空）时给调用方的统一出口文案 —— 不再兜底默认模型，
 *  避免用空的 model 打到后端拿一个「model not found」的含糊错误。 */
const ERR_MODEL_UNCONFIGURED =
  "尚未配置生效模型：请先在「设置 → 本地模型/远程模型」中选择或填写要使用的模型名";

function assertModelConfigured(cfg: LLMConfig): void {
  if (!cfg.model?.trim()) throw new Error(ERR_MODEL_UNCONFIGURED);
}

/** One-shot (non-streaming) completion. */
export async function completeLLM(cfg: LLMConfig, messages: LLMMessage[]): Promise<string> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false,
  });

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
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: true,
  });
  if (!res.body) {
    throw new Error("LLM 服务未返回数据流，请重试");
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
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false,
    response_format: { type: "json_object" },
  });

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
