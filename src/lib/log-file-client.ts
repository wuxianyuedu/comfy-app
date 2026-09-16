/* ── 本地日志文件的网络客户端（第②层的网络部分）──────────────────────
 * 日志面板通过 `/api/logs/current` 轮询 launcher / dev-launcher 的输出文件。
 * 此前这段 fetch 直接写在 LogProvider.tsx（视图）里——它是该文件唯一的裸 fetch，
 * 收口到这里后视图只关心「每次轮询读到的内容与游标」。
 *
 * 约定：返回的 `size` 是文件当前总字节数，客户端用它做增量拉取游标；
 * `offset` 是**本次返回内容的起点**（服务端在需要重读整文件时会把它回落到 0）。
 */

export interface FileLogSlice {
  content: string;
  /** 文件当前总字节数（下一轮增量读取的游标）。 */
  size: number;
  /** 本次返回内容在文件中的起点。 */
  offset: number;
  /**
   * 本次运行的开始时刻（毫秒）；仅追加写来源（app-runtime / 常驻服务）返回，
   * null = 读不到锚点（非双击链路启动），面板此时不做时间线截断。
   */
  sessionStart?: number | null;
  /**
   * 服务端进程标识。客户端存下它，下一轮带上比对；不一致即「应用服务真重启过」，
   * 面板据此重置时间线与游标（否则重启前后的行会混成一条线）。
   */
  bootId?: string;
  /** true = 本轮请求带的服务进程标识与响应不一致（详见 route.ts）。 */
  mismatch?: boolean;
}

export type LogSourceKind =
  | "dev"
  | "launcher"
  | "app"
  | "comfyui-runtime"
  | "drizzle-studio-runtime"
  | "ollama-runtime"
  | "app-runtime";

/** source 参数 → /api/logs/current 的 source 查询值。 */
function sourceQuery(source: LogSourceKind): string {
  if (source === "dev") return "dev-launcher";
  return source;
}

/**
 * 拉取某日志文件从 offset 起的新增内容；服务端未就绪 / 文件不存在时返回 null。
 *
 * `bootId` 是上一轮响应的服务端进程标识：带上它，服务端才能在「换个进程回答」
 * 时告诉我们真实发生过重启（响应里的 `mismatch`），面板据此重置时间线。
 */
export async function fetchFileLogSlice(
  source: LogSourceKind,
  offset: number,
  bootId?: string,
): Promise<FileLogSlice | null> {
  const boot = bootId ? `&bootId=${encodeURIComponent(bootId)}` : "";
  const res = await fetch(
    `/api/logs/current?source=${sourceQuery(source)}&offset=${offset}${boot}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as FileLogSlice;
}

/** 列出 log/ 下的归档日志文件（供「历史日志」选择）。 */
export interface LogFileInfo {
  name: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
}

export async function fetchLogFileList(): Promise<LogFileInfo[]> {
  const res = await fetch("/api/logs/list");
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: LogFileInfo[] };
  return data.files ?? [];
}

/** 读取某个归档日志文件的全量内容（路径由 /api/logs/list 给出，服务端做越界校验）。 */
export async function fetchLogFileContent(
  relativePath: string,
): Promise<string | null> {
  const res = await fetch(
    `/api/logs/history?file=${encodeURIComponent(relativePath)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string };
  return data.content ?? null;
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
