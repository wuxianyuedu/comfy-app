import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "log");
const DEFAULT_LOG_FILE = path.join(LOG_DIR, "dev-launcher.log");
const LAUNCHER_LOG_FILE = path.join(LOG_DIR, "start-tauri-launcher.log");
const SENTINEL_FILE = path.join(LOG_DIR, "dev-launcher-current.txt");

function resolveCurrentLog(source = "dev-launcher"): string {
  if (source === "launcher") {
    return LAUNCHER_LOG_FILE;
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "dev-launcher";
  const logFile = resolveCurrentLog(source);
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ logFile)) {
      return NextResponse.json({ content: "", size: 0, offset: 0 });
    }

    const { searchParams } = new URL(request.url);
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
