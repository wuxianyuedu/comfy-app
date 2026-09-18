/* ── 调试源码查看客户端（第②层的网络部分）──────────────────────────────
 * DebugChainFooter 弹窗通过 `/api/debug/source` 读取某代码模块的源码。
 * 此前这段裸 fetch 直接写在视图里，收口到这里后视图只需按 file 取 payload。
 */

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
  const res = await fetch(`/api/debug/source?file=${encodeURIComponent(file)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as DebugSourcePayload;
}
