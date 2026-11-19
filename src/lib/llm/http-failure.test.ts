/**
 * `http-failure.ts` —— 上游非 2xx 的统一可读归因（#3517）。
 *
 * 这一份判三件事：HTML 页面**不灌标记**、JSON / 纯文本照旧带截断片段、
 * 状态码归因与地址点名各只出现一次（不重复拼状态码）。
 */
import { describe, expect, it } from "vitest";

import { httpFailureDetail } from "./http-failure";

describe("httpFailureDetail", () => {
  it("JSON 错误体：带出截断片段，401/403 补密钥归因", () => {
    expect(httpFailureDetail({ body: '{"error":"bad key"}', status: 401 })).toBe(
      'HTTP 401：{"error":"bad key"}（密钥无效，或该密钥没有这个接口的权限）',
    );
    // 没有专门归因的状态码只留状态码与片段（不硬塞一句泛泛的「请求失败」）
    expect(httpFailureDetail({ body: "{}", status: 429 })).toBe("HTTP 429：{}");
  });

  it("HTML 页面：不灌整页标记，直接说「这不是接口响应」并指向 Base URL", () => {
    const detail = httpFailureDetail({
      body: '<!DOCTYPE html><html lang="en"><head><title>404</title></head><body>…</body></html>',
      status: 404,
      url: "https://platform.example.com/v1/models",
    });
    expect(detail).toContain("HTTP 404（https://platform.example.com/v1/models）");
    expect(detail).toContain("返回的是网页（HTML）而不是接口响应");
    expect(detail).toContain("Base URL");
    // 关键：界面里不该出现 HTML 标记（#3517 的现场就是一段 <!DOCTYPE …）
    expect(detail).not.toContain("<!DOCTYPE");
    expect(detail).not.toContain("<html");
  });

  it("HTML 判定只看开头：正文里偶然出现的标记不算整页 HTML", () => {
    expect(httpFailureDetail({ body: 'upstream said "<body>"', status: 502 })).toBe(
      'HTTP 502：upstream said "<body>"',
    );
  });

  it("纯文本错误页照旧带片段（反代的 502 页不是 HTML 也照样看得见原因）", () => {
    expect(httpFailureDetail({ body: "upstream boom", status: 502 })).toBe(
      "HTTP 502：upstream boom",
    );
  });

  it("404 归因指向版本段；空响应体只留状态码与归因", () => {
    expect(httpFailureDetail({ body: "   ", status: 404 })).toBe(
      "HTTP 404（这个地址没有该接口：请核对 Base URL 是否含正确的版本段，如 /v1）",
    );
  });

  it("片段截断到 240 字符（长文本不撑爆一行）", () => {
    const detail = httpFailureDetail({ body: "z".repeat(500), status: 500 });
    expect(detail.length).toBeLessThanOrEqual("HTTP 500：".length + 240);
  });

  it("Base URL 落在已核实的厂商官网域上：归因之后再补一句端点指路（#3612）", () => {
    // #3612 的现场：官网域对任何密钥都答 401 Login expired —— 光说「密钥无效」
    // 会把用户引去反复换密钥，指路句（真正的 API 端点在哪）必须一起出现。
    const detail = httpFailureDetail({
      body: '{"code":"000501","message":"Login expired"}',
      status: 401,
      url: "https://api.agnes-ai.com/api/v1/models",
    });
    expect(detail).toContain("（密钥无效，或该密钥没有这个接口的权限）");
    expect(detail).toContain("「Agnes」的接口端点在 https://apihub.agnes-ai.com/v1");
    expect(detail).toContain("api.agnes-ai.com 是官网侧的域");
  });

  it("HTML 分支同样补端点指路（官网域返回的登录页往往就是 HTML）", () => {
    const detail = httpFailureDetail({
      body: "<!DOCTYPE html><html><body>login</body></html>",
      status: 401,
      url: "https://www.agnes-ai.com/v1/models",
    });
    expect(detail).toContain("返回的是网页（HTML）而不是接口响应");
    expect(detail).toContain("https://apihub.agnes-ai.com/v1");
  });

  it("url 缺省或域不在清单里：文案保持原样，不追加任何指路句", () => {
    expect(httpFailureDetail({ body: '{"error":"bad key"}', status: 401 })).toBe(
      'HTTP 401：{"error":"bad key"}（密钥无效，或该密钥没有这个接口的权限）',
    );
    expect(
      httpFailureDetail({
        body: '{"error":"bad key"}',
        status: 401,
        url: "https://api.example.com/v1/models",
      }),
    ).toBe(
      'HTTP 401（https://api.example.com/v1/models）：{"error":"bad key"}（密钥无效，或该密钥没有这个接口的权限）',
    );
  });
});
