/* ── 调试源码查看客户端（第②层的网络部分）──────────────────────────────
 * DebugChainFooter 弹窗通过 `/api/debug/source` 读取某代码模块的源码。
 * 此前这段裸 fetch 直接写在视图里，收口到这里后视图只需按 file 取 payload。
 */

import { readApiError, readJsonBody } from "~/lib/api-error";
import { withQuery } from "~/lib/query-string";

export interface DebugSourcePayload {
  file: string;
  /** 绝对路径（正斜杠盘符格式），供 vscode://file/ 协议打开 */
  absolutePath: string;
  content: string;
  size: number;
  modifiedAt: string;
}

/** 读取某模块的源码文本。文件不存在 / 非白名单时抛带服务端文案的错误。 */
export async function fetchDebugSource(
  file: string,
): Promise<DebugSourcePayload> {
  /* 一行也走出口：编码是出口的责任，调用处不必记得（漏一处就是静默 404，
   * 见规范 16 §16.2.4.32 的第 ④ 条）。 */
  const res = await fetch(withQuery("/api/debug/source", { file }));
  /* 读法收在一处（规范 16 §16.2.4.35）：这里此前在 `unknown` 上直接取
   * `body?.error`（服务端回结构化信封时读不到），且 `res.json()` 各调一遍。 */
  const body = await readJsonBody(res);
  if (!res.ok) throw new Error(readApiError(body) ?? `HTTP ${res.status}`);
  return body as DebugSourcePayload;
}
