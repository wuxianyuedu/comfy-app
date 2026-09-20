// ── REST Route Handler 的请求体入口（唯一形态）（规范 16 §16.2.4.44）──────────
//
// 按**形态**扫描时撞出来的账：`src/app/api/**` 的 POST 路由里，
// 「读 JSON 体 → 判它是不是对象 → 不是就回 400」这三步被写了十来遍 ——
// 而它们对同一件事各判各的：
//
//   · **5 个文件逐字相同**的 12 行（`agent/chat` / `workshop/draft` /
//     `workshop/logs` 之外的 `workshop-api/config` / `workshop-api/generate` /
//     `workshop-local/prepare`）：`try { body = await req.json() } catch {`
//     → `NextResponse.json({ error: "请求格式错误" }, { status: 400 })`
//     → `if (!isRecord(body))` → `{ error: "请求体必须是对象" }`；
//   · `custom-nodes` 与 `llm/test` 写成 `await req.json().catch(() => ({}))`
//     —— **畸形 JSON 被静默当成空对象**，于是同一个坏请求在一种写法下回
//     「请求格式错误」、在另一种下走到「字段缺失」分支回一句完全无关的话；
//   · `workshop/logs` 又把 `isRecord` 就地展开成
//     `(typeof body === "object" && body !== null ? body : {})` —— 它的语义与
//     `custom-nodes` 那族相同（畸形体当空对象），却写得看不出来是同一条判据；
//   · `llm/route.ts` 有自己的一套 `BodySchema.parse`（那条保留：它的字段语义
//     与 `LLMRequestOptions` 绑定，见下「不收」）；
//   · `logs/app-runtime` / `logs/export` 回的信封是 `{ ok: false }`，
//     连**错误形状**都与上面那族不同（一个 `{ error: string }`、
//     一个 `{ ok: false, error?: string }`）。
//
// 也就是说 —— **「这个请求体的格式对不对、不对回什么」取决于它是哪个文件写的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（每种写法都合法）。
//
// ## 收什么、不收什么
//
// **收**：读体（`req.json()`）、「必须是对象」这条收窄、以及由此产生的 400 信封
//（走 §10.9 的 `errorResponse(new ValidationError(…))` —— 与其余 REST 错误
// 同一形状）。
// **不收**：**字段级**校验（`messages` 不能为空 / `image` 必须存在 / `stage`
// 要能解析）—— 每个端点的字段语义各不相同，那是域判据，留在各自的路由里。
// 也不收「哪些方法需要鉴权」（`requireRequestUser` 的调用位置随端点而异）。

import "server-only";

import { NextResponse } from "next/server";

import { ValidationError } from "~/lib/core/errors";
import { isPlainRecord } from "~/lib/is-record";
import { errorResponse } from "~/server/lib/error-response";

/**
 * 读 JSON 体并收窄成对象；**格式不对时直接给出 400 响应**。
 *
 * ```ts
 * // 调用处：鉴权 → 读体 → 原样把 400 返回
 * 路由：export async function POST(req: NextRequest) {
 *   const user = await requireRequestUser();      // 鉴权随端点而异
 *   if (!user) return unauthorizedResponse();   // 未登录即 401
 *   const body = await readJsonRecord(req);       // 读体 + 收窄一次给全
 *   if (body instanceof NextResponse) return body;   // 格式错误：已带 400
 *   const kind = body.kind;                          // 这里已经是 Record
 *   …
 * }
 * ```
 *
 * 返回 `NextResponse` 而不是抛：调用处需要**原样**把它返回，而
 * `try/catch` 会把「格式错误」与「业务失败」混在同一条控制流里 ——
 * 那正是 `llm/route.ts` 现在难读的原因。
 *
 * **畸形 JSON 不再被当成空对象**（`custom-nodes` / `llm/test` / `workshop/logs`
 * 的旧写法）：坏请求回一句明确的「请求格式错误」，比让它走到「字段缺失」分支
 * 回一句与病因无关的话要好。既有落点若确实依赖「空对象」语义（读字段处
 * 都已按缺省处理），这一改动只是让错误更准确 —— 它们不会因此多出失败路径。
 */
export async function readJsonRecord(
  req: Request,
): Promise<Record<string, unknown> | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(
      new ValidationError("请求格式错误：正文不是合法 JSON"),
    );
  }
  /* 用 `isPlainRecord` 而不是 `isRecord`：后者的判据是「是不是对象」，
   * 而 **JSON 数组也算对象**（`typeof [] === "object"`）—— 数组体进了
   * 调用处会在 `body.xxx` 上静默拿到 `undefined`，回一句与病因无关的话。
   * 这里要的是「一个 JSON 对象」，所以数组是格式错误。 */
  if (!isPlainRecord(body)) {
    return errorResponse(new ValidationError("请求体必须是对象"));
  }
  return body;
}

/** `readJsonRecord` 的结果是不是「已备好的错误响应」。 */
export function isErrorResponse(
  value: Record<string, unknown> | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * 「必填字符串字段」的取法（`strField` 的同一口径，见
 * `~/lib/workshop/media-source.server`）—— **不含**在这里：
 * 字段级校验是各端点的域判据。本模块只管到「它是个对象」为止。
 *
 * 这一行注释是**有意的提醒**：留一个空段比留一个含糊的通用 `requireString`
 * 更安全 —— 后者会诱导所有人把各自的字段错误文案收成一句（那会丢掉
 * 「哪个字段错了」这条用户可见信息）。
 */
