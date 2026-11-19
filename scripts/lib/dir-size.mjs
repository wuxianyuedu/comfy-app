/**
 * dir-size.mjs — 脚本层的量盘与读数小件（`deps:prune` / `target:prune` 共用）。
 *
 * 为什么在 `scripts/lib/`：两个清理入口都要「量目录占盘 → 按人话报出来」，
 * 按 §12.18 收在这里写一次，不各抄一份（§12.12 的小函数跨层复制）。
 * 判据/脚本层不引 `src/lib/error-message`（TS 模块），unknown 的可读详情在这里给。
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * unknown 抛值的可读详情。
 * @param {unknown} error
 */
export function unknownDetail(error) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * 目录占盘字节数：只数普通文件，不穿符号链接（链接指向别处的内容不该算进来）。
 * @param {string} absDir
 */
export function dirSize(absDir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(absDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      total += dirSize(full);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      total += statSync(full).size;
    } catch {
      /* 扫描期间被并发移走：那一块量不到就少量一块，不影响判决 */
    }
  }
  return total;
}

/**
 * 只给整数读数，不用精度 API（它与 `~/lib/number-format` 是同一条口径）。
 * ≥1GB 折成一位小数的 GB——target 这类多 GB 目录印成「5231 MB」没法读。
 * @param {number} bytes
 */
export function humanSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes < 1024 * 1024) {
    return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  }
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}
