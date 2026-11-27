// ── Workshop MCP 本地 LLM 调用 ─────────────────────────────────
// 不依赖 ~/lib/llm/server（后者 import "server-only" 会在纯 Node 抛错）。
// 从环境变量读取默认值，并可被 `llmConfig` 表里的用户设置覆盖（与界面
// 设置 UI 共享同一张表，复用 workshopDb 读取，不触碰 `~/env`）。
import { decryptLlmKey } from "~/lib/llm/secrets";
import { errorText } from "~/lib/error-message";
import { logger } from "~/lib/core/logger";
import { isLoopbackBaseUrl, type LLMMessage } from "~/lib/llm/types";
import { ERR_NO_EFFECTIVE_MODEL, llmFailureMessage } from "~/lib/llm/config-health";
import { llmConfig } from "~/server/db/schema";
import { workshopDb } from "./db";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import { asRecord, isUnknownArray } from "~/lib/is-record";
/* 本文件会被纯 Node 宿主加载（见文件头）：出网判据走不带 server-only 的核心。 */
import { safeFetch } from "~/lib/network/outbound-url-core";

export type WorkshopLLMConfig = {
  apiKey: string | null;
  baseUrl: string;
  maxTokens: number;
  model: string;
  temperature: number;
};

function envDefaults(): WorkshopLLMConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? OLLAMA_DEFAULT_BASE_URL,
    model: process.env.LLM_MODEL ?? "",
    apiKey: process.env.LLM_API_KEY ?? null,
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2048),
  };
}

/** 解析有效 LLM 配置：env 默认 → llmConfig 表单行覆盖。任何失败回退 env。 */
export async function getWorkshopLLMConfig(): Promise<WorkshopLLMConfig> {
  const cfg = envDefaults();
  try {
    const rows = await workshopDb.select().from(llmConfig).limit(1);
    const row = rows[0];
    if (row) {
      if (row.baseUrl) {
        cfg.baseUrl = row.baseUrl;
      }
      if (row.model) {
        cfg.model = row.model;
      }
      if (row.apiKey !== null && row.apiKey !== "") {
        cfg.apiKey = decryptLlmKey(row.apiKey);
      }
      if (row.temperature !== null && row.temperature !== undefined) {
        cfg.temperature = row.temperature;
      }
      if (row.maxTokens !== null && row.maxTokens !== undefined) {
        cfg.maxTokens = row.maxTokens;
      }
    }
  } catch (error) {
    // 表不存在 / 连接异常 → 使用 env 默认。回落保留，故障留读数（#4419 / 硬规则 4）：
    // 此前静默吞掉，用户在设置页配好的模型无声失效且排障时无任何 DB 故障读数。
    logger.warn(errorText(error, "[workshop-llm] 配置行读取失败，本次请求按 env 默认配置执行"));
  }
  return cfg;
}

function headersFor(cfg: WorkshopLLMConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey !== null && cfg.apiKey !== "") {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

/** 一次性（非流式）补全。 */
export async function completeWorkshopLLM(
  cfg: WorkshopLLMConfig,
  messages: Array<LLMMessage>,
  signal?: AbortSignal,
): Promise<string> {
  if (!cfg.model.trim()) {
    throw new Error(ERR_NO_EFFECTIVE_MODEL);
  }
  let res: Response;
  try {
    res = await safeFetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headersFor(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: false,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
        : AbortSignal.timeout(180_000),
      scenario: "llm-upstream",
    });
  } catch (error) {
    const healthCfg = {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      provider: isLoopbackBaseUrl(cfg.baseUrl) ? ("local" as const) : ("remote" as const),
    };
    throw new Error(llmFailureMessage({ cfg: healthCfg, error }), { cause: error });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? llmFailureMessage({
            cfg: {
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              provider: isLoopbackBaseUrl(cfg.baseUrl) ? ("local" as const) : ("remote" as const),
            },
            status: res.status,
          })
        : "";
    throw new Error(
      `LLM 请求失败 (${res.status})${hint}${detail.trim() ? `：${clampText(detail, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}` : ""}`,
    );
  }
  // LLM 响应体是外来 JSON：逐层按宽松对象/数组读，content 非字符串回落 ""。
  const raw: unknown = await res.json();
  const root = asRecord(raw);
  const rawChoices = root?.choices;
  const choices = isUnknownArray(rawChoices) ? rawChoices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  return typeof content === "string" ? content : "";
}
