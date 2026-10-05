/* ── 常驻服务 runtime 日志的**落盘侧**：一次启动一份文件（Node-only）──────
 *
 * 四份 runtime 日志（comfyui / drizzle-studio / ollama / app-runtime）的写方
 * 分散在四个模块、两条链路里（Next server 与应用服务启动期）。把「本次启动该写
 * 哪一份文件」收在这里**一处**，理由与 `log-paths.ts` 是唯一路径事实来源同源：
 * 写方各自拼名字必然漂（有人写日期、有人写时分秒、有人忘掉同秒分叉），而漂开的
 * 表现是「日志列表里少了一次启动」——静默、且只在真实运行里才露头。
 *
 * ## 与会话横幅的关系
 *
 * 旧形态（固定名 + 追加，靠 `▶` 横幅认边界）的**文件名不再需要唯一**，因此横幅
 * 在这四份日志上没有消费者了：一次启动的文件天然只有一个会话的开头与结尾。
 * 写侧照旧保留（`session-banner.server.ts`）会被归类成「没人读的写法」——
 * 调用点因此一并撤掉，横幅留给 `comfyui-trace.log` 之外**真正会在一份文件里
 * 被启动多轮**的通道（当前没有：四份都在本刀覆盖内）。
 *
 * ## 分层（规范 18 §18.4）
 *
 * 本模块是 `.server.ts`（有真 IO：读目录挑不重名的名字、建目录、追加写），
 * 判据（名字形态 / 解析 / 文案）在纯模块 `runtime-log-file.ts`。调用方
 * 拿到的是一个**已绑定路径的写入器**，不必知道目录在哪、也不该自己拼。
 */

import fs from "node:fs";
import path from "node:path";

import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";
import {
  RUNTIME_LOG_SOURCES,
  legacyRuntimeLogFileName,
  parseRuntimeLogFileName,
  runtimeLogFileName,
  type RuntimeLogFileName,
  type RuntimeLogSource,
} from "~/lib/log/runtime-log-file";

/** 同秒内最多分几个名字（再往上说明时钟被写坏了，不如让判据炸出来）。 */
const MAX_ORDINAL = 100;

/**
 * 本次启动该写的文件（同一秒里已经有一份就往后排，**绝不覆盖**）。
 *
 * 不覆盖这一条是必需的：`启动 → 秒退 → 再启动` 在这四份日志上都很常见
 * （端口被占、依赖缺失、用户连点两下），覆盖会让第一次的失败现场直接消失 ——
 * 而那次恰恰是最该看的。
 */
export function allocateRuntimeLogFile(
  source: RuntimeLogSource,
  dir: string,
  at: Date,
): string {
  for (let ordinal = 1; ordinal <= MAX_ORDINAL; ordinal += 1) {
    const file = path.join(dir, runtimeLogFileName(source, at, ordinal));
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return file;
  }
  /* 同一秒里上百次启动：退到毫秒级补一个唯一名，而不是覆盖别人的现场。 */
  return path.join(dir, `${source}-${at.getTime()}.log`);
}

/** 一份 runtime 日志文件的描述（面板下拉的一项）。 */
export interface RuntimeLogFileEntry {
  /** 文件名（也是下拉的 value）。 */
  name: string;
  /** 绝对路径。 */
  file: string;
  /** 启动时刻（毫秒）；旧固定名为 null（它没有时刻）。 */
  startedAt: number | null;
}

/**
 * 列某个来源在 `log/current/services/` 下的**全部**单次文件（新→旧）。
 *
 *   - 认三种形态：本次命名、同秒分叉的 `-N`、以及迁移前的旧固定名
 *     （`<source>.log`，排在最后、`startedAt` 为 null）。旧固定名要认是因为
 *     用户盘上已有它 —— 改名迁移把历史丢掉比留着一条「更早的日志」糟得多。
 *   - 排序按名字（字典序 = 时间序），**不按 mtime**：外部拷贝、备份还原都会改
 *     mtime，而名字里的时刻是写进去的。
 */
export function listRuntimeLogFiles(
  source: RuntimeLogSource,
  dir: string = SERVICES_LOG_DIR,
): RuntimeLogFileEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    return []; // 目录还不存在（这个服务从没在本机启动过）——不是错误
  }
  const out: RuntimeLogFileEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    if (name === legacyRuntimeLogFileName(source)) {
      out.push({ name, file: path.join(dir, name), startedAt: null });
      continue;
    }
    const parsed = parseRuntimeLogFileName(name);
    if (parsed?.source !== source) continue;
    out.push({
      name,
      file: path.join(dir, name),
      startedAt: parsed.startedAt,
    });
  }
  /* 旧固定名（`startedAt: null`）永远排最前 —— 「更早」是对它的定义。 */
  return out.sort((a, b) => {
    if (a.startedAt === null && b.startedAt === null) {
      return a.name.localeCompare(b.name);
    }
    if (a.startedAt === null) return -1;
    if (b.startedAt === null) return 1;
    return a.startedAt - b.startedAt;
  });
}

/** 某个来源当前**最新**那一份（写方在「不新建、续写上一份」时用它）。 */
export function latestRuntimeLogFile(
  source: RuntimeLogSource,
  dir: string = SERVICES_LOG_DIR,
): RuntimeLogFileEntry | null {
  const all = listRuntimeLogFiles(source, dir);
  return all.length > 0 ? (all[all.length - 1] ?? null) : null;
}

/** 写入器：一行一行追加进**本次启动那一份**文件。 */
export interface RuntimeLogWriter {
  /** 落盘路径（诊断/排障要能说出来它在哪）。 */
  file: string;
  /** 追加一行（调用方给的是正文，换行与本模块的落盘把守由本模块补）。 */
  write(line: string): void;
}

/**
 * 开一次启动的写入器：挑一个不重名的文件、建目录、把句柄定下来。
 *
 * **不自己写时间戳**：行首时刻由调用方给（各来源的行格式里有 `[时刻]`，
 * 而 `app-runtime` 那一路还带 `[LEVEL] [ns]`）—— 本模块只管「写到哪一份」。
 * 于是「同一件事只有一处实现」落在**文件归属**上，行格式仍归各写方自己的契约。
 */
export function openRuntimeLogWriter(
  source: RuntimeLogSource,
  at: Date = new Date(),
  dir: string = SERVICES_LOG_DIR,
): RuntimeLogWriter {
  const file = allocateRuntimeLogFile(source, dir, at);
  try {
    /* `flag: "a"` 的第一次写就会建文件；这里显式建目录是因为 `mkdir` 的失败
     * 要自己咽掉（日志子系统绝不阻塞业务，见各县志模块的硬约束）。 */
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  } catch {
    /* 目录建不出来时后续 append 同样会失败并被咽掉 —— 退化为不写日志 */
  }
  return {
    file,
    write(line: string) {
      try {
        fs.appendFileSync(/*turbopackIgnore: true*/ file, `${line}\n`, "utf-8");
      } catch {
        /* 日志写失败绝不影响业务主流程 */
      }
    },
  };
}

/** 保留策略：每个来源最多留几份单次文件（超出的删最旧的）。 */
export const RUNTIME_LOG_KEEP_FILES = 20;

/**
 * 轮转：每个来源留最近 {@link RUNTIME_LOG_KEEP_FILES} 份，多余的删掉。
 *
 * 数据来源从「`runs/` 的保留策略」换成了这一条，因为**文件不再随运行包归档**：
 * 一次启动一份文件之后，同一个来源在一个运行包里可能有几十份（ComfyUI 被重启
 * 多次），跟着 `runs/` 走会让包体量随「服务重启次数」线性膨胀，而用户要看的
 * 永远只是最近几次。删最旧的、留最近的，与 `runs/` 那条口径同源。
 *
 * 失败静默：这是启动路径上的清理，绝不该因为它把启动拖慢或弄挂。
 */
export function pruneRuntimeLogFiles(
  dir: string = SERVICES_LOG_DIR,
  keep: number = RUNTIME_LOG_KEEP_FILES,
): number {
  let removed = 0;
  for (const source of RUNTIME_LOG_SOURCES) {
    const files = listRuntimeLogFiles(source, dir);
    for (const entry of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        fs.rmSync(/*turbopackIgnore: true*/ entry.file, { force: true });
        removed += 1;
      } catch {
        /* 单个删不掉（被占用是常见情况）不该影响别的 */
      }
    }
  }
  return removed;
}

/** 供诊断/排障：某个来源当前有几份单次文件。 */
export function countRuntimeLogFiles(
  source: RuntimeLogSource,
  dir: string = SERVICES_LOG_DIR,
): number {
  return listRuntimeLogFiles(source, dir).length;
}

/** 名字形态的再导出一层（调用方从 `.server` 拿写入器时常常也要判形态）。 */
export type { RuntimeLogFileName, RuntimeLogSource };
