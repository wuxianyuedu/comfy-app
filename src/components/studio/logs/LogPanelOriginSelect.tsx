"use client";

/**
 * 日志面板的「来源筛选下拉」子树（`LogPanel` 的拆分件）。
 *
 * 从 `LogPanel.tsx` 抽出：`OriginSelect` 组件 + 它私有的 `CountColumn` /
 * `asOriginFilter` / `ORIGIN_COLUMNS` / `ORIGIN_LABELS`，以及对外共享的
 * `ORIGIN_TEXT`（页脚与标题徽标也用同一份来源文案）与 `levelSummary` /
 * `optionCountsText` 两个摘要函数。
 *
 * 拆分动机：`LogPanel.tsx` 992 行超过 §12.6 文件长度棘轮的阈值，而这块
 * 「来源下拉的排版与文案」与主组件里的虚拟滚动 / 事件处理**没有共享状态**、
 * 只是一次性拿 `value` + `countsByOrigin` 渲染，天然适合拆出去。主组件从
 * `./LogPanelOriginSelect` import `OriginSelect` 与 `ORIGIN_TEXT`；对外语义
 * 不变（消费者仍是 `~/components/studio/logs/LogPanel`）。
 */
import {
  CONSOLE_ORIGIN,
  type LogLevel,
  type LogLevelCounts,
  type LogOriginFilter,
} from "./log-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { LOG_PANEL_POPUP_Z_CLASS } from "./log-panel-layers";
import { displayValue } from "~/lib/display-value";

/** 单个级别的摘要文案；零条目的级别说「无」——它也是一条信息，不是空白。 */
function levelSummary(label: string, value: number): string {
  return value > 0 ? `${label} ${value}` : `${label}无`;
}

/**
 * 来源下拉里每一项自己的计数摘要（`1822 条 · 信息 1821 · 警告 1 · 错误无`）。
 *
 * 它回答的是「**切过去**会看到多少」，与当前选中的是哪一个无关——所以在
 * 收起状态（扳机/触发按钮）里**不显示**：那是「已经选好了」的地方，数字重复
 * 一遍只占宽度（用户反馈：下拉显示的文本不需要再报一遍每一项有多少，左侧
 * 级别按钮上都看得到）。
 *
 * 打开后的候选列表另走 `SelectItem` 的多列布局（数字右对齐成表），这里只提供
 * 纯文本版本给屏幕阅读器与已选值兜底。
 */
function optionCountsText(counts: LogLevelCounts): string {
  return [
    `${counts.all} 条`,
    levelSummary("信息", counts.info),
    levelSummary("警告", counts.warn),
    levelSummary("错误", counts.error),
  ].join(" · ");
}

/**
 * 计数列（下拉候选列表里每个来源右边的四列数字）。
 *
 * 四列**定宽 + 右对齐 + 等宽数字**是这里的全部要点：宽度随内容变的数字列
 * 排在一起必然参差（`1769` 与 `0` 的视觉差异），读起来就是「对不齐、很难看」。
 * 所以每列显式定宽（`w-14`，容纳最大的四位数），「条」固定在总数那一列里。
 *
 * 零条目一律写「—」且保持灰色：整列 `0` 与「那一行本来就没有这项」长得一样，
 * 而这里要表达的正是「这个来源没有警告」这个**结论**（与级别按钮上显示 `0`
 * 而不隐藏同一条原则）。
 */
function CountColumn({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "warn" | "error";
}) {
  const color =
    value === 0
      ? "text-ink-fainter"
      : tone === "warn"
        ? "text-warning-strong"
        : tone === "error"
          ? "text-destructive"
          : "text-ink-soft";
  return (
    <span className={`w-14 shrink-0 text-right tabular-nums ${color}`}>
      {/* 计数徽标：**0 是有意义的「无」，不是缺值** —— 所以这里不套
       *  `displayValue`（它会把 0 照常显示成 "0"，那是给「量」用的），而是
       *  显式判 `> 0`，让占位符与屏幕阅读器文案来自同一个判断。 */}
      {value > 0 ? value : displayValue(null)}
      <span className="sr-only">{value > 0 ? ` ${label}` : ` 无${label}`}</span>
    </span>
  );
}

/**
 * 把下拉回传的选中值收窄成来源筛选键。
 *
 * `Select` 的 `value` 是「任意可序列化值」（库的类型是 `any`），而我们只放
 * `LogOriginFilter` 这几个字符串。这里用一个真正的收窄函数而不是 `as`：值若
 * 意外为空/未知，落到「全部来源」这个**安全默认**上，而不是把 `undefined` 塞进
 * 索引里去渲染 `undefined`。
 */
function asOriginFilter(value: unknown): LogOriginFilter {
  return typeof value === "string" && value in ORIGIN_TEXT
    ? (value as LogOriginFilter)
    : "all";
}

/** 下拉候选列表的列宽（列标题与各行共用，列与列才对得上）。 */
const ORIGIN_COLUMNS: {
  key: LogLevel | "all";
  title: string;
  tone: "muted" | "warn" | "error";
}[] = [
  { key: "all", title: "条数", tone: "muted" },
  { key: "info", title: "信息", tone: "muted" },
  { key: "warn", title: "警告", tone: "warn" },
  { key: "error", title: "错误", tone: "error" },
];

/**
 * 级别标签在筛选按钮上的配色。
 *
 * 用户要求很直接：「警告文字改成黄色，错误改成红色」。颜色给**文字**而不是
 * 数字，是因为按 `/警告/` 找过去时，用户扫的是这几个字；数字（`4ch` 定宽）
 * 保持中性灰，才不会出现「两个字都带色、读起来像两个高亮块」。
 *
 * 零条目也照样着色：它表达的仍然是「这一格是警告」，而不是「这里有问题」——
 * 「有没有问题」由数字回答（`0` 与「切过去是空的」互相印证）。
 */
/* 来源筛选（ISSUE #262）：启动日志与应用运行日志此前混在一屏，query 噪音把
 * 业务日志挤掉。分开看是最直接的「让日志有意义」手段。
 *
 * 文案统一取自 ORIGIN_TEXT（此前下拉里叫「启动」、页脚里叫「开发服务」，
 * 同一个来源两种叫法，用户对不上号）。 */
const ORIGIN_LABELS: LogOriginFilter[] = [
  "all",
  "app-runtime",
  "app",
  "dev",
  "launcher",
  CONSOLE_ORIGIN,
];

/**
 * 来源的显示文案（下拉、标题徽标、页脚共用一份，避免同一来源三种叫法）。
 */
const ORIGIN_TEXT: Record<LogOriginFilter, string> = {
  all: "全部来源",
  "app-runtime": "应用运行",
  /** 应用服务自身输出（Next dev server 的 stdout/stderr 转录）。 */
  app: "应用服务",
  dev: "启动",
  launcher: "启动器",
  /* 无文件来源的那些行（浏览器 console 拦截、Tauri 事件、全局未捕获错误）。
   * 文案写「控制台 / 全局错误」而不是「其他」：它回答的是「这批行是谁写的」，
   * 让用户一眼知道切过去能看到什么（`ResizeObserver loop…`、未捕获的 Promise
   * 拒绝都在这里）。 */
  [CONSOLE_ORIGIN]: "控制台 / 全局错误",
};

/**
 * 来源筛选下拉。
 *
 * 用 `Select`（base-ui）而不是原生 `<select>`，只为一件事：**候选列表能排版**。
 * 原生 `<option>` 只接受纯文本、且字体与列宽由 OS 决定，"应用服务 · 1769 条 ·
 * 信息 1769" 与 "启动 · 46 条 · 信息 46" 的冒号、数字必然对不上——用户反馈的
 * 「能像表格一样吗，现在对不齐」就是这个。换成自绘列表后，数字挤成四列定宽右
 * 对齐，读起来就是一张表。
 *
 * 分工：
 * - **扳机（收起态）**只显示当前来源的名字——具体多少条、多少警告在左侧级别
 *   按钮与标题徽标上，这里再写一遍既重复又撑宽控件（用户反馈第 4 条）；
 * - **候选列表**才是「切换之前先看行情」的地方：每个来源一行，行内四列数字。
 */
function OriginSelect({
  value,
  countsByOrigin,
  onChange,
}: {
  value: LogOriginFilter;
  countsByOrigin: Record<LogOriginFilter, LogLevelCounts>;
  onChange: (next: LogOriginFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger
        size="sm"
        aria-label="按来源筛选"
        title="按来源筛选：展开后每项都标出该类别的条数与本机上的信息 / 警告 / 错误"
        className="border-border-strong bg-canvas-deep text-ink-field h-8 rounded-lg text-[12px]"
      >
        {/* 只写来源名：具体多少条、多少警告在左侧级别按钮与标题徽标上，
            这里再报一遍既不增加信息量，又把本就不宽的行头再挤掉一块。 */}
        <SelectValue>
          {(selected) => ORIGIN_TEXT[asOriginFilter(selected)]}
        </SelectValue>
      </SelectTrigger>
      {/* 弹层必须盖在日志面板之上：面板遮罩走刻度表的 `modal` 档（见本文件底部
          overlayClass 的 z 参数），而 Select 的定位层若低于它——弹层照常画出来，却整块
          压在遮罩底下**收不到指针事件**。用户读到的现象就是「点了下拉看不到菜单」
          与「没法切换来源」，来源筛选因此形同失效（ISSUE #262）。
          层级给在定位层（positionerClassName）而不是 Popup：Popup 的 z 只在
          定位层建立的 stacking context 内部比较，改它越不出这一层。 */}
      {/* `w-(--anchor-width)` 会把弹层压到扳机那么宽，四列数字直接挤成一团；
          这里放开宽度，让弹层按内容（四个定宽列）撑开。
          注意 `w-auto` / `min-w-max` 的**级联顺序**：两者都比 `w-(--anchor-width)`
          后出现，因此最终生效的是内容宽度（这正是这里要的效果）；反过来若把
          `w-auto` 去掉，弹层会被压到扳机的 90px，四列数字挤成一团。 */}
      <SelectContent
        positionerClassName={LOG_PANEL_POPUP_Z_CLASS}
        /* 与扳机**底边**对齐（用户要求：「弹出下拉菜单的最上方和下拉按钮的
         * 最下方对齐即可」）。
         *
         * base-ui 的 `alignItemWithTrigger` 默认会把弹层挪去盖住扳机本身，
         * 于是头部在窗口顶端时弹层只能向上生长——实测直接顶到窗口最上方、
         * 盖住标题行的左侧（截图里就是这样）。两条一起改：
         *   - `alignItemWithTrigger={false}`：弹层不覆盖扳机，从它下面开始；
         *   - `collisionAvoidance={{ side: "none" }}`：撞到视口底部也不翻到
         *     上面去，需要时改为**滚动**弹层自身。
         * 于是弹层顶边恒等于扳机底边（sideOffset 4px），与窗口位置无关。 */
        alignItemWithTrigger={false}
        collisionAvoidance={{ side: "none" }}
        className="border-border-strong bg-card text-ink-field w-auto min-w-max rounded-lg border p-0"
      >
        {/* 列标题：把「数字是什么」写在一次，行内就不必每格重复「信息 / 警告」 */}
        <div
          aria-hidden
          className="border-border-strong text-ink-muted flex items-center gap-3 border-b px-2.5 py-1 text-[11px]"
        >
          <span className="w-16 shrink-0">来源</span>
          {ORIGIN_COLUMNS.map((column) => (
            <span key={column.key} className="w-14 shrink-0 text-right">
              {column.title}
            </span>
          ))}
        </div>
        <div className="p-1">
          {ORIGIN_LABELS.map((origin) => {
            const counts = countsByOrigin[origin];
            return (
              <SelectItem
                key={origin}
                value={origin}
                className="gap-0 py-1 pr-7 pl-1.5 text-[12px]"
              >
                <span className="flex items-center gap-3">
                  <span className="text-ink-bright w-16 shrink-0">
                    {ORIGIN_TEXT[origin]}
                  </span>
                  {ORIGIN_COLUMNS.map((column) => (
                    <CountColumn
                      key={column.key}
                      label={column.title}
                      value={counts[column.key]}
                      tone={column.tone}
                    />
                  ))}
                </span>
                {/* 纯文本版本，供屏幕阅读器与测试断言（自绘列是视觉产物） */}
                <span className="sr-only">{optionCountsText(counts)}</span>
              </SelectItem>
            );
          })}
        </div>
      </SelectContent>
    </Select>
  );
}

export { OriginSelect, ORIGIN_TEXT };
