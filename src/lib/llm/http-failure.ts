/**
 * `http-failure.ts` — 上游非 2xx 的统一可读归因（纯函数）。
 *
 * 三条链路共用同一份文案：连通性探测（`api/llm/test`）、候选模型拉取
 * （`api/llm/models`）与实际调用测试（`usage-test.server`）。此前它们各写一遍
 * `HTTP {status}：{截断后的响应体}`，于是同一个故障有三种说法，而且都会把
 * 网关 / 控制台的整页 HTML 截一段灌进界面 —— 用户看到的是
 * `HTTP 404：<!DOCTYPE html>…`，读不出「这个地址根本不是接口」这件事（#3517）。
 *
 * 判据只有一条：响应体开头是不是 HTML 文档。是 ⇒ 直接说「这是网页不是接口」
 * 并指向 Base URL；否则照旧带出截断片段，再按状态码补一句归因。
 *
 * @module lib/llm/http-failure
 */

import { INLINE_JSON_SNIPPET_MAX, clampText } from "~/lib/text-clamp";

/** 响应体开头像 HTML 文档（控制台页面 / 网关错误页），而不是接口响应。
 *  只看开头一小段：正文里偶然出现的 `<body` 不该被当成整页 HTML。 */
function isHtmlDocument(body: string): boolean {
  const head = body.replace(/^\uFEFF/, "").trimStart();
  return /^<(?:!doctype\s+html|html|head|body)\b/i.test(head);
}

/** 按状态码补一句归因（「HTTP 状态码」这段事实保持原样，不替换）。 */
function statusHint(status: number): string {
  if (status === 401 || status === 403) {
    return "（密钥无效，或该密钥没有这个接口的权限）";
  }
  if (status === 404 || status === 405) {
    return "（这个地址没有该接口：请核对 Base URL 是否含正确的版本段，如 /v1）";
  }
  return "";
}

export type HttpFailureInput = {
  /** 响应体原文；已解析成对象的 JSON 先 `JSON.stringify` 再给。 */
  body: string;
  status: number;
  /** 发起请求的完整地址；给了才在文案里点名，方便对照「到底探的是哪一条」。 */
  url?: string;
};

/** 非 2xx 的统一错误文案。 */
export function httpFailureDetail({ body, status, url }: HttpFailureInput): string {
  const at = url === undefined || url === "" ? "" : `（${url}）`;
  const text = body.trim();
  if (isHtmlDocument(text)) {
    return `HTTP ${status}${at}：这个地址返回的是网页（HTML）而不是接口响应 —— 多半把控制台或官网地址填进了 Base URL，请改填 API 端点（常见形如 https://api.example.com/v1）`;
  }
  /* 接口响应体是结构化的（JSON 错误对象或反代的纯文本），用 JSON 那一档上限；
   * 空响应体只留状态码与归因，不拼一个空的冒号。 */
  const snippet = clampText(text, { maxLength: INLINE_JSON_SNIPPET_MAX, marker: "" });
  return `HTTP ${status}${at}${snippet === "" ? "" : `：${snippet}`}${statusHint(status)}`;
}
