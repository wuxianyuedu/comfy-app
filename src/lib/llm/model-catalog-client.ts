/* ── 模型清单客户端（规范 17 §17.2 第②层的网络部分）──────────────────
 * 工坊提取下拉的候选模型来源：
 *   - 本地：GET /api/llm/models?provider=local —— 服务端探测 Ollama /api/tags
 *     （LM Studio / vLLM 等兼容端点回落 GET {base}/models）
 *   - 远端：GET /api/llm/models?provider=remote —— 服务端按已保存 baseUrl/apiKey
 *     拉 OpenAI 兼容 /models（无密钥时返回可解释的 unavailable，不抛错）
 * 两类失败都不抛异常：探测失败只是下拉里少一组，不该打断页面。
 *
 * 远端探测可带 model 参数：命中的远端模型条目若配了独立 baseUrl/apiKey，
 * 服务端就用它（而不是全局 Base URL）去探测——保证「配置都对却报 fetch
 * failed」这类误导提示不再出现。不带 model 时回落全局远端连接。
 */

import { withQuery } from "~/lib/query-string";
import { errorMessage } from "~/lib/error-message";

export interface RemoteModelCatalog {
  ok: boolean;
  models: string[];
  detail: string;
}

async function getModels(
  provider: "local" | "remote",
  model?: string,
): Promise<RemoteModelCatalog> {
  try {
    /* `model` 只在远端探测时带上（见文件头），空值由出口省略整个键 ——
     * 不再自己拼一个条件串再拼进模板（规范 16 §16.2.4.32）。 */
    const res = await fetch(
      withQuery("/api/llm/models", {
        provider,
        model: provider === "remote" ? model : undefined,
      }),
      {
        signal: AbortSignal.timeout(8000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: unknown;
      models?: unknown;
      detail?: unknown;
    };
    return {
      ok: json.ok === true,
      models: Array.isArray(json.models)
        ? json.models
            // 只判 `m !== ""` 会把**全空白**的名字放进来（上游偶尔给出
            // `"   "` 这种占位），下拉里就多一个选不中、显示为空的条目。
            // 这里按 trim 后是否为空来筛，并顺手去掉两边空白（显示与再上行
            // 都干净）。
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.trim())
            .filter((m) => m !== "")
        : [],
      detail:
        typeof json.detail === "string"
          ? json.detail
          : `请求失败 (${res.status})`,
    };
  } catch (e) {
    return {
      ok: false,
      models: [],
      detail: errorMessage(e, "网络请求失败"),
    };
  }
}

export function fetchLocalModels(): Promise<RemoteModelCatalog> {
  return getModels("local");
}

export function fetchRemoteModels(model?: string): Promise<RemoteModelCatalog> {
  return getModels("remote", model);
}
