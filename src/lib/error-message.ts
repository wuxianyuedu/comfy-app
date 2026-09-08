// ── unknown 抛值 → 可读兜底文案 ─────────────────────────────────────────────
// catch 到的变量是 unknown，项目里此前出现过 8 份各自实现的
// `(e as any)?.message ?? fallback`（组件、hook、Route Handler 各一份）。
// 收敛到这一处：失败路径统一有可读文案（硬规则 4），「未知的 unknown 怎么取值」
// 也只有一个地方可改。
//
// 注意长度判空：`new Error("")` 会把空串当成有效文案渲染成空白提示条，
// 因此空消息一律回落 fallback。

/**
 * 常见网络层故障的可读翻译。
 *
 * 背景（ISSUE #220）：tRPC / fetch 收到非 JSON 响应（dev server 重启窗口、
 * standalone 包未起好、代理返回错误页）时，`res.json()` 抛出
 * `Unexpected token '<', "<!DOCTYPE "...is not valid JSON`——原文对用户毫无
 * 信息量，且这类错误的真实原因（服务端此刻不可用）在原文里完全看不出来。
 * 在取值出口统一翻译成人话，各调用方无需各自判断。
 */
const NETWORK_ERROR_TRANSLATIONS: [RegExp, string][] = [
  [
    /Unexpected token '?.<'?.*is not valid JSON/i,
    "服务返回了非预期内容（通常是应用服务正在重启或未就绪），请稍候重试",
  ],
  [/Failed to fetch|NetworkError|Load failed/i, "网络请求失败，请检查应用服务是否正在运行"],
  [/fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i, "连接被拒绝或中断，应用服务可能尚未就绪"],
  [/aborted|AbortError|timeout|ETIMEDOUT/i, "请求超时或被中断，请稍候重试"],
];

/** 把网络层原始报错翻译成可读文案；无法识别时返回 null（走原 message）。 */
function translateNetworkError(message: string): string | null {
  for (const [pattern, readable] of NETWORK_ERROR_TRANSLATIONS) {
    if (pattern.test(message)) return readable;
  }
  return null;
}

/** 从 unknown 抛值里取出 message；取不到（或非字符串、空串）则用 fallback。 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) {
      return translateNetworkError(m) ?? m;
    }
  }
  return fallback;
}
