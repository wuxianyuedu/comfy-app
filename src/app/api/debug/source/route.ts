import { type NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireServerUser } from "@/lib/auth-server";

/**
 * GET /api/debug/source?file=src/components/studio/workflow-node.tsx
 *
 * 画布调试模式的「渲染链路标签」点击后读取项目源码用。
 * 安全约束：
 *  - file 必须是相对项目根的路径，且最终绝对路径必须落在 <项目根>/src 下
 *    （防止 `../` 路径穿越读取任意文件）；
 *  - 只允许读取源码/文本类扩展名。
 */

const PROJECT_ROOT = path.resolve(process.cwd() /* turbopackIgnore: true */);
const SRC_ROOT = path.join(PROJECT_ROOT, "src");
const ALLOWED_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".json",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".html",
  ".txt",
]);

export async function GET(request: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  const file = request.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "missing file param" }, { status: 400 });
  }
  if (file.includes("\0")) {
    return NextResponse.json({ error: "invalid file param" }, { status: 400 });
  }

  const resolved = path.resolve(/*turbopackIgnore: true*/ PROJECT_ROOT, file);
  const rel = path.relative(SRC_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "forbidden: outside src/" }, { status: 403 });
  }
  if (!ALLOWED_EXT.has(path.extname(resolved).toLowerCase())) {
    return NextResponse.json({ error: "not a source file" }, { status: 400 });
  }

  try {
    const content = await fs.readFile(resolved, "utf8");
    const stat = await fs.stat(resolved);
    return NextResponse.json({
      file: path.relative(PROJECT_ROOT, resolved).split(path.sep).join("/"),
      /** 绝对路径（正斜杠盘符格式，如 F:/AI/.../src/...），供 vscode://file/ 协议打开 */
      absolutePath: resolved.split(path.sep).join("/"),
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
