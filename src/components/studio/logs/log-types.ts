/**
 * 日志面板共享类型的**叶子**模块（`log-store` 的拆分件）。
 *
 * 从 `log-store.ts` 抽出：`LogLevel`、`LogEntry`、`LogFilter`、
 * `LogOriginFilter`、`CONSOLE_ORIGIN`、`bucketOf`、`LogLevelCounts`、
 * `LogOriginCounts`、`LOG_PAGE_SIZE`。原本内联在主模块、被主模块与
 * `log-analysis.ts`（拆分件）共同消费；§12.7 的 `check-circular-deps` 不看
 * `import type`、只要 AST 上有 import 边就算环，所以共享类型必须沉到独立
 * 叶子才能真正拉直方向：
 *   `log-analysis.ts` 依赖叶子 `log-types.ts`
 *   `log-store.ts` 依赖叶子 `log-types.ts`（并 re-export 保持既有 import 路径不变）。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 面板每页最多显示多少条——这是面板对「同时显示数」的**唯一**上限。
 *
 * 时间线本身**不设总数上限**（用户要求：日志要能往前翻完整段，不再被
 * 「面板保留最近 2000 条」截断）。此前有 2000 条环形缓冲时，应用服务来源的
 * 高频行把这 2000 条全部占满，启动 / 启动器写在启动早期的行被整批挤出去，
 * 用户看到的就是那两个来源恒为空。渲染成本由每页 ≤ LOG_PAGE_SIZE 兜住；
 * 内存随运行时长增长的速率由「面板自轮询行不进面板」（isPanelSelfPollingLine）
 * 压到接近业务增速，完整历史始终在 log/ 下的文件里，可按需重读。
 */
export const LOG_PAGE_SIZE = 2000;

export interface LogEntry {
  /** nanoid 风格的短 id */
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
  /** console 日志的调用位置（文件:行号） */
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

/**
 * 可在「设置 → 日志」里逐个开关的日志分类。
 *
 * 是 `LogOriginFilter` 去掉 `"all"` 后的真子集——面板里能按来源筛的那几类，
 * 这里都能单独关掉。新增一个来源分类时，往这里加一项即可（来源下拉的
 * `ORIGIN_LABELS` / `ORIGIN_TEXT` 也要同步）。
 */
export type LogCategoryFilter = Exclude<LogOriginFilter, "all">;

/** 分类的展示顺序（设置页开关与未来任何枚举都按它排列）。 */
export const LOG_CATEGORY_FILTERS: LogCategoryFilter[] = [
  "app-runtime",
  "app",
  "dev",
  "launcher",
  "console",
];

/** 单一级别的计数表（`all` = 该范围内全部级别）。 */
export type LogLevelCounts = Record<LogLevel | "all", number>;

/** 来源 × 级别的二维计数表（`all` 键为全部来源汇总，见 computeOriginCounts）。 */
export type LogOriginCounts = Record<LogOriginFilter, LogLevelCounts>;
