import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ollama 默认端口；与 ollama-start 路由保持一致。 */
const OLLAMA_PORT = 11434;

async function ollamaUp(): Promise<boolean> {
  return fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/version`, {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * POST /api/llm/ollama-stop
 *
 * 关闭 Ollama：优先用 `ollama stop`（官方 CLI，会优雅终止 serve 实例）。
 * CLI 不可用或不支持时回退到 taskkill / kill 进程树 —— 杀整棵树，
 * 避免 cmd 外壳死了留下 serve 孤儿继续锁 11434 端口。
 */
export async function POST(_req: NextRequest) {
  await getServerUser();
  if (!(await ollamaUp())) {
    return NextResponse.json({ ok: true, detail: "Ollama 未在运行" });
  }

  // 1) 优雅路径：ollama stop <model> 只停模型加载，不退 serve ——
  //    官方 CLI 没有「退出 serve」的命令，所以进程级终止是唯一可靠的关闭方式。
  // 2) 进程树终止：
  //    Windows: taskkill /IM ollama.exe /T /F（按映像名杀整棵树）
  //    POSIX:   pkill -TERM ollama（按进程名）
  try {
    if (process.platform === "win32") {
      await execAsync("taskkill /IM ollama.exe /T /F");
    } else {
      await execAsync("pkill -TERM -x ollama || true");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, detail: `关闭 Ollama 失败：${msg}` },
      { status: 500 },
    );
  }
  // 等端口真正释放（最多 5s），给界面状态行一个确定的结果
  for (let i = 0; i < 10; i++) {
    if (!(await ollamaUp())) {
      return NextResponse.json({ ok: true, detail: "Ollama 已关闭" });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return NextResponse.json(
    { ok: false, detail: "关闭命令已发送，但 Ollama 仍在响应，请手动确认进程已退出" },
    { status: 500 },
  );
}
