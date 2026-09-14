// ── Workshop MCP 本地 LLM 调用 ─────────────────────────────────
// 不依赖 @/lib/llm/server（后者 import "server-only" 会在纯 Node 抛错）。
// 从环境变量读取默认值，并可被 `llmConfig` 表里的用户设置覆盖（与界面
// 设置 UI 共享同一张表，复用 workshopDb 读取，不触碰 `~/env`）。
import { decryptSecret } from "@/lib/llm/secrets";
import type { LLMMessage } from "@/lib/llm/types";
import { llmConfig } from "@/server/db/schema";
import { workshopDb } from "./db";
import { OLLAMA_DEFAULT_BASE_URL } from "@/lib/endpoints";

export interface WorkshopLLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number;
  maxTokens: number;
}

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
      if (row.baseUrl) cfg.baseUrl = row.baseUrl;
      if (row.model) cfg.model = row.model;
      if (row.apiKey) cfg.apiKey = decryptSecret(row.apiKey);
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
  if (!cfg.model?.trim()) {
    throw new Error(
      "尚未配置生效模型：请先在「设置 → 本地模型/远程模型」中选择或填写要使用的模型名",
    );
  }
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
    const msg = e instanceof Error ? e.message : String(e);
    const cause =
      e instanceof TypeError && e.cause instanceof Error
        ? String(e.cause.message)
        : "";
    const reach = /ECONNREFUSED|ECONNRESET/.test(cause) || /fetch failed/i.test(msg);
    throw new Error(
      reach
        ? `连不上 LLM 服务（${cfg.baseUrl}）：请确认本地服务已启动或 Base URL 正确（${cause || "连接被拒绝"}）。`
        : `LLM 请求失败：${msg}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? "（API Key 无效或未授权）"
        : "";
    throw new Error(`LLM 请求失败 (${res.status})${hint}${detail.trim() ? `：${detail.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}
