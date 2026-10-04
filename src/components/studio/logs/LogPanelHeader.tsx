"use client";

/**
 * LogPanel 的行头拆分件（§17.12 视图二次拆分：只动 JSX 物理位置，不动行为）。
 * 标题 + 级别筛选 + 来源下拉 + 操作按钮排；反馈位（复制成败）与宽度档
 * 由父组件经 props 注入。
 */
import { Check, Copy, Download, FileText, Trash2, Type, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { SaveExportButton } from "./SaveExportButton";
import { LogFilterBar } from "./LogFilterBar";
import { OriginSelect } from "./LogPanelOriginSelect";
import { WidePanelToggle, type WidePanel } from "~/components/ui/wide-panel";
import { copyFailureText } from "~/components/ui/use-copy-feedback";
import { FILTER_SELECTED_STYLES } from "./log-row-style";
import type {
  LogLevelCounts,
  LogOriginCounts,
  LogOriginFilter,
} from "./log-types";

export function LogPanelHeader(input: {
  originCounts: LogLevelCounts;
  countsByOrigin: LogOriginCounts;
  origin: LogOriginFilter | null;
  setOrigin: (value: LogOriginFilter) => void;
  wrap: boolean;
  setWrap: (updater: (prev: boolean) => boolean) => void;
  copyFailed: boolean;
  copyDone: boolean;
  copyAllAction: () => void;
  scopeLabel: string;
  total: number;
  download: () => void;
  clear: () => void;
  panel: WidePanel;
  setIsOpen: (open: boolean) => void;
}) {
  const {
    originCounts,
    countsByOrigin,
    origin,
    setOrigin,
    wrap,
    setWrap,
    copyFailed,
    copyDone,
    copyAllAction,
    scopeLabel,
    total,
    download,
    clear,
    panel,
    setIsOpen,
  } = input;

  return (
    <>
      {/* 行头：宽窗口一行，窄窗口下筛选器整组折到第二行（判据是筛选器容器的
        `min-w-56`），所以行高用 `min-h`、允许内容把它撑高而不是钉死高度。 */}
      <div className="border-border-strong bg-surface-1 flex min-h-14 shrink-0 flex-wrap items-center gap-y-1.5 border-b px-4 py-2">
        <div className="flex shrink-0 items-center gap-2">
          <FileText size={16} className="text-primary-strong shrink-0" />
          {/* 标题不可换行：换行会把行头撑高、把下面的筛选器挤成竖排单字
          （窄窗口下实测就是这样）。宽度不够时宁可让别的元素让它。 */}
          <span className="text-ink-bright text-[15px] font-semibold whitespace-nowrap">
            应用日志
          </span>
          {/* 标题旁不复述任何计数：数字的唯一出口是右侧级别按钮（同一份
          `originCounts`），完整分类数（含信息）在各按钮的悬浮说明里。 */}
        </div>

        {/* Level filters：数字是**当前来源**下的计数，与右边来源下拉同口径。
        标签与数字**同行**（标签在左、计数在右）——这是本轮之前被否掉的一种
        排法，当时的问题是它**各占一份固有宽度**、不和别人分享空间：行头一挤
        就先把筛选器压到 32px、汉字只剩竖排的余地。
        现在筛选器整组 `flex-1`：它自己就是那块弹性空间，宽度随行头伸缩，
        每个按钮等分并在有富余时一起变宽（用户诉求：「全部/警告/错误这些挤
        在一起，可以占用大些空间」；「顶部还有较大空白区域」指的就是它们与
        搜索框之间那块被 `flex-1` 空白吸走的地方）。 */}
        {/* 这个容器同时承担两件事：
        1. **它自己就是那块弹性空间**——不再另设无名空白，五个按钮等分富余
           宽度（用户诉求：「全部/警告/错误这些挤在一起，可以占用大些空间」）；
           右侧的搜索 / 来源下拉 / 操作按钮也因此被顶到最右，不必再靠一个
           单独的 `flex-1` 空白——多一个 `flex-1` 只会和它平分富余宽度，
           于是「空白又回来了」。
        2. **`min-w-56` 是折行与否的判据**：可用宽度不足 224px 时它整组落到
           第二行（`flex-wrap` 的换行单位就是这个容器）并吃掉整行宽度。
           比「每个按钮各自 min-w 后硬挤」好在：无论多窄，标签都保持可读，
           不会退化成只剩一列竖字。 */}
        <LogFilterBar originCounts={originCounts} />

        {/* 来源筛选贴最右（用户要求：中间让出来的宽度归左侧的类别与条数）。
        候选列表每项自带「条数 / 信息 / 警告 / 错误」四列——此前只有名字，
        用户必须先切过去才知道那边有没有问题（ISSUE #360）。 */}
        <OriginSelect
          value={origin ?? "all"}
          countsByOrigin={countsByOrigin}
          onChange={setOrigin}
        />

        {/* Actions */}
        <div className="flex items-center gap-1 pl-2">
          <Hint label={wrap ? "折叠超长行" : "自动换行显示"} accessibleName>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setWrap((prev) => !prev)}
              /* 选中态与级别按钮同一份：`bg-subtle` 在浅色主题下与行头底色同值。 */
              className={`rounded-md p-2 transition-colors ${
                wrap
                  ? `${FILTER_SELECTED_STYLES} text-ink-bright`
                  : "text-ink-muted hover:bg-subtle hover:text-ink"
              }`}
            >
              <Type size={16} />
            </Button>
          </Hint>
          {/* 提示写明范围：复制/下载的是**当前筛选下的全部日志**（跨所有页）。
           * 复制这枚自己带成败反馈（§16.2.4.43）—— 失败时原地换成「复制失败」
           * 并说明怎么自救，成功时短暂换成对勾。 */}
          <Hint
            label={
              copyFailed
                ? copyFailureText("日志列表")
                : `复制当前筛选的全部日志（${scopeLabel} · ${total} 条）`
            }
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={copyAllAction}
              aria-label="复制当前筛选的全部日志"
              className={`rounded-md ${
                copyFailed
                  ? "text-danger-strong"
                  : "text-ink-muted hover:bg-subtle hover:text-ink"
              }`}
            >
              {copyFailed ? (
                <span className="text-[10px] whitespace-nowrap">复制失败</span>
              ) : copyDone ? (
                /* 对勾替换掉复制图标是「按下去了」的唯一可见变化 —— 闪一下
                   （`value-tick`）把它从「图标不知什么时候换的」变成一次
                   明确的反馈；`key` 只在两态之间切换，值没变不重播。 */
                <Check
                  key="done"
                  data-icon="inline-start"
                  className="value-tick"
                  size={16}
                />
              ) : (
                <Copy key="idle" data-icon="inline-start" size={16} />
              )}
            </Button>
          </Hint>
          <Hint
            label={`下载为文本文件（当前筛选的全部日志：${scopeLabel} · ${total} 条）`}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={download}
              aria-label="下载当前筛选的全部日志"
              className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
            >
              <Download data-icon="inline-start" size={16} />
            </Button>
          </Hint>
          {/* 服务端落盘版导出（见 SaveExportButton）。 */}
          <SaveExportButton
            label={origin ?? "all"}
            scopeLabel={scopeLabel}
            total={total}
          />
          <Hint label="清空面板" accessibleName>
            <Button
              variant="ghost"
              size="icon"
              onClick={clear}
              className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
            >
              <Trash2 data-icon="inline-start" size={16} />
            </Button>
          </Hint>
          <WidePanelToggle
            panel={panel}
            className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
          />
          <Hint label="关闭 (Ctrl+Shift+L)" accessibleName>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
            >
              <X data-icon="inline-start" size={16} />
            </Button>
          </Hint>
        </div>
      </div>
    </>
  );
}
