"use client";

/**
 * 日志面板行头的「级别筛选 + 搜索」一组控件（从 `LogPanel.tsx` 拆出）。
 *
 * 拆分的直接理由是**文件行数**（规范 §12.6 的超限文件棘轮）：`LogPanel` 本来就
 * 是「筛选 / 分页 / 虚拟滚动 / 锚定」四件事挤在一起，其中「行头那排筛选按钮该
 * 怎么排」与面板的滚动逻辑毫无耦合，且注释与类名占了很大篇幅。拆开之后
 * 面板本体只管滚动与分页。
 *
 * 口径：这一组控件**自己从 store 取状态**（`useLogPanel`），不再由面板把
 * `filter / search / setFilter / setSearch` 当 props 传下来 —— 那几个值本来就
 * 只有这块用，传一遍只是把同一份依赖写两处（与 `SaveExportButton` 同一口径）。
 * **渲染位置仍由面板决定**（它在 `min-w-56` 那个弹性容器里）。
 */

import { Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useLogPanel } from "./LogProvider";
import { FILTER_SELECTED_STYLES } from "./log-row-style";
import type { LogFilter, LogLevelCounts } from "./log-store";

/* 级别色（语义 token，规范 03 §3.6.2）：原实现把 cyan / amber / rose 的四个档位
 * 全部写死（每个还带一条 hover 档），改品牌色与状态色时这一排不动。现在统一走
 * `--color-info` / `--color-warning` / `--color-danger` —— 且都不再手写 `dark:`，
 * 文字档的 `-strong` 自带两态取值。
 * `debug` 保持中性（它与 `all` 的区别是「更窄的筛」，不是「一种状态色」）。 */
const LEVEL_LABEL_STYLES: Record<LogFilter, string> = {
  all: "text-ink-bright",
  debug: "text-ink-muted hover:text-ink",
  info: "text-info-strong hover:opacity-80",
  warn: "text-warning-strong hover:opacity-80",
  error: "text-danger-strong hover:opacity-80",
};

export const FILTER_LABELS: { label: string; value: LogFilter }[] = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

/**
 * 级别按钮上的计数数字。
 *
 * **定宽 + 右对齐 + 等宽数字**：四个按钮上的 `0 / 12 / 3 / 1822` 宽度不一，
 * 按钮再等分也读不齐。这里给它一个显式的 `w-[4ch]`——「文字 + 四位数字」是
 * 这一格的固定预算，所以**文本长度不再随内容变化**。
 *
 * 数字本身不再按级别染色（`text-ink-fainter` 固定）：级别色已由同一行左侧的
 * **标签文字**承担（「警告」黄、「错误」红），同一个含义不必写两遍，
 * 也避免两个色块挤在一个按钮里互相稀释。
 */
function CountChip({ value }: { value: number }) {
  return (
    <span className="text-ink-fainter w-[4ch] shrink-0 text-right text-[11px] tabular-nums">
      {value}
    </span>
  );
}

export function LogFilterBar({
  originCounts,
}: {
  /** **当前来源**下的各级别计数（与来源下拉同口径，两边永远对得上）。 */
  originCounts: LogLevelCounts;
}) {
  const filter = useLogPanel((state) => state.header.filter);
  const search = useLogPanel((state) => state.header.search);
  const setFilter = useLogPanel((state) => state.setFilter);
  const setSearch = useLogPanel((state) => state.setSearch);

  return (
    <>
      {/* 这个容器同时承担两件事：
          1. **它自己就是那块弹性空间**——不再另设无名空白，四个按钮等分富余
             宽度（用户诉求：「全部/警告/错误这些挤在一起，可以占用大些空间」）；
             右侧的搜索 / 来源下拉 / 操作按钮也因此被顶到最右，不必再靠一个
             单独的 `flex-1` 空白——多一个 `flex-1` 只会和它平分富余宽度，
             于是「空白又回来了」。
          2. **`min-w-56` 是折行与否的判据**：可用宽度不足 224px 时它整组落到
             第二行（`flex-wrap` 的换行单位就是这个容器）并吃掉整行宽度。
             比「每个按钮各自 min-w 后硬挤」好在：无论多窄，标签都保持可读，
             不会退化成只剩一列竖字。 */}
      <div className="ml-3 flex min-w-56 flex-1 basis-0 items-center gap-1">
        {FILTER_LABELS.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            /* `min-w-fit` 取的是**内容固有宽度**：`min-w-0` 会让容器压到能
             * 忽略固有宽度、于是「警告」被切成 `警…`（ISSUE #262）。窄窗口下
             * 整组可能横向溢出，交给行头的 `flex-wrap` 接住（折行判据就是
             * 上面容器的 `min-w-56`），而不是靠切字。
             * 选中态见 log-row-style 的 FILTER_SELECTED_STYLES。 */
            className={`flex h-9 min-w-fit flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] leading-none transition-colors ${
              filter === option.value
                ? FILTER_SELECTED_STYLES
                : "hover:bg-subtle"
            } ${LEVEL_LABEL_STYLES[option.value]}`}
            title={`当前来源的${option.label}：${originCounts[option.value]} 条（该来源共 ${originCounts.all} 条 · 警告 ${originCounts.warn} · 错误 ${originCounts.error}）`}
          >
            <span className="whitespace-nowrap">{option.label}</span>
            <CountChip value={originCounts[option.value]} />
          </Button>
        ))}
      </div>

      {/* Search 紧跟在级别按钮之后（不再 `ml-auto`）。
          行头的稀有宽度应当优先给**类别与条数**：搜索框是偶尔才用一次的
          控件，却因为吃掉了 `ml-auto` 多出来的全部空间，把来源下拉一直顶在
          级别按钮旁边，两者之间空出一大片（用户截图的红框正是这块空白），
          而左侧那排四位数的计数反而最挤。现在下拉右移贴住搜索框，
          中间被让出来的宽度由 `flex-1` 的空白区吸收。 */}
      {/* 搜索框可收缩（`shrink` + `min-w`）：行头窄到放不下时它先让位，
          而不是去挤筛选器的标签。`w-56` 是它舒展时的宽度。 */}
      <div className="relative flex w-56 min-w-24 shrink items-center">
        <Search
          size={14}
          className="text-ink-fainter pointer-events-none absolute left-2.5"
        />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索日志（支持命中高亮）..."
          className="border-border-strong bg-canvas-deep text-ink-field placeholder:text-ink-fainter focus:border-primary-500/40 h-8 w-full rounded-lg border pr-7 pl-8 text-[13px] outline-none"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSearch("")}
            className="text-ink-muted hover:text-ink absolute right-2"
          >
            ×
          </Button>
        )}
      </div>
    </>
  );
}
