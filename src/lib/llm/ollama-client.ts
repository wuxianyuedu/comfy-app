// ── Ollama 探测 / 启动：浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）──
// 原先两处 `fetch` 内联在设置页的事件处理器里，响应收窄与失败降级散落在 JSX。
// 集中到此处后：错误信封与超时策略改一处生效，视图零感知。

/** 探测超时：Ollama 没起时连接会挂住，宁可早失败也别让页面一直转圈。 */
const PROBE_TIMEOUT_MS = 3000;

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export type OllamaProbe = { up: true; models: OllamaModel[] } | { up: false };

/** Ollama 的 /api/tags 在 OpenAI 兼容 base URL（…/v1）后面，需要剥掉后缀。 */
export function ollamaTagsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 探测本地 Ollama 是否可用（GET /api/tags）。
 * 任何非 2xx / 超时 / 非法 JSON 一律按「未运行」返回 —— 探测失败不是错误，
 * 只是状态行该显示红点，不该抛给用户（硬规则 4：失败也要有出口，这里出口就
 * 是状态行的「未运行」+ 启动按钮）。
 */
export async function probeOllama(baseUrl: string): Promise<OllamaProbe> {
  try {
    const res = await fetch(ollamaTagsUrl(baseUrl), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { up: false };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      /* 2xx 却不是合法 JSON —— 端口上跑的不是 Ollama（常见：代理/占位页返回
       * HTML）。按「未运行」处理，而不是「运行中但 0 个模型」——后者会让
       * 模型下拉框渲染成空的 <select>，用户以为自己没装模型。 */
      return { up: false };
    }
    const models = isRecord(body) ? body.models : undefined;
    return {
      up: true,
      models: Array.isArray(models) ? (models as OllamaModel[]) : [],
    };
  } catch {
    return { up: false };
  }
}

/**
 * 请求服务端拉起 `ollama serve`。
 * POST 返回 200 正常返回；返回 500 时抛出包含服务端 error 详情的 Error
 * （如「进程秒退」「端口被占」「未找到 ollama」等——具体原因由调用方决定展示方式）。
 */
export async function startOllama(): Promise<void> {
  const res = await fetch("/api/llm/ollama-start", { method: "POST" });
  if (!res.ok) {
    let detail = "启动 Ollama 失败，请确认已安装 Ollama 并在 PATH 中可用";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore JSON parse failure — 用兜底文案
    }
    throw new Error(detail);
  }
}
