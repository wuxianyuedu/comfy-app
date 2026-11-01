import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { LOG_DIRS } from "../../../../../scripts/launcher-core/log.mjs";
import { LOG_LAYOUT, runsDir } from "../../../../../scripts/launcher-core/run.mjs";
import { apiErrorBody } from "~/lib/api-error";
import { clamp } from "~/lib/clamp";
import { LOG_ROOT } from "~/lib/log/log-paths";
import type { LogSessionsPayload } from "~/lib/log/log-sessions";
import {
  buildRunScopedOptions,
  parsePackScopedId,
  type PackLogFile,
} from "~/lib/log/log-run-packs";
import { scanRunPacks } from "~/lib/log/log-run-packs.server";
import {
  RUNTIME_LOG_SOURCES,
  parseRuntimeLogFileName,
  runtimeLogFileLabel,
  type RuntimeLogSource,
} from "~/lib/log/runtime-log-file";
import { listRuntimeLogFiles, type RuntimeLogFileEntry } from "~/lib/log/runtime-log-pack.server";

/**
 * `GET /api/logs/sessions` —— 列出某个来源**每一次启动**的日志（**跨运行包**），
 * 并回指定一次的正文。
 *
 * 供设置页「启动日志」小窗口与它的全屏视图：那里要的是「切到某一次启动」。
 *
 * ## 用户原话（ISSUE #1587）：「日志会归档到 runs 中，但应用内缺少入口查看」
 *
 * 应用**退出时**会把整个 `log/current/` 归档进 `log/runs/<日期>_<时分秒>-<runId>/`
 * （`archiveCurrent`），于是「上一次运行的启动日志」在归档之后**没有任何界面能打开**
 * —— 用户只能自己去文件管理器里翻 `log/runs/`。本端点因此列**两处**：
 *
 *   - 本次运行：`log/current/services/` 下该来源的份（新→旧，恒在最前）；
 *   - 历史归档：各运行包里这一来源的份（包名倒序 = 时间倒序）。
 *
 * ## 这一层只有一处判据：**文件是谁**
 *
 * 上一版按**应用运行包**列表、正文用「当前包 − 前一包」的长度减法去切（依赖
 * 「包 N ⊇ 包 N-1」这条来自归档复制语义的性质）。改成一次启动一份文件之后，
 * 「文件是谁」不依赖任何假设 —— 跨包这一层**复用的正是这条**，一条减法都没加回来：
 * 归档是整目录复制，**包内结构与 `current/` 逐字同构**，所以跨包就是「把各包里的
 * 文件排成一条时间线」，与包内那层共用同一份顺序判据（`compareRuntimeLogFiles`）。
 *
 * ## 跨包那几件判据不在本文件里
 *
 * 包目录名怎么解析、id 怎么编码、下拉怎么排、文案怎么拼在 `lib/log/log-run-packs.ts`
 * （纯判据，能脱离磁盘单测）；列 `runs/` 与读 `run.json` 在
 * `lib/log/log-run-packs.server.ts`。端点只做四件必须在这里做的事：判来源白名单、
 * 取两处路径、定位选中那一份、读正文（尾部窗口）。
 *
 * ## 路径不在端点里拼（§12.14）
 *
 * `current/` 那边取 `log-paths` 的 `SERVICES_LOG_DIR` 与 `listRuntimeLogFiles()`；
 * `runs/` 那边取 `run.mjs` 的 `runsDir()`（归档写方的唯一定义），包内相对目录与
 * `run.json` 的名字分别取 `log.mjs` 的 `LOG_DIRS.services` 与 `run.mjs` 的
 * `LOG_LAYOUT.runJson`。读方自己拼一遍，两边一旦漂开表现是「归档了但界面看不到」
 * ——而两边各自都「看起来是对的」。
 *
 * ## 参数
 *
 *   - `source`：`RUNTIME_LOG_SOURCES` 里的一项；
 *   - `session`（可选）：要读的份。两种**已登记**形态 —— `current/` 的份是裸文件名
 *     （`comfyui-runtime-20261005-093612.log`），归档份是 `<包名>/<文件名>`。
 *     其余形态（含 `..` 一类穿越形态）一律回落最新那一份，不拿它去拼路径。
 */

/** 单次请求最多返回的正文字节数（约 40 万字符量级）。 */
const MAX_TEXT_BYTES = 400_000;

/** 下拉最多列多少次启动：再老的翻不到，列出来只是噪声。 */
const MAX_FILES = 30;

/**
 * 最多翻几个运行包。
 *
 * 与 `MAX_FILES` 同一量级：跨包 + 包内很容易超出 30 条，反正最终列表会被
 * `MAX_FILES` 裁到 30 条（`buildRunScopedOptions` 的 `max`），这里只管「别为了
 * 凑满 30 条去读上百个包的目录」。`runs/` 的保留策略本来就只留 20 包。
 */
const MAX_PACKS = 20;

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
 *
 * 异步（ISSUE #2193）：本端点与 `GET /api/logs/current` 共用「最新那一份」那条
 * 判据，而同步 `stat` / `open` / `read` 压的是事件循环线程。读取契约（窗口大小、
 * 掐头对齐、`windowed` / `size` 的语义）一字未改 —— 钉它的 `route.test.ts` 是
 * 这一轮改动的**判据**，不是要绕过去的东西。
 */
async function readTail(
  file: string,
  maxBytes: number,
): Promise<{ size: number; text: string; windowed: boolean }> {
  let size: number;
  try {
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ file);
    size = stat.size;
  } catch {
    return { text: "", windowed: false, size: 0 };
  }
  /* 尾部窗口的起点：`size - maxBytes` 夹回 `[0, size]`（文件比窗口还小 → 从头
   * 读整份）。夹的法子走 `~/lib/clamp` 的唯一出口，不在这里写 `Math.max` ——
   * 「窗口算术」在本仓库是 §16.2.4.67 的收口面（列表那一族用 `tailWindow`；
   * 这里是**字节**窗口，形态不同但同一类账）。 */
  const start = clamp(size - maxBytes, 0, size);
  const length = size - start;
  if (length <= 0) {
    return { text: "", windowed: false, size };
  }
  const buf = Buffer.alloc(length);
  const handle = await fs.promises.open(/*turbopackIgnore: true*/ file, "r");
  try {
    await handle.read(buf, 0, length, start);
  } finally {
    await handle.close();
  }
  const raw = buf.toString("utf8");
  if (start === 0) {
    return { text: raw, windowed: false, size };
  }
  /* 窗口推后了起点：窗口里那个半行不属于本次返回的内容，丢掉它。
   * 只剩一行且它本身就是半行时给空串（而不是把半个 JSON 一样的乱码给出去）。 */
  const firstBreak = raw.indexOf("\n");
  return {
    text: firstBreak !== -1 ? raw.slice(firstBreak + 1) : "",
    windowed: true,
    size,
  };
}

/** `current/` 下的一份 → 跨包列表的一项。
 *
 * 旧固定名（迁移前留下的 `<来源>.log`）解析不出时刻：它**必须**有一个说得通的
 * 文案，不能退回文件名 —— 在那条下拉里 `comfyui-runtime.log` 读起来像是「现在的
 * 那一份」，而它实际是所有新份之前的全部历史。`runtimeLogFileLabel` 对
 * `startedAt: null` 给「更早的日志」，正好是它的语义。 */
function toPackFile(entry: RuntimeLogFileEntry): PackLogFile {
  const parsed = parseRuntimeLogFileName(entry.name);
  return {
    name: entry.name,
    startedAt: entry.startedAt,
    title: runtimeLogFileLabel(parsed ?? { source: "", startedAt: null, ordinal: 1 }),
  };
}

/**
 * 归档份的绝对路径：`<包名>/<文件名>` → `runs/<包名>/<来源目录>/<文件名>`。
 *
 * 形态判据走 `parsePackScopedId`（包名必须是真实包名形态、文件名不许再含分隔符），
 * 端点**不自己拆** —— 脏 id（客户端缓存过、或人手敲的）必须在这里被挡掉，而不是
 * 拿它去拼路径。拆不出来时返回 null，调用方回落最新那一份。
 */
function resolveArchivedFile(sessionId: string, root: string): string | null {
  const parsed = parsePackScopedId(sessionId);
  if (!parsed) {
    return null;
  }
  return path.join(runsDir(root), parsed.packName, LOG_DIRS.services, parsed.fileName);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "";
  const requested = searchParams.get("session");

  if (
    !(/* SAFETY: 类型断言已复核 */ (RUNTIME_LOG_SOURCES as ReadonlyArray<string>).includes(source))
  ) {
    return NextResponse.json(emptyPayload(`unknown source: ${source}`), {
      status: 400,
    });
  }

  try {
    /* 本次运行：目录与命名规则都从写方那一侧拿（`runtime-log-pack.server`）——
     * 读方自己拼 `log/current/services/<source>-*.log` 就会与写方漂开，而漂开的
     * 表现是「日志在磁盘上、界面上看不到」（两边各自都「看起来是对的」）。 */
    const currentEntries = await listRuntimeLogFiles(
      /* SAFETY: 类型断言已复核 */ source as RuntimeLogSource,
    );

    /* 历史归档：`runs/` 与包内相对目录同样从写方那一侧取，端点不写 `log/runs`
     * 字面量。交给 `scanRunPacks` 的是**日志根的父目录**（`runsDir()` 自己拼
     * `log/runs`）—— 与 `POST /api/logs/diagnostics` 把 `path.dirname(LOG_ROOT)`
     * 交给 `exportDiagnostics()` 是同一手法。 */
    const root = path.dirname(LOG_ROOT);
    const { packs, total: archivedTotal } = await scanRunPacks({
      runsDir: runsDir(root),
      sourceDir: LOG_DIRS.services,
      runJsonName: LOG_LAYOUT.runJson,
      maxPacks: MAX_PACKS,
      source: /* SAFETY: 类型断言已复核 */ source as RuntimeLogSource,
    });

    /* 分组、顺序、文案全在纯判据那一层：端点只把两边的数据递进去，不自己拼列表
     * —— 「本次运行恒在最前」「其后按次运行分组」「文案三段」是**用户侧契约**，
     * 写在端点或视图里都会与另一处漂开（§12.12）。 */
    const { sessions, total } = buildRunScopedOptions(
      currentEntries.map(toPackFile),
      packs,
      MAX_FILES,
      currentEntries.length + archivedTotal,
    );
    if (sessions.length === 0) {
      return NextResponse.json(emptyPayload());
    }

    const selectedId =
      sessions.find((session) => session.id === requested)?.id ?? sessions[0]?.id ?? null;
    /* 请求的那一份已被保留策略删掉（或客户端缓存了旧列表）时回落最新那一份，
     * 并把实际选中项如实回报 —— 客户端据此同步下拉，不去猜。 */
    const selected = sessions.find((session) => session.id === selectedId);
    if (!selected) {
      return NextResponse.json(emptyPayload());
    }

    /* 本次运行的份按**文件名**定位（它就在 `services/` 下）；归档份要按包名进包找
     * —— 裸文件名找不到它（那是另一个目录里的同名文件）。 */
    const file =
      currentEntries.find((entry) => entry.name === selected.id)?.file ??
      resolveArchivedFile(selected.id, root);
    if (!file) {
      return NextResponse.json(emptyPayload());
    }

    const { text, windowed, size } = await readTail(file, MAX_TEXT_BYTES);
    return NextResponse.json({
      sessions,
      selectedId: selected.id,
      content: text,
      truncated: windowed,
      windowed,
      size,
      /* 一共几份（不受 MAX_FILES 影响）：界面据此说明「更早的启动不在列表里」，
       * 而不是让用户以为「这个来源只启动过这些次」—— 跨包之后这个数只会更大。 */
      total,
    } satisfies LogSessionsPayload);
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取日志会话失败", { ...emptyPayload() }), {
      status: 500,
    });
  }
}
