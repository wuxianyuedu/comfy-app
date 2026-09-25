import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import fs from "node:fs";
import path from "node:path";
import { OLLAMA_RUNTIME_LOG } from "~/lib/log/log-paths";
import { formatLocalStamp } from "~/lib/time-format";
import { OLLAMA_STOP_PROBE } from "~/lib/retry-policy";
import { sleep } from "~/lib/with-timeout";
import { appendSessionBanner as appendSessionBannerToFile } from "~/lib/session-banner.server";
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

/** 追加一行到 ollama-runtime.log（失败不影响主流程）。 */
function appendOllamaLog(line: string): void {
  try {
    fs.mkdirSync(path.dirname(OLLAMA_RUNTIME_LOG), { recursive: true });
    fs.appendFileSync(
      OLLAMA_RUNTIME_LOG,
      `${localTimestamp()} ${line}\n`,
      "utf-8",
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 会话边界横幅（唯一实现见 `src/lib/session-banner.server.ts`）：区分多次启动累积的
 * ollama-runtime.log（两侧各留空行，直接看文件也能看出本次从哪开始）。 */
function appendOllamaBanner(kind: "start" | "end", title: string): void {
  appendSessionBannerToFile(OLLAMA_RUNTIME_LOG, kind, title);
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
      appendOllamaBanner("end", "■ Ollama 已手动关闭");
      appendOllamaLog("[state] Ollama 已关闭");
      return NextResponse.json({ ok: true, detail: "Ollama 已关闭" });
    }
    await sleep(500);
  }
  const msg = "关闭命令已发送，但 Ollama 仍在响应，请手动确认进程已退出";
  appendOllamaLog(`[err] ${msg}`);
  return NextResponse.json({ ok: false, detail: msg }, { status: 500 });
}
