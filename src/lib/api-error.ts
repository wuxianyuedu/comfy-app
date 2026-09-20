// ── 「服务端错误信封」的唯一口径（规范 16 §16.2.4.35）──────────────────────
//
// 按形态扫描时撞出来的账：`src/app/api/**` 里有十二处逐字同形的
//
//   return NextResponse.json(                        // ← 服务端返回：
//     { error: errorMessage(e, "读取素材库失败") },   //    亲手拼的错误信封
//     { status: 500 },
//   );
//
// 而**读它们的客户端有六种写法**（都在 `src/lib/**`）：
//
//   · `readMaterialError` / `readBgmError` / `readUploadError` —— 三份**逐字
//     相同**的「取 `body.error` 字符串」，各自在文件内声明一次；
//   · `readApiErrorMessage`（workshop 通道）—— 多认一种 `{error:{message}}`；
//   · `readComfyErrorMessage` —— 三种形态（`detail` / `{error}` 字符串 /
//     `{error:{message}}`），因为 `/api/comfy/ensure` 三种都发过；
//   · `debug-source-client` 直接 `body?.error`（`unknown` 上取值）；
//   · `ollama-client` 自己 `as { error?: string }` 断言；
//   · `agent/client` 只认 `{error:{message}}`（`data.error` 是对象时取
//     `.message`，是字符串时回落「请求失败」）。
//
// 也就是说 —— **「服务端失败了，客户端读到什么」取决于它是哪一处读的**。
// 而这一侧与 UI 侧的出口（`~/lib/async-action`）**不是同一件事**：
// 那边管「动作失败怎么变成用户可见反馈」，这边管**响应体怎么编码**。
// 收口前它们被混在一起讨论过（「这十二处也是失败路径」），这也正是本账
// 一直没做的原因 —— 先得把口径定下来。
//
// ## 口径（两条）
//
// 1. **服务端的错误文案由 `errorMessage(e, fallback)` 产出**（与 UI 侧同一枚
//    口径，`~/lib/error-message`）：网络层原文翻成人话、未知抛值有兜底。
//    `fallback` 是**这一路动作**的标题（「读取素材库失败」），不是通用兜底 ——
//    十二处各自给的就是它，收口后仍然由调用处给。
// 2. **信封形状是「REST 侧」与「tRPC 侧」各一套，不许第三套**：
//    - REST 路由 → `~/server/lib/error-response` 的 `errorResponse(e)`
//      （`{ error: { code, message } }`，见规范 10 §10.9）；
//    - 但**「业务失败」与「请求失败」不是同一件事**：`/api/materials` 的上传
//      失败要连带回 `folders: []` / `items: []`（客户端拿它当列表），
//      `/api/upload` 要带 `hint: "comfyui-unreachable"` 让客户端知道可重试。
//      这两种要带**业务字段**，不能走 `errorResponse`（那是纯错误响应）。
//
// 所以本模块给的是**第二种**：**带业务字段的失败响应**里那个 `error` 字段的
// 取值口径 + 客户端读它的唯一写法。两条口径合起来覆盖了十二处：
//
//   · 纯错误（无业务字段）→ `errorResponse`（**已经清了，见 §10.9**）；
//   · 带业务字段 → 本模块的 `apiErrorBody` / `readApiError`。
//
// ## 收什么、不收什么
//
// **收**：`error` 字段怎么取值（`apiErrorDetail`）、带业务字段的失败体怎么拼
// （`apiErrorBody`）、客户端怎么读（`readApiError`）、
// 「怎么判这个响应是不是失败」（`RESPONSE_ERROR_KEY`）。
// **不收**：HTTP 状态码的选择（那是路由的域判据：400 入参、502 外部依赖、
// 500 兜底）、`logger.error` 的落点（归 `~/lib/log`）、
// 路由自己的业务字段（`folders` / `hint` / SSE 的 `data:` 行）。

import { errorMessage } from "~/lib/error-message";

/** 响应体里承载错误文案的键 —— 全库唯一（十二处路由与六个客户端同源）。 */
export const RESPONSE_ERROR_KEY = "error";

/**
 * 服务端失败文案的取值：`errorMessage(e, fallback)`。
 *
 * 单独给一个名字是为了让**「服务端这一侧」和「UI 侧」在代码上指向同一处**
 * —— 收口前那十二处各自 import `errorMessage` 并自己拼，
 * 而 `ollama-client` 那一侧还在用 `as { error?: string }` 断言。
 *
 * `fallback` 是**这一路动作**的标题（「保存服务端草稿失败」），不是通用兜底：
 * 用户看到的是「哪件事失败了」+「为什么」两段，缺一段都不够定位。
 */
export function apiErrorDetail(error: unknown, fallback: string): string {
  return errorMessage(error, fallback);
}

/**
 * 拼一个**带业务字段**的失败响应体。
 *
 * 业务字段（`folders` / `items` / `hint` …）原样展开，错误文案统一挂在
 * {@link RESPONSE_ERROR_KEY} 上 —— 键名只在这里出现一次，客户端按同一个键读。
 *
 * 用法：把 `apiErrorBody(e, "读取素材库失败", { folders: [], items: [] })`
 * 交给 `NextResponse.json(…)`，状态码由路由自己给（500 兜底）。下发的
 * 响应体是 `{ folders: [], items: [], error: "…" }` —— 业务字段原样在前，
 * 错误文案在唯一的键上。
 */
export function apiErrorBody(
  error: unknown,
  fallback: string,
  fields?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...fields,
    [RESPONSE_ERROR_KEY]: apiErrorDetail(error, fallback),
  };
}

/** 从响应体里取可读错误文案；不是失败体（或文案为空）时给 `null`。
 *
 * 两种历史形态都认：字符串 `error`（REST 路由的 `/api/*`），
 * 以及 `{ error: { message } }`（`errorResponse` 的结构化信封，
 * 鉴权 401 与 `NotFoundError` 走这条）。**第三种形状不许再出现** ——
 * 收口前 `readComfyErrorMessage` 多认的 `detail` 是 `/api/comfy/ensure`
 * 的合法业务字段（它不是错误文案，是「还在启动」的进度描述），
 * 那一路由它自己的客户端处理。
 */
export function readApiError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const err: unknown = (body as Record<string, unknown>)[RESPONSE_ERROR_KEY];
  if (typeof err === "string" && err.trim()) return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

/**
 * 读 JSON 响应体，非法 JSON 按空对象处理。
 *
 * **后端 500 可能返回非 JSON**（dev server 重启窗口、代理错误页）——
 * 那时 `res.json()` 抛出的是「Unexpected token '<'」，对用户毫无信息量，
 * 而真正的原因（服务没起来）在原文里完全看不出来。
 * 归一到 `{}` 之后由 `readApiError(...) ?? fallback` 给出可读文案。
 */
export async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return {};
  }
}
