/* ── 模型清单客户端（规范 17 §17.2 第②层的网络部分）──────────────────
 * 工坊提取下拉的候选模型来源：
 *   - 本地：GET /api/llm/models?provider=local —— 服务端探测 Ollama /api/tags
 *     （LM Studio / vLLM 等兼容端点回落 GET {base}/models）
 *   - 远端：GET /api/llm/models?provider=remote —— 服务端按已保存 baseUrl/apiKey
 *     拉 OpenAI 兼容 /models（无密钥时返回可解释的 unavailable，不抛错）
 * 两类失败都不抛异常：探测失败只是下拉里少一组，不该打断页面。
 */

export interface RemoteModelCatalog {
  ok: boolean;
  models: string[];
  detail: string;
}

async function getModels(provider: "local" | "remote"): Promise<RemoteModelCatalog> {
  try {
    const res = await fetch(`/api/llm/models?provider=${provider}`, {
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: unknown;
      models?: unknown;
      detail?: unknown;
    };
    return {
      ok: json.ok === true,
      models: Array.isArray(json.models)
        ? json.models.filter((m): m is string => typeof m === "string" && m !== "")
        : [],
      detail: typeof json.detail === "string" ? json.detail : `请求失败 (${res.status})`,
    };
  } catch (e) {
    return {
      ok: false,
      models: [],
      detail: e instanceof Error ? e.message : "网络请求失败",
    };
  }
}

export function fetchLocalModels(): Promise<RemoteModelCatalog> {
  return getModels("local");
}

export function fetchRemoteModels(): Promise<RemoteModelCatalog> {
  return getModels("remote");
}
