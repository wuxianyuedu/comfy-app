import { clamp } from "~/lib/clamp";
import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import { isRecord } from "~/lib/is-record";
import fs from "node:fs";
import { latestPanelLogFile } from "~/lib/log/capture-streams.server";
import { resolveSessionStart } from "~/lib/log/log-session-scope";
import { fileMtimeMs } from "~/lib/log/log-session-scope.server";
import { getServerBootId } from "~/lib/shell/dev-server-id";
import { launchPaths } from "~/lib/shell/launch-diagnostics";
import {
  DEV_LAUNCHER_CURRENT_SENTINEL,
  DEV_LAUNCHER_LOG,
  LAUNCHER_SHELL_LOG,
} from "~/lib/log/log-paths";
import { RUNTIME_LOG_SOURCES, type RuntimeLogSource } from "~/lib/log/runtime-log-file";
import { latestRuntimeLogFile } from "~/lib/log/runtime-log-pack.server";

const LAUNCHER_LOG_FILE = LAUNCHER_SHELL_LOG;
const SENTINEL_FILE = DEV_LAUNCHER_CURRENT_SENTINEL;

function isRuntimeLogSource(v: unknown): v is RuntimeLogSource {
  return typeof v === "string" && RUNTIME_LOG_SOURCES.some((source) => source === v);
}

/* 壳侧启动链路的两份日志（壳自持 log/shell/shell.log + 壳侧编排链路
 * log/launcher/shell-launch.log）。路径的唯一事实来源是 `launchPaths`——
 * 它与 Rust 壳侧共用同一组路径常量（tests/launch-diagnostics-paths.test.ts
 * 逐项核对），这里不再抄一份字面量。 */
const SHELL_CHAIN_PATHS = launchPaths(process.cwd());

/**
 * 追加写日志（app-runtime / 各常驻服务 runtime）不轮转，积累几个月后可能几十 MB：首次打开（offset=0 或游标失效）
 * 只回尾部窗口，避免把整文件塞进一次响应。两个约束缺一不可：① 窗口够大（旧实现 128KB，而单行约 85~150 字节，
 * 128KB 只装约 900~1500 行，用户很容易在一次会话里超过它，于是「越读越旧」，ISSUE #262）；② 起点必须按行对齐（跳过窗口第一个半行），否则面板解析出乱码行。
 */
const TAIL_BYTES = 1024 * 1024;

/**
 * 文件的当前字节数；**不存在**回 null，其它错误照抛 —— 「没有这个文件」是空切片（面板显示「还没有输出」），
 * 而「读不到」（权限 / 磁盘）是接口挂了 ⇒ 必须走 500 出口，不许并成同一个 null 冒充「没有日志」。一次 `stat` 同时回答这两件事。
 */
async function sizeOrNull(file: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ file);
    return stat.size;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * 读文件的某一段字节（只读请求区间，不把整文件读进内存）；返回 null 表示文件不存在。异步（ISSUE #2193）：这条端点被日志面板
 * 每 2s 打多路来源，同步 IO 占住事件循环线程、代价由所有并发请求一起付。`turbopackIgnore` 标记逐处跟着调用点搬（漏搬表现为「构建期过、出厂件缺件」，硬规则 17 / 18）。
 */
async function readBytes(file: string, start: number, length: number): Promise<Buffer | null> {
  const size = await sizeOrNull(file);
  if (size === null) {
    return null;
  }
  const from = clamp(start, 0, size);
  const len = clamp(length, 0, size - from);
  if (len === 0) {
    return Buffer.alloc(0);
  }
  const buf = Buffer.alloc(len);
  const handle = await fs.promises.open(/*turbopackIgnore: true*/ file, "r");
  try {
    await handle.read(buf, 0, len, from);
  } finally {
    await handle.close();
  }
  return buf;
}

/** 把窗口起点向后对齐到第一个完整行（丢弃被截断的头半行），避免解析出乱码。 */
function alignToLineStart(buf: Buffer, start: number, fileSize: number): number {
  if (start <= 0) {
    return 0;
  }
  const nl = buf.indexOf(0x0a);
  if (nl === -1) {
    return fileSize;
  }
  return start + nl + 1;
}

/**
 * 本次运行在追加写日志文件里的**起点时刻**。追加写日志与 dev-launcher.log 的关系只有一条：本运行开始时它被覆盖重建，mtime 即本次启动时刻；
 * 面板据此把早于该时刻的行挡在外面（`dropStaleEntries`），本端点负责把它一并回给客户端。读不到锚点（非双击链路启动）返回 null：
 * 客户端退化为不做时间线截断，多显示几条历史行也好过凭空丢掉本次日志。
 */
async function sessionStartMs(): Promise<number | null> {
  return resolveSessionStart(await fileMtimeMs(DEV_LAUNCHER_LOG));
}

async function resolveCurrentLog(source: string): Promise<string> {
  if (source === "launcher") {
    return LAUNCHER_LOG_FILE;
  }
  try {
    const raw = await fs.promises.readFile(/*turbopackIgnore: true*/ SENTINEL_FILE, "utf8");
    const sentinel = raw.trim();
    if (sentinel && (await sizeOrNull(sentinel)) !== null) {
      return sentinel;
    }
  } catch {
    // sentinel 不存在或无效时回退到默认文件
  }
  return DEV_LAUNCHER_LOG;
}

type Slice = {
  /**
   * 当前提供本响应的应用服务进程标识。客户端存下它，下一轮轮询比对 —— 它同时承担两件事：**排障**（面板页脚展示「服务:xxxx」，
   * 用户报障时能说清连的是哪个进程）与**重启可见**（进程换了能立刻发现并重读日志，不把两个进程的输出混成一条时间线）。
   */
  bootId?: string;
  content: string;
  /**
   * 服务端进程启动标识与客户端缓存的不一致：true = 这份状态来自另一个应用服务进程，应视为真正的重启 ——
   * 清掉时间线、重置游标并重新拉取，而不是继续往旧时间线上追加。
   */
  mismatch?: boolean;
  /** 本次返回内容在文件中的起点。 */
  offset: number;
  /**
   * 本次运行的开始时刻（毫秒）；**只有跨运行累积的来源才有值**。覆盖重建的来源（launcher / dev / app）返回 null：
   * 文件天然只含本次内容，下发「会话起点」会让客户端把本次启动早期的行（启动器在 dev-launcher.log 创建前写的头几行）误判成历史而丢掉（ISSUE #262 复审）。
   */
  sessionStart: number | null;
  /** 文件当前总字节数：客户端下一轮的增量读取游标。 */
  size: number;
};

/**
 * 增量读取一段日志：客户端带上上次读到的 `size` 作为游标 → 只回游标之后的新增；
 * 游标无效（首帧 / 文件被新运行覆盖重建 / 文件变小）→ 回尾部窗口，并掐头对齐到完整行。
 */
async function readLogSlice(
  logFile: string,
  requestedOffset: number,
  bootId: string,
  mismatch: boolean,
  /**
   * 该来源的文件是否跨运行累积（见 `resolveSourceFile`）。只有累积来源才需要会话起点；覆盖重建的来源恒为 null。
   */
  resumable: boolean,
): Promise<Slice> {
  const sessionStart = resumable ? await sessionStartMs() : null;
  const fileSize = await sizeOrNull(logFile);
  if (fileSize === null) {
    return { content: "", size: 0, offset: 0, sessionStart, bootId, mismatch };
  }
  const cursorValid =
    Number.isFinite(requestedOffset) && requestedOffset > 0 && requestedOffset <= fileSize;
  /* 游标已被读到文件末尾：没有新增，直接回空（不必再读一次）。 */
  if (cursorValid && requestedOffset === fileSize) {
    return {
      content: "",
      size: fileSize,
      offset: fileSize,
      sessionStart,
      bootId,
      mismatch,
    };
  }
  let start = cursorValid ? requestedOffset : Math.max(0, fileSize - TAIL_BYTES);

  const buf = (await readBytes(logFile, start, fileSize - start)) ?? Buffer.alloc(0);
  /* 只有「滑动窗口」分支才需要掐头对齐：游标来自上一次响应的 `size`，
   * 它本身就在行边界上（或者是文件末尾）。 */
  if (!cursorValid) {
    start = alignToLineStart(buf, start, fileSize);
    const skip = start - (fileSize - buf.length);
    return {
      content: buf.subarray(Math.max(0, skip)).toString("utf8"),
      size: fileSize,
      offset: start,
      sessionStart,
      bootId,
      mismatch,
    };
  }
  return {
    content: buf.toString("utf8"),
    size: fileSize,
    offset: start,
    sessionStart,
    bootId,
    mismatch,
  };
}

/** 解析某个日志来源对应的文件；来源不被识别 / 文件不存在时返回 null。 */
async function resolveSourceFile(
  source: string,
): Promise<{ file: string; resumable: boolean } | null> {
  /* 四份 runtime 日志（comfyui / drizzle-studio / ollama / app-runtime）现在是**一次启动一份文件**（ISSUE #1326），这里取「最新那一份」
   * 跟随正在写的那一份。`resumable: false`：一个文件只属于一次启动，没有跨运行累积的历史行要裁 —— 会话起点对本族消失
   *（此前拿 `dev-launcher.log` 的 mtime 当起点，锚点比真实启动时刻晚，会把启动早期的行误判成历史，见 §4.1 的四审）。 */
  if (isRuntimeLogSource(source)) {
    const latest = await latestRuntimeLogFile(source);
    return latest ? { file: latest.file, resumable: false } : { file: "", resumable: false };
  }
  /* 「应用服务输出」：Next dev server 的 stdout/stderr 转录（本次进程一份）。 */
  if (source === "app") {
    const file = await latestPanelLogFile();
    return file !== null && file !== "" ? { file, resumable: true } : null;
  }
  /* 壳侧两路（shell = 壳自持日志；shell-launch = 壳侧编排链路）：双击启动的最早一段现场（exe / 项目根 / 启动报告）只在这两份里。
   * 文件虽是追加写、跨运行累积，但**不能**按会话起点裁剪：锚点（dev-launcher.log 的 mtime）晚于壳写下的头几行（启动报告在编排器
   * 拉起之前就落盘），拿它裁会把「为什么起不来」的那几行误判成历史丢掉 —— 与 launcher / dev 同口径，旧运行的行靠行内时间戳区分。 */
  if (source === "shell") {
    return { file: SHELL_CHAIN_PATHS.shellLog, resumable: false };
  }
  if (source === "shell-launch") {
    return { file: SHELL_CHAIN_PATHS.shellLaunchLog, resumable: false };
  }
  /* 启动链路日志（launcher / dev-launcher）每次运行覆盖重建，天然只有本次
   * 内容，不需要会话起点；切片规则一致。 */
  return { file: await resolveCurrentLog(source), resumable: false };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "dev-launcher";
  const requestedOffset = Number(searchParams.get("offset") ?? "0");
  /* 客户端上一轮看到的服务端进程标识：与本响应不一致 = 中间发生过一次真正的
   * 服务端重启（或另一实例接管了端口）。面板据此重置游标与时间线，而不是把
   * 新旧两个进程的输出混成一条线（ISSUE #360：重启前后日志互相污染）。 */
  const clientBootId = searchParams.get("bootId") ?? "";
  const bootId = getServerBootId();
  const mismatch = clientBootId !== "" && clientBootId !== bootId;

  try {
    const resolved = await resolveSourceFile(source);
    if (resolved?.file === "") {
      /* 该来源本机一次也没启动过：**明确的空切片**（不是 404/500）——
       * 面板据此显示「还没有输出」，与「接口挂了」分开。 */
      return NextResponse.json({
        content: "",
        size: 0,
        offset: 0,
        sessionStart: null,
        bootId,
        mismatch,
      });
    }
    if (!resolved) {
      /* 来源暂时没有文件（如应用服务转录尚未落盘）：回一个**明确的空切片**，
       * 而不是 404/500——面板据此区分「本次运行确实还没有输出」与「接口挂了」。 */
      return NextResponse.json({
        content: "",
        size: 0,
        offset: 0,
        /* 无对应文件的来源（转录尚未落盘）：没有可累积的内容，不给起点——
         * 给了反而会让客户端去裁一条并不存在的「历史」。 */
        sessionStart: null,
        bootId,
        mismatch,
      });
    }
    return NextResponse.json(
      await readLogSlice(
        resolved.file,
        mismatch ? 0 : requestedOffset,
        bootId,
        mismatch,
        resolved.resumable,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      apiErrorBody(error, "读取当前日志失败", {
        content: "",
        size: 0,
        offset: 0,
        sessionStart: null,
        bootId,
        mismatch,
      }),
      { status: 500 },
    );
  }
}
