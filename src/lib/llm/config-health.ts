/**
 * LLM「配置不可用」的分类与可行动文案（ISSUE #5145）。
 *
 * 此前主链（`lib/llm/server.ts`）与工坊链（`server/workshop/llm.ts`）各写一份
 * 「API Key 无效」提示，措辞不同；「没配生效模型」那句更是逐字重复两份。
 * 这里收成无副作用的纯函数出口，两端共用；不碰任何密钥明文。
 */
import { isLoopbackBaseUrl, type LLMConfig } from "./types";

export type LlmConfigTarget = Pick<LLMConfig, "baseUrl" | "model" | "provider">;

/** 未配置生效模型：调用前就判掉，不发请求。 */
export const ERR_NO_EFFECTIVE_MODEL =
  "尚未配置生效模型：请先在「设置 → 本地模型/远程模型」中选择或填写要使用的模型名";

/** 401 / 403：密钥失效或无权限 —— 指到具体设置位置。 */
export const ERR_AUTH_INVALID =
  "API Key 无效或未授权：请到「设置 → 远程模型」更新该供应商密钥，或确认该 Key 有此模型的调用权限后重试";

/** 空模型 / 本地服务未启动 / 鉴权失败三类判据（纯函数，不读库、不发请求）。 */
export type LlmProblemKind = "no-model" | "auth-invalid" | "local-down";

export function llmConfigProblem(cfg: LlmConfigTarget): {
  kind: "no-model";
  message: string;
} | null {
  return cfg.model.trim() === "" ? { kind: "no-model", message: ERR_NO_EFFECTIVE_MODEL } : null;
}

/**
 * 上游 HTTP / 网络失败 → 可行动文案。
 * 保留「API Key 无效或未授权」这个既有锚词，兼容历史卡 / 队列的读数和用例。
 */
export function llmFailureMessage(input: {
  cfg: LlmConfigTarget;
  error?: unknown;
  status?: number;
}): string {
  const { cfg } = input;
  if (input.status === 401 || input.status === 403) {
    return `（${ERR_AUTH_INVALID}）`;
  }
  const cause = errorDetail(input.error);
  const isLocal = cfg.provider === "local" || isLoopbackBaseUrl(cfg.baseUrl);
  if (isLocal && /ECONNREFUSED|ECONNRESET|fetch failed|getaddrinfo/i.test(cause)) {
    return `本地模型服务未启动（${cfg.baseUrl}）：请先启动 Ollama，或到「设置 → 本地模型」确认 Base URL 后重试。`;
  }
  return `LLM 请求失败${cause === "" ? "" : `：${cause}`}`;
}

/** 沿 cause 链取一句底层原因；外来错误明文只截断，不回显大段响应体。 */
function errorDetail(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    if (current instanceof Error) {
      const text = current.message.trim();
      if (text !== "") {
        return text.slice(0, 300);
      }
      current = current.cause;
      continue;
    }
    if (typeof current === "string") {
      return current.trim().slice(0, 300);
    }
    break;
  }
  return "";
}
