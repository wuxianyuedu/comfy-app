import { NextResponse } from "next/server";
import { requireServerUser } from "@/lib/auth-server";
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "log");

interface LogFileInfo {
  name: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
}

function scanLogFiles(dir: string, base: string): LogFileInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: LogFileInfo[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      out.push(...scanLogFiles(full, rel));
    } else if (entry.isFile() && entry.name.endsWith(".log")) {
      const stat = fs.statSync(full);
      out.push({
        name: entry.name,
        relativePath: rel.replace(/\\/g, "/"),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return out;
}

export async function GET() {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  try {
    const files = scanLogFiles(LOG_DIR, "")
      .filter((f) => f.name !== "dev-launcher.log")
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(
      {
        files: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
