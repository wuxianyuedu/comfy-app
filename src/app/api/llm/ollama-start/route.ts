import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/ollama-start
 *
 * Attempts to launch `ollama serve` as a detached background process.
 * Works when Ollama is installed and available in PATH.
 * 本地单用户模式：用 getServerUser() 兜底 demo 用户，无需登录即可调用
 * （与设置页其它免登录接口保持一致）。
 */
export async function POST(_req: NextRequest) {
  await getServerUser();
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return NextResponse.json({ ok: true, detail: "Ollama 启动命令已执行" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `启动 Ollama 失败：${msg}` },
      { status: 500 }
    );
  }
}
