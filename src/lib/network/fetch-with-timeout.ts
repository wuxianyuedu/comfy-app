// 浏览器侧 fetch 的统一超时收口（ISSUE #4204）。
//
// 背景：页面里的 fetch 与业务轮询共享浏览器对同一 host 的 HTTP/1.1 连接池
// （每 host 6 条）。一个「服务端不回包也不拒连」的请求会把连接**永久占住**，
// 挤掉探活与其它轮询——#4196 的「探活被饿死误报断开」就是这个形态的现场。
// 本封装给所有走它的请求一个默认超时预算；需要更长预算（长轮询 / 大文件 /
// 长任务端点）的调用方显式传 `timeoutMs`，要自己的取消权（联想、可中断下载）
// 的调用方显式传 `signal`——传了就以调用方为准，这里不覆盖。
//
// 默认 15s：比探活的 5s 宽（不与它抢判断）、比浏览器自己的分钟级兜底紧得多。
// 只包浏览器侧（"use client" 模块）；服务端出站的收口是
// `~/lib/network/outbound-url.server.ts` 的 safeFetch（#4205，那半已带兜底）。

/** 未显式给 `signal` / `timeoutMs` 时的默认超时预算（毫秒）。 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
