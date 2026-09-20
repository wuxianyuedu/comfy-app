/**
 * REST 路由的请求体入口（规范 16 §16.2.4.44）。
 *
 * 这条账的核心分歧是**畸形 JSON 算什么**：收口前 5 个文件回
 * 「请求格式错误」的 400，而 `custom-nodes` / `llm/test` / `workshop/logs`
 * 用 `.catch(() => ({}))` 把它**静默当成空对象** —— 于是同一个坏请求
 * 在一种写法下得到准确的原因、在另一种下走到「字段缺失」分支回一句
 * 与病因无关的话。用例把这条分歧钉死。
 */
import { describe, expect, it } from "vitest";

import { isErrorResponse, readJsonRecord } from "./request-body";

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
    expect((result as Response).status).toBe(400);
    const envelope = (await (result as Response).json()) as {
      error: { code: string; message: string };
    };
    /* 信封形状走 §10.9 的唯一出口：`{ error: { code, message } }`，
     * 而不是 `{ error: "…" }` 字符串。 */
    expect(envelope.error.code).toBe("validation.invalid");
    expect(envelope.error.message).toContain("JSON");
  });

  it("数组正文算「不是对象」—— 回 400 而不是把它当记录用", async () => {
    const result = await readJsonRecord(reqWith("[1,2,3]"));
    expect(isErrorResponse(result)).toBe(true);
    expect((result as Response).status).toBe(400);
  });

  it("字符串 / 数字 / null 正文同样回 400", async () => {
    for (const raw of ['"x"', "42", "null"]) {
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
