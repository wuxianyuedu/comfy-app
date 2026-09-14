// 应用端口解析的唯一事实源（Node 侧），dev.mjs / start.mjs / playwright.config.ts 共用。
//
// 取值优先级（launch-and-build.md §1.1 / §1.4 多检出并行）：
//   1. .env 显式 COMFYAPP_PORT（每个检出各自的 .env，要固定端口时配置）；
//   2. 按检出绝对路径稳定推导——同一检出恒定同端口，多份检出并行互不冲突；
//   3. 兜底 3100（仅在路径推导不可用的异常情况）。
//
// 推导算法是多语言约定（PowerShell / Python / Rust 各有同型实现，改动须四处同步）：
// 对「绝对路径、反斜杠转正斜杠、转小写」的 UTF-8 字节取 FNV-1a 32 位哈希，
// 映射到 3200..3999：port = 3200 + (fnv1a32(path) % 800)。
import { readFileSync } from "node:fs";
import path from "node:path";

export const FALLBACK_PORT = 3100;
export const DERIVED_PORT_BASE = 3200;
export const DERIVED_PORT_SPAN = 800;

/** @param {string} root @returns {string} 规范化后的检出路径（小写、正斜杠） */
export function normalizeRootForPort(root) {
  const slashed = root.replace(/\\/g, "/");
  // Windows 盘符路径（C:/…）不交给 path.resolve：该 API 是平台相关的，在 POSIX 上
  // 会把 "F:/AI/…" 当成相对路径拼到 cwd 前面（/workspace/f:/ai/…），于是跨平台的
  // 端口推导对同一输入给出不同端口，四侧同算法的一致性锚点也随之漂移（CI 是 Linux，
  // 而开发者是 Windows）。盘符路径已带根前缀，这里只做分隔符统一与大小写归一。
  const isWindowsDrive = /^[a-z]:\//i.test(slashed);
  const resolved = isWindowsDrive ? slashed : path.resolve(slashed);
  return resolved.replace(/\\/g, "/").toLowerCase();
}

/** FNV-1a 32 位哈希，输入按 UTF-8 字节处理（与各语言实现按字节对齐）。
 *  @param {string} text @returns {number} */
export function fnv1a32(text) {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** @param {string} root @returns {number} 3200..3999 区间内的稳定端口 */
export function derivePortFromPath(root) {
  return (
    DERIVED_PORT_BASE + (fnv1a32(normalizeRootForPort(root)) % DERIVED_PORT_SPAN)
  );
}

/** 读 .env 的 COMFYAPP_PORT；未配置 / 非法 / 文件缺失时返回 null。
 *  @param {string} root @returns {number | null} */
export function readEnvPort(root) {
  let raw;
  try {
    raw = readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return null;
  }
  const line = raw
    .split(/\r?\n/)
    .find((l) => /^\s*COMFYAPP_PORT\s*=/.test(l));
  if (!line) return null;
  const val = (line.split("=", 2)[1] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const port = Number.parseInt(val, 10);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  return null;
}

/** 最终端口：.env 显式值优先，否则按检出路径推导，异常时兜底。
 *  @param {string} root @returns {number} */
export function resolveAppPort(root) {
  const fromEnv = readEnvPort(root);
  if (fromEnv !== null) return fromEnv;
  try {
    return derivePortFromPath(root);
  } catch {
    return FALLBACK_PORT;
  }
}
