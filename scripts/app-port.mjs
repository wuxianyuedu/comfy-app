// 应用端口解析的唯一事实源（Node 侧），dev.mjs / start.mjs / playwright.config.ts 共用。
// 仓库根（`resolveAppPort` 的入参）也在这里收口（`resolveRepoRoot`）：同一事实
// 只写一处，免得调用点各用 `ROOT` 常量 / `process.cwd()` 两种口径 —— 看着同值，
// 换个人从别处 import 就分叉（ISSUE #1771）。
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
  const isWindowsDrive = /^[a-z]:\//i.test(raw.replaceAll("\\", "/"));
  const isUnc = raw.startsWith("\\\\");
  const absolute = isWindowsDrive || isUnc || path.isAbsolute(raw);
  const resolved = absolute ? raw : path.resolve(raw);
  return resolved.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "");
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
  return DERIVED_PORT_BASE + (fnv1a32(normalizeRootForPort(root)) % DERIVED_PORT_SPAN);
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
  if (!line) {
    return null;
  }
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

/**
 * `.env` 端口值 → 端口号：**整串就是一个十进制整数**才算数。
 *
 * 为什么不能直接用 `Number.parseInt`：它**吃前缀**—— `"3100abc"` → 3100、
 * `"3100.5"` → 3100。于是 Node 侧会把 `COMFYAPP_PORT=3100abc` 当成用户写死了
 * 3100，而另三侧（Python `re.fullmatch` / Rust `parse::<u16>()` /
 * PowerShell `[int]::TryParse`）对同一个值给的是「未配置」—— 两边于是按**不同
 * 端口**启动：Node 侧在 3100 起 dev server，壳按路径推导去等另一个端口。这正是
 * ISSUE #821 那个「启动页一直等 dev server」的同一种失效，只是入口从「壳不读
 * .env」换成了「四侧对同一个值的理解不一致」。
 *
 * 形状与另三侧逐字对齐（`tests/fixtures/app-port-vectors.json` 的 `envVectors`
 * 是唯一事实源，四侧各有一份同型实现读它）：
 *   · 允许前导 `+`（Rust / PowerShell / Python 三侧都收，Node 不收就是新分叉）；
 *   · 只认 ASCII 十进制位（`٣١٠٠` 这类 Unicode 数字只有 Python 的 `int()` 收，
 *     另三侧都不收，所以这里也不收）；
 *   · 落点 1..=65535，越界按「未配置」退回路径推导。
 *
 * @param {string | null} value `readEnvFileValue` 的返回值
 * @returns {number | null}
 */
export function parseDotEnvPortValue(value) {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\+?[0-9]+$/.test(trimmed)) {
    return null;
  }
  const port = Number.parseInt(trimmed, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** 读 `.env` 的 `COMFYAPP_PORT`；未配置 / 非法 / 文件缺失时返回 null。
 *  @param {string} root @returns {number | null} */
export function readEnvPort(root) {
  let raw;
  const file = path.join(root, ".env");
  if (!existsSync(file)) {
    return null;
  }
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return parseDotEnvPortValue(readEnvFileValue(raw, APP_PORT_ENV_KEY));
}

/**
 * 本模块所在检出的仓库根 —— **`resolveAppPort` 入参的唯一来源**。
 *
 * 为什么要有它：端口按「检出路径」推导，那么「检出路径取哪个」就是端口契约的
 * 一半。此前四个调用点各自写 `path.resolve(path.dirname(fileURLToPath(...)), "..")`、
 * 另两个（`playwright.config.ts` / `e2e/global-setup.ts`）写 `process.cwd()`
 * —— 当下二者同值（谁都是仓库根），但它们是**两种口径**：`cwd` 随调用者的
 * 工作目录走（从别处 import、或宿主 chdir 之后就不再是仓库根），而
 * `import.meta.url` 锚在文件自己身上、恒定不变。端口推导对这两种输入会给出
 * **不同端口**，且不报错 —— 正是「同一事实两处表达」的静默分叉。
 *
 * 取 `import.meta.url`（而不是 `process.cwd()`）的理由：它是唯一不依赖运行时
 * 状态的锚点，`scripts/app-port.mjs` 自己就在仓库根的 `scripts/` 下，于是
 * 「哪儿 import 都是同一个根」。这与 `normalizeRootForPort` 的取向一致
 * ——绝对路径就是绝对路径，别再拼一次 cwd。
 *
 * @returns {string} 仓库根绝对路径 */
export function resolveRepoRoot() {
  return path.resolve(import.meta.dirname, "..");
}

/** 最终端口：`.env` 显式值优先，否则按检出路径推导，异常时兜底。
 *  @param {string} root @returns {number} */
export function resolveAppPort(root) {
  const fromEnv = readEnvPort(root);
  if (fromEnv !== null) {
    return fromEnv;
  }
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
  if (fromEnv !== null) {
    return { port: fromEnv, source: "env" };
  }
  try {
    return { port: derivePortFromPath(root), source: "derived" };
  } catch {
    return { port: FALLBACK_PORT, source: "fallback" };
  }
}
