/**
 * tRPC JSON Lines 响应的**解包 + 错误块识别**（ISSUE #4325）。
 *
 * 为什么单独一件：`main-journey.spec.ts` 的 `trpcCall` 原本逐行内联解包，只认
 * 「成功块」（`json[2][0][0]`），服务端批内单过程报错（典型：入参 zod 校验失败）
 * **不会让 HTTP 变红**（tRPC v11 流式响应下 HTTP 仍是 200，`res.ok()` 拦不到），
 * 错误块被解成「一个带 error 键的对象」一路漏到下游断言，红在不相干的位置
 * （#4274：`project.upsert` 入参没过，却报在两条之后的 `project.list` 断言上）。
 *
 * 抽成纯函数后 `trpcCall` 只管发请求，解包/识别可被 `tests/e2e-trpc-response.test.ts`
 * 直接执行。形状来自**真实失败响应取证**（本地起 dev server 发空入参的
 * `project.upsert` mutation，2026-11-18），不是照猜：
 *
 *   HTTP 200；响应两行 JSONL：
 *     行 0（head）：`{"json":{"0":[[0],[null,0,0]]}}`
 *     行 1：       `{"json":[0,0,[[{"error":{…}}]]]}`
 *   最后一行解包：`parsed.json[2][0][0]` = `{error: {message, code, data:{code,httpStatus,path,zodError}}}`；
 *   成功时同一位置是过程返回值 `[[值]]` 里的那个值。
 *
 * 识别只认「该槽位是对象且有 `error` 键、`error.message` 是字符串」这一形状 —— 不把
 * 别的对象误判成错误（成功返回本身也可能是个带 error 字段的业务对象，那种不在这里
 * 判：tRPC 的错误块 `error` 里必有 `code` 数字与 `message` 字符串，这里要求两者）。
 */
import { isPlainRecord, isRecord, isUnknownArray } from "~/lib/is-record";

/** 从 tRPC 错误块里取人类可读的诊断串：过程名 + 服务端 message + code。 */
function errorDetail(procedure: string, error: Record<string, unknown>): string {
  const message = typeof error.message === "string" ? error.message.slice(0, 500) : "(无 message)";
  const data = isRecord(error.data) ? error.data : null;
  const code = data && typeof data.code === "string" ? data.code : "";
  const path = data && typeof data.path === "string" ? data.path : procedure;
  return `${procedure} 调用失败（tRPC 错误块，过程=${path}${code ? `，code=${code}` : ""}）：${message}`;
}

/**
 * 解一整段 JSONL 响应，返回批内第 0 个过程的值；识别到错误块就抛带过程名的 Error。
 *
 * 成功路径与旧 `trpcCall` 逐字一致：`json[2] → [0] → [0]`。解析失败 / 空响应体 /
 * 信封形状不对都抛清楚的错（不在静默返回 undefined）—— 那些形态本身就说明响应
 * 不是合法 JSONL，继续往下只会把「协议没读懂」伪装成「业务值是空」。
 *
 * @param body `await res.text()` 的原始响应体
 * @param procedure 过程名（错误消息里带上，让 e2e 红在真实失败点）
 */
export function unwrapTrpcJsonl(body: string, procedure: string): unknown {
  const lines = body.split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`${procedure} 回了空响应体（预期 JSON Lines）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new Error(
      `${procedure} 的最后一行不是合法 JSON（预期 JSON Lines），原文：${last.slice(0, 200)}`,
    );
  }
  const json = isRecord(parsed) ? parsed.json : undefined;
  if (!isUnknownArray(json) || json.length < 3) {
    throw new Error(
      `${procedure} 的响应信封缺 \`json[2]\` 数据段（预期 JSON Lines 的 batch 槽位），原文：${last.slice(0, 200)}`,
    );
  }
  const data = json[2];
  const slot = isUnknownArray(data) ? data[0] : undefined;
  const value = isUnknownArray(slot) ? slot[0] : slot;
  /* 错误块：`{error: {message: string, code: number, data: {code, …}}}`。
   * 用 isPlainRecord 排掉数组；error 需同时有字符串 message 与数字 code ——
   * 与 tRPC v11 实测形状一致，也避免把业务对象里叫 error 的字段误判。 */
  if (isPlainRecord(value)) {
    const error = value.error;
    if (isRecord(error) && typeof error.message === "string" && typeof error.code === "number") {
      throw new Error(errorDetail(procedure, error));
    }
  }
  return value;
}
