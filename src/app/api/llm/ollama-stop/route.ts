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
 * 关闭动作落进最近一次启动的那份文件：「关闭」没有「本次启动」句柄，新开一份会产出空文件
 * 且与启动输出断连；找不到既有文件时退回新建。异步跟着 `latestRuntimeLogFile`（ISSUE #2193）；
 * 逐行 await：`[action] 关闭` 必须排在 `■ 已手动关闭` 之前。
 */
async function writerForStop(): Promise<RuntimeLogWriter> {
  const latest = await latestRuntimeLogFile("ollama-runtime");
  if (latest) {
    return {
      file: latest.file,
      write: (line) => {
        appendTo(latest.file, `${localTimestamp()} ${line}`);
      },
    };
  }
  const created = openRuntimeLogWriter("ollama-runtime");
  return {
    file: created.file,
    write: (line) => {
      created.write(`${localTimestamp()} ${line}`);
    },
  };
}

function appendTo(file: string, line: string): void {
  try {
    fs.appendFileSync(/*turbopackIgnore: true*/ file, `${line}\n`, "utf8");
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 追加一行到本次（或最近一次）启动的文件（失败不影响主流程）。 */
async function appendOllamaLog(line: string): Promise<void> {
  (await writerForStop()).write(line);
}

async function ollamaUp(): Promise<boolean> {
  return fetch(`${ollamaBaseUrl(OLLAMA_PORT)}/api/version`, {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * 端点：POST /api/llm/ollama-stop —— 关闭 Ollama：官方 CLI 没有「退出 serve」的命令，进程级
 * 终止是唯一可靠方式。按映像名杀整棵树，判据在 `~/lib/process/kill-process-tree`
 * （`mode: "image"`：Windows `taskkill /IM /T /F`，POSIX `pkill -x`）。
 */
export async function POST(_req: NextRequest) {
  if (!(await requireRequestUser())) {
    return unauthorizedResponse();
  }
  if (!(await ollamaUp())) {
    await appendOllamaLog("[state] Ollama 未在运行，跳过关闭");
    return NextResponse.json({ ok: true, detail: "Ollama 未在运行" });
  }

  // 按映像名杀整棵进程树（平台机制由 kill-process-tree 选）。
  const killed = await killProcessTreeByImage(OLLAMA_IMAGE);
  await appendOllamaLog(`[action] 关闭 Ollama：${killed.via}`);
  if (!killed.ok) {
    const msg = `关闭 Ollama 失败：${killed.via}`;
    await appendOllamaLog(`[err] ${msg}`);
    return NextResponse.json({ ok: false, detail: msg }, { status: 500 });
  }
  // 等端口真正释放，给界面状态行一个确定的结果 —— 次数与间隔走
  // `~/lib/retry-policy` 的 OLLAMA_STOP_PROBE（10 次 × 500ms = 5s，见 §16.2.4.49）。
  for (let i = 0; i < OLLAMA_STOP_PROBE.maxAttempts; i++) {
    if (!(await ollamaUp())) {
      await appendOllamaLog("■ Ollama 已手动关闭");
      await appendOllamaLog("[state] Ollama 已关闭");
      return NextResponse.json({ ok: true, detail: "Ollama 已关闭" });
    }
    await sleep(500);
  }
  const msg = "关闭命令已发送，但 Ollama 仍在响应，请手动确认进程已退出";
  await appendOllamaLog(`[err] ${msg}`);
  return NextResponse.json({ ok: false, detail: msg }, { status: 500 });
}
