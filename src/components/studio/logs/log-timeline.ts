/**
 * 日志面板时间线的**身份与合并**纯函数（`log-analysis` 的拆分件）：`entryKey` / `arrivalKey` /
 * `logEntryKey`、去重索引建表/复用/摘键、`mergeTimeline` 两版、`lastSeqOf`、会话起点裁剪。
 * 拆出因 `log-analysis.ts` 逼近 900 行硬闸（§12.6）且这是每 2s 一轮的热路径。方向：本文件 →
 * `log-types`；`log-analysis` 从这里取符号，无回环。 */
import type { LogEntry } from "./log-types";

/**
 * 行身份：同一行被多路读到时据此去重。**刻意不含 `origin`**：六个来源各有副本
 * （`dev-launcher.log` 转写 dev 输出、`shell-launch.log` 与 launcher 重叠），带上 origin 会让同一行
 * 落成六份，「全部来源 4000 条」与「各分类之和 24000 条」就指同一批事件的两种口径。
 */
function entryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${entry.time}\u0000${entry.level}\u0000${entry.message}`;
}

/**
 * 行身份（**跨来源无关**）：同一条日志不论被哪几路读到，身份都相同。
 * 与 {@link entryKey} 同一构造、单独留一支具名函数，是为了让「按身份记账」（计数 / 过滤 / 去重）
 * 读起来是它自己的概念，而不是又一次内联模板字符串（三处各写一遍必然漂移）。
 */
export function logEntryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return entryKey(entry);
}

/**
 * 时间线去重索引：`entryKey` / `arrivalKey` 两张表。建表是对整条时间线的 O(已有条数)：六路每 2s
 * 各写一次，5000 条时实测每轮 2.27ms 全花在建表（排序只占 0.11ms），所以跨轮复用、只在形状变化时
 * 重建。`entryKey` 是身份表（不含 origin），`arrivalKey` 是「同秒同级同正文」副本表，两张表只持引用。
 */
export type TimelineIndex = {
  sameArrival: Map<string, LogEntry>;
  seen: Map<string, LogEntry>;
};

/** 为一条已落板的时间线建索引（O(n)：只在形状变化时调用）。 */
export function buildTimelineIndex(entries: ReadonlyArray<LogEntry>): TimelineIndex {
  const seen = new Map<string, LogEntry>();
  const sameArrival = new Map<string, LogEntry>();
  for (const entry of entries) {
    seen.set(entryKey(entry), entry);
    /* 同毫秒同正文的副本行（`seq` 只差几个数）视为同一条日志的另一次读取。 */
    const near = arrivalKey(entry);
    if (!sameArrival.has(near)) {
      sameArrival.set(near, entry);
    }
  }
  return { seen, sameArrival };
}

/**
 * 时间线尾部截断后，把索引里**已出窗口**的键摘掉（O(被摘掉的条数)）。摘而不是重建：截断后退回
 * 重建会让面板顶到上限后每轮又全表扫描；而留在 `seen` 里的出窗口行，会让旧内容的重读被当重复丢掉。
 * 摘掉后行为与「从保留段重建」逐字一致；`droppedEntries` 是被截掉那一段，同一 key 可能仍有副本在窗口，先比引用。
 */
export function trimTimelineIndex(
  index: TimelineIndex,
  droppedEntries: ReadonlyArray<LogEntry>,
): void {
  for (const entry of droppedEntries) {
    const key = entryKey(entry);
    if (index.seen.get(key) === entry) {
      index.seen.delete(key);
    }
    const near = arrivalKey(entry);
    if (index.sameArrival.get(near) === entry) {
      index.sameArrival.delete(near);
    }
  }
}

/**
 * 把新条目并进时间线：**按时刻排序 + 跨来源去重**，不设总数上限。排序键 `(time, seq)`，seq 只在
 * 同一毫秒内决定先后；key 相同的条目直接丢弃（副本转写与整段重读会重复送来）。不裁剪——「一次看
 * 多少」由分页决定。无索引版自己建一次索引（给一次性调用方 / 测试），**热路径用 mergeTimelineIndexed**。
 */
/**
 * 「时间线 → 它的去重索引」的进程内缓存。键是**数组引用**：每条写入路径都产出新数组，引用相等即
 * 「这份时间线没变过」，与 `revision` 的「新数组 ⟺ 有新行落板」契约同源。用 `WeakMap` 而非单槽：
 * 单槽在 `setBootId` 清空后追加、或两条时间线来回切时会反复建表；WeakMap 让索引随时间线一起回收。
 */
const timelineIndexCache = new WeakMap<Array<LogEntry>, TimelineIndex>();

/** 取（或惰性建）某份时间线的索引 —— 热路径的唯一入口。 */
export function indexOfTimeline(entries: Array<LogEntry>): TimelineIndex {
  const cached = timelineIndexCache.get(entries);
  if (cached) {
    return cached;
  }
  const built = buildTimelineIndex(entries);
  timelineIndexCache.set(entries, built);
  return built;
}

/**
 * 把某份索引登记到某条时间线名下。只有两处该调：`mergeTimeline` 内部与 store 的 {@link capTimeline}
 * （唯一另一条换掉 `logs` 引用却不经过合并的路径）。别处产出的数组由 `indexOfTimeline` 惰性补建，
 * 登记早了反而让缓存持过期表。
 */
export function rememberTimelineIndex(entries: Array<LogEntry>, index: TimelineIndex): void {
  timelineIndexCache.set(entries, index);
}

/**
 * {@link mergeTimeline} 的索引复用版：`index` 由调用方跨轮持有，返回的是时间线当下的索引（新行已
 * 登记），形状变化后须重建。两条去重规则与无索引版一致：① 已落板的种类不再落第二份（按 `entryKey`）；
 * ② 同秒后到的来源并进已落板那一行（补 origin）——不改 key，因此索引在新行登记前已是最终形态。
 */
export function mergeTimeline(current: Array<LogEntry>, fresh: Array<LogEntry>): Array<LogEntry> {
  if (fresh.length === 0) {
    return current;
  }
  const { logs, index } = mergeTimelineIndexed(current, fresh, indexOfTimeline(current));
  /* 合并产出的是新数组：把索引挂在它名下，下一轮就不必再建一次表。 */
  if (logs !== current) {
    rememberTimelineIndex(logs, index);
  }
  return logs;
}

export function mergeTimelineIndexed(
  current: Array<LogEntry>,
  fresh: Array<LogEntry>,
  index: TimelineIndex,
): { index: TimelineIndex; logs: Array<LogEntry> } {
  if (fresh.length === 0) {
    return { logs: current, index };
  }
  const { seen, sameArrival } = index;
  const added: Array<LogEntry> = [];
  let changed = false;
  for (const entry of fresh) {
    const key = entryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    /* 已经有一条「同一毫秒写下的同一段正文」在板上：并进它的 origin，
     * 不再单独落一份。 */
    const existing = sameArrival.get(arrivalKey(entry));
    if (existing) {
      if (existing.origin !== entry.origin) {
        existing.origin = entry.origin;
        changed = true;
      }
      continue;
    }
    seen.set(key, entry);
    sameArrival.set(arrivalKey(entry), entry);
    added.push(entry);
  }
  if (added.length === 0) {
    return { logs: changed ? [...current] : current, index };
  }
  const merged =
    current.length === 0 || changed
      ? [...current.map((e) => ({ ...e })), ...added]
      : [...current, ...added];
  merged.sort((a, b) => (a.time === b.time ? a.seq - b.seq : a.time - b.time));
  return { logs: merged, index };
}

/** 同一秒内的副本判据：时刻取整到秒 + 级别 + 正文（`entryKey` 的毫秒容忍版）。 */
function arrivalKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${Math.floor(entry.time / 1000)}\u0000${entry.level}\u0000${entry.message}`;
}

/** 时间线的**真实**末条（最新一条）——「已读水位」「有无新内容」「跳最新」都用它。 */
export function lastSeqOf(logs: Array<LogEntry>): number {
  return logs.at(-1)?.seq ?? 0;
}

/**
 * 哪些来源的文件**跨运行累积**、需要会话起点裁到本次运行（客户端与服务端共享的事实）：四个来源
 * 现都不需要（`app-runtime` 一次启动一份文件、`app` 按进程命名、`launcher` / `dev` 每次覆盖重建），
 * 机制保留（`dropStaleEntries` 仍是将来唯一出口，空集合恒真零开销）。必须逐来源判定：起点取自
 * `dev-launcher.log` 的 mtime，壳写下的头几行在它创建之前，全局 cutoff 会误裁本次运行的行（ISSUE #262）；壳侧两路故意不进集合。 */
const SESSION_SCOPED_ORIGINS = new Set<NonNullable<LogEntry["origin"]>>([]);

/**
 * 该来源的文件是否跨运行累积、需要会话起点裁剪（契约判据，可独立断言）。
 * 留成导出函数，让「哪类来源该裁」有唯一事实来源：视图/store 与测试都问它，而不是各自抄字符串判断。
 */
export function isSessionScopedOrigin(origin: LogEntry["origin"] | undefined): boolean {
  return origin !== undefined && SESSION_SCOPED_ORIGINS.has(origin);
}

/**
 * 会话起点过滤：丢掉「上一次运行」残留的行。只有 `isSessionScopedOrigin` 判为累积的来源才参与
 * 比较；覆盖重建的来源与运行期条目一律保留。行时刻早于起点即判历史，读不出时刻的裸文本行钳到解析当时。
 * @param cutoffMs 会话起点（毫秒）；null/undefined = 不启用该过滤
 */
export function dropStaleEntries(
  entries: Array<LogEntry>,
  cutoffMs: number | null | undefined,
): Array<LogEntry> {
  if (cutoffMs === null || cutoffMs === undefined) {
    return entries;
  }
  return entries.filter((entry) => !isSessionScopedOrigin(entry.origin) || entry.time >= cutoffMs);
}
