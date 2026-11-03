"use client";

/**
 * 日志面板行头的「级别筛选 + 搜索」一组控件。「行头那排按钮该怎么排」与面板滚动逻辑毫无耦合，拆开后面板本体只管滚动与分页。
 * 口径：这一组**自己从 store 取状态**（`useLogPanel`），不再由面板传 props（那几个值只有这块用，传一遍只是把同一份依赖写两处，与 `SaveExportButton` 同口径）；渲染位置仍由面板决定（它在 `min-w-fit` 那个弹性容器里）。 */

import { Search } from "lucide-react";
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Input } from "~/components/ui/input";
import { useLogPanel } from "./LogProvider";
import { FILTER_SELECTED_ITEM_STYLES } from "./log-row-style";
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

export const FILTER_LABELS: Array<{ label: string; value: LogFilter }> = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

/**
 * 级别按钮上的计数数字：**定宽 + 右对齐 + 等宽数字**。四个按钮上的 `0 / 12 / 3 / 1822` 宽度不一，
 * 按钮再等分也读不齐，所以给显式 `w-[4ch]`——「文字 + 四位数字」是固定预算，文本长度不再随内容变。
 * 数字本身不按级别染色（`text-ink-fainter`）：级别色已由同一行左侧的**标签文字**承担，避免两个色块互相稀释。
 */
function CountChip({ value }: { value: number }) {
  return (
    <span className="text-ink-fainter text-2xs w-[4ch] shrink-0 text-right tabular-nums">
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
      {/* 容器承担两件事：① 它就是弹性空间——五个按钮等分富余宽度，右侧控件被顶到最右；多一个
          `flex-1` 只会平分、空白又回来。② `min-w-fit`（ISSUE #1695）取内容固有宽度，放不下就整组
          换行；此前 `min-w-56`（224px）小于按钮固有宽（约 406px），容器被压而按钮压不下去，溢出那截
          （overflow 默认 visible）画到搜索框上，且 `flex-wrap` 判 flex base size 而非溢出内容、永不换行。 */}
      <ToggleGroup
        aria-label="日志级别筛选"
        className="ml-3 min-w-fit flex-1 basis-0 gap-1"
        multiple={false}
        onValueChange={(vals) => {
          const next = vals[0];
          if (
            typeof next === "string" &&
            (next === "all" ||
              next === "debug" ||
              next === "info" ||
              next === "warn" ||
              next === "error") &&
            next !== filter
          ) {
            setFilter(next);
          }
        }}
        value={[filter]}
      >
        {FILTER_LABELS.map((option) => (
          <ToggleGroupItem
            /* `min-w-fit` 取**内容固有宽度**：`min-w-0` 会让容器忽略固有宽度、「警告」被切成 `警…`
             * （ISSUE #262）；它与上面容器的 `min-w-fit` 同源（ISSUE #1695 的溢出正是两者脱节）。
             * 选中态不能只靠 `data-pressed:bg-muted`（`--color-subtle` 浅色下与行头同值，ISSUE #609），
             * 故显式挂 `FILTER_SELECTED_ITEM_STYLES`（底色 + 描边 + 字重）；`LEVEL_LABEL_STYLES` 是级别语义色。 */
            className={`flex h-9 min-w-fit flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs leading-none transition-colors ${LEVEL_LABEL_STYLES[option.value]} ${
              option.value === filter ? FILTER_SELECTED_ITEM_STYLES : ""
            }`}
            key={option.value}
            title={`当前来源的${option.label}：${originCounts[option.value]} 条（该来源共 ${originCounts.all} 条 · 警告 ${originCounts.warn} · 错误 ${originCounts.error}）`}
            value={option.value}
          >
            <span className="whitespace-nowrap">{option.label}</span>
            <CountChip value={originCounts[option.value]} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Search 紧跟在级别按钮之后（不再 `ml-auto`）：行头稀有宽度应优先给**类别与条数**。
          搜索框偶尔才用一次，却吃掉 `ml-auto` 多出的全部空间，把来源下拉顶在级别按钮旁、中间空出
          一大片（用户截图红框正是它），左侧四位数计数反而最挤；现在下拉右移贴住搜索框，空隙由 `flex-1` 吸收。 */}
      {/* 搜索框可收缩（`shrink` + `min-w`）：行头窄到放不下时它先让位，
          而不是去挤筛选器的标签。`w-56` 是它舒展时的宽度。 */}
      <div className="relative flex w-56 min-w-24 shrink items-center">
        <Search className="text-ink-fainter pointer-events-none absolute left-2.5" size={14} />
        <Input
          className="border-border-strong bg-canvas-deep text-ink-field placeholder:text-ink-fainter focus-visible:border-primary-500/40 focus-visible:ring-primary/30 h-8 rounded-lg pr-7 pl-8 text-sm"
          onChange={textHandler(setSearch)}
          placeholder="搜索日志（支持命中高亮）..."
          type="text"
          value={search}
        />
        {search && (
          <Button
            className="text-ink-muted hover:text-ink absolute right-2"
            onClick={() => {
              setSearch("");
            }}
            size="icon-xs"
            variant="ghost"
          >
            ×
          </Button>
        )}
      </div>
    </>
  );
}
