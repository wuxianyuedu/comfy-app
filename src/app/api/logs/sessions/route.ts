import { NextResponse } from "next/server";
import fs from "node:fs";

import { apiErrorBody } from "~/lib/api-error";
import { clamp } from "~/lib/clamp";
import { tailWindow } from "~/lib/page-window";
import type {
  LogSessionMeta,
  LogSessionsPayload,
} from "~/lib/log/log-sessions";
import {
  RUNTIME_LOG_SOURCES,
  parseRuntimeLogFileName,
  runtimeLogFileLabel,
  type RuntimeLogSource,
} from "~/lib/log/runtime-log-file";
import {
  listRuntimeLogFiles,
  type RuntimeLogFileEntry,
} from "~/lib/log/runtime-log-pack.server";

/**
 * `GET /api/logs/sessions` —— 列出某个来源的**每一次启动**的日志，并回指定一次
 * 的正文。
 *
 * 供设置页「启动日志」小窗口与它的全屏视图：那里要的是「切到某一次启动」。
 *
 * ## ISSUE #1326：这一层从「运行包切分」退化成「列文件」
 *
 * 上一版把**应用运行包**（`log/runs/<日期>_<时分秒>-<runId>/`）当列表：一次
 * 应用运行一个包，包里的 runtime 文件要**减去前一包**才是「那一次」的内容
 * （因为文件追加不轮转、而归档是整目录复制）。用户随后提了更彻底的口径
 * ——「这四份也要改成每个文件只存储单次运行的历史」—— 文件本身改成
 * **一次启动一份**之后，这一层不再需要任何切分判据：
 *
 *   - 列表 = `log/current/services/` 下该来源的单次文件（新→旧）；
 *   - 正文 = **那一份文件整份**。
 *
 * 于是上一版的 `runSlice` / `baselineMissing` / `scanRunPacks` 全部退场，
 * 连 `log/run-run-sessions` 的跨运行减法定理一起 —— 判据从「长度相减」变成
 * 「文件是谁」，而后者不依赖任何假设。这是「把查询能力绑在目录结构上」
 * 换成「绑在文件名上」，两边都成立，但后者少一整类静默出错的机会。
 *
 * ## 两条仍然成立的边界
 *
 *   1. **只列真属于该来源的文件**：一个来源一份目录里可能同时有 comfyui 与
 *      ollama 的文件（同目录），按名字过滤，不按「目录里有什么」；
 *   2. **上限**（{@link MAX_FILES}）：一次启动一份文件之后，同一天可能攒几十
 *      份（服务被反复重启），下拉列不完。取最近的，并如实回报一共有几份
 *      （`total`），界面据此说明「更早的不在列表里」。
 *
 * 鉴权口径与 `current` 一致（同为本地日志文件的读取通道，且是同一批调用方），
 * 不额外要求登录态。
 *
 * 参数：
 *   - `source`：`RUNTIME_LOG_SOURCES` 里的一项；
 *   - `session`（可选）：要读的文件名。缺省或已不在列表里时回落**最新那一份**，
 *     实际选中项放进 `selectedId` 回给客户端 —— 客户端据此同步下拉，而不是自己猜。
 */

/** 单次请求最多返回的正文字节数（约 40 万字符量级）。 */
const MAX_TEXT_BYTES = 400_000;

/** 下拉最多列多少次启动：再老的翻不到，列出来只是噪声。 */
const MAX_FILES = 30;

/** 空载荷（与 `current` 同口径：不给 404/500，界面据此显示空态而不是报错）。 */
function emptyPayload(error?: string): LogSessionsPayload & { error?: string } {
  return {
    sessions: [],
    selectedId: null,
    content: "",
    truncated: false,
    windowed: false,
    size: 0,
    total: 0,
    ...(error ? { error } : {}),
  };
}

/**
 * 读文件尾部窗口（超过 `maxBytes` 时**掐头对齐到行边界**）。
 *
 * 「对齐」是必需的：日志文件可能几十 MB，而窗口起点落在半行上时面板会解析出
 * 乱码行（同 `GET /api/logs/current` 的尾部窗口规则）。一次启动一份文件之后
 * 正文不再需要「减去前一份」，但**窗口**这条约束不变 —— 一次很长的启动
 * （挂着 ComfyUI 跑一下午）照样能写出几 MB。
 */
function readTail(
  file: string,
  maxBytes: number,
): { text: string; windowed: boolean; size: number } {
  let size: number;
  try {
    size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  } catch {
    return { text: "", windowed: false, size: 0 };
  }
  /* 尾部窗口的起点：`size - maxBytes` 夹回 `[0, size]`（文件比窗口还小 → 从头
   * 读整份）。夹的法子走 `~/lib/clamp` 的唯一出口，不在这里写 `Math.max` ——
   * 「窗口算术」在本仓库是 §16.2.4.67 的收口面（列表那一族用 `tailWindow`；
   * 这里是**字节**窗口，形态不同但同一类账）。 */
  const start = clamp(size - maxBytes, 0, size);
  const length = size - start;
  if (length <= 0) return { text: "", windowed: false, size };
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  const raw = buf.toString("utf8");
  if (start === 0) return { text: raw, windowed: false, size };
  /* 窗口推后了起点：窗口里那个半行不属于本次返回的内容，丢掉它。
   * 只剩一行且它本身就是半行时给空串（而不是把半个 JSON 一样的乱码给出去）。 */
  const firstBreak = raw.indexOf("\n");
  return {
    text: firstBreak >= 0 ? raw.slice(firstBreak + 1) : "",
    windowed: true,
    size,
  };
}

/** 文件条目 → 下拉项（时刻来自文件名，形态判据在 `runtime-log-file.ts`）。
 *
 * 旧固定名（迁移前留下的 `<来源>.log`）解析不出时刻：它**必须**有一个说得通的
 * 文案，不能退回文件名 —— 在那条下拉里 `comfyui-runtime.log` 读起来像是「现在的
 * 那一份」，而它实际是所有新份之前的全部历史。`runtimeLogFileLabel` 对
 * `startedAt: null` 给「更早的日志」，正好是它的语义。 */
function toOption(entry: RuntimeLogFileEntry): LogSessionMeta {
  const parsed = parseRuntimeLogFileName(entry.name);
  return {
    id: entry.name,
    title: runtimeLogFileLabel(
      parsed ?? { source: "", startedAt: null, ordinal: 1 },
    ),
    startedAt: entry.startedAt,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "";
  const requested = searchParams.get("session");

  if (!(RUNTIME_LOG_SOURCES as readonly string[]).includes(source)) {
    return NextResponse.json(emptyPayload(`unknown source: ${source}`), {
      status: 400,
    });
  }

  try {
    /* 目录与命名规则都从写方那一侧拿（`runtime-log-pack.server`）——
     * 读方自己拼 `log/current/services/<source>-*.log` 就会与写方漂开，而
     * 漂开的表现是「日志在磁盘上、界面上看不到」（两边各自都「看起来是对的」）。 */
    const all = listRuntimeLogFiles(source as RuntimeLogSource);
    /* 列表新→旧（写方按旧→新给，这里翻转）：用户几乎总是要找**最近**那几次。
     * 取尾部 N 条走 `~/lib/page-window` 的 `tailWindow`（§16.2.4.67 的唯一出口：
     * 它把「size ≥ 长度时整份返回」与「负数 / NaN 不许变成 `slice(-0)`」这两条
     * 边界一并管住，手写 `slice(-n)` 会把 `-0` 变成「从头取」这种静默反向）。 */
    const recent = tailWindow(all, MAX_FILES);
    const sessions = recent.map(toOption).reverse();
    if (sessions.length === 0) return NextResponse.json(emptyPayload());

    const selectedId =
      sessions.find((session) => session.id === requested)?.id ??
      sessions[0]?.id ??
      null;
    /* 请求的那一份已被保留策略删掉（或客户端缓存了旧列表）时回落最新那一份，
     * 并把实际选中项如实回报 —— 客户端据此同步下拉，不去猜。 */
    const selected = recent.find((entry) => entry.name === selectedId);
    if (!selected) return NextResponse.json(emptyPayload());

    const { text, windowed, size } = readTail(selected.file, MAX_TEXT_BYTES);
    return NextResponse.json({
      sessions,
      selectedId: selected.name,
      content: text,
      truncated: windowed,
      windowed,
      size,
      /* 一共几份（不受 MAX_FILES 影响）：界面据此说明「更早的启动不在列表里」，
       * 而不是让用户以为「这个来源只启动过这些次」。 */
      total: all.length,
    } satisfies LogSessionsPayload);
  } catch (error) {
    return NextResponse.json(
      apiErrorBody(error, "读取日志会话失败", { ...emptyPayload() }),
      { status: 500 },
    );
  }
}
