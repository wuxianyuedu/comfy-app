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
  [
    /Failed to fetch|NetworkError|Load failed/i,
    "网络请求失败，请检查应用服务是否正在运行",
  ],
  [
    /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i,
    "连接被拒绝或中断，应用服务可能尚未就绪",
  ],
  [
    /signal is aborted without reason|AbortError/i,
    "请求被中断，应用服务可能正在重启，请稍候重试",
  ],
  [/aborted|timeout|ETIMEDOUT/i, "请求超时或被中断，请稍候重试"],
];

/** 把网络层原始报错翻译成可读文案；无法识别时返回 null（走原 message）。 */
function translateNetworkError(message: string): string | null {
  for (const [pattern, readable] of NETWORK_ERROR_TRANSLATIONS) {
    if (pattern.test(message)) return readable;
  }
  return null;
}

/**
 * 传输层「包装式」文案的特征：它描述的是**传输过程**，不含业务/服务端信息。
 *
 * tRPC 客户端在批量流式链路上失败时，顶层 `message` 常是这类通用文案
 * （如 `signal is aborted without reason`——React Query 重试时中止上一轮请求
 * 所致），而**真正的原因**在 `shape.message`（服务端 procedure 抛出的原文，
 * 如 `no such table: llmConfig`）。只看顶层就会把「库里没有这张表」误报成
 * 「请求被中断」，用户按提示去等重启自然永远修不好。
 */
const TRANSPORT_WRAPPER_RE =
  /signal is aborted without reason|^AbortError|aborted without reason|The operation was aborted/i;

/**
 * 从 tRPC 错误对象里取「最贴近根因」的文案。
 *
 * 优先级：服务端原始 message（`shape.message`，与顶层不同且非空时）→
 * 顶层 message。顶层只是传输层包装时才让位给服务端原文。
 */
function pickUnderlyingMessage(e: object): string | null {
  const top = (e as { message?: unknown }).message;
  const topStr = typeof top === "string" && top.length > 0 ? top : null;
  const shape = (e as { shape?: { message?: unknown } }).shape;
  const shapeStr =
    shape && typeof shape.message === "string" && shape.message.length > 0
      ? shape.message
      : null;
  // 服务端原文更能说明问题；与顶层重复时不必替换。
  if (shapeStr && shapeStr !== topStr) return shapeStr;
  return topStr;
}

/** 从 unknown 抛值里取出 message；取不到（或非字符串、空串）则用 fallback。 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const underlying = pickUnderlyingMessage(e);
    if (underlying) {
      /* 顶层是传输层包装且服务端另有原文 → 直接用原文（它是根因描述）。 */
      if (
        underlying !== (e as { message?: unknown }).message &&
        !TRANSPORT_WRAPPER_RE.test(underlying)
      ) {
        return underlying;
      }
      return translateNetworkError(underlying) ?? underlying;
    }
  }
  return fallback;
}

/**
 * 从 unknown 抛值里取出**原始**报错详情（给日志/「完整错误」区用，不翻译）。
 *
 * 与 {@link errorMessage} 的分工：`errorMessage` 产出**给人看**的可读文案
 * （把「Unexpected token '<'」这类无信息量的原文换成人话），本函数产出
 * **给排查用**的原文——tRPC 的 `code` / 服务端 `message` / stack 首行。
 * 两者都落进 app-runtime 日志：前者进消息，后者进 `raw` 字段。没有它时，
 * 面板里只剩翻译后的文案，服务端真实报错（如 `no such table: xxx`）丢失。
 *
 * 长度设上限：stack 可达数百行，落盘只需能定位的头几行。
 */
export function rawErrorDetail(e: unknown, maxLen = 600): string {
  if (e === null || e === undefined) return "";
  const parts: string[] = [];
  if (typeof e === "string") {
    parts.push(e);
  } else if (typeof e === "object") {
    const obj = e as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      data?: { code?: unknown; httpStatus?: unknown };
      cause?: unknown;
      stack?: unknown;
      shape?: { message?: unknown; code?: unknown };
    };
    if (typeof obj.name === "string" && obj.name) parts.push(obj.name);
    const message =
      typeof obj.message === "string" && obj.message ? obj.message : null;
    if (message) parts.push(message);
    // tRPC 客户端错误把 code / httpStatus 放在 data 里；服务端 shape 里也有 code。
    const code =
      typeof obj.data?.code === "string"
        ? obj.data.code
        : typeof obj.shape?.code === "string"
          ? obj.shape.code
          : typeof obj.code === "string"
            ? obj.code
            : null;
    if (code) parts.push(`code=${code}`);
    if (typeof obj.data?.httpStatus === "number") {
      parts.push(`http=${obj.data.httpStatus}`);
    }
    // cause 常携带被包装的底层错误（AbortError / TypeError 等）。
    if (obj.cause instanceof Error && obj.cause.message) {
      parts.push(`cause=${obj.cause.name}: ${obj.cause.message}`);
    }
    if (typeof obj.stack === "string" && obj.stack) {
      const head = obj.stack.split("\n").slice(0, 3).join(" | ");
      if (head && !message?.includes(head)) parts.push(head);
    }
  }
  const text = parts.join(" — ");
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
