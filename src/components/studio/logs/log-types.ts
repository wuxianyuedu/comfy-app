/**
 * 日志面板共享类型的**叶子**模块（`log-store` 的拆分件）：`LogLevel` / `LogEntry` / `LogFilter` / `LogOriginFilter` / `CONSOLE_ORIGIN` / `bucketOf` / `LogLevelCounts` / `LogOriginCounts` / `LOG_PAGE_SIZE`。
 * 被主模块与 `log-analysis.ts` 共同消费；§12.7 的 `check-circular-deps` 不看 `import type`、AST 上有边就算环，所以共享类型必须沉到独立叶子才能拉直方向，`log-store` re-export 保持既有 import 路径不变。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 面板每页最多显示多少条——面板对「同时显示数」的**唯一**上限。时间线本身不设总数上限（用户要求能往前
 * 翻完整段）；此前 2000 条环形缓冲被应用服务高频行占满，启动 / 启动器的早期行被整批挤出，那两个来源恒为空。
 * 渲染成本由每页 ≤ LOG_PAGE_SIZE 兜住，内存增速由「自轮询行不进面板」压到接近业务增速；完整历史在 log/ 文件里。
 */
export const LOG_PAGE_SIZE = 2000;

export type LogEntry = {
  /** nanoid 风格的短 id */
  id: string;
  level: LogLevel;
  /** console 日志的调用位置（文件:行号） */
  location?: string;
  /** Serialized message */
  message: string;
  /** 文件来源：dev-launcher / launcher / 应用服务输出 / app-runtime 的文件行带此标记。 */
  origin?: "dev" | "launcher" | "app" | "app-runtime" | "shell" | "shell-launch";
  /**
   * 入库顺序：只在同一毫秒内作为稳定排序次键（时间戳相同时保持确定先后），以及「去重后是否为新内容」
   * 的判据。它**不参与**跨毫秒排序——时间线按 `time` 升序，这是面板「按时间显示」的定义本身（ISSUE #262）。
   */
  seq: number;
  /** Where the log came from（console / tauri / system）。 */
  source: "console" | "tauri" | "system";
  /** 日志写入时刻（毫秒）。排序、展示、会话边界判定都用它。 */
  time: number;
};

export type LogFilter = LogLevel | "all";

/**
 * 面板可筛选的来源（`all` = 全部）。比 `LogEntry["origin"]` 多一个 `"console"`：面板里有**三分之一的行
 * 不属于任何文件来源**（console 拦截、Tauri 事件、全局未捕获错误，`origin` 为 undefined），此前只在
 * 「全部来源」下可见、切到任何来源就整批藏起来，也没地方看出「还有一批行没被覆盖」。因此「控制台 /
 * 全局错误」是真分类：有自己的计数，且 `console + 四个文件来源 = 全部来源`（见 computeOriginCounts 守恒契约）。 */
export type LogOriginFilter = NonNullable<LogEntry["origin"]> | "console" | "all";

/**
 * 行没有文件来源（`origin` 为 undefined）时归入的桶（见 {@link LogOriginFilter}）。单独取个名字而不是
 * 各处散写 `"console"` 字面量：它是这条归类规则的唯一事实来源，视图、计数、过滤三处都问它。
 */
/* SAFETY: 类型断言已复核 */
export const CONSOLE_ORIGIN = "console" as const;

/** 有文件来源的行 → 它自己的来源；没有的 → 「控制台 / 全局错误」桶。 */
export function bucketOf(entry: Pick<LogEntry, "origin">): LogOriginFilter {
  return entry.origin ?? CONSOLE_ORIGIN;
}

/**
 * 可在「设置 → 日志」里逐个开关的日志分类：`LogOriginFilter` 去掉 `"all"` 后的真子集，面板里能按来源
 * 筛的那几类这里都能单独关掉。新增来源分类时往这里加一项，`ORIGIN_LABELS` / `ORIGIN_TEXT` 也要同步。
 */
export type LogCategoryFilter = Exclude<LogOriginFilter, "all">;

/** 分类的展示顺序（设置页开关与未来任何枚举都按它排列）。 */
export const LOG_CATEGORY_FILTERS: Array<LogCategoryFilter> = [
  "app-runtime",
  "app",
  "dev",
  "launcher",
  "shell-launch",
  "shell",
  "console",
];

/** 单一级别的计数表（`all` = 该范围内全部级别）。 */
export type LogLevelCounts = Record<LogLevel | "all", number>;

/** 来源 × 级别的二维计数表（`all` 键为全部来源汇总，见 computeOriginCounts）。 */
export type LogOriginCounts = Record<LogOriginFilter, LogLevelCounts>;
