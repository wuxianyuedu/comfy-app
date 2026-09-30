/* ── 本地日志文件的网络客户端（第②层的网络部分）──────────────────────
 * 日志面板通过 `/api/logs/current` 轮询 launcher / dev-launcher 的输出文件。
 * 此前这段 fetch 直接写在 LogProvider.tsx（视图）里——它是该文件唯一的裸 fetch，
 * 收口到这里后视图只关心「每次轮询读到的内容与游标」。
 *
 * 约定：返回的 `size` 是文件当前总字节数，客户端用它做增量拉取游标；
 * `offset` 是**本次返回内容的起点**（服务端在需要重读整文件时会把它回落到 0）。
 */

import { withQuery } from "~/lib/query-string";
import type { LogSessionsPayload } from "./log-sessions";

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
  | "app-runtime"
  /** 壳自持日志（log/shell/shell.log，双击启动链路最早的一段现场）。 */
  | "shell"
  /** 壳侧编排链路（log/launcher/shell-launch.log）。 */
  | "shell-launch";

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
  const res = await fetch(
    withQuery("/api/logs/current", {
      source: sourceQuery(source),
      /* `offset` 是**游标**：`0` 表示「从头上读」，是真实的值不是缺值
       *（省略它服务端会按自己的默认游标回答，那是另一件事）。 */
      offset,
      /* 上一轮的服务端进程标识；没有时整个键省略。 */
      bootId: bootId ?? undefined,
    }),
  );
  if (!res.ok) return null;
  return (await res.json()) as FileLogSlice;
}

/* ── 常驻服务 runtime 日志的「会话视图」（设置页启动日志）───────────────
 * 这些文件追加不轮转，多次启动的行混在一条时间线上。`/api/logs/sessions` 按
 * 会话横幅把它们切开，一次只回**一份**正文；设置页因此能提供「切换每次启动」
 * 的下拉，而不用把整份文件读进浏览器。切分判据见 `lib/log/log-sessions`。
 */

/** 可做会话切分的来源（`RUNTIME_LOG_FILES` 里的常驻服务三条通道）。 */
export type RuntimeLogSourceKind =
  "comfyui-runtime" | "drizzle-studio-runtime" | "ollama-runtime";

/**
 * 拉取某来源的会话列表 + 指定会话（缺省取最新一次）的正文。
 *
 * 服务端未就绪 / 网络失败时返回 null（与 `fetchFileLogSlice` 的约定不同：
 * 它抛错，因为它跑在「已经很确定服务端在」的面板轮询里；本函数在设置页
 * 挂载时就会调用一次，用户可能正处在服务重启的窗口期，报错只会污染控制台）。
 */
export async function fetchLogSessions(
  source: RuntimeLogSourceKind,
  sessionId?: string | null,
): Promise<LogSessionsPayload | null> {
  try {
    /* 会话 id 可选：空值由出口省略（不再自己 `if` 一次再 `set`）。 */
    const res = await fetch(
      withQuery("/api/logs/sessions", { source, session: sessionId }),
    );
    if (!res.ok) return null;
    return (await res.json()) as LogSessionsPayload;
  } catch {
    return null;
  }
}

/** 列出 log/ 下的归档日志文件（供「历史日志」选择）。 */
export interface LogFileInfo {
  name: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
}

/* ── 日志导出到本地文件（客户端 → 服务端）─────────────────────────────
 * 面板的「保存到本地」经 `POST /api/logs/export` 由服务端写进 `log/exports/`，
 * 并把路径回给面板显示（见该端点的说明：桌面壳里浏览器下载不保证落盘）。
 */

/** 导出的结果：成功时给出服务端写下的**绝对路径**与相对 `log/` 的路径。 */
export interface SavedLogExport {
  ok: boolean;
  path?: string;
  relativePath?: string;
  bytes?: number;
  error?: string;
}

/**
 * 把一段日志文本保存到本机 `log/exports/`。
 *
 * `label` 只用于文件名可读性（服务端有白名单兜底）；内容由调用方给定。
 * 失败返回 `{ ok: false }` 而不是抛错——面板据此显示「保存失败」，
 * 不阻塞日志面板本身。
 */
export async function saveLogExport(
  label: string,
  content: string,
): Promise<SavedLogExport> {
  try {
    const res = await fetch("/api/logs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, content }),
    });
    const data = (await res.json()) as SavedLogExport;
    return data;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "network",
    };
  }
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
