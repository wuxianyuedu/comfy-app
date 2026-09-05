import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 4000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Ollama 的 /api/tags 在 OpenAI 兼容 base URL（…/v1）后面，需剥掉后缀。 */
function ollamaTagsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
}

/**
 * GET /api/llm/models
 *
 * 拉取当前 LLM 配置提供方的模型清单：
 * - local（Ollama）：GET {base}/api/tags → { models: [{ name }] }
 * - remote（OpenAI 兼容）：GET {base}/models → { data: [{ id }] }
 *
 * 供设置页把候选模型列表（extraModels）自动回填。任何失败都返回空列表——
 * 探测失败不是错误，前端按「拉取失败，可手动输入」降级。
 */
export async function GET(_req: NextRequest) {
  await getServerUser();

  const cfg = await getLLMConfig();
  const isOllama = cfg.provider === "local";
  const listUrl = isOllama
    ? ollamaTagsUrl(cfg.baseUrl)
    : `${cfg.baseUrl.replace(/\/$/, "")}/models`;

  try {
    const headers: Record<string, string> = {};
    if (cfg.provider === "remote" && cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    const res = await fetch(listUrl, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json({ models: [] });
    }
    const body: unknown = await res.json();
    if (!isRecord(body)) {
      return NextResponse.json({ models: [] });
    }
    // Ollama /api/tags → { models: [{ name }] }；OpenAI 兼容 /models → { data: [{ id }] }
    const rawList = isOllama ? body.models : body.data;
    if (!Array.isArray(rawList)) {
      return NextResponse.json({ models: [] });
    }
    const models = rawList
      .map((m) => {
        if (!isRecord(m)) return "";
        const id: unknown = isOllama ? m.name : m.id;
        return typeof id === "string" ? id.trim() : "";
      })
      .filter((n) => n !== "");
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
