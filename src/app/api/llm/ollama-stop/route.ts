import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import fs from "node:fs";
import {
  latestRuntimeLogFile,
  openRuntimeLogWriter,
  type RuntimeLogWriter,
} from "~/lib/log/runtime-log-pack.server";
import { formatLocalStamp } from "~/lib/time-format";
import { OLLAMA_STOP_PROBE } from "~/lib/retry-policy";
import { sleep } from "~/lib/with-timeout";
import { OLLAMA_DEFAULT_PORT, ollamaBaseUrl } from "~/lib/endpoints";
import { killProcessTreeByImage } from "~/lib/process/kill-process-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ollama 默认端口；与 ollama-start 路由保持一致。 */
/* 端口取自 `~/lib/endpoints` 的单一事实源 —— 它同时被设置页 placeholder、
 *  llmConfig 的入库默认值与 MCP 侧 LLM 兜底读取，本地再写一个字面量就又是一处
 *  「改漏就静默分叉」的落点。 */
const OLLAMA_PORT = OLLAMA_DEFAULT_PORT;

/** Ollama 的可执行文件名（按映像名回收时的目标）。 */
const OLLAMA_IMAGE = process.platform === "win32" ? "ollama.exe" : "ollama";

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的。 */
function localTimestamp(): string {
  return formatLocalStamp(new Date());
}

/**
 * 关闭动作落进**哪一份文件**：最近一次启动的那份。
 *
 * 「关闭」是另一个请求、甚至可能是另一个进程，它没有「本次启动」的句柄 ——
 * 因此不能自己新开一份（那会产出一份只有 `[action] 关闭` 两行的空文件，
 * 而用户要看的「为什么关得掉 / 关不掉」本该和那次启动的输出连在一起）。
 * 找不到任何既有文件时（跨重启来关一个别处拉起的实例）退回新建一份。
 */
function writerForStop(): RuntimeLogWriter {
  const latest = latestRuntimeLogFile("ollama-runtime");
  if (latest) {
    return {
      file: latest.file,
      write: (line) => appendTo(latest.file, `${localTimestamp()} ${line}`),
    };
  }
  const created = openRuntimeLogWriter("ollama-runtime");
  return {
    file: created.file,
    write: (line) => created.write(`${localTimestamp()} ${line}`),
  };
}

function appendTo(file: string, line: string): void {
  try {
    fs.appendFileSync(/*turbopackIgnore: true*/ file, `${line}\n`, "utf-8");
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 追加一行到本次（或最近一次）启动的文件（失败不影响主流程）。 */
function appendOllamaLog(line: string): void {
  writerForStop().write(line);
}

async function ollamaUp(): Promise<boolean> {
  return fetch(`${ollamaBaseUrl(OLLAMA_PORT)}/api/version`, {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * 端点：POST /api/llm/ollama-stop
 *
 * 关闭 Ollama：官方 CLI 没有「退出 serve」的命令（`ollama stop <model>` 只停
 * 模型加载），所以进程级终止是唯一可靠的关闭方式。
 *
 * 终止**按映像名杀整棵树**，判据收在 `~/lib/process/kill-process-tree`（`mode: "image"`）：
 * Windows 映射到 `taskkill /IM ollama.exe /T /F`，POSIX 映射到 `pkill -x ollama`。
 * 本模块不再自己拼命令、也不自己摸 `process.platform` —— 按映像名杀同样是
 * 「杀整棵树」的一种，散在路由里就又是一处平台判据。
 */
export async function POST(_req: NextRequest) {
  if (!(await requireRequestUser())) return unauthorizedResponse();
  if (!(await ollamaUp())) {
    appendOllamaLog("[state] Ollama 未在运行，跳过关闭");
    return NextResponse.json({ ok: true, detail: "Ollama 未在运行" });
  }

  // 按映像名杀整棵进程树（平台机制由 kill-process-tree 选）。
  const killed = await killProcessTreeByImage(OLLAMA_IMAGE);
  appendOllamaLog(`[action] 关闭 Ollama：${killed.via}`);
  if (!killed.ok) {
    const msg = `关闭 Ollama 失败：${killed.via}`;
    appendOllamaLog(`[err] ${msg}`);
    return NextResponse.json({ ok: false, detail: msg }, { status: 500 });
  }
  // 等端口真正释放，给界面状态行一个确定的结果 —— 次数与间隔走
  // `~/lib/retry-policy` 的 OLLAMA_STOP_PROBE（10 次 × 500ms = 5s，见 §16.2.4.49）。
  for (let i = 0; i < OLLAMA_STOP_PROBE.maxAttempts; i++) {
    if (!(await ollamaUp())) {
      appendOllamaLog("■ Ollama 已手动关闭");
      appendOllamaLog("[state] Ollama 已关闭");
      return NextResponse.json({ ok: true, detail: "Ollama 已关闭" });
    }
    await sleep(500);
  }
  const msg = "关闭命令已发送，但 Ollama 仍在响应，请手动确认进程已退出";
  appendOllamaLog(`[err] ${msg}`);
  return NextResponse.json({ ok: false, detail: msg }, { status: 500 });
}
