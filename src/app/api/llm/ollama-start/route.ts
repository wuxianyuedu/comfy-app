import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { getExitPolicy } from "~/lib/app-settings/app-settings.server";
import { spawnManaged, waitForDetachMediator } from "~/lib/process/process-launch";
import {
  openRuntimeLogWriter,
  pruneRuntimeLogFiles,
  type RuntimeLogWriter,
} from "~/lib/log/runtime-log-pack.server";
import { formatLocalStamp } from "~/lib/time-format";
import { INLINE_STDERR_MAX, clampText } from "~/lib/text-clamp";
import { spawn } from "node:child_process";
import { OLLAMA_DEFAULT_PORT, ollamaBaseUrl } from "~/lib/endpoints";
import { withTimeoutResult } from "~/lib/with-timeout";
import { errorMessage } from "~/lib/error-message";
import { isRecord } from "~/lib/is-record";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";
import { safeFetch } from "~/lib/network/outbound-url.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ollama 默认端口；Base URL 可配置，但「点一下启动」的场景默认拉起的就是它。 */
const OLLAMA_PORT = OLLAMA_DEFAULT_PORT;

/** 把 spawn / 启动错误翻成用户可行动的提示：ENOENT / EACCES → 安装指引，其余走 errorMessage 原文。 */
function ollamaFailureHint(error: unknown): string {
  const msg = errorMessage(error, String(error));
  return /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
    ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
    : msg;
}

/** 探测 Ollama 服务超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 2000;

/** spawn 后观察进程存活的最短时间（毫秒）——用于区分「启动成功」与
 *  「进程秒退（端口被占/未安装/路径错误）」。 */
const SPAWN_GRACE_MS = 1000;

/**
 * Ollama 启动互斥锁，挂在 globalThis 而不是模块顶层——
 * Next.js dev 模式 HMR 会重置模块变量，让并发 POST 各自 spawn。
 */
const G_KEY = "__ollamaServeSpawnLock_v2";

function isSpawnLock(v: unknown): v is { starting: boolean } {
  return isRecord(v) && typeof v.starting === "boolean";
}

const existingLock: unknown = Reflect.get(globalThis, G_KEY);
const st: { starting: boolean } = isSpawnLock(existingLock) ? existingLock : { starting: false };
Reflect.set(globalThis, G_KEY, st);

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时。 */
function localTimestamp(): string {
  return formatLocalStamp(new Date());
}

/** 开一次启动的日志：轮转旧文件 → 开新的一份 → 落首行标题。
 *  writer 随**本次启动会话**走（ISSUE #4733 / #3850）：由调用方持有并传给
 *  后续回调，不再挂模块作用域 —— 此前并发 POST 走「已在运行」分支时会把
 *  [state] 行写进上一次会话的文件，会话结束后还残留到下次启动。 */
function beginOllamaSession(at: Date = new Date()): RuntimeLogWriter {
  pruneRuntimeLogFiles();
  const writer = openRuntimeLogWriter("ollama-runtime", at);
  appendOllamaLog(writer, "▶ Ollama 启动会话");
  return writer;
}

/** 追加一行到本次启动的文件（失败不影响主流程）；writer 为 null 时静默跳过。 */
function appendOllamaLog(writer: RuntimeLogWriter | null, line: string): void {
  writer?.write(`${localTimestamp()} ${line}`);
}

/** 探测 Ollama 是否已就绪（HTTP 200 = 服务在监听）。 */
async function probeOllamaPort(): Promise<boolean> {
  try {
    const res = await safeFetch(`${ollamaBaseUrl(OLLAMA_PORT)}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      scenario: "llm-upstream",
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
  if (process.platform !== "win32") {
    return "ollama";
  }
  const candidates = [
    process.env.LOCALAPPDATA !== undefined && process.env.LOCALAPPDATA !== ""
      ? `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`
      : null,
    process.env.ProgramFiles !== undefined && process.env.ProgramFiles !== ""
      ? `${process.env.ProgramFiles}\\Ollama\\ollama.exe`
      : null,
    process.env["ProgramFiles(x86)"] !== undefined && process.env["ProgramFiles(x86)"] !== ""
      ? `${process.env["ProgramFiles(x86)"]}\\Ollama\\ollama.exe`
      : null,
  ].filter((candidate): candidate is string => typeof candidate === "string");
  const fs = await import("node:fs");
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return c;
      }
    } catch {
      // 忽略 —— 继续探测下一个候选
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
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("sc", ["query", "ollama"], {
      windowsHide: true,
      timeout: 3000,
    });
    return /STATE\s*:\s*4\s+RUNNING/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * 拉起 ollama serve。退出策略：exitKillOllama=true（默认）→ bound，挂应用进程树、应用退出连带关闭（Windows 沿用非 detached，避免弹独立 cmd 窗口）；
 * false → keepAlive，脱离进程树保活；keepAlive 路径没有直连 child 可观察秒退，只做「拉起命令已执行」，就绪与否交前端按端口轮询。
 */
async function spawnOllamaServe(
  exe: string,
  keepAlive: boolean,
  writer: RuntimeLogWriter | null,
): Promise<{ detail: string; ok: boolean }> {
  if (keepAlive) {
    appendOllamaLog(writer, `[keepAlive-spawn] cmd=${exe} args=${JSON.stringify(["serve"])}`);
    const launched = spawnManaged({
      command: exe,
      args: ["serve"],
      windowsHide: true,
      mode: "keepAlive",
    });
    if (launched.child === undefined || launched.error !== undefined) {
      const msg = launched.error;
      const hint =
        /enoent|not find|cannot find/i.test(msg) || msg.includes("EACCES")
          ? "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试"
          : msg;
      appendOllamaLog(writer, `[err] 启动失败：${hint}`);
      return Promise.resolve({
        ok: false,
        detail: `启动 Ollama 失败：${hint}`,
      });
    }
    /* Start-Process 参数被拒等拉起失败发生在 powershell 中介里，目标进程
     * 根本不会出现；等中介退出并带出 stderr，立刻给用户可行动的报错。 */
    const mediator = await waitForDetachMediator(launched.child);
    if (mediator.code !== null && mediator.code !== 0) {
      return Promise.resolve({
        ok: false,
        detail: `启动 Ollama 失败（保活拉起被拒）：${
          mediator.stderr.trim() || `powershell 退出码 ${mediator.code}`
        }`,
      });
    }
    return Promise.resolve({
      ok: true,
      detail: "Ollama 启动命令已执行（保活模式），正在等待服务就绪",
    });
  }
  {
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
    appendOllamaLog(
      writer,
      `[spawn] pid=${child.pid ?? "unknown"} cmd=${exe} args=${JSON.stringify(["serve"])}`,
    );

    // Ollama 输出（serve 的 stdout/stderr）——截断每行避免日志文件膨胀
    child.stdout.on("data", (d: Buffer) => {
      const text = clampText(d.toString("utf8").trimEnd(), {
        maxLength: INLINE_STDERR_MAX,
        marker: "",
      });
      if (text) {
        appendOllamaLog(writer, `[out] ${text}`);
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      const text = clampText(d.toString("utf8").trimEnd(), {
        maxLength: INLINE_STDERR_MAX,
        marker: "",
      });
      if (text) {
        appendOllamaLog(writer, `[err] ${text}`);
      }
    });

    /* 观察期内的三种信号谁先到算谁：**秒退 / spawn 失败 → 启动失败**，
     * **观察期到仍未退出 → 启动成功**。后者正是「与时间赛跑、超时给兜底值」
     * 那一档 —— 交给 `withTimeoutResult`，定时器与重入判据都由出口管。 */
    return withTimeoutResult(
      new Promise<{ detail: string; ok: boolean }>((settle) => {
        // spawn 找不到可执行文件时触发（异步 error 事件）
        child.on("error", (err) => {
          const hint = ollamaFailureHint(err);
          appendOllamaLog(writer, `[err] spawn error：${hint}`);
          settle({ ok: false, detail: `启动 Ollama 失败：${hint}` });
        });

        // 进程在观察期内退出 = 启动秒退（端口被占 / 配置错误 / 安装不完整）
        child.on("exit", (code, signal) => {
          appendOllamaLog(writer, `■ Ollama 进程已退出（code=${code ?? "null"}）`);
          appendOllamaLog(writer, `[exit] code=${code ?? "null"} signal=${signal ?? "none"}`);
          settle({
            ok: false,
            detail:
              `Ollama 进程启动后立即退出（code=${code ?? "null"}, signal=${signal ?? "none"}）。` +
              "可能是端口已被占用或 Ollama 安装不完整，请在终端手动执行 ollama serve 查看详情",
          });
        });
      }),
      SPAWN_GRACE_MS,
      { ok: true, detail: "Ollama 启动命令已执行，正在等待服务就绪" },
    );
  }
}

/**
 * 端点：GET /api/llm/ollama-start
 * 就绪探测：检查 11434 端口是否开始接受连接。
 */
export async function GET(_req: NextRequest) {
  if (!(await requireRequestUser())) {
    return unauthorizedResponse();
  }
  const ready = await probeOllamaPort();
  return NextResponse.json({ ready });
}

/**
 * 端点：POST /api/llm/ollama-start —— 拉起 ollama serve。顺序：端口已就绪直接返回 → Windows 已注册系统服务则返回 → 互斥锁保证同一时刻仅一次 spawn
 *（windowsHide + shell:false；Windows 不用 detached 避免弹 cmd 窗，POSIX 用 detached 防随父退出）→ 观察 1s、秒退即报错 → 过程写入 log/services/ollama-runtime.log。
 */
export async function POST(_req: NextRequest) {
  if (!(await requireRequestUser())) {
    return unauthorizedResponse();
  }
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(_req);
  if (crossOrigin !== null) {
    return crossOrigin;
  }

  // ── 已在运行就直接返回 ──
  if (await probeOllamaPort()) {
    /* [state] 行不再写进上一次会话的日志文件（ISSUE #4733）：这两个分支没有
     * 本次启动会话，出口走响应体，不串台别人的文件。 */
    appendOllamaLog(null, "[state] Ollama 已在运行，跳过启动");
    return NextResponse.json({
      ok: true,
      alreadyRunning: true,
      detail: "Ollama 已在运行",
    });
  }

  // ── Windows 服务已在管理 Ollama → 不需要重复拉起 ──
  if (await ollamaServiceRunning()) {
    appendOllamaLog(null, "[state] Ollama 已注册为 Windows 服务并在后台运行");
    return NextResponse.json({
      ok: true,
      alreadyRunning: true,
      detail: "Ollama 服务已在后台运行",
    });
  }

  // ── 互斥锁：防止并发 POST 重复 spawn ──
  if (st.starting) {
    return NextResponse.json({
      ok: true,
      alreadyRunning: false,
      detail: "Ollama 正在启动中，请稍候",
    });
  }
  st.starting = true;

  /* writer 随本次启动会话走（ISSUE #4733）：提在 try 外，失败路径的 [err] 行
   * 仍能落进已开的会话文件；没有会话（开文件前就失败）时为 null、静默跳过。 */
  let writer: RuntimeLogWriter | null = null;
  try {
    const ollama = await resolveOllamaExe();
    // 退出策略决定拉起方式：false（保活）时脱离进程树，应用退出不连带关闭。
    const keepAlive = getExitPolicy().exitKillOllama === false;
    /* 先换本次启动的日志文件再写第一条（同上）。 */
    writer = beginOllamaSession();
    appendOllamaLog(
      writer,
      `[action] 启动 Ollama：exe=${ollama} keepAlive=${keepAlive}${keepAlive ? "（保活模式：应用退出后不关闭）" : ""}`,
    );
    const result = await spawnOllamaServe(ollama, keepAlive, writer);

    if (result.ok) {
      return NextResponse.json({ ok: true, detail: result.detail });
    }
    return NextResponse.json({ error: result.detail }, { status: 500 });
  } catch (error) {
    const hint = ollamaFailureHint(error);
    appendOllamaLog(writer, `[err] 启动失败：${hint}`);
    return NextResponse.json({ error: `启动 Ollama 失败：${hint}` }, { status: 500 });
  } finally {
    st.starting = false;
  }
}
