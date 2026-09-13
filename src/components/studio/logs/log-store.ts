"use client";

/**
 * log-store — 日志面板全局状态单例（Zustand）。
 *
 * 规范 07 §7.4：日志状态用 Zustand 管理，不使用 React Context。
 * 多个面板（BrowserStatusBar / LogPanel）直接读取同一 store。
 *
 * ── 时间线契约（面板「按时间顺序 + 有信息量」的地基）──────────────────
 * 时间线是**合并后的单一顺序**，不是「按到达顺序堆叠」：
 *   1. 排序键是 `(time, seq)`——`time` 是每行自带的写入时刻（毫秒），
 *      `seq` 只是同一毫秒内的稳定次键（跨来源去重后按它保持确定性顺序）。
 *      此前按到达顺序堆叠，三路轮询（launcher / dev / app-runtime）并发回来时
 *      旧时刻的行会落在新时刻的行之后，面板看着像「停在原地」（ISSUE #346）。
 *   2. 同一行被多路读到（launcher 转写含 dev 输出、文件被整段重读）时按
 *      `time + level + message` 去重，不重复计入。没有这条，面板的条数与
 *      真实事件数对不上，翻页也会翻出重复内容。
 *   3. 读不到时刻的裸文本行由解析层钳到当时本地时刻，因此**不会**落到历史行
 *      之前（旧的「按解析时刻 + 只追加」写法会把它们排到末尾，破坏时间序）。
 */

import { create } from "zustand";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 面板只渲染最近这么多条日志（规范 07 §7.5 的环形缓冲上限）。 */
export const MAX_LOG_ENTRIES = 2000;

/**
 * 面板每页条数（规范 07 §7.13 的分页契约）：
 * 「显示」页与内存上限各管一段，两者不再耦合。
 */
export const LOG_PAGE_SIZE = 200;

/** 每一页（面板显示窗口）里最多保留的连续重复行数（见 dedupeRepeats）。 */
const REPEAT_FOLD_LIMIT = 5;

export interface LogEntry {
  /** nanoid-style short id */
  id: string;
  /** 日志写入时刻（毫秒）。排序、展示、会话边界判定都用它。 */
  time: number;
  level: LogLevel;
  /** Serialized message */
  message: string;
  /** Where the log came from（console / tauri / system）。 */
  source: "console" | "tauri" | "system";
  /** 文件来源：dev-launcher / launcher / 应用服务输出 / app-runtime 的文件行带此标记。 */
  origin?: "dev" | "launcher" | "app" | "app-runtime";
  /** Caller location (file:line) for console logs */
  location?: string;
  /**
   * 入库顺序：只在同一毫秒内作为稳定排序次键（时间戳相同时保持确定的先后），
   * 以及「去重后是否为新内容」的判据。
   *
   * 它**不参与**跨毫秒排序——时间线按 `time` 升序，这是面板「按时间显示」
   * 的定义本身（ISSUE #262）。
   */
  seq: number;
}

export type LogFilter = LogLevel | "all";

/**
 * 面板可筛选的来源（`all` = 全部）。
 *
 * 比 `LogEntry["origin"]` 多一个 `"console"`：面板里有**三分之一的行根本不属于
 * 任何文件来源**——浏览器 console 拦截、Tauri 事件、全局未捕获错误（它们的
 * `origin` 是 `undefined`）。此前它们只在「全部来源」下可见，选中任何一个来源
 * 都会把它们整批藏起来，而下拉里既没有它们的名字、也没有任何一处能看出
 * 「还有一批行没被任何分类覆盖」（用户反馈第 1 条：「有的日志只在全部页签才显示，
 * 这种也要有自己的分类或是归入其他分类」）。
 *
 * 因此「控制台 / 全局错误」是一个**真分类**：它有自己的计数、按它筛出这些行，
 * 且 `console + 四个文件来源 = 全部来源`（见 computeOriginCounts 的守恒契约）。
 */
export type LogOriginFilter =
  NonNullable<LogEntry["origin"]> | "console" | "all";

/**
 * 行没有文件来源（`origin` 为 undefined）时归入的桶（见 {@link LogOriginFilter}）。
 *
 * 单独取个名字而不是在各处散写 `"console"` 字面量：它就是这条归类规则的唯一
 * 事实来源，视图、计数、过滤三处都问它。
 */
export const CONSOLE_ORIGIN = "console" as const;

/** 有文件来源的行 → 它自己的来源；没有的 → 「控制台 / 全局错误」桶。 */
export function bucketOf(entry: Pick<LogEntry, "origin">): LogOriginFilter {
  return entry.origin ?? CONSOLE_ORIGIN;
}

/** 单一级别的计数表（`all` = 该范围内全部级别）。 */
export type LogLevelCounts = Record<LogLevel | "all", number>;

/** 来源 × 级别的二维计数表（`all` 键为全部来源汇总，见 computeOriginCounts）。 */
export type LogOriginCounts = Record<LogOriginFilter, LogLevelCounts>;

let entryId = 0;
function nextId() {
  entryId = (entryId + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${entryId.toString(36)}`;
}

/**
 * 入库序计数器（进程内单调递增，不随清空 / 过滤重置）。
 * 只作同一毫秒内的排序次键与去重判据；模块级而非 store state，保证
 * `clear()` / 页面重载后仍单调，否则新日志会被当成旧日志排到前面。
 */
let entrySeq = 0;
function nextSeq(): number {
  entrySeq += 1;
  return entrySeq;
}

function serializeOne(a: unknown): string {
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  if (a === undefined) return "undefined";
  if (a === null) return "null";
  if (a instanceof Error) {
    return a.stack
      ? `${a.name}: ${a.message}\n${a.stack}`
      : `${a.name}: ${a.message}`;
  }
  // Preserve stack-like strings that may come from serialized error objects.
  if (
    typeof a === "object" &&
    a !== null &&
    "stack" in a &&
    typeof (a as { stack?: unknown }).stack === "string"
  ) {
    const e = a as { name?: unknown; message?: unknown; stack: string };
    const head = typeof e.message === "string" ? e.message : JSON.stringify(a);
    return `${head}\n${e.stack}`;
  }
  try {
    return JSON.stringify(a, null, 2);
  } catch {
    if (
      typeof a === "string" ||
      typeof a === "number" ||
      typeof a === "boolean" ||
      typeof a === "bigint"
    ) {
      return String(a);
    }
    return "";
  }
}

export function serialize(args: unknown[]): string {
  return args.map(serializeOne).join(" ");
}

/**
 * 从调用栈中定位真正的业务调用方。
 * 拦截 console.* 时，栈顶是 log-store 自己的包装函数，需要跳过；
 * 再跳过 React / Next.js / Tauri 等框架/编译产物帧，返回第一个**能映射回项目源码**
 * 的业务位置（即以 .ts/.tsx 结尾的 source-map 帧）。
 *
 * 只认 source-map 帧的原因：Next/webpack/Turbopack 在 dev 期把用户代码 source-map 到
 * `.tsx/.ts`；而框架自身的 console 输出来自被压缩/哈希的编译 chunk（形如
 * `src/00vplg9./.js:1879`）。这类位置对用户没有可读含义——它们并非业务代码打印的。
 * 与其展示一串看不出由来的哈希 chunk 路径，不如不展示（返回 undefined，行上不出现位置列）。
 */
export function captureLocation(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const loggerSelfRe = /log-(?:store|provider)\.(tsx|ts|jsx|js)/;
    const frameworkRe =
      /node_modules|react-dom|react\.production|react\.development|next\/(?:dist|server|client)|@tauri-apps|scheduler|webpack[\/](?:runtime|bootstrap)|\[native code\]/i;
    // 项目源码以 TS 编写；dev 期只有映射回 .ts/.tsx 的帧才算"可读业务位置"。
    const sourceRe = /\.(?:tsx?|mts|cts)$/i;

    const lines = stack.split("\n");
    for (let pass = 0; pass < 2; pass++) {
      for (const raw of lines) {
        const line = raw.trim();
        if (!line?.startsWith("at ")) continue;
        if (loggerSelfRe.test(line)) continue;
        if (pass === 0 && frameworkRe.test(line)) continue;

        // 取 frame 中的位置部分：优先用最后一个 (...) 里的内容，否则取整行
        const parenMatch = /\(([^)]+)\)\s*$/.exec(line);
        const loc = parenMatch ? parenMatch[1] : line.replace(/^at\s+/, "");
        if (!loc) continue;

        // 位置段末尾一定是 :line:col，取最后两个冒号分割
        const lastColon = loc.lastIndexOf(":");
        if (lastColon <= 0) continue;
        const secondLastColon = loc.lastIndexOf(":", lastColon - 1);
        const lineNo =
          secondLastColon >= 0
            ? loc.slice(secondLastColon + 1, lastColon)
            : loc.slice(lastColon + 1);
        let path =
          secondLastColon >= 0
            ? loc.slice(0, secondLastColon)
            : loc.slice(0, lastColon);

        // 清理常见前缀 / 协议
        path = path.replace(/^webpack-internal:\/\/\/\.\//, "");
        path = path.replace(/^webpack-internal:\/+/i, "");
        path = path.replace(/^file:\/\/\//, "");
        path = path.replace(/^https?:\/\/[^/]+\/_next\/static\/chunks\//, "");
        path = path.replace(/^https?:\/\/[^/]+\//, "");

        // Turbopack / 某些 webpack source-map 配置会把模块路径里的 "/" 编码为 "_"，
        // 形成 "src_components_studio_15hhqk_logs_log-store.ts" 这种标识符。
        // 在肉眼可读性层面把它还原（heuristic：以 src_ 开头且没有 "/"）。
        if (!path.includes("/") && path.startsWith("src_")) {
          path = path.replace(/_/g, "/");
        }

        // 取 /src/ 之后的路径作为最简可读形式
        const srcIdx = path.indexOf("/src/");
        if (srcIdx !== -1) path = path.slice(srcIdx + 1);

        // 只展示能映射回项目源码（.ts/.tsx 系）的位置；编译 chunk（.js/.mjs）或
        // 框架内部帧看不懂也无需展示——继续向下找真正的业务帧，找不到就返回 undefined。
        if (
          path &&
          sourceRe.test(path) &&
          /^\d+$/.test(lineNo) &&
          !/^\d+$/.test(path)
        ) {
          return `${path}:${lineNo}`;
        }
      }
    }
  } catch {
    // 解析失败不应影响日志记录
  }
  return undefined;
}

/**
 * 过滤 tRPC loggerLink / React Query 内部追踪日志。
 *
 * tRPC 客户端在 dev 模式通过 loggerLink 把每次调用打成 console 日志，形如
 * `%c<< mutation #43 %cworkflow.update` 或 `%c>> query #1 ...`。这些日志随
 * 组件重渲染与保存操作大量产生，会淹没真正的业务日志；但 LoggerLink 对网络排错
 * 本身有价值（保留在 console），只是不写进日志面板。因此这里仅做面板侧丢弃。
 *
 * 同时兜底 tRPC 在 mutation 落库/重排后重新包装的塌缩形态（形如
 * `[[ << mutation #43 ]workflow.update {}`），它会被 React devtools 以
 * "Console Error" 形式从 LogProvider 转发帧抛到面板，同样属于无害框架噪音。
 */
export function isReactQueryLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  // 标准形态：tRPC loggerLink 的格式串 + 逐帧样式参数，args[0] 即为追踪签名。
  // 真实追踪至少两个参数（格式串 + 样式），单参数的不是追踪，避免误吞业务文案。
  if (args.length >= 2) {
    const first = args[0];
    if (
      typeof first === "string" &&
      /^\s*%c\s*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(first)
    )
      return true;
  }
  // 塌缩/重包装形态：loggerLink 的 %c 样式与逐帧参数被 React devtools 吞并，
  // 合并成带 "[[" 前缀的单串（形如 `[[ << mutation #43 ]workflow.update {}`），
  // 并经由 LogProvider 转发帧以 "Console Error" 冒到面板。同属无害框架噪音。
  const text = serialize(args);
  return /^[\s\[]*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(text);
}

/**
 * 过滤已知的、无害的框架/运行时噪音，避免它们淹没业务日志。
 * 典型例子：Tauri v2 在 Windows WebView2 上 IPC custom protocol fetch 失败时
 * 会自动降级到 postMessage，并打印一条 warn。这是正常行为，不影响功能。
 */
export function isNoisyFrameworkLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  return /IPC custom protocol failed|Tauri will now use the postMessage interface/i.test(
    text,
  );
}

/**
 * 过滤 Next.js dev 自身的开发提示，避免它们以"业务 info 日志"身份进面板。
 * 典型例子：热更新完成时 Next dev 在浏览器 console 打印 `[Fast Refresh] done in
 * XXXXms`，它来自框架的 dev chunk（source-map 只到压缩后的哈希模块，形如
 * `src/00vplg9./.js`），并非任何业务代码打印，也没有可读的调用位置。
 * 与其它框架噪音一致：保留在浏览器 console（降为 debug），只不入面板。
 */
export function isNextDevNoise(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  return /\[Fast\s*Refresh\]\s*(?:done|finished)?.*\d+\s*ms/i.test(text);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(ts: number, opts?: { alwaysDate?: boolean }): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  if (opts?.alwaysDate || !isSameDay(d, new Date())) {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${month}-${day} ${time}`;
  }
  return time;
}

/* 启动链路行的形态（dev-launcher 的 Transcript 是「裸文本 + 缩进」的混合体）：
 *
 *   "[10:22:24] [INFO ] 预检通过"                    ← 级别标记带填充空格（PadRight 5）
 *   "[10:22:25] [STEP] 检查端口占用"                 ← 标准形态
 *   "  [10:22:24] [INFO ] 未检测到 .env 配置文件。"     ← 缩进两格的续行
 *   "  [10:22:24] [ERROR] 启动失败："                   ← 同上
 *   "[10:22:30] [[OK] 服务器已就绪"                   ← 颜色码残缺留下的多余 `[`
 *
 * 三条口径缺一不可，否则整行会掉进裸文本兜底、以 "[HH:mm:ss] [LEVEL]" 原文
 * 显示在面板上（ISSUE #262 六审：用户读到的就是「启动 / 启动器两项还是没有
 * 日志内容」——行其实抓到了，只是没被认成日志行）：
 *   1. 级别标记容错：`\[` + 可选残码 + 可选空白 + 级别 + 可选空白 + 可选残码 + `]`。
 *      PowerShell 的 `PadRight(5)` 会给 INFO / STEP / OK 补尾空格，严格的
 *      `\[INFO\]` 匹配不到；颜色码残缺时 `[` 后还会多留一段假转义（`[[90m[OK`）；
 *   2. 行首允许**缩进**（`\s*`）—— dev-launcher 的引导文案与错误详情是缩进
 *      两格的续行，且同样带完整的时刻 + 级别前缀，不该当成另一种形态；
 *   3. 只认这六个级别名（`STEP` / `OK` / `INFO` / `WARN` / `ERROR` / `DEBUG`）——
 *      容错只放宽「级别周围」，不放过 `[rpc]` / `[system]` 这类普通前缀词。
 *
 * 时刻仍限 `HH:mm:ss`（带日期的行由下面两条更具体的规则接管）；级别名大小写
 * 不敏感，与 app-runtime / launcher 转录的宽松口径一致。 */
const LOG_LINE_RE =
  /^\s*\[(\d{2}):(\d{2}):(\d{2})\]\s*\[\[?[0-9;]*m?\[?\s*(STEP|OK|INFO|WARN|ERROR|DEBUG)\s*\[?[0-9;]*m?\]\s*(.*)$/;
const LAUNCHER_LOG_RE =
  /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;
const APP_RUNTIME_LOG_RE =
  /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*\[(INFO|WARN|ERROR|DEBUG)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/;

/**
 * 过滤常规 tRPC/RPC 调用计时日志（#294）。
 *
 * 形如 `[rpc] setting.dbStudioStatus 155ms {"type":"query"}` / `[trpc] generate.generate
 * 25ms {"type":"query"}` 的行来自 tRPC 中间件的调用计时（历史上每次 query/mutation
 * 都写一条），正常调用每几秒就刷一整屏，把真正的业务/警告日志冲走。
 * 「有问题的调用」（失败 error、超过慢查询阈值的 warn）必须保留——它们的消息
 * 带「失败」字样或级别本身是 warn/error，不会命中这里的"常规 info 计时"判定。
 */
export function isRoutineRpcTimingLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  const body = text
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\]?|\])\s*/i, "");
  return /^\S+\s+\d+ms(\s*\{.*\})?$/i.test(body);
}

/** 文件转录行（app-runtime / launcher）侧的同规则过滤：返回 true 表示不进面板。 */
export function isRoutineRpcTimingLine(line: string): boolean {
  const m = APP_RUNTIME_LOG_RE.exec(line);
  const text = m ? (m[10] ?? "") : line;
  const level = m ? (m[8] ?? "").toUpperCase() : "";
  // 失败 / 慢查询（error/warn 级别）永远保留
  if (level === "WARN" || level === "ERROR") return false;
  // 行格式两种来源：app-runtime 行的 text 已被 APP_RUNTIME_LOG_RE 拆掉 [ns]
  // 前缀；launcher 转录整行原文可能带 [rpc] / rpc] 前缀。先剥前缀再测正文。
  const body = text
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\]?|\])\s*/i, "");
  return /^\S+\s+\d+ms(\s*\{.*\})?$/i.test(body);
}

function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "error":
      return "error";
    case "warn":
    case "warning":
      return "warn";
    case "debug":
      return "debug";
    default:
      return "info";
  }
}

/**
 * 匹配 Next.js dev 的 `[Fast Refresh] rebuilding` 转录行。
 * 它由框架打进 launcher/dev 转录（无业务含义），但行内常携带上一条编译
 * 错误的级别标记（形如 `[INFO] [Fast Refresh] rebuilding [ERROR] ...`），
 * 按级别正则会整行落成 error——看起来像应用出错，实际只是热更新进行中。
 * 与 isNextDevNoise（浏览器 console 侧过滤）互补：这条处理文件转录侧。
 */
const FAST_REFRESH_REBUILD_RE =
  /\[Fast\s*Refresh\]\s*rebuilding(?:\s*\[(?:ERROR|WARN|DEBUG)\])?/i;

export function parseFileLogs(
  text: string,
  baseDate?: Date,
  origin?: LogEntry["origin"],
): LogEntry[] {
  /*
   * 读不到时刻时的兜底：baseDate 是**这批内容所属的日期**（默认今天），时刻取
   * 解析当时的本地时间。这样裸文本行落在「现在」，不会因为时间戳缺失被排到
   * 时间线开头（用 00:00:00 会），与「时间线按 time 升序」的契约相容。
   */
  const now = Date.now();
  const today = baseDate ?? new Date();
  const entries: LogEntry[] = [];
  let seq = nextSeq();
  const push = (entry: Omit<LogEntry, "seq">) => {
    entries.push({ ...entry, seq: seq++ });
  };
  for (const rawLine of text.split("\n")) {
    // Strip ANSI SGR (e.g. \x1b[36m) that the launcher now writes into the
    // transcript, so the [HH:mm:ss] [LEVEL] regex still matches cleanly.
    // 颜色码残缺（\x1b 丢失、只剩 `[90m` / `[0m`）时它们会留在正文里，按 SGR
    // 的形状整段剥掉，免得面板上出现 `[[OK] 【[90m[OK[0m] …` 这类双份级别标记。
    const line = rawLine
      .replace(/\r$/, "")
      .replace(/\x1b\[[0-9;:]*m/g, "")
      .replace(/\[[0-9;:]*m/g, "");
    if (!line.trim()) continue;
    // 常规 tRPC/RPC 调用计时行（如 `[rpc] xxx 155ms {"type":"query"}`）不进面板：
    // 正常调用高频产生会刷屏（#294）；失败/慢查询（error/warn 级别）仍保留。
    if (isRoutineRpcTimingLine(line)) continue;
    const m = LOG_LINE_RE.exec(line);
    if (m) {
      const [, hh, mm, ss, lv, msg] = m;
      const d = new Date(today);
      d.setHours(Number(hh ?? "0"), Number(mm ?? "0"), Number(ss ?? "0"), 0);
      push({
        id: nextId(),
        time: d.getTime(),
        level: parseLogLevel(lv ?? "INFO"),
        message: msg ?? "",
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    const am = APP_RUNTIME_LOG_RE.exec(line);
    if (am) {
      const [, year, month, day, hh, mm, ss, ms, lv, ns, msg] = am;
      const d = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hh),
        Number(mm),
        Number(ss),
        Number(ms),
      );
      const nsTag = ns ? `[${ns}] ` : "";
      const msgText = nsTag + (msg ?? "");
      push({
        id: nextId(),
        time: d.getTime(),
        // Fast Refresh 进行中若沾染上一条错误的级别标记，按 info 落板
        level: FAST_REFRESH_REBUILD_RE.test(msgText)
          ? "info"
          : parseLogLevel(lv ?? "INFO"),
        message: msgText,
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    const lm = LAUNCHER_LOG_RE.exec(line);
    if (lm) {
      const [, year, month, day, hh, mm, ss, ms, msg] = lm;
      const d = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hh),
        Number(mm),
        Number(ss),
        Number(ms),
      );
      push({
        id: nextId(),
        time: d.getTime(),
        level: "info",
        message: msg ?? "",
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    push({
      id: nextId(),
      time: now,
      level: "info",
      message: line,
      source: "system",
      ...(origin ? { origin } : {}),
    });
  }
  return entries;
}

/** 行身份：同一行被多路读到（launcher 转写含 dev 输出）时据此去重。 */
function entryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${entry.time}\u0000${entry.level}\u0000${entry.message}`;
}

/**
 * 把新条目并进时间线：**按时刻排序 + 跨来源去重**，然后只保留最近 MAX_LOG_ENTRIES 条。
 *
 * - 排序键 `(time, seq)`：`time` 来自行内的写入时刻；`seq` 只在同一毫秒内决定
 *   先后（三路轮询并发到达，同毫秒内按到达顺序保持稳定即可）。
 * - 去重：与已有条目 key 相同的新条目直接丢弃。dev-launcher 转写会包含 dev
 *   输出、文件被整段重读也会重复送来同一批行，没有这一步面板条数与真实事件数
 *   就对不上（翻页还会翻出重复内容）。
 * - 上限只裁**最旧**的条目：内存占用有界，且「显示多少条」由分页决定，
 *   不再等于内存上限（ISSUE #262：面板本该能翻页看更多，却卡在 2000 条）。
 */
export function mergeTimeline(
  current: LogEntry[],
  fresh: LogEntry[],
  max = MAX_LOG_ENTRIES,
): LogEntry[] {
  if (fresh.length === 0) return current;
  const seen = new Set(current.map(entryKey));
  const added: LogEntry[] = [];
  for (const entry of fresh) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(entry);
  }
  if (added.length === 0) return current;
  const merged = current.length === 0 ? added.slice() : [...current, ...added];
  merged.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** 时间线的**真实**末条（最新一条）——「已读水位」「有无新内容」「跳最新」都用它。 */
export function lastSeqOf(logs: LogEntry[]): number {
  return logs[logs.length - 1]?.seq ?? 0;
}

/**
 * 哪些来源的文件**跨运行累积**，因此需要会话起点把它们裁到本次运行。
 *
 * 这是客户端与服务端共享的一条事实（服务端 `resumable` 分支从同一原则推导），
 * 所以单独列出来而不是散在判据里：
 *   - `app-runtime`：**追加写、不轮转**，文件里混着前几次运行的行——只能靠
 *     行时刻裁（见 §7.14）；
 *   - `app`（nextjs-panel-<pid>-<ts>.log）：文件名按进程命名，但服务端取的是
 *     「目录里最新的那一份」，在本次进程还没落盘时会**读到上一个进程的文件**，
 *     因此同样要裁；
 *   - `launcher`（start-tauri-launcher.log）/ `dev`（dev-launcher.log）：
 *     每次运行**覆盖重建**，文件内容天然只有本次——它们**不需要**裁。
 *
 * 为什么必须逐来源判定、而不能拿一个全局 cutoff 往整条时间线上套：
 * 会话起点取自 `dev-launcher.log` 的 mtime，而**启动器的头几行写在它被创建
 * 之前**（python 版本、exe、cwd、探测 Node…）。用一个全局 cutoff 一刀切，
 * 这些真·本次运行的行会被当成历史丢掉——用户读到的就是「启动和启动器日志
 * 丢失」（ISSUE #262 复审）。覆盖重建的来源不存在「历史行」，因此不参与裁剪。
 */
const SESSION_SCOPED_ORIGINS = new Set<NonNullable<LogEntry["origin"]>>([
  "app-runtime",
  "app",
]);

/**
 * 该来源的文件是否跨运行累积、需要会话起点裁剪（契约判据，可独立断言）。
 *
 * 留成导出函数是为了让「哪类来源该裁」这条契约有唯一事实来源：视图/store 与
 * 测试都问它，而不是各自抄一份字符串判断。
 */
export function isSessionScopedOrigin(
  origin: LogEntry["origin"] | undefined,
): boolean {
  return origin !== undefined && SESSION_SCOPED_ORIGINS.has(origin);
}

/**
 * 会话起点过滤：丢掉「上一次运行」残留的行。
 *
 * 只有 {@link isSessionScopedOrigin} 判为跨运行累积的来源才参与比较——文件每次
 * 运行覆盖重建的来源（launcher / dev / app）与运行期生成的条目（console / tauri /
 * system）一律保留：
 *   - 前者内容天然只有本次，拿起点去裁只会把「本次启动早期」的行误判成历史；
 *   - 后者的时刻是「现在」，永远不会早于起点。
 *
 * 行时刻早于会话起点即判为历史。读不出时刻的裸文本行（`time` 取解析当时的时刻）
 * 天然不会早于起点，保留。
 *
 * @param cutoffMs 会话起点（毫秒）；null/undefined = 不启用该过滤
 */
export function dropStaleEntries(
  entries: LogEntry[],
  cutoffMs: number | null | undefined,
): LogEntry[] {
  if (cutoffMs === null || cutoffMs === undefined) return entries;
  return entries.filter(
    (entry) => !isSessionScopedOrigin(entry.origin) || entry.time >= cutoffMs,
  );
}

/**
 * 渲染前折叠连续重复行：同一页里连续 N 条内容完全相同的行压缩成一条
 * `…（重复 N 次）`，只保留前 REPEAT_FOLD_LIMIT 条。
 *
 * 为什么必须有这一步：面板里最常见的「没信息量」形态不是长度，而是**重复**——
 * 同一路轮询每轮写一条同样的慢查询 / 重连提示，一屏就被刷满，用户看不到别的
 * （ISSUE #262）。写入侧已经按时间桶聚合了一次（§7.14.1），这里是视图侧的最后
 * 一道保险：只影响显示，不改动时间线本身。
 *
 * 只折叠**连续**重复（按相邻位置），不按键全局分组——跨距离的相同行之间隔着
 * 别的事件，合并它们会把时间线读成「同一个事件发生了 N 次」，那是错的。
 */
export function dedupeRepeats(
  entries: LogEntry[],
  limit = REPEAT_FOLD_LIMIT,
): LogEntry[] {
  /* 折叠键只看「级别 + 内容」，不看时刻：每轮轮询写出来的重复行时刻必然不同，
   * 带上时刻就一条也折叠不了。跨来源去重看时刻（entryKey），这里看语义。 */
  const foldKey = (entry: LogEntry) => `${entry.level}\u0000${entry.message}`;
  const out: LogEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const first = entries[i]!;
    let run = 1;
    while (
      i + run < entries.length &&
      foldKey(entries[i + run]!) === foldKey(first)
    ) {
      run += 1;
    }
    if (run <= limit) {
      out.push(first);
      i += 1;
      continue;
    }
    for (let k = 0; k < limit; k += 1) out.push(entries[i + k]!);
    out.push({
      ...first,
      id: `${first.id}-repeat`,
      message: `…（以上内容连续重复 ${run - limit} 次）`,
    });
    i += run;
  }
  return out;
}

/**
 * 单行日志 → 可复制的文本（**唯一口径**：行的复制按钮与「复制全部日志」共用）。
 *
 * 时刻取**全日期**（`MM-DD HH:mm:ss.mmm`）而不是行首显示的那一截：面板上同一天
 * 的行只显示时分秒，但复制出去的文本会离开面板的上下文（贴进 issue、发给人看），
 * 没有日期就说不清是哪天的事。
 */
export function formatEntryForClipboard(entry: LogEntry): string {
  return `${formatTime(entry.time, { alwaysDate: true })} [${entry.level.toUpperCase()}] ${entry.message}`;
}

function formatForClipboard(entries: LogEntry[]): string {
  return entries.map(formatEntryForClipboard).join("\n");
}

function zeroCounts(): LogLevelCounts {
  return { all: 0, debug: 0, info: 0, warn: 0, error: 0 };
}

function computeCounts(logs: LogEntry[], search = ""): LogLevelCounts {
  const base = zeroCounts();
  for (const entry of logs) {
    if (!matchesSearch(entry, search)) continue;
    base.all++;
    base[entry.level]++;
  }
  return base;
}

/**
 * 来源 × 级别的二维计数表（`all` = 全部来源）。
 *
 * 面板此前**只有一个总数**：级别筛选行上的数字是全部来源的合计，来源下拉里
 * 只有名字没有数。于是「看着警告有 974 条，切到启动器却什么都没有」——
 * 那 974 条全在别处，而界面没有任何地方能看出来（ISSUE #360 的第二张图）。
 *
 * 契约：
 * - **key 是筛选值本身**：`"all"` + 四个级别，与 `LogFilter` 一一对应，视图直接
 *   `countsByOrigin[origin][level]` 取值，不需要在视图里再换算；
 * - **逐来源独立**：`countsByOrigin.launcher.warn` 只数 `origin === "launcher"`
 *   的行，`countsByOrigin.all` 才是全量；
 * - **不搜也能看，搜了就跟着收窄**：计数是「当前界面上能选到什么」的口径，因此
 *   与 `computeFiltered` 共用同一个 `matchesSearch`——搜索时会点中哪些行，计数上
 *   就显示几。两处若各写一套匹配规则，会出现「左边写着警告 2、切过去只剩 1」，
 *   比不显示数字更让人怀疑面板（ISSUE #360 的同一类问题）。
 */
export function computeOriginCounts(
  logs: LogEntry[],
  search = "",
): LogOriginCounts {
  const table: LogOriginCounts = {
    all: zeroCounts(),
    dev: zeroCounts(),
    launcher: zeroCounts(),
    app: zeroCounts(),
    "app-runtime": zeroCounts(),
    [CONSOLE_ORIGIN]: zeroCounts(),
  };

  for (const entry of logs) {
    if (!matchesSearch(entry, search)) continue;
    table.all.all += 1;
    table.all[entry.level] += 1;
    /* 逐来源独立计数（ISSUE #360），且**每个来源都必须有一个桶**：
     * 无 origin 的行（console 拦截 / Tauri 事件 / 全局错误）归 `console`，
     * 有 origin 的归它自己。于是「console + 四个文件来源 = 全部来源」这条
     * 守恒关系恒成立——下拉里的分类加起来就是「全部来源」，不会再出现
     * 「只在全部页签才显示、哪个分类都进不去」的行（ISSUE #262 六审）。 */
    const bucket = table[bucketOf(entry)];
    if (!bucket) continue;
    bucket.all += 1;
    bucket[entry.level] += 1;
  }
  return table;
}

/**
 * 搜索命中判据（唯一事实）：面板的过滤与各处计数都走这里，两边口径不会漂移
 * ——「按钮上写着 2、切过去只剩 1」正是口径分叉的产物。
 */
function matchesSearch(entry: LogEntry, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.message.toLowerCase().includes(needle) ||
    entry.location?.toLowerCase().includes(needle) === true
  );
}

function computeFiltered(
  logs: LogEntry[],
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
): LogEntry[] {
  return logs.filter((entry) => {
    const levelOk = filter === "all" || entry.level === filter;
    /* 过滤与计数共用 `bucketOf`：两处各写一份判据必然漂移，而漂移的表现正是
     * 「下拉上写着 5 条、切过去只有 3 条」这类不再可信的数字（ISSUE #360）。 */
    const originOk = origin === "all" || bucketOf(entry) === origin;
    return levelOk && originOk && matchesSearch(entry, search);
  });
}

function welcomeEntry(): LogEntry {
  return {
    id: nextId(),
    seq: nextSeq(),
    time: Date.now(),
    level: "info",
    message: "日志面板已启用。按 Ctrl+Shift+L 或点击状态栏日志按钮打开/关闭。",
    source: "system",
  };
}

export interface LogStoreState {
  logs: LogEntry[];
  filteredLogs: LogEntry[];
  filter: LogFilter;
  /** 来源筛选（#262：启动日志与应用运行日志混在一屏，需要能分开看）。 */
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  counts: LogLevelCounts;
  /**
   * 每个来源各自的级别计数（含 `all` 汇总）：面板在级别按钮与来源下拉上各显示
   * 一份，用户不必先切来源才知道那边有几个警告（见 computeOriginCounts）。
   */
  countsByOrigin: LogOriginCounts;
  /**
   * 面板渲染一帧所需的全部状态（见 {@link LogPanelSlice}）。
   *
   * 它随时间线或筛选状态变化而整体重建，面板只订阅这一个字段。视图层因此不必
   * 自己拼装状态、也就不会出现「某条写入路径忘了带视图状态」的漏项——那正是
   * 「来源切了、计数还停在切之前」这类 bug 的来源。
   */
  header: LogPanelSlice;
  /** 翻页：当前页（1 起，倒序查看，1 = 最新一页）与每页条数。 */
  page: number;
  pageSize: number;
  /**
   * 本次运行的开始时间（毫秒）；null = 未知（非 launcher 启动）。
   * 面板只显示本次运行：行时刻早于它即上一次运行的残留（见 dropStaleEntries）。
   */
  sessionStart: number | null;
  /**
   * 当前提供日志的服务端进程标识（bootId）。
   *
   * 它回答的是「这条日志是哪个应用服务进程写的」：进程重启（或另一实例接管
   * 端口）后 bootId 变化，面板据此**清空时间线并重读**，而不是把两个进程的
   * 输出混成一条线。面板页脚展示它，用户报障时能说清自己连的是哪个进程
   * （ISSUE #360：「应用服务为什么没启动」现场没有任何可引用的标识）。
   */
  bootId: string | null;
  /**
   * 生成 `logs` 切片的生成号（每次时间线变化 +1）。
   *
   * 它是「store 有没有新日志」的判据，而不是时间线末条 seq：时间线按时刻排序，
   * 一条**迟到但时刻更早**的行会插进中间、末条不变——只看末条会漏掉这种新增。
   */
  revision: number;
  /**
   * 「已翻过去的历史」：翻到这一页那一刻，窗口之后本来就有多少条。
   *
   * 页脚「有 N 条新的日志」= 窗口之后的条数 − 它（见 selectNewLogCount）——
   * 否则停在第 2 页会一开口就报「有 200 条新的日志」，而那 200 条是用户自己
   * 翻过去的。第 1 页恒为 0。
   */
  viewBaselineAfter: number;
  /**
   * 「已读水位」：翻到历史位置那一刻**已经看到**的条目。
   *
   * 它是投影计数（`selectNewLogCount`）的输入，回答「我看到的之后又来了几条」。
   * 同时也决定贴底时滚动到哪里（见 LogPanel 的贴底基线）——两者用同一份水位，
   * 所以「面板说有几条新的」与「实际滚到哪」永远不会各说各话。
   */
  viewSeenIds: ReadonlySet<string>;
  /**
   * 「贴底基线」：面板开着且用户贴着底看时，**只追到这里**。
   *
   * 它是「日志一直在动、选不中想复制的那一行」的根治点（ISSUE #262 复审）：
   * 面板此前用「内容一变就滚到 `scrollHeight`」贴底，而日志每 2s 轮询一次、
   * 上限 2000 条时几乎每轮都有新行——于是内容每两秒整体上移一次，用户刚框住的
   * 文本立刻被滚动冲掉。现在贴底只追到「面板开着那一刻已看过的最后一条」，
   * 新行在下面**默默累积**（页脚同时给出「有 N 条新的日志 · 回到最新」出口），
   * 看不看、什么时候看由用户决定。
   *
   * 它与「已读水位」（`viewSeenIds`）是同一份东西的两种用途：水位决定**滚到哪**
   * 与**报几条新的**，因此两处永远不会互相矛盾。
   */
  followBaseline: number;
  /**
   * 用户主动按下「回到最新」的时刻；此后贴底直接追到最新，不再受
   * {@link followBaseline} 约束。
   */
  followResetAt: number;
  /**
   * 「已读水位」的生成号：翻到历史页那一刻的 `revision`。
   *
   * 判据是 `revision` 变化（时间线真的变过）而不是「末条变了」：按时刻排序后，
   * 一条**迟到的旧时刻行**会插进中间、末条不动——只看末条会漏掉这类新增
   * （ISSUE #346）。
   *
   * ⚠️ 时间线被环形缓冲截断时 `revision` **不推进**（见 appendFileLogs）：
   * 截断没有让任何一条真正的新日志落板，而推进它会把下面这条推论的循环打断——
   * 「revision 变过 → 有新内容 → 重新取水位」，那会让面板把**每两秒一次的
   * 新日志**都当成用户已经读过（水位被反复刷到最新），页脚于是永远报不出
   * 「有 N 条新的日志」（ISSUE #262 复审：翻页翻不动、提示不出现）。
   */
  viewRevision: number;
  /**
   * 第 1 页窗口的**锚点**：用户「正在看的那一段」的头一条 id（null = 不锚定）。
   *
   * 为什么需要它：第 1 页取的是时间线的**尾部 200 条**。日志每 2s 轮询一次，
   * 每来一条新行，这 200 条的窗口就整体前移一格——React 会卸载掉最上面那一条、
   * 挂上新的最末一条。用户刚在顶部某一行里框住的文本**随节点一起被卸载**，选区
   * 于是消失（ISSUE #262 复审：「刚选择就刷新把我的选择弄没了」，在真实浏览器里
   * 实测到的正是这条）。
   *
   * 锚定之后，「用户看过的那一段」钉在原地、新行列在它**之后**：DOM 节点不重建，
   * 选区自然不会被冲掉；想追最新也可以亲手往下滚。
   *
   * 重取时机（= 用户「转到最新」）：打开面板 / 点「回到最新」 / 换页 / 切筛选 /
   * 搜索 / 用户自己滚到底部。
   */
  anchorId: string | null;
  /**
   * 贴底看最新（true，默认）：面板停在「已看过的最新一条」处，新日志在下面累积。
   * false = 用户手动上滚离开了底部，或自己关掉了自动滚动。
   *
   * 它同时决定页脚「回到最新」出口是否出现（selectShouldPinToLatest），
   * 因此必须与 {@link LogStoreState.setFollowBottom} 一起看在 store 里——
   * 视图只读它，不再各存一份。
   */
  autoScroll: boolean;
  /** 用户滚到底部/离开底部时由视图上报（见 setFollowBottom）。 */
  setFollowBottom: (follow: boolean) => void;
  /** 用户点击「回到最新」：解绑贴底基线并回到第 1 页（见 jumpToLatest）。 */
  jumpToLatest: () => void;
  addEntry: (entry: Omit<LogEntry, "id" | "time" | "seq">) => void;
  appendFileLogs: (entries: LogEntry[]) => void;
  setSessionStart: (sessionStart: number | null) => void;
  /** 记录当前服务端进程标识；变化时清掉时间线（跨进程的行不可比）。 */
  setBootId: (bootId: string | null) => void;
  setFilter: (f: LogFilter) => void;
  setOrigin: (o: LogOriginFilter) => void;
  setSearch: (s: string) => void;
  setPage: (page: number) => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  copyAll: () => Promise<void>;
  download: () => void;
}

/** 面板渲染一帧需要的全部状态（`LogPanelState` 的别称，视图侧更短的写法）。 */
export type LogPanelState = LogStoreState;

/**
 * 面板状态切片（`LogPanel()` 内部那个 `useLogPanel(state => state.panel)`）。
 *
 * 面板订阅的是**状态本身**：store 只在时间线/筛选真正变化时才重建这些对象，
 * 因此选它不会引入逐帧比较。这样写而不是在视图里用 `useShallow` 现拼对象，
 * 是为了让「面板读哪些状态」这件事只写一遍、只在一个文件里（视图层零状态拼装）。
 */
export interface LogPanelSlice {
  filteredLogs: LogEntry[];
  filter: LogFilter;
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  counts: LogLevelCounts;
  countsByOrigin: LogOriginCounts;
  page: number;
  pageSize: number;
  bootId: string | null;
  /** 贴底看最新（见 {@link LogStoreState.autoScroll}）。 */
  autoScroll: boolean;
  /** 第 1 页窗口的锚点（见 {@link LogStoreState.anchorId}）。 */
  anchorId: string | null;
  /** 「已翻过去的历史」条数（见 {@link LogStoreState.viewBaselineAfter}）。 */
  viewBaselineAfter: number;
}

/**
 * 派生出「时间线 + 计数 + 过滤结果」这三件随时间线走的东西。
 *
 * 不碰视图状态（当前页 / 已读水位 / 来源 / 级别 / 搜索）——那些由
 * {@link applyView} 收口，保证 `header` 切片永远反映的是**写入之后**的状态，
 * 而不是写入前那一份。
 */
function derive(
  logs: LogEntry[],
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
  revision: number,
) {
  return {
    logs,
    counts: computeCounts(logs, search),
    countsByOrigin: computeOriginCounts(logs, search),
    filteredLogs: computeFiltered(logs, filter, search, origin),
    revision,
  };
}

/** 从当前状态里摘出视图那几项（`applyView` 的入参形状）。 */
function viewOf(state: LogStoreState): LogPanelView {
  return {
    filter: state.filter,
    origin: state.origin,
    search: state.search,
    isOpen: state.isOpen,
    page: state.page,
    pageSize: state.pageSize,
    bootId: state.bootId,
    autoScroll: state.autoScroll,
    anchorId: state.anchorId,
    viewBaselineAfter: state.viewBaselineAfter,
  };
}

/** 视图状态（筛选条件 + 页码 + 收缩状态），`applyView` 的入参。 */
interface LogPanelView {
  filter: LogFilter;
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  page: number;
  pageSize: number;
  bootId: string | null;
  autoScroll: boolean;
  anchorId: string | null;
  viewBaselineAfter: number;
}

/**
 * 把视图状态与派生字段合成一次 `set` 的载荷。
 *
 * 面板订阅的状态切片（`header`）必须是**写入之后**的状态：`set` 的浅合并不会
 * 回头替我们重算切片，若某条写入路径忘了带上它，面板上就是「来源已经切了、
 * 计数还停在切之前」。所有改视图状态的路径都从这里出去，这一条就不会漏。
 *
 * `filteredLogs` 按**合并后的视图**重算（几百毫秒才变一次的时间线上，这点开销
 * 换「少一个会漂移的中间量」是划算的）；`page` 由调用方先钳好再传进来。
 */
function applyView(derived: ReturnType<typeof derive>, view: LogPanelView) {
  const filteredLogs = computeFiltered(
    derived.logs,
    view.filter,
    view.search,
    view.origin,
  );
  return {
    ...derived,
    ...view,
    filteredLogs,
    header: {
      filteredLogs,
      filter: view.filter,
      origin: view.origin,
      search: view.search,
      isOpen: view.isOpen,
      counts: derived.counts,
      countsByOrigin: derived.countsByOrigin,
      page: view.page,
      pageSize: view.pageSize,
      bootId: view.bootId,
      autoScroll: view.autoScroll,
      anchorId: view.anchorId,
      viewBaselineAfter: view.viewBaselineAfter,
    },
  };
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  logs: typeof window === "undefined" ? [] : [welcomeEntry()],
  filteredLogs: [],
  filter: "all",
  origin: "all",
  search: "",
  isOpen: false,
  counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
  countsByOrigin: computeOriginCounts([]),
  header: {
    filteredLogs: [],
    filter: "all",
    origin: "all",
    search: "",
    isOpen: false,
    counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    countsByOrigin: computeOriginCounts([]),
    page: 1,
    pageSize: LOG_PAGE_SIZE,
    bootId: null,
    autoScroll: true,
    anchorId: null,
    viewBaselineAfter: 0,
  },
  page: 1,
  pageSize: LOG_PAGE_SIZE,
  autoScroll: true,
  sessionStart: null,
  bootId: null,
  revision: 0,
  viewRevision: 0,
  viewSeenIds: new Set<string>(),
  viewBaselineAfter: 0,
  followBaseline: 0,
  followResetAt: 0,
  anchorId: null,

  addEntry: (entry) =>
    set((state) => {
      const full: LogEntry = {
        ...entry,
        id: nextId(),
        seq: nextSeq(),
        time: Date.now(),
      };
      const logs = mergeTimeline(state.logs, [full]);
      return applyView(
        derive(
          logs,
          state.filter,
          state.search,
          state.origin,
          state.revision + 1,
        ),
        viewOf(state),
      );
    }),

  appendFileLogs: (entries) =>
    set((state) => {
      const fresh = dropStaleEntries(entries, state.sessionStart);
      /* 空批次直接原样返回：计数/过滤结果不变（setState 浅合并，不覆盖
       * counts），与「追加空数组时状态保持不变」的既有契约一致。 */
      if (fresh.length === 0) return { logs: state.logs };
      const logs = mergeTimeline(state.logs, fresh);
      /* 全批是重复行（或全被会话起点裁掉）→ 时间线没变，什么都不推进。 */
      if (logs === state.logs) return { logs: state.logs };
      /* 批次里到底有没有**一条真正落板的新行**？
       *
       * 不能用「长度有没有变」判断：时间线封顶（环形缓冲到上限）之后，新行会顶掉
       * 同样多条最旧的行，长度恒等于 MAX_LOG_ENTRIES——明明是「有新日志」，长度
       * 却说他「没有」。判据只能是**身份**：新行是否出现在合并后的时间线里。
       *
       * 这一条同时决定两件事：
       *   1. `revision` 只在真的落了新行时才推进。截断本身不推进，否则页脚会把
       *      「时间线右移一格」也当成有新日志而重新取水位，新行当场被标成已读
       *      （ISSUE #262 复审：提示永远不出现 → 用户读到的就是「翻页翻不动」）；
       *   2. 贴底基线的推进同样只认新行，内容不会被每两秒一次的轮询反复拉动。 */
      const landed = new Set(logs.map((entry) => entry.id));
      const hasNew = fresh.some((entry) => landed.has(entry.id));
      return applyView(
        derive(
          logs,
          state.filter,
          state.search,
          state.origin,
          hasNew ? state.revision + 1 : state.revision,
        ),
        viewOf(state),
      );
    }),

  /* 会话起点到达得比首次轮询晚时，时间线里可能已经混进了上次运行的行：
   * 一次性收拢到底。应用运行中的 mtime 不会后移，因此这是幂等操作。 */
  setSessionStart: (sessionStart) =>
    set((state) => {
      const logs = dropStaleEntries(state.logs, sessionStart);
      const changed = logs.length !== state.logs.length;
      return {
        sessionStart,
        ...applyView(
          derive(
            logs,
            state.filter,
            state.search,
            state.origin,
            changed ? state.revision + 1 : state.revision,
          ),
          viewOf(state),
        ),
      };
    }),

  /* 服务端进程标识变化 = 真的换了进程。旧时间线里的行属于上一个进程，与本次
   * 会话没有可比性（且新进程会从头写自己的日志文件），一次性清干净并重置游标；
   * 页脚随后会显示新的标识。 */
  setBootId: (bootId) =>
    set((state) => {
      if (state.bootId === bootId) return {};
      /* 只有「从无到有 / 换了一个」才算换进程：首次拿到标识时时间线里还没有
       * 旧进程的行，不必清。 */
      const changed = state.bootId !== null && state.bootId !== bootId;
      return {
        bootId,
        ...(changed
          ? {
              ...applyView(
                derive(
                  [],
                  state.filter,
                  state.search,
                  state.origin,
                  state.revision + 1,
                ),
                // 视图入参取自写入前的 state，切片里的 bootId 在这里显式补齐
                { ...viewOf(state), bootId, page: 1 },
              ),
              viewRevision: state.revision + 1,
              viewSeenIds: new Set<string>(),
              viewBaselineAfter: 0,
              followResetAt: Date.now(),
              anchorId: null,
            }
          : { header: { ...state.header, bootId } }),
      };
    }),

  setFilter: (f) =>
    set((state) => {
      const next = {
        ...viewOf(state),
        filter: f,
        /* 过滤条件变了，当前页多半越界：
        回到最新一页，避免用户停在空白页。 */ page: 1,
      };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  setOrigin: (o) =>
    set((state) => {
      const next = { ...viewOf(state), origin: o, page: 1 };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  setSearch: (s) =>
    set((state) => {
      const next = { ...viewOf(state), search: s, page: 1 };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  /* 翻页 = 用户「把这一刻的时间线当作已读基准」：水位取到当前位置，此后新增的
   * 行才算「新来的」，页脚据此报数（ISSUE #346）。
   *
   * 水位**不能**按「切完之后那一页的内容」取：停在第 3 页时说「我只看到这 200 条」
   * 并不成立——比他更新、他已经放弃追赶的那一大段同样不该算「新的」。实测正是
   * 这个错法让页脚从「有 401 条新的日志」开始报数（#262 复审）。
   *
   * 贴底基线同时按当前水位重取：换页 = 用户要在这里停下来看，新行只累积不推动。 */
  setPage: (page) =>
    set((state) => {
      const nextPage = Math.max(1, page);
      const seen = currentWatermark(state);
      return {
        page: nextPage,
        header: { ...state.header, page: nextPage },
        viewSeenIds: seen,
        viewRevision: state.revision,
        /* 「已翻过去的历史」= 第 1 页之外、压在这一页上面的那些条数。
         * 第 1 页恒为 0（窗口就是最新一段，其后本来就没有东西），否则用户一停下
         * 就会被报「有 200 条新的日志」——而那 200 条是他自己刚翻过去的。 */
        viewBaselineAfter:
          nextPage === 1
            ? 0
            : Math.max(
                0,
                state.filteredLogs.length - nextPage * state.pageSize,
              ),
        followBaseline: Math.max(0, state.filteredLogs.length - 1),
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  /**
   * 贴底看最新 vs. 追最新：贴底（true）时面板按水位停在用户读过的地方，日志
   * 只在下面累积（页脚给出新增条数）；追最新（false）时不再自动滚动。
   *
   * `autoScroll` 过去只在视图层的 useState 里，现在同时写进 store：贴底基线的
   * 解绑（{@link followBaseline}）与视图的贴底判定必须用同一份状态，否则会出现
   * 「面板说不自动滚动、却仍在滚」这种两边各说各话的形态。
   */
  setFollowBottom: (follow) =>
    set((state) => ({
      autoScroll: follow,
      /* 用户自己滚回底部 = 他主动追最新：锚点与贴底基线一起重取，此后新行继续
       * 从他看的位置往下排。 */
      ...(follow
        ? {
            followResetAt: Date.now(),
            viewBaselineAfter: 0,
            followBaseline: followBaselineOf(state),
            ...anchorOf(state),
          }
        : {}),
      header: { ...state.header, autoScroll: follow },
    })),

  /** 用户显式要求「回到最新」：解绑贴底基线，此后贴底一路追到最新。 */
  jumpToLatest: () =>
    set((state) => ({
      followResetAt: Date.now(),
      autoScroll: true,
      followBaseline: followBaselineOf(state),
      ...anchorOf(state),
      header: { ...state.header, autoScroll: true, page: 1 },
      page: 1,
    })),
  setIsOpen: (open) =>
    set((state) => ({
      isOpen: open,
      header: { ...state.header, isOpen: open },
    })),
  toggleOpen: () =>
    set((state) => {
      const isOpen = !state.isOpen;
      /* 打开面板 = 用户此刻看到的是「最新的那一段」：水位与贴底基线一起取到当前，
       * 后续新到的行才算「新的」。面板开着不动时两者都不随新日志前进，这正是
       * 「内容不要自己动」的实现（ISSUE #262 复审）。 */
      return {
        isOpen,
        header: { ...state.header, isOpen },
        ...(isOpen
          ? {
              viewSeenIds: currentWatermark(state),
              followBaseline: followBaselineOf(state),
              followResetAt: 0,
              ...anchorOf(state),
            }
          : {}),
      };
    }),

  clear: () =>
    set((state) => {
      const view = { ...viewOf(state), page: 1 };
      return {
        ...applyView(
          derive([], view.filter, view.search, view.origin, state.revision + 1),
          view,
        ),
        /* 清空后不再有「已读 / 未读」可言：水位里保留的那些 id 已经不在时间线上，
         * 下次新日志直接按「没取过水位」处理（水位为空即按「当前看到的全部」处理），贴底基线同时解绑，
         * 此后贴底直接追到最新。 */
        viewRevision: state.revision + 1,
        viewSeenIds: new Set<string>(),
        viewBaselineAfter: 0,
        followResetAt: Date.now(),
        anchorId: null,
      };
    }),

  copyAll: async () => {
    const text = formatForClipboard(get().logs);
    if (typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  },

  download: () => {
    if (typeof document === "undefined") return;
    const blob = new Blob([formatForClipboard(get().logs)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comfy-app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
}));

/* ── 已读水位与贴底基线 ─────────────────────────────────────────────── */

/**
 * 「已读水位」的内容：**已读过哪些条目**（id 集合）。
 *
 * 用条目身份而不是条数，是本文件在 ISSUE #262 复审里改掉的一条口径。条数在
 * **时间线被截断**时不再是单调量：环形缓冲只保留最近 MAX_LOG_ENTRIES 条，长度
 * 会停在 2000，于是「当前长度 − 上次长度」恒为 0——页脚永远报不出「有 N 条新的
 * 日志」，用户也就永远等不到那个「回到最新」的入口（现场实测：页脚写着
 * 「面板保留最近 2000 条」，却一直是第 1 页）。
 *
 * 身份口径下，新条目（id 新）天然不在水位里，被挤掉多少条旧行都不影响计数，
 * 因此贴底位置也不会被截断反复拉动。
 */
function watermarkIds(entries: LogEntry[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) ids.add(entry.id);
  return ids;
}

/**
 * 取「已读水位」：**此刻时间线里已有的全部条目**。
 *
 * 语义是「用户把这一刻当作分界——此刻之前的不算新的，之后到的才算」。
 *
 * ⚠️ 水位只能由**显式动作**整体替换（翻页 / 切筛选 / 搜索 / 打开面板），不能在
 * 每次写入新日志时「顺手扩展」。写日志时扩展，会让水位**追着最新跑**：写入之后
 * 的视图里本来就含新行，扩展一步等于把刚到的行直接标成已读，页脚于是永远报 0
 * ——用户看到的就是「面板一直在涨，却从来不提示有新的」（ISSUE #262 复审）。
 *
 * 也不能只取「当前这一页那 200 条」。停在第 2 页时说「我只看到这 200 条」并不
 * 成立：比他更新、他已经放弃追赶的那一大段同样不该算「新的」。实测正是这个错法
 * 让页脚从「有 401 条新的日志」开始报数（#262 复审）。
 */
function currentWatermark(state: LogStoreState): ReadonlySet<string> {
  return watermarkIds(state.filteredLogs);
}

/** 打开面板 / 首次取水位时的基准：当前这一段就是用户正在看的。 */
function followBaselineOf(state: LogStoreState): number {
  return Math.max(0, state.filteredLogs.length - 1);
}

/**
 * 重取第 1 页锚点：当前窗口（尾部 pageSize 条）的头一条。
 *
 * 「转到最新」的每个动作都调用它——打开面板 / 点回到最新 / 换页 / 切筛选 / 搜索 /
 * 用户自己滚到底部。除此之外锚点不动，这是「看得正起劲的那一段不要被新日志推走」
 * 的实现（见 `anchorId` 的完整说明）。
 */
function anchorOf(state: LogStoreState): { anchorId: string | null } {
  return { anchorId: headOfFirstPage(state) };
}

function headOfFirstPage(state: LogStoreState): string | null {
  const size = Math.max(1, state.pageSize);
  const start = Math.max(0, state.filteredLogs.length - size);
  return state.filteredLogs[start]?.id ?? null;
}

/* ── 派生视图：面板怎么切一页 ───────────────────────────────────────── */

/**
 * 按时间倒序分页：第 1 页是最新的一段，往前翻看更早的日志。
 *
 * 分页在**过滤后的时间线**上做（filteredLogs 顺序即时间顺序），因此
 * 「最新一页」总在 page=1，与 `counts.all` 无关。
 */
export function selectPageLogs(
  logs: LogEntry[],
  page: number,
  pageSize: number,
): { entries: LogEntry[]; page: number; totalPages: number } {
  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const end = total - (safePage - 1) * pageSize;
  const start = Math.max(0, end - pageSize);
  return { entries: logs.slice(start, end), page: safePage, totalPages };
}

/**
 * 第 1 页的**锚定**窗口：只要锚点还在时间线里，就以它为起点往后取 pageSize 条。
 *
 * 锚点不在（被环形缓冲挤出去了 / 还没设）→ 退回「尾部 pageSize 条」这个默认窗口。
 * 返回的 `truncatedFromEnd` 说明窗口后面还有多少条**更新的**日志，页脚据此说
 * 「有 N 条新的日志」——它就是「用户还没看的那批」。
 *
 * 为什么不能一直用「尾部 pageSize 条」：窗口每一轮轮询都整体前移一格，React 会
 * 卸载最上面那一条、挂上新的最末一条。用户刚框住的文本随节点被卸载，选区消失
 * （ISSUE #262 复审在真实浏览器里实测到的正是这条）。锚定之后窗口原地不动，
 * DOM 节点不重建，选区自然留住。
 */
export function selectFirstPageWindow(
  logs: LogEntry[],
  anchorId: string | null,
  pageSize: number,
): { entries: LogEntry[]; truncatedFromEnd: number } {
  const size = Math.max(1, pageSize);
  if (anchorId !== null) {
    const at = logs.findIndex((entry) => entry.id === anchorId);
    if (at !== -1) {
      const entries = logs.slice(at, at + size);
      return { entries, truncatedFromEnd: logs.length - (at + entries.length) };
    }
  }
  const start = Math.max(0, logs.length - size);
  return { entries: logs.slice(start), truncatedFromEnd: 0 };
}

/**
 * 面板是否「已经不在最新」：不在第 1 页，或用户手动上滚离开了底部。
 * 两者都必须给「回到最新」出口，否则用户会以为日志不再刷新（ISSUE #262）。
 */
export function selectShouldPinToLatest(
  page: number,
  autoScroll: boolean,
): boolean {
  return page !== 1 || !autoScroll;
}

/**
 * 停在历史位置期间新来了多少条日志。
 *
 * 判据分两层，缺一不可：
 *   1. `revision` 变过 —— 时间线**真的**变过（不是「末条变了」：按时刻排序后，
 *      一条迟到的旧时刻行会插进中间、末条不动）；
 *   2. 用户当前窗口**之后**确实还有日志 —— 条数由锚定窗口的 `truncatedFromEnd`
 *      直接给出（见 selectFirstPageWindow）。长度差在这里是不管用的：第 1 页窗口
 *      锚定之后长度不再变化，时间线封顶时长度差更是恒为 0（ISSUE #262 复审）。
 *
 * ⚠️ `revision` 在这里仍是门槛，所以**环形缓冲截断不能推进它**：截断只是把最旧
 * 的一批挤出去，新行如果推进了 revision，下面的计数就会把「写入之后视图里本来就
 * 含新行」当成已读，报出 0（用户读到的就是「翻页翻不动、提示不出现」）。
 */
export function selectNewLogCount(state: {
  /** 当前窗口之后还有多少条更新的日志。 */
  unseenAfterView: number;
  /**
   * 用户翻到这一页那一刻，窗口之后本来就有多少条（「已翻过去的历史」）。
   *
   * 计数必须减掉它，否则停在第 2 页时会一开口就报「有 200 条新的日志」——
   * 那 200 条是用户**自己翻过去的**，不是新来的（现场实测过这个错法）。
   * 第 1 页这个值是 0（窗口就是最新一段，其后本来就没有东西）。
   */
  baselineAfterView: number;
  page: number;
  autoScroll: boolean;
}): number {
  if (!selectShouldPinToLatest(state.page, state.autoScroll)) return 0;
  return Math.max(0, state.unseenAfterView - state.baselineAfterView);
}
