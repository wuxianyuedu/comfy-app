// ── 浏览器侧两个「把一段文本送出去」的出口 ──────────────────────────────────
// 按**形态**扫描时撞出来的重复：全库此前有 4 份剪贴板写入（各自的 execCommand
// 兜底写法还不一样）、7 份「Blob + 临时 <a download>」下载。两者都是
// 「把一段文本送出去」这一件事，只在**送出去的通道**上不同，因此收在一处。
//
// 与 `format-bytes.ts` / `error-message.ts` 同级：整个 src 都在用，放进某个域
// 会让那个域变成所有人的上游（规范 12 §12.5.3 的顶层单例判据）。

/**
 * 把文本写进剪贴板，返回是否成功。
 *
 * 两条通道依次尝试：Clipboard API → 临时 `<textarea>` + `execCommand`。
 * 后者是**非安全上下文 / 权限被拒**时的兜底（Clipboard API 在这两种情况下
 * 直接抛错，而 `execCommand` 仍可能在用户手势里生效）。
 *
 * 为什么**返回 boolean 而不是静默**：调用方要据此给出反馈（「已复制」或
 * 「复制失败」），静默的那一份会让「没粘出内容」看起来像应用坏了。不需要
 * 反馈时调用方自己丢弃返回值即可。
 *
 * 注意 `document.execCommand` 已废弃但**必须保留**：它是唯一在 Tauri 的
 * `http://` 非安全上下文里还能工作的通道。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走兜底 */
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    /* 移出视口而不是 `display:none`：隐藏元素不可 `select()`。 */
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 触发一次浏览器下载（Blob + 临时 `<a download>`，用完立即 revoke）。
 *
 * `revokeObjectURL` 放在 `click()` **之后**是必须的顺序：先 revoke 会让
 * 尚未开始的下载拿到一个已失效的 URL（大文件必现），这是此前 7 份实现里
 * 写法最不一致的一处。
 *
 * `type` 默认 `application/json;charset=utf-8`（此前 7 份里 6 份是 JSON）；
 * 纯文本导出传 `text/plain;charset=utf-8`。**带上 charset 才能保证中文
 * 文件名之外的内容不乱码**。
 */
export function downloadText(
  text: string,
  filename: string,
  type = "application/json;charset=utf-8",
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 把对象按缩进 JSON 下载（此前 6 份下载里有一半只是为了这一件事）。
 * 单独给一支是因为调用处不必各自记得 `JSON.stringify(x, null, 2)` 与类型。
 */
export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename);
}
