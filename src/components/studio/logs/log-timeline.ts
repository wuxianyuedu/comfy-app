/**
 * 日志面板时间线的**身份与合并**纯函数（`log-analysis` 的拆分件）。
 *
 * 这里放「一条日志的身份是什么、两条是不是同一条、新到的一批怎么并进时间线」
 * 这一族判据：`entryKey` / `arrivalKey` / `logEntryKey`、去重索引
 * （`TimelineIndex` 与它的建表 / 复用 / 摘键）、`mergeTimeline` 两版、
 * `lastSeqOf`、会话起点裁剪（`isSessionScopedOrigin` / `dropStaleEntries`）。
 *
 * 拆出来的理由有两条：
 *   1. **文件行数硬闸（规范 §12.6）**：`log-analysis.ts` 逼近 900 行，而这一族是它
 *      内部最自成体系的一段（只吃 `LogEntry` 类型）；
 *   2. **热路径归属**：面板每 2s 一轮的写入合并全落在这里，把它单独成件之后，
 *      「哪一段是每轮都要跑的」在文件边界上就能看出来。
 *
 * 方向：本文件 → `log-types`（类型）；`log-analysis` 从这里取「判重 / 合并」
 * 那几个符号（re-export 保持既有 import 路径不变），无回环。
 */
import type { LogEntry } from "./log-types";

/**
 * 行身份：同一行被多路读到（launcher 转写含 dev 输出）时据此去重。
 *
 * **刻意不含 `origin`**：面板有六个来源、各自从**自己那一份**文件里读，其中若干
 * 文件装的是同一段内容的副本（`dev-launcher.log` 转写 dev 的输出、`shell-launch.log`
 * 与 launcher 的两份互相重叠）。带上 `origin` 会让同一行在时间线上落成六份，
 * 界面上的「全部来源 4000 条」与「各分类之和 24000 条」指的是同一批事件。
 */
function entryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${entry.time}\u0000${entry.level}\u0000${entry.message}`;
}

/**
 * 行身份（**跨来源无关**）：同一条日志不论被哪几路读到，身份都相同。
 *
 * 与 {@link entryKey} 是同一个构造、这里单独留一支具名函数，是为了让
 * 「按身份记账」这件事在调用处读起来是它自己的概念（计数 / 过滤 / 去重共用），
 * 而不是又一次内联模板字符串——三处各写一遍时，改一处忘两处的漂移必然发生。
 */
export function logEntryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return entryKey(entry);
}

/**
 * 时间线去重索引：`entryKey` / `arrivalKey` 两张表。
 *
 * 为什么要有这个显式的结构（而不是每次合并就地建两张 Map）：面板六路轮询每
 * 2s 各写一次，而建表是**对整条时间线**的 O(已有条数)。时间线动辄数千条时，
 * 「只为判出这次送来的一两行是新的」就要走遍全表——实测 5000 条时每轮
 * 2.27ms 全花在建表上，占整次合并的 97%（排序只占 0.11ms）。索引改为跨轮
 * 复用（{@link mergeTimelineIndexed}），建表就只在时间线**形状**变化时发生。
 *
 * `entryKey → LogEntry` 是身份表（**不含 origin**，见 `entryKey` 的说明）；
 * `arrivalKey → LogEntry` 是「同一秒内同级别同正文」的副本表，用于把后到来源
 * 并进已落板那一行。两张表都只持有**引用**，与 `current` 同生命周期。
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
  return { sameArrival, seen };
}

/**
 * 时间线尾部截断后，把索引里**已出窗口**的那些键摘掉（O(被摘掉的条数)）。
 *
 * 为什么摘而不是「重建一次」：本模块的索引之所以存在，就是为了不每轮做 O(n)
 * 的建表（见 {@link TimelineIndex}）。截断发生时若退回重建，面板顶到上限
 * （`LOG_STORE_MAX`）之后每轮又变回全表扫描 —— 恰恰是索引最该省力的那一段。
 *
 * 为什么要摘：出窗口的行若留在索引里，一段**旧内容的重读**（文件被整段重读、
 * 多路轮询副本）会因为它还在 `seen` 里而被当成重复丢掉 —— 表面上与「保留」
 * 同结果，实际差在前者「时间线里没有、也不再补进来」，而截断的语义是「这条
 * 出窗口了」而不是「这条永不再出现」。摘掉之后行为与「从保留段重建」逐字一致。
 *
 * 参数 `droppedEntries` 是**按顺序被截掉的那一段**（`logs.slice(0, -keep)`）。
 * 同一个 key 可能对应另一条仍在窗口里的行（副本行）——那时不能摘，所以摘下
 * 之前比一次引用。
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
 *
 * 无索引版：自己建一次索引（给一次性调用方 / 测试用）。**热路径用
 * {@link mergeTimelineIndexed}**，别让每轮轮询都走这一支。
 */
/**
 * 「时间线 → 它的去重索引」的进程内缓存。
 *
 * 键是**数组引用**：时间线的每一条写入路径都产出新数组（`derive` 把 `logs`
 * 定成数组本身），因此引用相等就是「这份时间线没变过」的判据 —— 与
 * `revision` 那条「新数组 ⟺ 有新行落板」的契约同源。
 *
 * 用 `WeakMap` 而不是「上一个数组 + 它的索引」这种单槽缓存：单槽在
 * `setBootId` 清空后立刻又追加、或在两条时间线之间来回切（测试里常见）时会
 * 反复建表；WeakMap 让「这一份时间线」的索引自然随它一起被回收，不会留下
 * 永不释放的强引用（面板生命周期内时间线可能换很多次引用）。
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
 * 把某份索引登记到某条时间线名下。
 *
 * 只有两处该调它：`mergeTimeline` 内部（合并产出新数组）与 store 的
 * {@link capTimeline} —— 后者是**唯一**另一条会换掉 `logs` 数组引用却不经过
 * `mergeTimeline` 的路径。别处（`derive` / `clear` / `setBootId`）产出的数组
 * 由 `indexOfTimeline` 惰性补建，登记早了反而是让缓存持有已经过期的表。
 */
export function rememberTimelineIndex(entries: Array<LogEntry>, index: TimelineIndex): void {
  timelineIndexCache.set(entries, index);
}

/**
 * {@link mergeTimeline} 的索引复用版：`index` 由调用方跨轮持有。
 *
 * 返回的 `index` **就是**时间线当下的索引（新行已登记），调用方下一轮直接把它
 * 传回来即可；时间线形状变化（截断 / 会话起点裁剪）后须重建，调
 * {@link buildTimelineIndex}。
 *
 * 去重的两条规则与无索引版逐字一致（两处只有「表从哪来」的差异）：
 *   1. **已落板的种类不再落第二份**——按 `entryKey`（不含 origin）去重，
 *      否则界面上的「全部来源」与「各分类之和」指的是同一批事件的两种口径；
 *   2. **同一秒内后到的来源要并进已落板那一行**——它的 origin 可能正是用户
 *      在找的那个（启动行只写在 launcher / dev-launcher 的副本里，用户切到
 *      「启动器」却看不到时，问题就出在这一步没做）。
 *
 * 并 origin 那一步**不改 key**（`entryKey` 不含 origin），因此索引在新行登记
 * 之前就已经是最终形态——这正是「索引可以跨轮复用」成立的前提。
 */
export function mergeTimeline(current: Array<LogEntry>, fresh: Array<LogEntry>): Array<LogEntry> {
  if (fresh.length === 0) {
    return current;
  }
  const { index, logs } = mergeTimelineIndexed(current, fresh, indexOfTimeline(current));
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
    return { index, logs: current };
  }
  const { sameArrival, seen } = index;
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
    return { index, logs: changed ? current.slice() : current };
  }
  const merged =
    current.length === 0 || changed
      ? [...current.map((e) => ({ ...e })), ...added]
      : [...current, ...added];
  merged.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq));
  return { index, logs: merged };
}

/** 同一秒内的副本判据：时刻取整到秒 + 级别 + 正文（`entryKey` 的毫秒容忍版）。 */
function arrivalKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${Math.floor(entry.time / 1000)}\u0000${entry.level}\u0000${entry.message}`;
}

/** 时间线的**真实**末条（最新一条）——「已读水位」「有无新内容」「跳最新」都用它。 */
export function lastSeqOf(logs: Array<LogEntry>): number {
  return logs[logs.length - 1]?.seq ?? 0;
}

/**
 * 哪些来源的文件**跨运行累积**，因此需要会话起点把它们裁到本次运行。
 *
 * 这是客户端与服务端共享的一条事实（服务端 `resumable` 分支从同一原则推导），
 * 所以单独列出来而不是散在判据里。四个来源现在**都不需要裁**：
 *   - `app-runtime`：**一次启动一份文件**（`app-runtime-<时刻>.log`，ISSUE #1326），
 *     文件内容天生只有本次；
 *   - `app`（nextjs-panel-<pid>-<ts>.log）：文件名按进程命名，服务端取「目录里最新
 *     的那一份」；本次进程还没落盘时确实可能读到上一个进程的文件，但那份文件里
 *     的行属于**上一次应用启动**、时刻早于本次会话起点这件事由 `bootId` 的重启
 *     判据（`/api/logs/current` 的 `mismatch`）处理，比行时刻更准；
 *   - `launcher`（dev-launcher-stderr.log）/ `dev`（dev-launcher.log）：
 *     每次运行**覆盖重建**，文件内容天然只有本次。
 *
 * ## ISSUE #1326 之后这个集合空了（机制保留）
 *
 * `app-runtime` 曾经是这里唯一的成员：它固定名追加不轮转，上一次运行的行全留在
 * 同一个文件里，只能靠「行时刻 ≥ 会话起点」把它挡在面板外。现在它**一次启动一份
 * 文件**（`app-runtime-<时刻>.log`），`app`（应用服务输出转录）也一直是按进程
 * 命名 —— 两个来源的文件天生只含本次，裁剪不再需要。
 *
 * 机制本身留着（`dropStaleEntries` 仍被 store 调用、`sessionStart` 仍在契约里）：
 * 它是「某个来源将来变成跨运行累积」时的**唯一**出口，删掉它会诱使下一个人
 * 在面板里再写一遍时间线比较。集合为空时函数恒真、零开销。
 *
 * 为什么必须逐来源判定、而不能拿一个全局 cutoff 往整条时间线上套：
 * 会话起点取自 `dev-launcher.log` 的 mtime，而**壳写下的头几行在它被创建
 * 之前**（exe 路径、项目根、探测结果…）。用一个全局 cutoff 一刀切，
 * 这些真·本次运行的行会被当成历史丢掉——用户读到的就是「启动和启动器日志
 * 丢失」（ISSUE #262 复审）。覆盖重建的来源不存在「历史行」，因此不参与裁剪。
 *
 * 壳侧两路（shell / shell-launch）**故意不进**这个集合：它们的文件虽然是追加
 * 写、跨运行累积，但同一条锚点晚于壳的启动报告——按会话裁剪会把「为什么起
 * 不来」的头几行裁掉（见 `/api/logs/current` 的 resolveSourceFile 注释）。
 */
const SESSION_SCOPED_ORIGINS = new Set<NonNullable<LogEntry["origin"]>>([]);

/**
 * 该来源的文件是否跨运行累积、需要会话起点裁剪（契约判据，可独立断言）。
 *
 * 留成导出函数是为了让「哪类来源该裁」这条契约有唯一事实来源：视图/store 与
 * 测试都问它，而不是各自抄一份字符串判断。
 */
export function isSessionScopedOrigin(origin: LogEntry["origin"] | undefined): boolean {
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
  entries: Array<LogEntry>,
  cutoffMs: number | null | undefined,
): Array<LogEntry> {
  if (cutoffMs === null || cutoffMs === undefined) {
    return entries;
  }
  return entries.filter((entry) => !isSessionScopedOrigin(entry.origin) || entry.time >= cutoffMs);
}
