/**
 * comfy-cli 原文日志行的解析（`[comfy-cli 原始] {json}` / `stdout` / `stderr`）。
 *
 * 日志面板里的这些行是 comfy-cli 的原文：`原始` 行（envelope / converted 等
 * JSON 事件）进面板时**不再按单行截断**（见 `executor-cli-stream`），面板据此
 * 把它折成一行、展开后用 JsonViewer 显示完整 JSON；`stdout` / `stderr` 的普通
 * 文本行仍按原文显示。
 *
 * 为什么收口成一个模块：「哪一行是 comfy-cli 原文」「哪一行是 JSON 形态」
 * 「解析出来的对象是什么」这三件事此前在日志面板与「查看完整输出」弹窗里
 * 各写一份前缀正则，两处一旦分叉就会出现「面板说它可展开、弹窗解析不出」这类
 * 对不上的形态。判据（前缀 + 首字符 / JSON.parse）只在这里定义一次。
 */

/** comfy-cli 原文行的来源标记：原始（envelope 等 JSON）/ stdout / stderr。 */
export type CliLogTag = "原始" | "stdout" | "stderr";

/** `[comfy-cli <tag>] ` 前缀（tag 只认这三种，避免把别的 `[comfy-cli …]` 行误当原文）。 */
const CLI_LOG_PREFIX = /^\[comfy-cli (原始|stdout|stderr)\]\s?/;

/**
 * 拆出原文行的来源标记与载荷（去掉前缀）。
 *
 * 不是 comfy-cli 原文行（前缀不匹配）时返回 `null` —— 调用处据此按普通日志
 * 处理，不会把无关的 `[comfy-cli …]` 文本吞掉。
 */
export function splitCliLogLine(
  message: string,
): { tag: CliLogTag; payload: string } | null {
  const match = CLI_LOG_PREFIX.exec(message);
  if (!match) return null;
  return {
    tag: match[1] as CliLogTag,
    payload: message.slice(match[0].length).trimStart(),
  };
}

/**
 * 该行是不是「comfy-cli 原文 + JSON 容器」形态。
 *
 * 判据刻意**便宜**（只看前缀与首字符，不做 JSON.parse）：日志面板会对整页
 * 每一行调用一次（约 2000 次/轮），真正的解析只发生在它被展开的那一刻。
 * 首字符必须是 `{` / `[` —— JSON 事件都是对象或数组，而 stdout / stderr 的
 * 普通文本行不是。
 */
export function isCliJsonLine(message: string): boolean {
  const split = splitCliLogLine(message);
  if (!split) return false;
  const first = split.payload.charAt(0);
  return first === "{" || first === "[";
}

/**
 * 解析原文行里的 JSON 值；不可解析时返回 `null`。
 *
 * 「不可解析」包括：不是 comfy-cli 原文行 / 载荷首字符不是 `{` `[` / JSON.parse
 * 抛错 / 解析结果不是对象或数组（如 `123`、`"x"`、`null`）。返回 `null` 时调用处
 * 按**原文**（`splitCliLogLine` 的 `payload`）显示，与折叠前一致。
 */
export function parseCliJsonLine(
  message: string,
): { tag: CliLogTag; value: unknown } | null {
  const split = splitCliLogLine(message);
  if (!split) return null;
  const first = split.payload.charAt(0);
  if (first !== "{" && first !== "[") return null;
  try {
    const value: unknown = JSON.parse(split.payload);
    if (value && typeof value === "object") {
      return { tag: split.tag, value };
    }
  } catch {
    /* 非法 JSON（截断 / 非 JSON 文本）：交由调用处按原文显示。 */
  }
  return null;
}
