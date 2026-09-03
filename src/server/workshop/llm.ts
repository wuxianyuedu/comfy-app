// ── Workshop MCP 本地 LLM 调用 ─────────────────────────────────
// 不依赖 @/lib/llm/server（后者 import "server-only" 会在纯 Node 抛错）。
// 从环境变量读取默认值，并可被 `llmConfig` 表里的用户设置覆盖（与界面
// 设置 UI 共享同一张表，复用 workshopDb 读取，不触碰 `~/env`）。
import type { LLMMessage } from "@/lib/llm/types";
import { llmConfig } from "@/server/db/schema";
import { workshopDb } from "./db";

export interface WorkshopLLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number;
  maxTokens: number;
}

function envDefaults(): WorkshopLLMConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
    model: process.env.LLM_MODEL ?? "llama3.1",
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
      if (row.baseUrl) cfg.baseUrl = row.baseUrl;
      if (row.model) cfg.model = row.model;
      if (row.apiKey) cfg.apiKey = row.apiKey;
      if (row.temperature != null) cfg.temperature = row.temperature;
      if (row.maxTokens != null) cfg.maxTokens = row.maxTokens;
    }
  } catch {
    // 表不存在 / 连接异常 → 使用 env 默认
  }
  return cfg;
}

function headersFor(cfg: WorkshopLLMConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

/** 一次性（非流式）补全。 */
export async function completeWorkshopLLM(
  cfg: WorkshopLLMConfig,
  messages: LLMMessage[],
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headersFor(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new Error(`LLM 请求失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}
