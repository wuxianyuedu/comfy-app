/* ── 本地日志文件的网络客户端（第②层的网络部分）──────────────────────
 * 日志面板通过 `/api/logs/current` 轮询 launcher / dev-launcher 的输出文件。
 * 此前这段 fetch 直接写在 LogProvider.tsx（视图）里——它是该文件唯一的裸 fetch，
 * 收口到这里后视图只关心「每次轮询读到的内容与游标」。
 *
 * 约定：返回的 offset 是服务端累计字节数，客户端用它做增量拉取游标。
 */

export interface FileLogSlice {
  content: string;
  size: number;
  offset: number;
}

export type LogSourceKind =
  | "dev"
  | "launcher"
  | "comfyui-runtime"
  | "drizzle-studio-runtime"
  | "ollama-runtime"
  | "app-runtime";

/** source 参数 → /api/logs/current 的 source 查询值。 */
function sourceQuery(source: LogSourceKind): string {
  if (source === "dev") return "dev-launcher";
  if (source === "comfyui-runtime") return "comfyui-runtime";
  if (source === "drizzle-studio-runtime") return "drizzle-studio-runtime";
  if (source === "ollama-runtime") return "ollama-runtime";
  if (source === "app-runtime") return "app-runtime";
  return "launcher";
}

/** 拉取某日志文件从 offset 起的新增内容；服务端未就绪 / 文件不存在时返回 null。 */
export async function fetchFileLogSlice(
  source: LogSourceKind,
  offset: number,
): Promise<FileLogSlice | null> {
  const res = await fetch(
    `/api/logs/current?source=${sourceQuery(source)}&offset=${offset}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as FileLogSlice;
}

/* ── 应用运行日志写入（客户端 → 服务端）──────────────────────────────
 * `src/lib/app-runtime-log.ts` 是 Node-only 模块（顶层 import node:fs），
 * 客户端逻辑层（如设置页）需要把「静默失败」补记进 app-runtime.log 供日志
 * 面板轮询展示时，必须经 `POST /api/logs/app-runtime` 转交服务端写入，而非
 * 直接 import 该 Node 模块（否则 Turbopack 会把 node:fs 静态打进客户端
 * bundle，编译报 “does not support external modules”，见 ISSUE #282）。
 *
 * 调用方只负责把「级别 + 消息 + 字段」交给网络层；写入失败静默忽略，
 * 绝不阻塞业务主流程（对齐 service 端 logger 的失败不落盘的契约）。
 */

/** 客户端可安全传给服务端的日志级别。 */
export type AppLogClientLevel = "info" | "warn" | "error";

/**
 * 经服务端把一条日志写入 app-runtime.log（命名空间限定在 settings/app）。
 * 失败静默返回，不抛错。
 */
export async function postAppRuntimeLog(
  ns: "settings" | "app",
  level: AppLogClientLevel,
  msg: string,
  fields?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch("/api/logs/app-runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns, level, msg, fields }),
    });
  } catch {
    // 网络/服务端写入失败绝不阻塞业务主流程
  }
}
