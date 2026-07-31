// ── Shared LLM types ─────────────────────────────────────────
// Both local (Ollama / LM Studio / vLLM) and remote (OpenAI-compatible)
// providers speak the OpenAI /v1/chat/completions protocol.

export type LLMProviderType = "local" | "remote";

export interface LLMConfig {
  provider: LLMProviderType;
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 or https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  /** Only used by remote providers; never returned to the browser. */
  apiKey?: string | null;
  temperature: number;
  maxTokens: number;
}

/** Config shape sent to / shared with the browser (apiKey is masked). */
export interface LLMConfigView {
  provider: LLMProviderType;
  baseUrl: string;
  model: string;
  temperature: number;
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
}
