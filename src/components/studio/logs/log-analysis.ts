/**
 * 日志面板的**采集 / 解析 / 过滤**纯函数（`log-store` 的拆分件）。
 *
 * 从 `log-store.ts` 抽出：`serialize` / `captureLocation` 一族噪音判据
 * （`isReactQueryLog` / `isNoisyFrameworkLog` / `isNextDevNoise` /
 * `isRoutineRpcTimingLog` / `isRoutineRpcTimingLine` /
 * `isPanelSelfPollingLine`）→ 文件行解析（`parseFileLogs`）→ 时间线合并 /
 * 去重 / 计数（`mergeTimeline` / `lastSeqOf` / `dropStaleEntries` /
 * `dedupeRepeats` / `computeCounts` / `computeOriginCounts` /
 * `computeFiltered`）与 ID 生成的窄封装。store 与外部消费者通过 `log-store`
 * 的 re-export 使用同一批符号，import 路径不变（§12.18 复用优先——
 * 拆包只挪文件、不动契约）。
 *
 * 拆分动机：`log-store.ts` 1557 行超过 §12.6 文件长度棘轮的阈值；这一层的函数**不吃
 * store state、也不写它**，是天然的叶子，让 store 只留「状态 + actions +
 * selector」。方向：本文件 → `log-types`（类型）+ 外部 lib；store → 本文件，
 * 无回环。
 */
import { upperToken } from "~/lib/upper-token";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { nextId as nextEntryId } from "~/lib/unique-id";
import { splitLogRecords, stripSgr } from "./log-record";
import type {
  LogEntry,
  LogFilter,
  LogLevel,
  LogLevelCounts,
  LogOriginCounts,
  LogOriginFilter,
} from "./log-types";
import { bucketOf, CONSOLE_ORIGIN } from "./log-types";

/** 每一页（面板显示窗口）里最多保留的连续重复行数（见 dedupeRepeats）。 */
const REPEAT_FOLD_LIMIT = 5;

/* 日志条的 id 走全库唯一出口 `~/lib/unique-id`（规范 16 §16.2.4.36）——
 * 收口前这里自写「时间戳 + 计数器」，而且计数器**取模回绕**
 *（`(entryId + 1) % 1_000_000`）：转一圈之后同一毫秒内的两条日志会拿到
 * 同一个 id，下游按 id 去重（`seen` 集合）会把新的那条当成旧的丢掉。 */
export function nextId(now?: number) {
  return nextEntryId("log-", { now });
}

/**
 * 入库序计数器（进程内单调递增，不随清空 / 过滤重置）。
 * 只作同一毫秒内的排序次键与去重判据；模块级而非 store state，保证
 * `clear()` / 页面重载后仍单调，否则新日志会被当成旧日志排到前面。
 */
let entrySeq = 0;
export function nextSeq(): number {
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
  // 保留可能来自序列化错误对象的类栈字符串。
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
  const level = m ? upperToken(m[8]) : "";
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

/**
 * 过滤面板**自轮询**产生的访问日志行（Next dev server 的请求日志）。
 *
 * 面板每 2s 轮询一次 4 路日志来源（`GET /api/logs/current?source=…`）与
 * `GET /api/dev/server-id`，dev server 把每个请求打到 stdout，被转录进
 * nextjs-panel 文件（app 来源）——下一轮轮询又把它读回来。这是一条**自我
 * 反馈回路**：不滤掉就以每轮数行的速度无限累积，而且这些行读不到行内时刻、
 * 只能钳到解析当时，于是成批挤在同一毫秒里把真正的日志淹没。时间线此前封顶
 * 2000 条时，它们正是把「启动 / 启动器」的行全部挤出面板的推手；现在不设
 * 上限，不滤掉的话同样会让时间线变成只剩回声。
 *
 * 只匹配面板自用的这两条端点：业务请求（tRPC / 页面路由 / 生成接口）照常显示。
 * 端点名取自 LogProvider 的轮询实现（fetchFileLogSlice / server-id 探测），
 * 两边改名要同步。带时间戳前缀的形态（`[HH:mm:ss] [INFO] GET …`）由
 * parseFileLogs 在拆出正文后再问一次本函数。
 */
export function isPanelSelfPollingLine(line: string): boolean {
  return /^\s*GET\s+\/api\/(?:logs\/current|dev\/server-id)(?:\?|\s|$)/.test(
    line,
  );
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
  const originOf = origin ? { origin } : {};
  /* 时刻/级别只看**记录头**；续行拼回正文（见 log-record 模块）——续行本来
   * 就没有时刻前缀，此前各自成了一条 level=info 的裸文本行，用户读到的就是
   * 「一个 json 被拆成十几条」（ISSUE #609）。 */
  for (const record of splitLogRecords(stripSgr(text), isLogLine)) {
    const head = record.head;
    if (!head.trim()) continue;
    /* ANSI 已在 splitLogRecords 之前剥掉，这里只处理「有无续行」。 */
    const withRest = (msg: string) =>
      record.rest ? `${msg}\n${record.rest}` : msg;
    // 常规 tRPC/RPC 调用计时行（如 `[rpc] xxx 155ms {"type":"query"}`）不进面板：
    // 正常调用高频产生会刷屏（#294）；失败/慢查询（error/warn 级别）仍保留。
    if (isRoutineRpcTimingLine(head)) continue;
    // 面板自轮询的访问日志行（`GET /api/logs/current?…` 等）不进面板：
    // 它们是面板每 2s 轮询自己的回声，无限累积且成批挤在同一毫秒（见函数说明）。
    if (isPanelSelfPollingLine(head)) continue;
    const m = LOG_LINE_RE.exec(head);
    if (m) {
      const [, hh, mm, ss, lv, msg] = m;
      // 带时间戳前缀的自轮询行（如 dev-launcher 转录的 dev 输出）：拆出正文后再判一次
      if (isPanelSelfPollingLine(msg ?? "")) continue;
      const d = new Date(today);
      d.setHours(Number(hh ?? "0"), Number(mm ?? "0"), Number(ss ?? "0"), 0);
      push({
        id: nextId(d.getTime()),
        time: d.getTime(),
        level: parseLogLevel(lv ?? "INFO"),
        message: withRest(msg ?? ""),
        source: "system",
        ...originOf,
      });
      continue;
    }
    const am = APP_RUNTIME_LOG_RE.exec(head);
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
      const msgText = withRest((ns ? `[${ns}] ` : "") + (msg ?? ""));
      push({
        id: nextId(d.getTime()),
        time: d.getTime(),
        // Fast Refresh 进行中若沾染上一条错误的级别标记，按 info 落板
        level: FAST_REFRESH_REBUILD_RE.test(msgText)
          ? "info"
          : parseLogLevel(lv ?? "INFO"),
        message: msgText,
        source: "system",
        ...originOf,
      });
      continue;
    }
    const lm = LAUNCHER_LOG_RE.exec(head);
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
        id: nextId(d.getTime()),
        time: d.getTime(),
        level: "info",
        message: withRest(msg ?? ""),
        source: "system",
        ...originOf,
      });
      continue;
    }
    push({
      id: nextId(now),
      time: now,
      level: "info",
      message: record.text,
      source: "system",
      ...originOf,
    });
  }
  return entries;
}

/** 该行是不是「带时刻的日志记录头」（三种可解析形态之一）。 */
function isLogLine(line: string): boolean {
  return (
    LOG_LINE_RE.test(line) ||
    APP_RUNTIME_LOG_RE.test(line) ||
    LAUNCHER_LOG_RE.test(line)
  );
}

/** 行身份：同一行被多路读到（launcher 转写含 dev 输出）时据此去重。 */
function entryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${entry.time}\u0000${entry.level}\u0000${entry.message}`;
}

/**
 * 把新条目并进时间线：**按时刻排序 + 跨来源去重**，不设总数上限。
 *
 * - 排序键 `(time, seq)`：`time` 来自行内的写入时刻；`seq` 只在同一毫秒内决定
 *   先后（三路轮询并发到达，同毫秒内按到达顺序保持稳定即可）。
 * - 去重：与已有条目 key 相同的新条目直接丢弃。dev-launcher 转写会包含 dev
 *   输出、文件被整段重读也会重复送来同一批行，没有这一步面板条数与真实事件数
 *   就对不上（翻页还会翻出重复内容）。
 * - 不裁剪：时间线保留本面板生命周期内的全部条目（用户要求能往前翻完整段），
 *   「一次看多少」由分页（LOG_PAGE_SIZE）决定，与总量解耦。返回值 === current
 *   当且仅当 fresh 全是重复行——appendFileLogs 据此判断「有没有新行落板」。
 */
export function mergeTimeline(
  current: LogEntry[],
  fresh: LogEntry[],
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
  return merged;
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
 *   - `launcher`（dev-launcher-stderr.log）/ `dev`（dev-launcher.log）：
 *     每次运行**覆盖重建**，文件内容天然只有本次——它们**不需要**裁。
 *
 * 为什么必须逐来源判定、而不能拿一个全局 cutoff 往整条时间线上套：
 * 会话起点取自 `dev-launcher.log` 的 mtime，而**壳写下的头几行在它被创建
 * 之前**（exe 路径、项目根、探测结果…）。用一个全局 cutoff 一刀切，
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

function zeroCounts(): LogLevelCounts {
  return { all: 0, debug: 0, info: 0, warn: 0, error: 0 };
}

export function computeCounts(logs: LogEntry[], search = ""): LogLevelCounts {
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
  const needle = normalizeNeedle(search);
  /* 归一化与命中判决走 `~/lib/list-filter`（规范 16 §16.2.4.16）——
   * 「命中了正文还是位置」是本域的判据（两列），归一化不是。 */
  return (
    matchesNeedle(needle, entry.message) ||
    matchesNeedle(needle, entry.location ?? "")
  );
}

export function computeFiltered(
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
