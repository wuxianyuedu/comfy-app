// ── unknown 抛值 → 可读兜底文案 ─────────────────────────────────────────────
// catch 到的变量是 unknown，项目里此前出现过 8 份各自实现的
// `(e as any)?.message ?? fallback`（组件、hook、Route Handler 各一份）。
// 收敛到这一处：失败路径统一有可读文案（硬规则 4），「未知的 unknown 怎么取值」
// 也只有一个地方可改。
//
// 注意长度判空：`new Error("")` 会把空串当成有效文案渲染成空白提示条，
// 因此空消息一律回落 fallback。

/** 从 unknown 抛值里取出 message；取不到（或非字符串、空串）则用 fallback。 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
