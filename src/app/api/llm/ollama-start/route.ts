import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ollama 默认端口；Base URL 可配置，但「点一下启动」的场景默认拉起的就是它。 */
const OLLAMA_PORT = 11434;

/**
 * GET /api/llm/ollama-start
 *
 * 就绪探测：轮询本机 Ollama 端口是否开始接受连接。
 * 设置页启动按钮用它把「进程拉起 → 服务就绪」的窗口期兜住——
 * 以前 POST 完就返回，页面探到端口没起又立刻变回「未运行」，
 * 用户以为失败会连点按钮，每次点击又拉起一个 serve 进程，
 * 多个进程抢同一个端口就连环弹「端口被占用」的 Windows 错误框。
 */
export async function GET(_req: NextRequest) {
  await getServerUser();
  try {
    const res = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return NextResponse.json({ ready: res.ok });
  } catch {
    return NextResponse.json({ ready: false });
  }
}

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

  // 已在运行就直接返回，不再重复拉起（重复 spawn 的多个 serve
  // 抢 11434 端口，Windows 上会连环弹「端口被占用」错误对话框）。
  const already = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/version`, {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (already) {
    return NextResponse.json({ ok: true, alreadyRunning: true, detail: "Ollama 已在运行" });
  }

  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return NextResponse.json({ ok: true, detail: "Ollama 启动命令已执行" });
  } catch (e) {
    // Windows 上 spawn 找不到可执行文件大概率是没装 Ollama 或不在 PATH
    const msg = e instanceof Error ? e.message : String(e);
    const hint =
      /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
        ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
        : msg;
    return NextResponse.json({ error: `启动 Ollama 失败：${hint}` }, { status: 500 });
  }
}
