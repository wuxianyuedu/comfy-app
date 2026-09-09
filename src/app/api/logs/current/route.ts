import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  COMFYUI_RUNTIME_LOG,
  DEV_LAUNCHER_CURRENT_SENTINEL,
  DEV_LAUNCHER_LOG,
  DRIZZLE_STUDIO_RUNTIME_LOG,
  OLLAMA_RUNTIME_LOG,
  START_TAURI_LAUNCHER_LOG,
  APP_RUNTIME_LOG,
} from "@/lib/log-paths";

const DEFAULT_LOG_FILE = DEV_LAUNCHER_LOG;
const LAUNCHER_LOG_FILE = START_TAURI_LAUNCHER_LOG;
const SENTINEL_FILE = DEV_LAUNCHER_CURRENT_SENTINEL;
const COMFYUI_RUNTIME_LOG_FILE = COMFYUI_RUNTIME_LOG;
const DRIZZLE_STUDIO_RUNTIME_LOG_FILE = DRIZZLE_STUDIO_RUNTIME_LOG;
const OLLAMA_RUNTIME_LOG_FILE = OLLAMA_RUNTIME_LOG;
const APP_RUNTIME_LOG_FILE = APP_RUNTIME_LOG;

/**
 * comfyui-runtime.log / drizzle-studio-runtime.log 是追加写、不轮转的（每次
 * 启动都往里 append），首次打开只回尾部，避免文件积累几个月后整文件传输。
 */
const COMFYUI_TAIL_BYTES = 128 * 1024;

function resolveCurrentLog(source = "dev-launcher"): string {
  if (source === "launcher") {
    return LAUNCHER_LOG_FILE;
  }
  if (source === "comfyui-runtime") {
    return COMFYUI_RUNTIME_LOG_FILE;
  }
  try {
    const sentinel = fs.readFileSync(SENTINEL_FILE, "utf8").trim();
    if (sentinel && fs.existsSync(sentinel)) {
      return sentinel;
    }
  } catch {
    // sentinel 不存在或无效时回退到默认文件
  }
  return DEFAULT_LOG_FILE;
}

/**
 * 运行时进程日志（comfyui-runtime / drizzle-studio-runtime）用字节偏移增量读取
 * （客户端回传上次读到的 size 作为下起点）。
 * 返回约定与 dev/launcher 分支一致：content = 自 offset 起的新增内容，
 * size = 当前文件总字节数，offset = 本次内容起点（0 表示从头/文件不存在）。
 * 首次打开（offset=0）且文件超过 TAIL 时只回尾部，起点对齐到下一个换行，
 * 避免截出半行（或 UTF-8 多字节字符的半个）。
 */
function readRuntimeSlice(logFile: string, requestedOffset: number): {
  content: string;
  size: number;
  offset: number;
} {
  if (!fs.existsSync(/*turbopackIgnore: true*/ logFile)) {
    return { content: "", size: 0, offset: 0 };
  }
  const stat = fs.statSync(logFile);
  let start =
    Number.isFinite(requestedOffset) && requestedOffset > 0 && requestedOffset < stat.size
      ? requestedOffset
      : 0;
  if (start === 0 && stat.size > COMFYUI_TAIL_BYTES) {
    start = stat.size - COMFYUI_TAIL_BYTES;
  }
  const length = stat.size - start;
  if (length <= 0) {
    return { content: "", size: stat.size, offset: start };
  }
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(/*turbopackIgnore: true*/ logFile, "r");
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  let content = buf.toString("utf8");
  if (start > 0) {
    // 掐头到完整行（截断点可能落在行中间/多字节字符中间）
    const nl = content.indexOf("\n");
    content = nl >= 0 ? content.slice(nl + 1) : "";
  }
  return { content, size: stat.size, offset: start };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "dev-launcher";

  if (source === "comfyui-runtime" || source === "drizzle-studio-runtime" || source === "ollama-runtime" || source === "app-runtime") {
    try {
      const requestedOffset = Number(searchParams.get("offset") ?? "0");
      const logFile =
        source === "drizzle-studio-runtime"
          ? DRIZZLE_STUDIO_RUNTIME_LOG_FILE
          : source === "ollama-runtime"
            ? OLLAMA_RUNTIME_LOG_FILE
            : source === "app-runtime"
              ? APP_RUNTIME_LOG_FILE
              : COMFYUI_RUNTIME_LOG_FILE;
      return NextResponse.json(readRuntimeSlice(logFile, requestedOffset));
    } catch (error) {
      return NextResponse.json(
        {
          content: "",
          size: 0,
          offset: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }

  const logFile = resolveCurrentLog(source);
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ logFile)) {
      return NextResponse.json({ content: "", size: 0, offset: 0 });
    }

    const requestedOffset = Number(searchParams.get("offset") ?? "0");
    const content = fs.readFileSync(/*turbopackIgnore: true*/ logFile, "utf8");

    // 如果文件被重置（新运行），offset 可能超过文件大小，此时从头读取
    const safeOffset =
      Number.isFinite(requestedOffset) &&
      requestedOffset > 0 &&
      requestedOffset <= content.length
        ? requestedOffset
        : 0;

    return NextResponse.json({
      content: content.slice(safeOffset),
      size: content.length,
      offset: safeOffset,
    });
  } catch (error) {
    return NextResponse.json(
      {
        content: "",
        size: 0,
        offset: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
