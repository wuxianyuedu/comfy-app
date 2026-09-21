import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import fs from "node:fs";
import { RUNTIME_LOG_FILES } from "~/lib/log/log-paths";
import {
  parseLogSessions,
  type LogSessionMeta,
  type LogSessionsPayload,
} from "~/lib/log/log-sessions";

/**
 * `GET /api/logs/sessions` —— 按「每次启动」切分追加写 runtime 日志。
 *
 * 与 `GET /api/logs/current` 的分工：
 *   - `current` 是**增量跟随**（客户端带游标，服务端回新增的一段），供日志面板；
 *   - 本端点是**会话视图**（列出每次启动，并回指定一次的完整正文），供设置页
 *     「启动日志」小窗口与它的全屏视图 —— 那里的需求是「切到某一次启动」，
 *     而增量游标表达不了「这次启动从哪一行开始」。
 *
 * 鉴权口径与 `current` 一致（同为本地日志文件的读取通道，且是同一批调用方），
 * 不额外要求登录态。
 *
 * 参数：
 *   - `source`：`RUNTIME_LOG_FILES` 的键（comfyui-runtime / drizzle-studio-runtime /
 *     ollama-runtime / app-runtime）；
 *   - `session`（可选）：要读取的会话 id；缺省或已不在列表里（文件尾窗滑动后
 *     老会话被推出窗口）时回落到**最新一次**，服务端把实际选中项放在 `selectedId`
 *     里回给客户端 —— 客户端据此同步下拉的选中态，而不是自己猜。
 */

/**
 * 单次请求最多扫描的文件尾部字节数。
 *
 * 这些文件追加不轮转，跑几个月可能几十 MB；整份读进内存只为找横幅不划算，
 * 而用户要看的「每次启动」也总是最近几次。窗口外的更早启动由响应的 `windowed`
 * 如实告知，界面据此说明「更早的启动不在列表里」。
 */
const SCAN_BYTES = 4 * 1024 * 1024;

/** 下拉最多列出多少次启动：再老的启动一次也翻不到，列出来只是噪声。 */
const MAX_SESSIONS = 30;

/** 无对应文件的空响应（与 `current` 同口径：不给 404/500，界面据此显示空态）。 */
function emptyPayload(size: number): LogSessionsPayload {
  return {
    sessions: [],
    selectedId: null,
    content: "",
    truncated: false,
    windowed: false,
    size,
  };
}

/**
 * 读文件尾部窗口并解码成文本。
 *
 * 起点对齐到**行边界**（丢掉窗口里的第一个半行）：从字节中间切出来的半个字符
 * 或半行会渲染成乱码。`windowed` 表示前面还有内容没被读到。
 */
function readTailText(
  file: string,
  maxBytes: number,
): { text: string; windowed: boolean } {
  const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  const from = Math.max(0, size - maxBytes);
  const length = size - from;
  if (length <= 0) return { text: "", windowed: from > 0 };
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    fs.readSync(fd, buf, 0, length, from);
  } finally {
    fs.closeSync(fd);
  }
  const text = buf.toString("utf8");
  if (from <= 0) return { text, windowed: false };
  const firstBreak = text.indexOf("\n");
  return {
    text: firstBreak >= 0 ? text.slice(firstBreak + 1) : "",
    windowed: true,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "";
  const requested = searchParams.get("session");

  const file = RUNTIME_LOG_FILES[source];
  if (!file) {
    return NextResponse.json(
      { ...emptyPayload(0), error: `unknown source: ${source}` },
      { status: 400 },
    );
  }

  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) {
      return NextResponse.json(emptyPayload(0));
    }
    const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
    const { text, windowed } = readTailText(file, SCAN_BYTES);
    const all = parseLogSessions(text);
    const sessions = all.slice(-MAX_SESSIONS);
    const selected =
      (requested !== null
        ? sessions.find((session) => session.id === requested)
        : undefined) ?? sessions[sessions.length - 1];
    const meta: LogSessionMeta[] = sessions.map(({ id, title, startedAt }) => ({
      id,
      title,
      startedAt,
    }));
    return NextResponse.json({
      sessions: meta,
      selectedId: selected?.id ?? null,
      content: selected?.text ?? "",
      truncated: selected?.truncated ?? false,
      windowed,
      size,
    } satisfies LogSessionsPayload);
  } catch (error) {
    return NextResponse.json(
      apiErrorBody(error, "读取日志会话失败", { ...emptyPayload(0) }),
      { status: 500 },
    );
  }
}
