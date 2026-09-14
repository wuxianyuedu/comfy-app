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
// 规范化只对**相对路径**做 resolve —— 绝对路径原样处理，禁止无条件拼 cwd
// （详见 normalizeRootForPort 的注释：拼 cwd 会让平台/目录差异改变端口）。
import { readFileSync } from "node:fs";
import path from "node:path";

export const FALLBACK_PORT = 3100;
export const DERIVED_PORT_BASE = 3200;
export const DERIVED_PORT_SPAN = 800;

/**
 * 规范化检出路径：转正斜杠 + 转小写（跨四语言约定，见 §1.1）。
 *
 * 关键点：**只对非绝对路径做 resolve**。历史实现无条件 `path.resolve()`，
 * 而 `path.resolve` 的语义是「相对当前工作目录解析」——在 POSIX 上
 * `path.resolve("F:\\AI\\Other\\x")` 会拼成 `/workspace/f:/ai/other/x`，
 * 于是同一个检出在不同机器/不同 cwd 下推出**不同端口**，
 * 「同一检出恒定同端口」的多检出并行承诺直接失效（Windows 上跑测试时
 * 恰好 cwd 与路径同盘，掩盖了这个分歧）。
 *
 * 另三处实现都不拼 cwd：Rust 只做 replace + lowercase；PowerShell 用
 * `GetFullPath`（对已是绝对路径的输入原样返回）；Python 的 `abspath` 与
 * Node 的 resolve 同病（也拼 cwd，但会把反斜杠转正斜杠，与 Node 又不同）。
 * 统一为「绝对路径原样、相对路径才解析」后，四侧对同一输入恒定同值。
 *
 * 末尾分隔符一并去掉（`/workspace/` 与 `/workspace` 必须是同一端口）。
 *
 * @param {string} root @returns {string} 规范化后的检出路径（小写、正斜杠、无尾斜杠） */
export function normalizeRootForPort(root) {
  const raw = String(root ?? "");
  // Windows 盘符绝对路径（F:\ 或 F:/）与 UNC 路径（\\server\share）：
  // 在 POSIX 上 path.isAbsolute 认不出它们，必须显式判据，否则会被当相对路径
  // 拼上 cwd —— 这正是上面描述的失真来源。
  const winAbsolute = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\");
  const absolute = winAbsolute || path.isAbsolute(raw);
  const resolved = absolute ? raw : path.resolve(raw);
  return resolved.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
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
