import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getExitPolicy } from "@/lib/app-settings";
import { spawnManaged } from "@/lib/process-launch";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ollama 默认端口；Base URL 可配置，但「点一下启动」的场景默认拉起的就是它。 */
const OLLAMA_PORT = 11434;

/** 探测 Ollama 服务超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 2000;

/** spawn 后观察进程存活的最短时间（毫秒）——用于区分「启动成功」与
 *  「进程秒退（端口被占/未安装/路径错误）」。 */
const SPAWN_GRACE_MS = 1000;

/** 运行时日志文件名（log/ollama-runtime.log），由设置页日志面板读取。 */
const OLLAMA_RUNTIME_LOG = path.join(process.cwd(), "log", "ollama-runtime.log");

/**
 * Ollama 启动互斥锁，挂在 globalThis 而不是模块顶层——
 * Next.js dev 模式 HMR 会重置模块变量，让并发 POST 各自 spawn。
 */
const G_KEY = "__ollamaServeSpawnLock_v2";
const g = globalThis as unknown as Record<string, { starting: boolean } | undefined>;
const st: { starting: boolean } = g[G_KEY] ?? { starting: false };
g[G_KEY] = st;

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 追加一行到 ollama-runtime.log（失败不影响主流程）。 */
function appendOllamaLog(line: string): void {
  try {
    fs.mkdirSync(path.dirname(OLLAMA_RUNTIME_LOG), { recursive: true });
    fs.appendFileSync(OLLAMA_RUNTIME_LOG, `${localTimestamp()} ${line}\n`, "utf-8");
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 探测 Ollama 是否已就绪（HTTP 200 = 服务在监听）。 */
async function probeOllamaPort(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Windows 上优先找 ollama.exe 的精确路径，避免 spawn 落到 cmd.exe 包装。
 * Ollama 默认装在 %LOCALAPPDATA%\Programs\Ollama\ollama.exe。
 */
async function resolveOllamaExe(): Promise<string> {
  if (process.platform !== "win32") return "ollama";
  const candidates = [
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`
      : null,
    process.env.ProgramFiles
      ? `${process.env.ProgramFiles}\\Ollama\\ollama.exe`
      : null,
    process.env["ProgramFiles(x86)"]
      ? `${process.env["ProgramFiles(x86)"]}\\Ollama\\ollama.exe`
      : null,
  ].filter(Boolean) as string[];
  const fs = await import("node:fs");
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore — continue probing next candidate
    }
  }
  // 兜底：交给系统 PATH 解析
  return "ollama";
}

/**
 * Windows 上检测 Ollama 桌面版是否已注册为 Windows 服务
 * （sc query ollama 输出 STATE : 4 RUNNING 表示服务在运行）。
 */
async function ollamaServiceRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)(
      "sc",
      ["query", "ollama"],
      { windowsHide: true, timeout: 3000 },
    );
    return /STATE\s*:\s*4\s+RUNNING/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * 拉起 ollama serve。
 * 退出策略：exitKillOllama=true（默认）→ bound，Ollama 挂应用进程树，应用退出
 * 连带关闭（Windows 上仍沿用非 detached，避免弹独立 cmd 窗口）；false →
 * keepAlive，脱离进程树保活，下次打开应用直接复用。开关同样只在「拉起时」生效。
 * keepAlive 路径没有直连 child 可观察秒退（真实子进程是 Start-Process/已
 * unref 的孤儿），只做「拉起命令已执行」，就绪与否交给前端按端口轮询。
 */
function spawnOllamaServe(
  exe: string,
  keepAlive: boolean,
): Promise<{ ok: boolean; detail: string }> {
  if (keepAlive) {
    appendOllamaLog(`[keepAlive-spawn] cmd=${exe} args=${JSON.stringify(["serve"])}`);
    const launched = spawnManaged({
      command: exe,
      args: ["serve"],
      windowsHide: true,
      mode: "keepAlive",
    });
    if (launched.error) {
      const msg = launched.error;
      const hint =
        /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
          ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
          : msg;
      appendOllamaLog(`[err] 启动失败：${hint}`);
      return Promise.resolve({ ok: false, detail: `启动 Ollama 失败：${hint}` });
    }
    return Promise.resolve({
      ok: true,
      detail: "Ollama 启动命令已执行（保活模式），正在等待服务就绪",
    });
  }
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn(exe, ["serve"], {
      // Windows: detached:true 会给子进程独立控制台（即使 windowsHide
      // 也可能闪一下 cmd 窗口），所以 Windows 上不用 detached —— 让子进程
      // 继承父进程（无控制台的 Tauri sidecar）的进程上下文，不会弹窗。
      // POSIX: 需要 detached 防子进程随父进程 SIGHUP 退出。
      detached: !isWindows,
      // 用 pipe 捕获 stdout/stderr → 写入 ollama-runtime.log，供设置页日志面板读取。
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false, // 直接执行二进制，不经 cmd.exe（防 Windows cmd 窗口）
    });
    appendOllamaLog(`[spawn] pid=${child.pid ?? "unknown"} cmd=${exe} args=${JSON.stringify(["serve"])}`);

    // Ollama 输出（serve 的 stdout/stderr）——截断每行避免日志文件膨胀
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString("utf8").trimEnd().slice(0, 500);
      if (text) appendOllamaLog(`[out] ${text}`);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString("utf8").trimEnd().slice(0, 500);
      if (text) appendOllamaLog(`[err] ${text}`);
    });

    let settled = false;

    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, detail });
    };

    // 观察期到仍未退出 → 启动成功
    const timer = setTimeout(() => {
      done(true, "Ollama 启动命令已执行，正在等待服务就绪");
    }, SPAWN_GRACE_MS);

    // spawn 找不到可执行文件时触发（异步 error 事件）
    child.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
          ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
          : msg;
      appendOllamaLog(`[err] spawn error：${hint}`);
      done(false, `启动 Ollama 失败：${hint}`);
    });

    // 进程在观察期内退出 = 启动秒退（端口被占 / 配置错误 / 安装不完整）
    child.on("exit", (code, signal) => {
      appendOllamaLog(`[exit] code=${code ?? "null"} signal=${signal ?? "none"}`);
      done(
        false,
        `Ollama 进程启动后立即退出（code=${code ?? "null"}, signal=${signal ?? "none"}）。` +
          "可能是端口已被占用或 Ollama 安装不完整，请在终端手动执行 ollama serve 查看详情",
      );
    });
  });
}

/**
 * GET /api/llm/ollama-start
 * 就绪探测：检查 11434 端口是否开始接受连接。
 */
export async function GET(_req: NextRequest) {
  await getServerUser();
  const ready = await probeOllamaPort();
  return NextResponse.json({ ready });
}

/**
 * POST /api/llm/ollama-start
 *
 * 拉起 ollama serve：
 * 1. 先探测端口是否已就绪 → 已在运行就直接返回
 * 2. Windows 上检查是否已注册为系统服务 → 是则返回
 * 3. 互斥锁保护：同一时刻只允许一次 spawn
 * 4. 用 ollama.exe 精确路径 spawn，windowsHide + shell:false
 *    （Windows 不用 detached 避免弹独立 cmd 窗口；POSIX 用 detached
 *    防子进程随父进程退出）
 * 5. 观察 1s 确认进程存活；秒退则返回错误信息
 * 6. 启动过程与 stdout/stderr 写入 log/ollama-runtime.log（设置页可查看）
 */
export async function POST(_req: NextRequest) {
  await getServerUser();

  // ── 已在运行就直接返回 ──
  if (await probeOllamaPort()) {
    appendOllamaLog("[state] Ollama 已在运行，跳过启动");
    return NextResponse.json({
      ok: true, alreadyRunning: true, detail: "Ollama 已在运行",
    });
  }

  // ── Windows 服务已在管理 Ollama → 不需要重复拉起 ──
  if (await ollamaServiceRunning()) {
    appendOllamaLog("[state] Ollama 已注册为 Windows 服务并在后台运行");
    return NextResponse.json({
      ok: true, alreadyRunning: true, detail: "Ollama 服务已在后台运行",
    });
  }

  // ── 互斥锁：防止并发 POST 重复 spawn ──
  if (st.starting) {
    return NextResponse.json({
      ok: true, alreadyRunning: false, detail: "Ollama 正在启动中，请稍候",
    });
  }
  st.starting = true;

  try {
    const ollama = await resolveOllamaExe();
    // 退出策略决定拉起方式：false（保活）时脱离进程树，应用退出不连带关闭。
    const keepAlive = getExitPolicy().exitKillOllama === false;
    appendOllamaLog(
      `[action] 启动 Ollama：exe=${ollama} keepAlive=${keepAlive}${keepAlive ? "（保活模式：应用退出后不关闭）" : ""}`,
    );
    const result = await spawnOllamaServe(ollama, keepAlive);

    if (result.ok) {
      return NextResponse.json({ ok: true, detail: result.detail });
    }
    return NextResponse.json({ error: result.detail }, { status: 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint =
      /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
        ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
        : msg;
    appendOllamaLog(`[err] 启动失败：${hint}`);
    return NextResponse.json({ error: `启动 Ollama 失败：${hint}` }, { status: 500 });
  } finally {
    st.starting = false;
  }
}
