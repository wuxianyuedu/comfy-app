import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "~/lib/auth-server";
import { describeFetchFailure, getLLMConfig } from "~/lib/llm/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * GET /api/llm/models?provider=local|remote[&model=<name>] —— 拉取候选模型清单。
 *
 * - local：优先 GET {本地 base 剥掉 /v1}/api/tags（Ollama 形状），
 *   失败回落 GET {base}/models（LM Studio / vLLM 等 OpenAI 兼容端点）。
 * - remote：默认按已保存的全局远端 baseUrl / apiKey GET {base}/models；
 *   若带 model 参数且该远端条目配了独立 baseUrl/apiKey，则用该条目自己的
 *   连接参数探测——避免「工坊选了独立配置的远端模型，却拿全局 Base URL
 *   去探导致误报 fetch failed」这类误导提示。
 *
 * 探测失败不是硬错误：一律 200 + { ok:false, detail }，前端在对应分组里
 * 展示降级文案而不是让整页报错。
 */
export async function GET(req: NextRequest) {
  await getServerUser();

  const provider =
    req.nextUrl.searchParams.get("provider") === "remote" ? "remote" : "local";
  const rawModel = req.nextUrl.searchParams.get("model");
  const model =
    typeof rawModel === "string" && rawModel.trim() !== ""
      ? rawModel.trim()
      : "";
  // 仅远端探测按所选模型解析独立连接参数；本地候选没有独立 baseUrl，传 model
  // 反而可能误命中同名的远端条目，故本地一律不带 model。
  const cfg = await getLLMConfig({
    provider,
    model: provider === "remote" && model ? model : undefined,
  });

  if (!cfg.baseUrl) {
    return NextResponse.json({
      ok: false,
      models: [],
      detail: "尚未配置接口地址，请先在「LLM 设置」中保存 Base URL",
    });
  }

  const headers: Record<string, string> = {};
  if (provider === "remote" && cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const probe = (base: string) =>
    fetch(`${base.replace(/\/$/, "")}/models`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

  try {
    // 本地端点优先试 Ollama 的 /api/tags（剥掉 OpenAI 兼容的 /v1 后缀）
    let res: Response | null = null;
    if (provider === "local" && /\/v1\/?$/.test(cfg.baseUrl)) {
      const tagsUrl = `${cfg.baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
      try {
        const tagsRes = await fetch(tagsUrl, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (tagsRes.ok) {
          const parsed: unknown = await tagsRes.json();
          const rawList = isRecord(parsed) ? parsed.models : undefined;
          const models = Array.isArray(rawList)
            ? rawList
                .map((m) =>
                  isRecord(m) && typeof m.name === "string"
                    ? m.name.trim()
                    : "",
                )
                .filter((n) => n !== "")
            : [];
          return NextResponse.json({
            ok: true,
            models,
            detail: `共 ${models.length} 个本地模型`,
          });
        }
      } catch {
        // /api/tags 不存在或超时 → 继续走 OpenAI 兼容 /models
      }
    }

    res = await probe(cfg.baseUrl);
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      return NextResponse.json({
        ok: false,
        models: [],
        detail: `HTTP ${res.status}${snippet ? `：${snippet}` : ""}`,
      });
    }
    const parsed: unknown = await res.json();
    // OpenAI 兼容 /models → { data: [{ id }] }；Ollama /api/tags → { models: [{ name }] }
    const rawList = isRecord(parsed)
      ? (parsed.data ?? parsed.models)
      : undefined;
    const models = Array.isArray(rawList)
      ? rawList
          .map((m) => {
            if (typeof m === "string") return m.trim();
            if (isRecord(m)) {
              const id: unknown = m.id ?? m.name;
              return typeof id === "string" ? id.trim() : "";
            }
            return "";
          })
          .filter((n) => n !== "")
      : [];
    return NextResponse.json({
      ok: true,
      models,
      detail: `共 ${models.length} 个模型`,
    });
  } catch (e) {
    // 网络层 TypeError（如 fetch failed / ECONNREFUSED）翻译成可操作的人话，
    // 避免用户在工坊只看到一句生硬的 `fetch failed`。
    return NextResponse.json({
      ok: false,
      models: [],
      detail: describeFetchFailure(e, cfg),
    });
  }
}
