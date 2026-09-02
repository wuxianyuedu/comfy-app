// ── Shared LLM types ─────────────────────────────────────────
// Both local (Ollama / LM Studio / vLLM) and remote (OpenAI-compatible)
// providers speak the OpenAI /v1/chat/completions protocol.

export type LLMProviderType = "local" | "remote";

/** 已知的任务类型 key —— 用于按场景选择不同温度 */
export const TASK_TYPES = {
  txt2img: { label: "文生图", desc: "严谨确定，保证输出稳定可复现", hint: "0.1~0.3" },
  img2video: { label: "图生视频", desc: "中低随机性，平衡连贯性与变化", hint: "0.3~0.5" },
  chat: { label: "对话聊天", desc: "自然平衡，日常交互默认档位", hint: "0.6~0.8" },
  code: { label: "代码生成", desc: "极低随机性，输出精确符合语法", hint: "0.05~0.2" },
  creative: { label: "创意写作", desc: "高发散性，激发灵感与多样性", hint: "0.9~1.2" },
} as const;

export type TaskType = keyof typeof TASK_TYPES;

export interface LLMConfig {
  provider: LLMProviderType;
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 or https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  /** Only used by remote providers; never returned to the browser. */
  apiKey?: string | null;
  /** 全局默认温度（fallback） */
  temperature: number;
  /** 按任务类型覆盖的温度；null / 缺失某 key 时回退到 temperature */
  temperatureByTask?: Record<TaskType, number> | null;
  maxTokens: number;
}

/** Config shape sent to / shared with the browser (apiKey is masked). */
export interface LLMConfigView {
  provider: LLMProviderType;
  baseUrl: string;
  model: string;
  temperature: number;
  temperatureByTask?: Record<TaskType, number> | null;
  maxTokens: number;
  hasApiKey: boolean;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  provider?: LLMProviderType;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 调用方指定的任务类型，用于查找 temperatureByTask 覆盖 */
  taskType?: TaskType;
}
