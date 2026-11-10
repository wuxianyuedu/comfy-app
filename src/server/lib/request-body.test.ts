/**
 * REST 路由的请求体入口（规范 16 §16.2.4.44）：分歧在**畸形 JSON 算什么** —— 收口前 5 个文件回 400「请求格式错误」，而 `custom-nodes` / `llm/test` / `workshop/logs` 用 `.catch(() => ({}))` 静默当空对象，于是同一个坏请求在一种写法下给出准确原因、另一种走到「字段缺失」回一句与病因无关的话。用例把这条分歧钉死。
 */
import { describe, expect, it } from "vitest";

import { isPlainRecord } from "~/lib/is-record";
import { isErrorResponse, readJsonRecord } from "./request-body";

/** 错误信封 { error: { code, message } } 的形状守卫（§10.9 唯一出口）。 */
function isErrorEnvelope(v: unknown): v is { error: { code: string; message: string } } {
  if (!isPlainRecord(v)) {
    return false;
  }
  const error: unknown = v.error;
  if (!isPlainRecord(error)) {
    return false;
  }
  return typeof error.code === "string" && typeof error.message === "string";
}

function reqWith(body: string): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readJsonRecord", () => {
  it("合法对象正文原样返回（不包一层信封）", async () => {
    const result = await readJsonRecord(reqWith('{"kind":"image","n":1}'));
    expect(isErrorResponse(result)).toBe(false);
    expect(result).toEqual({ kind: "image", n: 1 });
  });

  it("畸形 JSON 回 400，**不再**被静默当成空对象", async () => {
    const result = await readJsonRecord(reqWith("{ 不是 JSON"));
    expect(isErrorResponse(result)).toBe(true);
    // 断言已判「是错误响应」，再用同一守卫让 NextResponse 的形状对 tsc 可见。
    if (!isErrorResponse(result)) {
      throw new Error("readJsonRecord 未返回错误响应");
    }
    expect(result.status).toBe(400);
    const parsed: unknown = await result.json();
    if (!isErrorEnvelope(parsed)) {
      throw new Error("错误信封形状不对");
    }
    /* 信封形状走 §10.9 的唯一出口：`{ error: { code, message } }`，
     * 而不是 `{ error: "…" }` 字符串。 */
    expect(parsed.error.code).toBe("validation.invalid");
    expect(parsed.error.message).toContain("JSON");
  });

  it("数组正文算「不是对象」—— 回 400 而不是把它当记录用", async () => {
    const result = await readJsonRecord(reqWith("[1,2,3]"));
    expect(isErrorResponse(result)).toBe(true);
    if (!isErrorResponse(result)) {
      throw new Error("readJsonRecord 未返回错误响应");
    }
    expect(result.status).toBe(400);
  });

  it("字符串 / 数字 / null 正文同样回 400", async () => {
    for (const raw of ['"x"', "42", "null"]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const result = await readJsonRecord(reqWith(raw));
      expect(isErrorResponse(result), raw).toBe(true);
    }
  });
});

describe("isErrorResponse", () => {
  it("只认 NextResponse（对象与 Promise 都不算）", async () => {
    expect(isErrorResponse({ kind: "image" })).toBe(false);
    const err = await readJsonRecord(reqWith("["));
    expect(isErrorResponse(err)).toBe(true);
  });
});
