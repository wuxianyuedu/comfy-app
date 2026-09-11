import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveSessionStart } from "@/lib/log-session-scope";
import { fileMtimeMs } from "@/lib/log-session-scope.server";
import { getServerBootId } from "@/lib/dev-server-id";
import {
  COMFYUI_RUNTIME_LOG,
  DEV_LAUNCHER_CURRENT_SENTINEL,
  DEV_LAUNCHER_LOG,
  DRIZZLE_STUDIO_RUNTIME_LOG,
  NEXTJS_LOG_DIR,
  OLLAMA_RUNTIME_LOG,
  START_TAURI_LAUNCHER_LOG,
  APP_RUNTIME_LOG,
} from "@/lib/log-paths";

const LAUNCHER_LOG_FILE = START_TAURI_LAUNCHER_LOG;
const SENTINEL_FILE = DEV_LAUNCHER_CURRENT_SENTINEL;
const RUNTIME_LOG_FILES: Record<string, string> = {
  "comfyui-runtime": COMFYUI_RUNTIME_LOG,
  "drizzle-studio-runtime": DRIZZLE_STUDIO_RUNTIME_LOG,
  "ollama-runtime": OLLAMA_RUNTIME_LOG,
  "app-runtime": APP_RUNTIME_LOG,
};

/** 应用服务输出转录文件（本次进程）：惰性解析，取不到时退化为「文件不存在」。 */
function panelCaptureLog(): string | null {
  try {
    const entries = fs
      .readdirSync(/*turbopackIgnore: true*/ NEXTJS_LOG_DIR)
      .filter((name) => name.startsWith("nextjs-panel-") && name.endsWith(".log"))
      .sort();
    const latest = entries[entries.length - 1];
    return latest ? path.join(NEXTJS_LOG_DIR, latest) : null;
  } catch {
    /* 目录不存在（从未跑过 dev）→ 面板该来源恒空，不报错 */
    return null;
  }
}

/**
 * 追加写日志（app-runtime / 各常驻服务 runtime）不轮转，积累几个月后可能是
 * 几十 MB。首次打开（offset=0 或游标已失效）只回**尾部窗口**，避免把整文件
 * 塞进一次响应。
 *
 * 两个约束缺一不可：
 *   1. 窗口必须够大——旧实现用 128KB，而 app-runtime 的单行（时间戳 + 级别 +
 *      命名空间 + 消息 + 字段）约 85~150 字节，128KB 只装得下约 900~1500 行；
 *      用户很容易在一次会话里超过它，于是「越读越旧」（ISSUE #262）。
 *   2. 起点必须**按行对齐**（跳过窗口里的第一个半行），否则面板会解析出乱码行。
 */
const TAIL_BYTES = 1024 * 1024;

/**
 * 读文件的某一段字节。只读请求区间，不把整文件读进内存——日志文件可能很大。
 * 返回 null 表示文件不存在。
 */
function readBytes(file: string, start: number, length: number): Buffer | null {
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
  const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  const from = Math.max(0, Math.min(start, size));
  const len = Math.max(0, Math.min(length, size - from));
  if (len === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    fs.readSync(fd, buf, 0, len, from);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

/** 把窗口起点向后对齐到第一个完整行（丢弃被截断的头半行），避免解析出乱码。 */
function alignToLineStart(buf: Buffer, start: number, fileSize: number): number {
  if (start <= 0) return 0;
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return fileSize;
  return start + nl + 1;
}

/**
 * 本次运行在追加写日志文件里的**起点时刻**。
 *
 * 追加写日志与 dev-launcher.log 的关系只有一条可用：本运行开始时
 * dev-launcher.log 被覆盖重建，mtime 即本次启动时刻。面板据此把早于该时刻的
 * 行挡在外面（`dropStaleEntries`），本端点负责把它一并回给客户端。
 *
 * 读不到锚点（非双击链路启动）时返回 null：客户端退化为不做时间线截断，
 * 多显示几条历史行也好过凭空丢掉本次日志。
 */
function sessionStartMs(): number | null {
  return resolveSessionStart(fileMtimeMs(DEV_LAUNCHER_LOG));
}

function resolveCurrentLog(source: string): string {
  if (source === "launcher") return LAUNCHER_LOG_FILE;
  try {
    const sentinel = fs.readFileSync(/*turbopackIgnore: true*/ SENTINEL_FILE, "utf8").trim();
    if (sentinel && fs.existsSync(/*turbopackIgnore: true*/ sentinel)) {
      return sentinel;
    }
  } catch {
    // sentinel 不存在或无效时回退到默认文件
  }
  return DEV_LAUNCHER_LOG;
}

interface Slice {
  content: string;
  /** 文件当前总字节数：客户端下一轮的增量读取游标。 */
  size: number;
  /** 本次返回内容在文件中的起点。 */
  offset: number;
  sessionStart: number | null;
  /**
   * 服务端进程启动标识与客户端缓存的**不一致**（见下方 `bootId` 的完整说明）。
   * true = 客户端拿到的这份状态来自「另一个应用服务进程」，应视为一次真正的
   * 重启：清掉时间线、重置游标并重新拉取，而不是继续往旧时间线上追加。
   */
  mismatch?: boolean;
  /**
   * 当前提供本响应的应用服务进程标识。客户端存下它，下一轮轮询比对——
   * 它同时承担两件事：
   *   1. **排障**：面板页脚展示「服务:xxxx」，用户报障时能说清自己连的是哪个进程；
   *   2. **重启可见**：进程换了（重启 / 另一实例接管端口）时客户端能立刻发现并
   *      重读日志，而不是把两个进程的输出混成一条时间线。
   */
  bootId?: string;
}

/**
 * 增量读取一段日志：
 * - 客户端带上上次读到的 `size` 作为游标 → 只回游标之后的新增；
 * - 游标无效（首帧 / 文件被新运行覆盖重建 / 文件变小）→ 回尾部窗口；
 * - 尾部窗口再掐头对齐到完整行。
 */
function readLogSlice(
  logFile: string,
  requestedOffset: number,
  bootId: string,
  mismatch: boolean,
): Slice {
  const sessionStart = sessionStartMs();
  if (!fs.existsSync(/*turbopackIgnore: true*/ logFile)) {
    return { content: "", size: 0, offset: 0, sessionStart, bootId, mismatch };
  }
  const fileSize = fs.statSync(/*turbopackIgnore: true*/ logFile).size;
  const cursorValid =
    Number.isFinite(requestedOffset) && requestedOffset > 0 && requestedOffset <= fileSize;
  /* 游标已被读到文件末尾：没有新增，直接回空（不必再读一次）。 */
  if (cursorValid && requestedOffset === fileSize) {
    return {
      content: "",
      size: fileSize,
      offset: fileSize,
      sessionStart,
      bootId,
      mismatch,
    };
  }
  let start = cursorValid ? requestedOffset : Math.max(0, fileSize - TAIL_BYTES);

  const buf = readBytes(logFile, start, fileSize - start) ?? Buffer.alloc(0);
  /* 只有「滑动窗口」分支才需要掐头对齐：游标来自上一次响应的 `size`，
   * 它本身就在行边界上（或者是文件末尾）。 */
  if (!cursorValid) {
    start = alignToLineStart(buf, start, fileSize);
    const skip = start - (fileSize - buf.length);
    return {
      content: buf.subarray(Math.max(0, skip)).toString("utf8"),
      size: fileSize,
      offset: start,
      sessionStart,
      bootId,
      mismatch,
    };
  }
  return {
    content: buf.toString("utf8"),
    size: fileSize,
    offset: start,
    sessionStart,
    bootId,
    mismatch,
  };
}

/** 解析某个日志来源对应的文件；来源不被识别 / 文件不存在时返回 null。 */
function resolveSourceFile(source: string): { file: string; resumable: boolean } | null {
  /* 追加写来源（应用运行日志 / 常驻服务）保留历史内容 → 需要会话起点截断。 */
  if (source in RUNTIME_LOG_FILES) {
    return { file: RUNTIME_LOG_FILES[source]!, resumable: true };
  }
  /* 「应用服务输出」：Next dev server 的 stdout/stderr 转录（本次进程一份）。 */
  if (source === "app") {
    const file = panelCaptureLog();
    return file ? { file, resumable: true } : null;
  }
  /* 启动链路日志（launcher / dev-launcher）每次运行覆盖重建，天然只有本次
   * 内容，不需要会话起点；切片规则一致。 */
  return { file: resolveCurrentLog(source), resumable: false };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "dev-launcher";
  const requestedOffset = Number(searchParams.get("offset") ?? "0");
  /* 客户端上一轮看到的服务端进程标识：与本响应不一致 = 中间发生过一次真正的
   * 服务端重启（或另一实例接管了端口）。面板据此重置游标与时间线，而不是把
   * 新旧两个进程的输出混成一条线（ISSUE #360：重启前后日志互相污染）。 */
  const clientBootId = searchParams.get("bootId") ?? "";
  const bootId = getServerBootId();
  const mismatch = clientBootId !== "" && clientBootId !== bootId;

  try {
    const resolved = resolveSourceFile(source);
    if (!resolved) {
      /* 来源暂时没有文件（如应用服务转录尚未落盘）：回一个**明确的空切片**，
       * 而不是 404/500——面板据此区分「本次运行确实还没有输出」与「接口挂了」。 */
      return NextResponse.json({
        content: "",
        size: 0,
        offset: 0,
        sessionStart: sessionStartMs(),
        bootId,
        mismatch,
      });
    }
    return NextResponse.json(
      readLogSlice(resolved.file, mismatch ? 0 : requestedOffset, bootId, mismatch),
    );
  } catch (error) {
    return NextResponse.json(
      {
        content: "",
        size: 0,
        offset: 0,
        bootId,
        mismatch,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
