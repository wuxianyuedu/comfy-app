/**
 * 日志面板的**采集 / 解析 / 过滤**纯函数（`log-store` 的拆分件）：噪音判据 → `parseFileLogs`
 * → 时间线合并 / 去重 / 计数 + ID 生成，经 `log-store` re-export 保持 import 路径（§12.18 只挪文件）。
 * 这一层不吃也不写 store state，是天然叶子；方向：本文件 → `log-types`，store → 本文件，无回环。
 */
import { upperToken } from "~/lib/upper-token";
import { PANEL_SELF_POLL_ENDPOINTS } from "~/lib/log/panel-self-poll";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { nextId as nextEntryId } from "~/lib/unique-id";
import { splitLogRecords, stripSgr } from "./log-record";
import type {
  LogCategoryFilter,
  LogEntry,
  LogFilter,
  LogLevel,
  LogLevelCounts,
  LogOriginCounts,
  LogOriginFilter,
} from "./log-types";
import { bucketOf, CONSOLE_ORIGIN } from "./log-types";
import { logEntryKey } from "./log-timeline";

/* 时间线的身份与合并判据拆到 `log-timeline`（文件行数硬闸）：这里 re-export，
 * 既有 `from "./log-analysis"` 的 import 路径**完全不变**（§12.18 拆包不动契约）。 */
export * from "./log-timeline";

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
  if (typeof a === "string") {
    return a;
  }
  if (typeof a === "number" || typeof a === "boolean") {
    return String(a);
  }
  if (a === undefined) {
    return "undefined";
  }
  if (a === null) {
    return "null";
  }
  if (a instanceof Error) {
    return a.stack ? `${a.name}: ${a.message}\n${a.stack}` : `${a.name}: ${a.message}`;
  }
  // 保留可能来自序列化错误对象的类栈字符串。
  if (
    typeof a === "object" &&
    a !== null &&
    "stack" in a &&
    /* SAFETY: 类型断言已复核 */
    typeof (a as { stack?: unknown }).stack === "string"
  ) {
    /* SAFETY: 类型断言已复核 */
    const e = a as {
      message?: unknown;
      name?: unknown;
      stack: string;
    };
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

/* ── console 的 printf 风格占位符 ────────────────────────────────────────
 * `console.error("… %s …", value)` 的 `%s` 是格式占位符而非日志内容，浏览器/Node 会换成实参；
 * 面板按 " " 拼接全部实参，成了「模板 + `%s` 原样 + 实参缀尾巴」，真正要说的「哪个 key 重复」
 * 被隔在 150 字符外（ISSUE #1703）。只认 `%s`/`%d`/`%i`/`%o`/`%O`/`%c`/`%%`；`%c` 必须吃掉
 * （tRPC loggerLink 逐帧样式参数）。噪判据看 `args[0]` 原串、不受展开影响——过滤认原始形态。 */

/** 占位符 → 消费一个实参的方式；`drop` 表示消费但不进正文（`%c` 的样式表）。 */
const PLACEHOLDER_KINDS: Record<string, "text" | "number" | "object" | "drop"> = {
  s: "text",
  d: "number",
  i: "number",
  f: "number",
  o: "object",
  O: "object",
  c: "drop",
};

/** 按 `kind` 渲染一个实参（`%c` 之外都复用 {@link serializeOne} 的口径）。 */
function renderArg(kind: string, value: unknown): string {
  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isNaN(n) ? "NaN" : String(n);
  }
  return serializeOne(value);
}

/**
 * 展开 console 的 printf 占位符（`%s` / `%d` / `%i` / `%f` / `%o` / `%O` / `%c` / `%%`）。
 * 有意窄化：无对应实参的占位符原样保留（浏览器会打 undefined），多出的实参按旧行为缀在末尾，
 * 首参非字符串不处理；`%.2f` / `%5d` 等不支持的宽度精度按字面量原样保留。
 */
export function formatConsoleArgs(args: Array<unknown>): string {
  const first = args[0];
  /* 首参不是字符串 = 没有模板可展开（`console.error(err)`）→ 原样拼。
   * **不能顺手在这里按 `args.length === 1` 提前返回**：单参调用里 `%%` 仍要还原
   * 成 `%`（用户打的就是「百分比」），提前返回会让 `100%%` 原样留在日志里。 */
  if (typeof first !== "string") {
    return args.map(serializeOne).join(" ");
  }
  const rest = args.slice(1);
  let argIndex = 0;
  /* 逐个扫描而非一次 `String.replace`：占位符是否成立取决于「还剩几个实参」，
   * 正则回调拿不到这个状态而只能一路消费下去。 */
  let out = "";
  for (let i = 0; i < first.length; i += 1) {
    const ch = first[i];
    if (ch !== "%" || i === first.length - 1) {
      out += ch;
      continue;
    }
    const spec = first[i + 1] ?? "";
    if (spec === "%") {
      out += "%";
      i += 1;
      continue;
    }
    const kind = PLACEHOLDER_KINDS[spec];
    if (!kind || argIndex >= rest.length) {
      out += ch;
      continue;
    }
    const value = rest[argIndex];
    argIndex += 1;
    if (kind !== "drop") {
      out += renderArg(kind, value);
    }
    i += 1;
  }
  for (; argIndex < rest.length; argIndex += 1) {
    out += ` ${serializeOne(rest[argIndex])}`;
  }
  return out;
}

export function serialize(args: Array<unknown>): string {
  return formatConsoleArgs(args);
}

/* 调用位置采集拆到 `log-callsite`（本文件加完那一族后越过文件长度硬闸）。
 * 这里原样转出去，`log-store` 那条 `export *` 链路和既有 import 路径都不受影响
 * （§12.18 复用优先 —— 拆包只挪文件、不动契约）。 */
export { captureLocation, locateInStack } from "./log-callsite";

/**
 * 过滤 tRPC loggerLink / React Query 内部追踪日志：dev 下每次调用都打一行，会淹没业务日志，
 * 但保留在浏览器 console、只做面板侧丢弃。同时兜底 mutation 后重新包装的塌缩形态
 * （`[[ << mutation #43 ]workflow.update {}`），它经 React devtools 以 Console Error 转发进面板。
 */
export function isReactQueryLog(args: Array<unknown>): boolean {
  if (args.length === 0) {
    return false;
  }
  // 标准形态：tRPC loggerLink 的格式串 + 逐帧样式参数，args[0] 即为追踪签名。
  // 真实追踪至少两个参数（格式串 + 样式），单参数的不是追踪，避免误吞业务文案。
  if (args.length >= 2) {
    const first = args[0];
    if (
      typeof first === "string" &&
      /^\s*%c\s*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(first)
    ) {
      return true;
    }
  }
  // 塌缩/重包装形态：loggerLink 的 %c 样式与逐帧参数被 React devtools 吞并，
  // 合并成带 "[[" 前缀的单串（形如 `[[ << mutation #43 ]workflow.update {}`），
  // 并经由 LogProvider 转发帧以 "Console Error" 冒到面板。同属无害框架噪音。
  const text = serialize(args);
  return /^[\s[]*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(text);
}

/**
 * 过滤已知的、无害的框架/运行时噪音，避免它们淹没业务日志。
 * 典型例子：Tauri v2 在 Windows WebView2 上 IPC custom protocol fetch 失败时
 * 会自动降级到 postMessage，并打印一条 warn。这是正常行为，不影响功能。
 */
export function isNoisyFrameworkLog(args: Array<unknown>): boolean {
  if (args.length === 0) {
    return false;
  }
  const text = serialize(args);
  return /IPC custom protocol failed|Tauri will now use the postMessage interface/i.test(text);
}

/**
 * 过滤 Next.js dev 自身的开发提示（如 `[Fast Refresh] done in XXXXms`）：来自框架 dev chunk，
 * 没有可读调用位置，与其它框架噪音一致——保留在浏览器 console（降为 debug），只不入面板。
 */
export function isNextDevNoise(args: Array<unknown>): boolean {
  if (args.length === 0) {
    return false;
  }
  const text = serialize(args);
  return /\[Fast\s*Refresh\]\s*(?:done|finished)?.*\d+\s*ms/i.test(text);
}

/* 启动链路行的形态（dev-launcher 的 Transcript 是「裸文本 + 缩进」的混合体）：
 * 三条口径缺一不可，否则整行掉进裸文本兜底、以 "[HH:mm:ss] [LEVEL]" 原文显示（ISSUE #262 六审）：
 * ① 级别标记容错（PadRight(5) 补尾空格、颜色码残缺会多留 `[[90m[OK`）；② 行首允许缩进；
 * ③ 只认 STEP/OK/INFO/WARN/ERROR/DEBUG 六个级别名，不放过 `[rpc]` 这类普通前缀词；时刻限 HH:mm:ss。
 */
const LOG_LINE_RE =
  /^\s*\[(\d{2}):(\d{2}):(\d{2})\]\s*\[\[?[0-9;]*m?\[?\s*(STEP|OK|INFO|WARN|ERROR|DEBUG)\s*\[?[0-9;]*m?\]\s*(.*)$/;
const LAUNCHER_LOG_RE = /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;
const APP_RUNTIME_LOG_RE =
  /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*\[(INFO|WARN|ERROR|DEBUG)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/;

/**
 * 过滤常规 tRPC/RPC 调用计时日志（#294）：`[rpc] xxx 155ms {…}` 来自中间件，正常调用每几秒刷一整屏。
 * 带「失败」或 warn/error 级别的慢查询必须保留——它们不会命中这里的「常规 info 计时」判定。
 */
export function isRoutineRpcTimingLog(args: Array<unknown>): boolean {
  if (args.length === 0) {
    return false;
  }
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
  if (level === "WARN" || level === "ERROR") {
    return false;
  }
  // 行格式两种来源：app-runtime 行的 text 已被 APP_RUNTIME_LOG_RE 拆掉 [ns]
  // 前缀；launcher 转录整行原文可能带 [rpc] / rpc] 前缀。先剥前缀再测正文。
  const body = text
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\]?|\])\s*/i, "");
  return /^\S+\s+\d+ms(\s*\{.*\})?$/i.test(body);
}

/** `GET <目标>` 那一格的开头：面板自用请求都从这里取目标路径。 */
const GET_REQUEST_TARGET = /^\s*GET\s+(\S+)/;

/**
 * 过滤面板**自轮询**产生的访问日志行（Next dev 请求日志），否则成自我反馈回路：每 2s 六路 + server-id、每 30s build-id 的请求被转录进 nextjs-panel、下一轮又读回来，无限累积且读不到行内时刻、只能钳到解析当时。
 * 端点集合取自 `~/lib/log/panel-self-poll`（请求方与过滤同源，ISSUE #2417）；只匹配清单内端点，业务请求照常显示。
 * 带 `[HH:mm:ss] [INFO]` 前缀的形态由 parseFileLogs 拆出正文后再问一次。 */
export function isPanelSelfPollingLine(line: string): boolean {
  const match = GET_REQUEST_TARGET.exec(line);
  const target = match?.[1];
  if (!target) {
    return false;
  }
  return PANEL_SELF_POLL_ENDPOINTS.some((endpoint) => {
    if (!target.startsWith(endpoint)) {
      return false;
    }
    /* 端点后必须是「查询串 / 到此为止」之一：`/api/logs/currentX` 不是这条
     * 端点，不能顺手被滤掉。 */
    const rest = target.slice(endpoint.length);
    return rest === "" || rest.startsWith("?");
  });
}

function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "error": {
      return "error";
    }
    case "warn":
    case "warning": {
      return "warn";
    }
    case "debug": {
      return "debug";
    }
    default: {
      return "info";
    }
  }
}

/**
 * 匹配 Next.js dev 的 `[Fast Refresh] rebuilding` 转录行：行内常带上一条编译错误的级别标记，
 * 按级别正则会整行落成 error。与 isNextDevNoise（console 侧）互补，这条处理文件转录侧。
 */
const FAST_REFRESH_REBUILD_RE = /\[Fast\s*Refresh\]\s*rebuilding(?:\s*\[(?:ERROR|WARN|DEBUG)\])?/i;

export function parseFileLogs(
  text: string,
  baseDate?: Date,
  origin?: LogEntry["origin"],
): Array<LogEntry> {
  /*
   * 读不到时刻时的兜底：baseDate 是**这批内容所属的日期**（默认今天），时刻取
   * 解析当时的本地时间。这样裸文本行落在「现在」，不会因为时间戳缺失被排到
   * 时间线开头（用 00:00:00 会），与「时间线按 time 升序」的契约相容。
   */
  const now = Date.now();
  const today = baseDate ?? new Date();
  const entries: Array<LogEntry> = [];
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
    if (!head.trim()) {
      continue;
    }
    /* ANSI 已在 splitLogRecords 之前剥掉，这里只处理「有无续行」。 */
    const withRest = (msg: string) => (record.rest ? `${msg}\n${record.rest}` : msg);
    // 常规 tRPC/RPC 调用计时行（如 `[rpc] xxx 155ms {"type":"query"}`）不进面板：
    // 正常调用高频产生会刷屏（#294）；失败/慢查询（error/warn 级别）仍保留。
    if (isRoutineRpcTimingLine(head)) {
      continue;
    }
    // 面板自轮询的访问日志行（`GET /api/logs/current?…` 等）不进面板：
    // 它们是面板每 2s 轮询自己的回声，无限累积且成批挤在同一毫秒（见函数说明）。
    if (isPanelSelfPollingLine(head)) {
      continue;
    }
    const m = LOG_LINE_RE.exec(head);
    if (m) {
      const [, hh, mm, ss, lv, msg] = m;
      // 带时间戳前缀的自轮询行（如 dev-launcher 转录的 dev 输出）：拆出正文后再判一次
      if (isPanelSelfPollingLine(msg ?? "")) {
        continue;
      }
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
        level: FAST_REFRESH_REBUILD_RE.test(msgText) ? "info" : parseLogLevel(lv ?? "INFO"),
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
  return LOG_LINE_RE.test(line) || APP_RUNTIME_LOG_RE.test(line) || LAUNCHER_LOG_RE.test(line);
}

/**
 * 渲染前折叠连续重复行：连续 N 条完全相同的行压成一条 `…（重复 N 次）`，只留前 REPEAT_FOLD_LIMIT 条。面板最常见「没信息量」是同一路轮询每轮写同样的慢查询提示。
 * 写入侧已按时间桶聚合一次（§7.14.1），这里是视图侧最后一道保险：只影响显示、不动时间线。
 * 只折叠**连续**重复——跨距离合并会把时间线读成「同一事件发生 N 次」，那是错的。 */
export function dedupeRepeats(
  entries: Array<LogEntry>,
  limit = REPEAT_FOLD_LIMIT,
): Array<LogEntry> {
  /* 折叠键只看「级别 + 内容」，不看时刻：每轮轮询写出来的重复行时刻必然不同，
   * 带上时刻就一条也折叠不了。跨来源去重看时刻（entryKey），这里看语义。 */
  const foldKey = (entry: LogEntry) => `${entry.level}\u0000${entry.message}`;
  const out: Array<LogEntry> = [];
  let i = 0;
  while (i < entries.length) {
    /* `at()` 越界即 `undefined`：索引取值与循环判据合成一处，不必再补 `!`。 */
    const first = entries.at(i);
    if (first === undefined) {
      break;
    }
    let run = 1;
    while (i + run < entries.length && foldKey(entries.at(i + run) ?? first) === foldKey(first)) {
      run += 1;
    }
    if (run <= limit) {
      out.push(first);
      i += 1;
      continue;
    }
    for (let k = 0; k < limit; k += 1) {
      const repeated = entries.at(i + k);
      if (repeated !== undefined) {
        out.push(repeated);
      }
    }
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

export function computeCounts(logs: Array<LogEntry>, search = ""): LogLevelCounts {
  const base = zeroCounts();
  for (const entry of logs) {
    if (!matchesSearch(entry, search)) {
      continue;
    }
    base.all++;
    base[entry.level]++;
  }
  return base;
}

/**
 * 按**行身份**挑出代表行：同一条日志被多路读到、时间线上落成多份时只留第一份；视图去重只折叠长成一样的连续行，副本行长在 `origin` 上。
 * 但**数字**不同：`all` 按身份计一次，逐来源各按自己文件条数计（与 `computeFiltered` 逐条对齐）。
 * 守恒只在每个来源内部成立，跨来源相加≠全部来源，界面必须分开摆。 */
export function dedupeByIdentity(
  logs: Array<LogEntry>,
  origin: LogOriginFilter = "all",
): Array<LogEntry> {
  if (origin !== "all") {
    return logs;
  }
  const seen = new Set<string>();
  const out: Array<LogEntry> = [];
  for (const entry of logs) {
    const key = logEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * 来源 × 级别的二维计数表（`all` = 全部来源）。此前只有总数与来源名无数，「看着警告 974 条、切到启动器却什么都没有」（ISSUE #360）。
 * 契约：key 是筛选值本身（`"all"` + 四个级别，视图直接 `countsByOrigin[origin][level]`）；逐来源独立（`launcher.warn` 只数 `origin === "launcher"`）。
 * 计数与 `computeFiltered` 共用 `matchesSearch`，搜索时一起收窄，否则「左边写警告 2、切过去只剩 1」比不显示更让人怀疑面板。 */
export function computeOriginCounts(logs: Array<LogEntry>, search = ""): LogOriginCounts {
  const table: LogOriginCounts = {
    all: zeroCounts(),
    dev: zeroCounts(),
    launcher: zeroCounts(),
    "shell-launch": zeroCounts(),
    shell: zeroCounts(),
    app: zeroCounts(),
    "app-runtime": zeroCounts(),
    [CONSOLE_ORIGIN]: zeroCounts(),
  };

  for (const entry of logs) {
    if (!matchesSearch(entry, search)) {
      continue;
    }
    /* 逐来源独立计数（ISSUE #360），且**每个来源都必须有一个桶**：
     * 无 origin 的行（console 拦截 / Tauri 事件 / 全局错误）归 `console`，
     * 有 origin 的归它自己。于是「每个来源的各级别之和 = 该来源的总数」在
     * 任何情况下都成立，不会再出现「只在全部页签才显示、哪个分类都进不去」
     * 的行（ISSUE #262 六审）。 */
    const bucket = table[bucketOf(entry)];
    if (!bucket) {
      continue;
    }
    bucket.all += 1;
    bucket[entry.level] += 1;
  }
  /* 「全部来源」按**身份**计（同一条日志被六路读到只算一条）。`table[origin]` 是「切过去会看到几行」，
   * `table.all` 是「面板上有多少条日志」，两个语义——同一批启动行写在 launcher / dev-launcher /
   * shell / shell-launch 好几份文件里，副本各算一份，因此跨来源相加本来就不等于 all。
   * 历史形态是二者用同一批行累加，撞上限（5000）时 all 被截、各分类之和仍算被挤掉的行，守恒连
   * 「撞上限之前」都不成立（e2e 实测 5000 vs 3335）；现在两个口径各自成立、各自可断言。 */
  for (const entry of dedupeByIdentity(logs)) {
    if (!matchesSearch(entry, search)) {
      continue;
    }
    table.all.all += 1;
    table.all[entry.level] += 1;
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
  return matchesNeedle(needle, entry.message) || matchesNeedle(needle, entry.location ?? "");
}

export function computeFiltered(
  logs: Array<LogEntry>,
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
  /** 被「设置 → 日志」开关关掉、要从面板隐藏的分类（与 `bucketOf` 同域）。 */
  disabled: Array<LogCategoryFilter> = [],
): Array<LogEntry> {
  const disabledSet = disabled.length > 0 ? new Set(disabled) : null;
  /* 「全部来源」按身份去重（同一条日志被六路读到只显示一次，与 `table.all` 的
   * 计数同口径）；选了具体来源就是「那份文件里的行」，逐行照给——副本不丢，
   * 因为用户切过去正是为了看 `origin` 指的那一份。 */
  const scoped = dedupeByIdentity(logs, origin);
  return scoped.filter((entry) => {
    const levelOk = filter === "all" || entry.level === filter;
    /* 过滤与计数共用 `bucketOf`：两处各写一份判据必然漂移，而漂移的表现正是
     * 「下拉上写着 5 条、切过去只有 3 条」这类不再可信的数字（ISSUE #360）。 */
    const originOk = origin === "all" || bucketOf(entry) === origin;
    /* 分类开关：被关掉的分类（无论当前在看「全部来源」还是某个具体来源）一律隐藏。
     * 计数维度（`computeOriginCounts`）不读这里——下拉里仍显示真实条数，开关只
     * 影响「显示哪些行」，与「来源筛选下拉」是两条正交的轴。 */
    /* SAFETY: 类型断言已复核 */
    const categoryOk = disabledSet ? !disabledSet.has(bucketOf(entry) as LogCategoryFilter) : true;
    return levelOk && originOk && categoryOk && matchesSearch(entry, search);
  });
}
