import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const LOG_FILE = path.join(process.cwd(), "log", "dev-launcher.log");

export async function GET(request: Request) {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return NextResponse.json({ content: "", size: 0, offset: 0 });
    }

    const { searchParams } = new URL(request.url);
    const requestedOffset = Number(searchParams.get("offset") ?? "0");
    const content = fs.readFileSync(LOG_FILE, "utf8");

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
