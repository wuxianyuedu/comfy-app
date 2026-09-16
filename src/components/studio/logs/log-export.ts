/**
 * log-export — 「把日志导出到面板之外」的两个出口（纯逻辑 + 两处最小 IO）。
 *
 * 规范 07 §7.9 定的是「复制走 Clipboard API、下载走 Blob + 临时 `<a download>`」，
 * 本模块把那两段实现从 store 里单独提出来（store 文件已到行数上限）——行为
 * 逐字不变（含剪贴板失败时的 `execCommand` 兜底），调用方只传最终文本。
 *
 * **导出范围由调用方决定**（store 传当前筛选下的全部条目拼出的文本）：本模块
 * 只管「怎么把一段文本送出去」，不管「送哪些行」——后者是 `filteredLogs` 的
 * 口径，属于 store。为此本模块**不依赖 `log-store`**（不引入循环引用）。
 *
 * @module logs/log-export
 */

/** 导出文件名（本地时间戳，避免同名互相覆盖）。 */
export function exportFileName(): string {
  return `comfy-app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
}

/** 写入剪贴板；权限被拒 / 非安全上下文时回退到 `execCommand("copy")`。失败静默。 */
export async function copyLogText(text: string): Promise<void> {
  if (typeof navigator === "undefined") return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      /* 两种方式都不行：静默（用户会看到没粘出内容，重试即可） */
    }
  }
}

/** 触发一次浏览器下载（Blob + 临时 `<a download>`，用完立即 revoke）。 */
export function downloadLogText(text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
