import type { LLMConfigView, LLMProviderType } from "~/lib/llm/types";

/** 提取模型通道：本地模型 / 远端 API。无「工具内置规则」通道（确定性解析可用性差，已移除）。 */
export type ExtractChannel = "local" | "remote";

/** 下拉选项值：local/remote 携带模型名 */
export function channelOptionValue(
  channel: ExtractChannel,
  model: string,
): string {
  return `${channel}::${model}`;
}

/** 下拉选项值 → 通道 + 模型名（与 channelOptionValue 互逆） */
export function parseChannelOption(value: string): {
  channel: ExtractChannel;
  model: string;
} {
  const idx = value.indexOf("::");
  if (idx === -1) return { channel: "local", model: "" };
  const channel = value.slice(0, idx);
  return {
    channel: channel === "remote" ? "remote" : "local",
    model: value.slice(idx + 2),
  };
}

/** 提取类下拉实际生效的 provider/model：独立选择优先，未选（空串）则沿用全局配置。
 *  解析出非 local/remote 的脏值时按本地兜底（提取通道只剩这两档）。 */
export function resolveChannelSelection(
  value: string,
  config: LLMConfigView | null,
): { provider: LLMProviderType; model: string } {
  if (value) {
    const parsed = parseChannelOption(value);
    return { provider: parsed.channel, model: parsed.model };
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
