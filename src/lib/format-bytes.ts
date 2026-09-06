/** 字节 → 人类可读容量（供底部状态栏显存/内存使用）。纯函数，可单测。
 *  GB 取 1 位小数（Task Manager 风格），MB/KB 逐级降档；非法/空值返回 null
 *  （由调用方决定隐藏）。 */
export function fmtBytes(n?: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n >= 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}
