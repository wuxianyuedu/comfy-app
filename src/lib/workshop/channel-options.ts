import type { LLMConfigView, LLMProviderType } from "@/lib/llm/types";

/** 模型通道：①工具（内置规则，不调用模型）②本地模型 ③远端 API —— 单下拉三分组 */
export type ExtractChannel = "tool" | "local" | "remote";

/** 下拉选项值：工具通道无模型；local/remote 携带模型名 */
export function channelOptionValue(channel: ExtractChannel, model: string): string {
  return channel === "tool" ? "tool" : `${channel}::${model}`;
}

/** 下拉选项值 → 通道 + 模型名（与 channelOptionValue 互逆） */
export function parseChannelOption(value: string): { channel: ExtractChannel; model: string } {
  if (value === "tool") return { channel: "tool", model: "" };
  const idx = value.indexOf("::");
  const channel = value.slice(0, idx) as "local" | "remote";
  return { channel, model: value.slice(idx + 2) };
}

/** 生成类下拉实际生效的 provider/model：独立选择优先，未选（空串）则沿用全局配置。
 *  生成类下拉不带「工具」通道，解析出 tool 只可能是脏值，按本地兜底。 */
export function resolveChannelSelection(
  value: string,
  config: LLMConfigView | null,
): { provider: LLMProviderType; model: string } {
  if (value) {
    const parsed = parseChannelOption(value);
    return {
      provider: parsed.channel === "tool" ? "local" : parsed.channel,
      model: parsed.model,
    };
  }
  return { provider: config?.provider ?? "local", model: config?.model ?? "" };
}

/** 生成类下拉的展示值：未手动选择时跟随全局配置，保证选中态与生效模型一致。 */
export function channelSelectionDisplayValue(
  value: string,
  config: LLMConfigView | null,
): string {
  if (value) return value;
  return config?.model ? channelOptionValue(config.provider, config.model) : "";
}

/** provider → 中文标签，供提示与成功状态统一口径 */
export function channelProviderLabel(provider: LLMProviderType): string {
  return provider === "local" ? "本地" : "远端";
}
