// ── 本机服务端点 / 端口的单一事实源 ──────────────────────────────────
// 背景（ISSUE #536 P3）：同一个地址在同一仓库里被各处**各自硬编码**了一遍 ——
// Ollama 的 `http://localhost:11434/v1` 散落在 5 个文件（设置页 placeholder、
// user 仓库的入库默认值、LLM 服务端 env 兜底、DB schema 默认值、MCP 侧 LLM
// 兜底），ComfyUI 的 `http://127.0.0.1:8188` 又散落在另外 5 个。改一次默认端口
// 要改多处，漏一处的表现是**静默的行为分叉**：设置页显示 11434、实际请求打
// 到别的默认值上。
//
// 本模块是这些值的**唯一落点**，且刻意满足两个约束：
//   · **零依赖、零 `server-only`** —— 它同时被浏览器组件（设置页 placeholder）、
//     Next 服务端（API route / repository / DB schema）与纯 Node 的 MCP 进程
//     （stdio / http）读取，任何一侧引入运行时依赖都会把另两侧带崩；
//   · 只放「默认值本身」，不放「怎么解析用户配置」——解析各自在自己的层里做。
//
// 改这里的任何值之前先 grep 一遍调用方：本模块存在的意义就是让那次 grep
// 只需要一次。

/** 本机回环地址。IPv4 显式写法 —— Node 的 fetch 会把 `localhost` 先解析成
 *  IPv6 `::1`，而 ComfyUI / Ollama 默认只监听 IPv4，表现为「curl 通、程序
 *  连不上」这类难查的 ECONNREFUSED（详见 `comfyui/client.ts` 的同类说明）。 */
export const LOOPBACK_HOST = "127.0.0.1";

/** Ollama 默认监听端口（`ollama serve` 的出厂值）。 */
export const OLLAMA_DEFAULT_PORT = 11434;

/** Ollama 的 OpenAI 兼容入口（默认 Base URL）。 */
export const OLLAMA_DEFAULT_BASE_URL = `http://${LOOPBACK_HOST}:${OLLAMA_DEFAULT_PORT}/v1`;

/** ComfyUI 的 HTTP 入口（默认端口见 `app-settings.ts` 的 `COMFYUI_DEFAULT_PORT`）。 */
export function comfyUiBaseUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}`;
}
