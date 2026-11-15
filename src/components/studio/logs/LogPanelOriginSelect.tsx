"use client";

/**
 * 日志面板的「来源筛选下拉」子树（`LogPanel` 的拆分件）：放 `OriginSelect` 及私有
 * `CountColumn` / `asOriginFilter` / `ORIGIN_*`、共享的 `ORIGIN_TEXT`（页脚与标题徽标同用）
 * 与 `levelSummary` / `optionCountsText`；与主组件的虚拟滚动 / 事件处理无共享状态。
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
  SelectGroup,
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
 * 来源下拉里每一项的计数摘要（`1822 条 · 信息 1821 · 警告 1 · 错误无`）。
 * 它回答「切过去会看到多少」，与当前选中无关，所以收起态不显示（级别按钮上已有）。
 * 候选列表另走 `SelectItem` 多列布局，这里只提供纯文本给屏幕阅读器与已选值兜底。
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
 * 四列定宽（`w-14`）+ 右对齐 + 等宽数字：宽度随内容变的数字列必然参差难读。
 * 零条目一律写「—」且保持灰色——表达「这个来源没有警告」这一结论。
 */
function CountColumn({
  label,
  value,
  tone,
}: {
  label: string;
  tone: "muted" | "warn" | "error";
  value: number;
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
 * 来源的显示文案（下拉、标题徽标、页脚共用一份，避免同一来源三种叫法）。
 */
const ORIGIN_TEXT: Record<LogOriginFilter, string> = {
  /* 「全部来源」是**日志条数**（同一条日志被六路读到只算一条）；下面那六个是
   * **切过去会看到几行**（各自文件里的副本各算一条）。两个口径都写在界面上，
   * 不靠用户自己推：同一批启动行躺在 launcher / 启动 / 壳侧编排 / 壳日志四份
   * 文件里，相加本来就不等于上面那个数——把它们画成一列可相加的分项，是这条
   * 下拉最容易被误读的地方（e2e 曾按「可相加」断言，整批跑时必红）。 */
  all: "全部来源（按条去重）",
  "app-runtime": "应用运行",
  /** 应用服务自身输出（Next dev server 的 stdout/stderr 转录）。 */
  app: "应用服务",
  dev: "启动",
  launcher: "启动器",
  /** 壳侧编排链路（log/current/launcher/shell-launch.log）：双击启动最早的现场。 */
  "shell-launch": "壳侧编排",
  /** 壳自持日志（log/shell/shell.log）：壳自己的诊断与编排器转发。 */
  shell: "壳日志",
  /* 无文件来源的那些行（浏览器 console 拦截、Tauri 事件、全局未捕获错误）。
   * 文案写「控制台 / 全局错误」而不是「其他」：它回答的是「这批行是谁写的」，
   * 让用户一眼知道切过去能看到什么（`ResizeObserver loop…`、未捕获的 Promise
   * 拒绝都在这里）。 */
  [CONSOLE_ORIGIN]: "控制台 / 全局错误",
};

/**
 * 把下拉回传的选中值收窄成来源筛选键。
 * `Select` 的 value 类型是 `any`；值意外为空/未知时落到「全部来源」这个安全默认，
 * 而不是把 `undefined` 塞进索引去渲染。
 */
function isOriginFilter(value: unknown): value is LogOriginFilter {
  return typeof value === "string" && value in ORIGIN_TEXT;
}

function asOriginFilter(value: unknown): LogOriginFilter {
  return isOriginFilter(value) ? value : "all";
}

/** 下拉候选列表的列宽（列标题与各行共用，列与列才对得上）。 */
const ORIGIN_COLUMNS: Array<{
  key: LogLevel | "all";
  title: string;
  tone: "muted" | "warn" | "error";
}> = [
  { key: "all", title: "条数", tone: "muted" },
  { key: "info", title: "信息", tone: "muted" },
  { key: "warn", title: "警告", tone: "warn" },
  { key: "error", title: "错误", tone: "error" },
];

/**
 * 级别标签在筛选按钮上的配色。
 * 颜色给**文字**而不是数字：用户按 `/警告/` 扫的是字；数字（`4ch` 定宽）保持中性灰，
 * 避免两个高亮块互相稀释。零条目也照样着色——它表达「这一格是警告」。
 */
/* 来源筛选（ISSUE #262）：启动日志与应用运行日志此前混在一屏，query 噪音把
 * 业务日志挤掉。分开看是最直接的「让日志有意义」手段。
 *
 * 文案统一取自 ORIGIN_TEXT（此前下拉里叫「启动」、页脚里叫「开发服务」，
 * 同一个来源两种叫法，用户对不上号）。 */
const ORIGIN_LABELS: Array<LogOriginFilter> = [
  "all",
  "app-runtime",
  "app",
  "dev",
  "launcher",
  "shell-launch",
  "shell",
  CONSOLE_ORIGIN,
];

/**
 * 来源筛选下拉。用 base-ui `Select` 而非原生 `<select>`，只为候选列表能排版（原生 option 字宽由
 * OS 决定、数字对不齐）；扳机只显示来源名，候选列表每来源一行、四列定宽右对齐数字。
 */
function OriginSelect({
  value,
  countsByOrigin,
  onChange,
}: {
  countsByOrigin: Record<LogOriginFilter, LogLevelCounts>;
  onChange: (next: LogOriginFilter) => void;
  value: LogOriginFilter;
}) {
  return (
    <Select
      onValueChange={(next) => {
        onChange(next ?? "all");
      }}
      value={value}
    >
      <SelectTrigger
        aria-label="按来源筛选"
        className="border-border-strong bg-canvas-deep text-ink-field h-8 rounded-lg text-xs"
        size="sm"
        title="按来源筛选：展开后每项都标出该类别的条数与本机上的信息 / 警告 / 错误"
      >
        {/* 只写来源名：具体多少条、多少警告在左侧级别按钮与标题徽标上，
            这里再报一遍既不增加信息量，又把本就不宽的行头再挤掉一块。 */}
        <SelectValue>{(selected) => ORIGIN_TEXT[asOriginFilter(selected)]}</SelectValue>
      </SelectTrigger>
      {/* 来源下拉弹层必须高于面板遮罩（modal 档），否则整块压在遮罩下收不到指针事件，
          现象是「点下拉看不到菜单 / 没法切换来源」（ISSUE #262）。层级给在定位层
          `positionerClassName` 而非 Popup：Popup 的 z 越不出定位层建立的 stacking context。 */}
      {/* `w-(--anchor-width)` 会把弹层压到扳机那么宽，四列数字直接挤成一团；
          这里放开宽度，让弹层按内容（四个定宽列）撑开。
          注意 `w-auto` / `min-w-max` 的**级联顺序**：两者都比 `w-(--anchor-width)`
          后出现，因此最终生效的是内容宽度（这正是这里要的效果）；反过来若把
          `w-auto` 去掉，弹层会被压到扳机的 90px，四列数字挤成一团。 */}
      <SelectContent
        /* 扳机底边对齐（用户要求「弹层最上方与下拉按钮最下方对齐」）：关掉
         * `alignItemWithTrigger` 使弹层不覆盖扳机，`collisionAvoidance.side="none"`
         * 让撞到底部时不翻上去（改用弹层自身滚动），顶边恒等于扳机底边 + sideOffset 4px。 */
        alignItemWithTrigger={false}
        className="border-border-strong bg-card text-ink-field w-auto min-w-max rounded-lg border p-0"
        collisionAvoidance={{ side: "none" }}
        positionerClassName={LOG_PANEL_POPUP_Z_CLASS}
      >
        {/* 列标题：把「数字是什么」写在一次，行内就不必每格重复「信息 / 警告」 */}
        <div
          aria-hidden
          className="border-border-strong text-ink-muted text-2xs flex items-center gap-3 border-b px-2.5 py-1"
        >
          <span className="shrink-0">来源</span>
          {ORIGIN_COLUMNS.map((column) => (
            <span className="w-14 shrink-0 text-right" key={column.key}>
              {column.title}
            </span>
          ))}
        </div>
        <div className="p-1">
          <SelectGroup>
            {ORIGIN_LABELS.map((origin) => {
              const counts = countsByOrigin[origin];
              return (
                <SelectItem className="gap-0 py-1 pr-7 pl-1.5 text-xs" key={origin} value={origin}>
                  <span className="flex items-center gap-3">
                    <span className="text-ink-bright shrink-0">{ORIGIN_TEXT[origin]}</span>
                    {ORIGIN_COLUMNS.map((column) => (
                      <CountColumn
                        key={column.key}
                        label={column.title}
                        tone={column.tone}
                        value={counts[column.key]}
                      />
                    ))}
                  </span>
                  {/* 纯文本版本，供屏幕阅读器与测试断言（自绘列是视觉产物） */}
                  <span className="sr-only">{optionCountsText(counts)}</span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </div>
      </SelectContent>
    </Select>
  );
}

export { OriginSelect, ORIGIN_TEXT };
