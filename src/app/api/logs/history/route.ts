import { NextResponse } from "next/server";
import { requireServerUser } from "@/lib/auth-server";
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "log");

export async function GET(request: Request) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get("file") ?? "";
    if (!rel) {
      return NextResponse.json(
        { content: "", size: 0, error: "missing file" },
        { status: 400 }
      );
    }

    // 安全校验：只能读取 log/ 目录下的 .log 文件
    const resolvedLogDir = path.resolve(LOG_DIR);
    const full = path.resolve(resolvedLogDir, rel);
    if (
      !full.startsWith(resolvedLogDir + path.sep) ||
      !full.endsWith(".log") ||
      !fs.existsSync(full)
    ) {
      return NextResponse.json(
        { content: "", size: 0, error: "invalid or missing file" },
        { status: 400 }
      );
    }

    const content = fs.readFileSync(full, "utf8");
    return NextResponse.json({ content, size: content.length });
  } catch (error) {
    return NextResponse.json(
      {
        content: "",
        size: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
