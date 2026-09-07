import "server-only";
import type { ZodType } from "zod";
import { llmConfigRepository, remoteModelRepository } from "@/lib/core/repository";
import { resolveTaskTemperature, splitExtraModels } from "./types";
import type { LLMConfig, LLMMessage, LLMRequestOptions, LLMProviderType, RemoteModelEntry, RemoteModelKind, TaskType } from "./types";

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
      // option C：llmConfig.extraModels 只存本地 ollama 候选（纯名字，无 apiKey）；
      // 远端独立模型改存 remoteModel 表。读取时合并两者，保证下游（运行时按名
      // 找 baseUrl/apiKey、设置页候选清单、工坊分组）行为不变。
      // 直接吃 DB 原始值（llmConfig.extraModels 里字符串=本地候选，对象=遗留/远端）
      const split = splitExtraModels((row as Record<string, unknown>).extraModels);
      const remoteRows = await remoteModelRepository.list();
      const remoteEntries = remoteRows.map((r) => ({
        name: r.name,
        baseUrl: r.baseUrl,
        apiKey: r.apiKey,
        kind: (r.kind as RemoteModelKind) ?? null,
      }));
      // 合并三来源：本地候选名 + 表内远端条目 + 遗留(尚未迁表)的远端对象
      cfg.extraModels = [
        ...split.localNames.map((n) => ({ name: n, baseUrl: null, apiKey: null, kind: null as RemoteModelKind | null })),
        ...remoteEntries,
        ...split.remoteEntries,
      ];
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

/**
 * option C 的存量迁移（幂等）：把历史遗留、混在 llmConfig.extraModels 里的远端
 * 条目对象搬到独立 remoteModel 表，并把 llmConfig.extraModels 收窄成纯本地候选名。
 * 在 configGet / configSave 读配置前调用一次即可；已迁移后再次调用是空操作。
 */
export async function ensureRemoteStorageMigrated(): Promise<void> {
  const row = await llmConfigRepository.findSingleton();
  if (!row) return;
  const raw = (row as Record<string, unknown>).extraModels;
  if (!Array.isArray(raw)) return;
  const split = splitExtraModels(raw);
  if (split.remoteEntries.length === 0) return; // 无遗留远端条目，无需迁移
  await remoteModelRepository.replaceAll(split.remoteEntries);
  await llmConfigRepository.upsertSingleton({
    extraModels: split.localNames,
  });
}

/** 客户端可读写形状（configGet 出口）：
 *  extraModels 保持类型区分 —— 本地 ollama 候选为字符串、远端独立模型为条目对象，
 *  这样设置页保存时 configSave 能按「字符串 vs 对象」把它们各自写回正确的地方，
 *  不把本地候选误判成远端模型。
 */
export async function getConfigForClient() {
  const cfg = await getLLMConfig();
  // 重新从 DB 组装：本地候选(字符串) + 远端表条目(对象)，避免 getLLMConfig 的
  // 内部对象化丢失「本地/远端」的类型区分。
  const row = await llmConfigRepository.findSingleton();
  let extra: Array<string | RemoteModelEntry> = [];
  if (row) {
    const split = splitExtraModels((row as Record<string, unknown>).extraModels);
    const remoteRows = await remoteModelRepository.list();
    extra = [
      ...split.localNames,
      ...remoteRows.map((r) => ({
        name: r.name,
        baseUrl: r.baseUrl,
        apiKey: r.apiKey,
        kind: (r.kind as RemoteModelKind) ?? null,
      })),
      ...split.remoteEntries,
    ];
  }
  return { ...cfg, extraModels: extra };
}

function headersFor(cfg: LLMConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.provider === "remote" && cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
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
  assertModelConfigured(cfg);
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
  assertModelConfigured(cfg);
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
