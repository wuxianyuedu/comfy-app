// 应用端口解析的唯一事实源（Node 侧），dev.mjs / start.mjs / playwright.config.ts 共用。
//
// 取值优先级（launch-and-build.md §1.1 / §1.6 多检出并行）：
//   1. 显式覆盖：`dev.mjs` 的 `-p` / `start.mjs` 的 `PORT`（**只有它是命令行入口**）；
//   2. `.env` 显式 `COMFYAPP_PORT`（每个检出各自的 .env，要固定端口时配置）；
//   3. 按检出绝对路径稳定推导——同一检出恒定同端口，多份检出并行互不冲突；
//   4. 兜底 3100（仅在路径推导不可用的异常情况）。
//
// 「谁读 .env」是被钉死的一条约定（ISSUE #821）：**只有这里读**。Rust 壳 / Python /
// PowerShell 侧都复制拷贝同一份 .env 单值解析（四语言约定，见下方推导算法），
// 因为壳不经过 Node 就拿不到「用户写在 .env 里的固定端口」，于是它与编排器会各自
// 按不同规则算出一个端口、永远对不上（表现是启动页卡在「等 dev server」）。
// 推导算法是多语言约定（PowerShell / Python / Rust 各有同型实现，改动须四处同步）：
// 对「绝对路径、反斜杠转正斜杠、转小写」的 UTF-8 字节取 FNV-1a 32 位哈希，
// 映射到 3200..3999：port = 3200 + (fnv1a32(path) % 800)。
// 规范化只对**相对路径**做 resolve —— 绝对路径原样处理，禁止无条件拼 cwd
// （详见 normalizeRootForPort 的注释：拼 cwd 会让平台/目录差异改变端口）。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const FALLBACK_PORT = 3100;
export const DERIVED_PORT_BASE = 3200;
export const DERIVED_PORT_SPAN = 800;
/** 环境变量名：.env 与进程环境、前端 tRPC 读的是同一个键（只此一处字面量）。 */
export const APP_PORT_ENV_KEY = "COMFYAPP_PORT";

/**
 * 规范化检出路径：转正斜杠 + 转小写 + 去尾斜杠（跨四语言约定，见 §1.1）。
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
  // 拼上 cwd —— 这正是上面描述的失真来源。盘符判据本体写作 /^[a-z]:\//i
  //（ASCII 盘符不区分大小写，无需再列 A-Z），UNC 另判前导双反斜杠。
  const isWindowsDrive = /^[a-z]:\//i.test(raw.replace(/\\/g, "/"));
  const isUnc = raw.startsWith("\\\\");
  const absolute = isWindowsDrive || isUnc || path.isAbsolute(raw);
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

/**
 * 从一段 `.env` 文本里取单个变量的值（本文件需要的**最小**子集，不引 dotenv）。
 *
 * 形态与另三侧实现严格对齐（Rust / PowerShell / Python 各有同型拷贝）：
 *   · 只认 `^\s*KEY\s*=` 开头的行，取第一个匹配；
 *   · 值去掉首尾空白与成对引号（`"4321"` / `'4321'` 都要能读）；
 *   · 行尾注释（`4321 # 固定端口`）一并去掉 —— dotenv 的常见写法。
 *
 * @param {string} content @param {string} key @returns {string | null} */
export function readEnvFileValue(content, key) {
  const line = String(content)
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (!line) return null;
  // 去掉行尾注释：只有前导 `#`（前面有空白）才算注释，`abc#def` 里的 `#` 是值的一部分。
  const raw = (line.split("=", 2)[1] ?? "").split(/\s+#/)[0] ?? "";
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** 读 `.env` 的 `COMFYAPP_PORT`；未配置 / 非法 / 文件缺失时返回 null。
 *  @param {string} root @returns {number | null} */
export function readEnvPort(root) {
  let raw;
  const file = path.join(root, ".env");
  if (!existsSync(file)) return null;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const value = readEnvFileValue(raw, APP_PORT_ENV_KEY);
  if (value === null) return null;
  const port = Number.parseInt(value, 10);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  return null;
}

/** 最终端口：`.env` 显式值优先，否则按检出路径推导，异常时兜底。
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

/**
 * 解析结果 + **它是怎么来的**（用于「端口对不上」时一句就能归因）。
 *
 * 只返回数字的 `resolveAppPort` 让故障现场缺一半信息：用户看到 dev server 在
 * 3100、壳在等 3809，却不知道两边各自按哪条规则算的。把来源一并透出后，
 * 诊断行可以直说「来自 .env」还是「来自路径推导」。
 *
 * @param {string} root @returns {{ port: number, source: "env" | "derived" | "fallback" }} */
export function resolveAppPortWithSource(root) {
  const fromEnv = readEnvPort(root);
  if (fromEnv !== null) return { port: fromEnv, source: "env" };
  try {
    return { port: derivePortFromPath(root), source: "derived" };
  } catch {
    return { port: FALLBACK_PORT, source: "fallback" };
  }
}
