"use client";

/**
 * 日志行的渲染层。行内分片缓存、关键词高亮、行级复制按钮只被此处使用，与面板状态无耦合。
 * 契约（拆走后不许改）：入参 `entry / wrap / keyword / style` 与 `data-log-*` 标记；
 * 换行与行高口径须与 `log-virtual` 的常量一致。
 */

import React, { memo, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { formatEntryForClipboard, type LogEntry } from "./log-store";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Hint } from "~/components/ui/hint";
import { LazyJsonViewer } from "~/components/ui/lazy-json-viewer";
import { copyFailureText, useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { isCliJsonLine, parseCliJsonLine } from "~/lib/log/log-cli-json";
import { findLogPathTokens } from "~/lib/log/log-path-tokens";
import { normalizeNeedle } from "~/lib/list-filter";
import { useFlashState } from "~/components/ui/use-flash-state";
import { formatTime } from "./log-format";
import { useRevealLogPath } from "./use-reveal-log-path";
import { LOG_ROW_EXPANDED, rowHeightFor, type LogDensity } from "./log-virtual";
import {
  LEVEL_BADGE_LABELS,
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  LOG_ROW_TEXT_ATTRIBUTE,
  TOKEN_CLASS,
  rowFragments,
  stripCategoryPrefixes,
  type RowToken,
} from "./log-row-style";

/* 逐消息渲染缓存：一条已解析的日志行不可变，按原始消息串缓存片段列表，避免父级每次
 * 重渲染（搜索、筛选、滚动、新日志）都对每行重跑 ANSI / token 解析——旧面板最大开销。
 * 内存由 RENDER_CACHE_MAX 限制（溢出整体清空）。Fast Refresh 重执行模块时规则变化天然从空缓存开始。 */
const FRAGMENT_CACHE = new Map<string, Array<RowToken>>();
const FRAGMENT_CACHE_MAX = 5000;

/** 密度档 → 行的上下内边距 class（与 `log-virtual` 的 `DENSITY_PADDING` 对齐，行高同口径）。
 *  三档整体下调一档（ISSUE #4716）：标准档 `py-1`（行高 28）即下调前的「紧凑」，宽松档 `py-3`
 *  （行高 44）即下调前的「标准」；新紧凑档 `py-0.5` 比原最窄档再收一档。 */
const DENSITY_PY_CLASS: Record<LogDensity, string> = {
  compact: "py-0.5",
  standard: "py-1",
  relaxed: "py-3",
};

/* 搜索命中 `<mark>` 高亮——琥珀是"荧光笔"的通用视觉语言、不是状态色
 * (warning-strong 会把「搜索到」误读为「警告」)。没有对应的"命中/高亮"
 * 语义 token → §3.6.1 例外块。 */
// p71-allow:start 搜索命中 `<mark>` 高亮——荧光笔装饰色、非状态语义、无匹配 token
const SEARCH_HIT_CLASS = "rounded-sm bg-amber-400/30 px-0.5 text-amber-900 dark:text-amber-100";
// p71-allow:end

function fragmentsOf(text: string): Array<RowToken> {
  const hit = FRAGMENT_CACHE.get(text);
  if (hit) {
    return hit;
  }
  const out = rowFragments(text);
  if (FRAGMENT_CACHE.size >= FRAGMENT_CACHE_MAX) {
    FRAGMENT_CACHE.clear();
  }
  FRAGMENT_CACHE.set(text, out);
  return out;
}

function HighlightedText({ text, keyword }: { keyword: string; text: string }) {
  const fragments = fragmentsOf(text);
  /* 归一化走 `~/lib/list-filter`（规范 16 §16.2.4.16）：它与 `matchesSearch`
   * 必须同一口径 —— 命中判据折了小写而高亮没折，会出现「行被选中但字没高亮」。 */
  const needle = normalizeNeedle(keyword);
  return (
    <>
      {fragments.map((fragment, index) => {
        const className = fragment.style ? TOKEN_CLASS[fragment.style] : undefined;
        return (
          <span className={className} key={index}>
            {highlightNeedle(fragment.text, needle)}
          </span>
        );
      })}
    </>
  );
}

/** 把一段文本按命中关键字切成 `<mark>` 与普通文本两种片段。 */
function highlightNeedle(text: string, needle: string): React.ReactNode {
  if (!needle) {
    return <PathLinkedText text={text} />;
  }
  const lower = text.toLowerCase();
  const parts: Array<React.ReactNode> = [];
  let cursor = 0;
  let at = lower.indexOf(needle);
  let key = 0;
  while (at !== -1) {
    if (at > cursor) {
      parts.push(<PathLinkedText key={`t${key}`} text={text.slice(cursor, at)} />);
    }
    parts.push(
      <mark className={SEARCH_HIT_CLASS} key={`m${key}`}>
        <PathLinkedText text={text.slice(at, at + needle.length)} />
      </mark>,
    );
    cursor = at + needle.length;
    at = lower.indexOf(needle, cursor);
    key += 1;
  }
  if (cursor < text.length) {
    parts.push(<PathLinkedText key={`t${key}`} text={text.slice(cursor)} />);
  }
  return parts;
}

/**
 * 一段文本 → 「像本机路径」的几段变成可点按钮（ISSUE #1365）。三层分工：识别归
 * `log-path-tokens`、点击归 `use-reveal-log-path`、打开归 `reveal-path` 及路由，这里只做区间→按钮。
 * 识别在分片内做；无 ANSI 行的区间取自 `findLogPathTokens`，带空格路径整条落一片。
 * 带 ANSI SGR 的行仍可能切在路径中间（尊重子进程配色，代价是可能只点得到前半截）。 */
function PathLinkedText({ text }: { text: string }): React.ReactNode {
  const tokens = findLogPathTokens(text);
  if (tokens.length === 0) {
    return text;
  }
  const parts: Array<React.ReactNode> = [];
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.start > cursor) {
      parts.push(text.slice(cursor, token.start));
    }
    parts.push(
      <RevealPathButton key={`p${index}`} path={token.text}>
        {token.text}
      </RevealPathButton>,
    );
    cursor = token.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

/**
 * 一个可点的路径。
 * 视觉：保持紫字（`TOKEN_CLASS["magenta-bright"]`，终端观感的一部分），只加下划线与悬停高亮；
 * 刻意不改链接蓝，免得老用户以为「路径没了」。反馈挂在按钮本身：失败原因（服务端那句）进 `title`。
 */
function RevealPathButton({ path, children }: { children: React.ReactNode; path: string }) {
  /* 回执与成功态**必须同生共死**：两个独立定时器在时长一改就会漂移，留下
   * 「已定位」还在、绿色已经消失的自相矛盾画面（与 `SaveExportButton` 同款）。 */
  const hint = useFlashState(1200);
  const feedback = useRevealLogPath(() => {
    hint.flash();
  });

  const onReveal = () => {
    if (feedback.busy) {
      return;
    }
    feedback.reveal(path);
  };

  /* 常态那一档**取既有 token 表**而不是再写一遍色板：路径的紫是 `TOKEN_CLASS`
   * 的 `magenta-bright`（它代表 ANSI 终端色的身份，§3.6.1 例外块），在别处手抄
   * 一份 palette 字面量，改配色时两处就会漂 —— P71 / P79 拦的正是这件事。 */
  const tone =
    feedback.outcome === "done"
      ? "text-success-strong"
      : feedback.outcome === "failed"
        ? "text-danger-strong"
        : TOKEN_CLASS["magenta-bright"];

  /* 悬停说明走 `ui/hint`（shadcn composition.md：`<Button>` 上不写原生 `title=`），
   * 而这里的文案是**动态的** —— 失败时要说清是哪个候选没找到（服务端给的那句）。 */
  const hintLabel =
    feedback.outcome === "failed"
      ? feedback.failure
      : feedback.outcome === "done"
        ? `已定位：${path}`
        : `${path}（点击在文件管理器里定位）`;

  return (
    <Hint label={hintLabel}>
      <Button
        aria-label={`在文件管理器里定位 ${path}`}
        /* 悬停/聚焦都给一点底色：日志行本身就是可滚动的密集文本，只有下划线时
         * 「这一段能不能点」在长行里读不出来。 */
        className={`hover:bg-subtle focus-visible:bg-subtle h-auto cursor-pointer rounded-sm px-0.5 py-0 leading-snug underline decoration-dotted underline-offset-2 ${tone}`}
        onClick={onReveal}
        type="button"
      >
        {children}
        {hint.on ? (
          <span className="text-3xs ml-1 whitespace-nowrap">
            {feedback.outcome === "failed" ? "打开失败" : "已定位"}
          </span>
        ) : null}
      </Button>
    </Hint>
  );
}

/**
 * 一行日志末尾的复制按钮（用户反馈第 2 条：「想复制报错文本还是复制不了，刚选中就刷走了」）。
 * 此前唯一出口是「复制全部日志」，用户要一行却拿到 2000 行，还得自己搜；它也让选区变得不重要。
 * 反馈本地、按行独立：1.2s 内显示「已复制」，且**只在成功时**改口（失败说已复制是撒谎）。
 */
/** `includeMeta=false`（精简列档）只复制正文——把列藏起来就是不想让它们混进复制结果（ISSUE #4567）。 */
function RowCopyButton({ entry, includeMeta }: { entry: LogEntry; includeMeta: boolean }) {
  const [outcome, setOutcome] = useState<"idle" | "done" | "failed">("idle");
  /* 亮起态与「到点复位、连点清旧定时器、卸载清定时器」由 hook 收口 ——
   * 此前这里自己持 `timerRef` + 自己 `clearTimeout`（全库两处这样写，
   * 另有四处裸 `setTimeout` 连卸载都不管）。日志行**会**随翻页/锚点窗口
   * 被卸载，所以这条不是洁癖：不清就是往已卸载组件上 setState。 */
  /* 本按钮的亮起时长：1.2s。比 `useFlashState` 的默认 1.5s 短 ——
   * 反馈就长在按钮自己身上（原地换字），日志行又是密集列表，
   * 「已复制」停留越久越像常驻标签。 */
  const flash = useFlashState(1200);

  /* 成败都改口（§16.2.4.43）：失败时说「已复制」是撒谎，而**只在成功时才改口**
   * 同样是撒谎的另一半 —— 用户连点几次都没反应，以为按钮坏了。 */
  const copy = useCopyFeedback({
    onSuccess: () => {
      setOutcome("done");
      flash.flash();
    },
    onFailure: () => {
      setOutcome("failed");
      flash.flash();
    },
  });

  const onCopy = () => {
    copy(formatEntryForClipboard(entry, { includeMeta }));
  };

  return (
    <Hint
      label={
        outcome === "done"
          ? "已复制本条日志"
          : outcome === "failed"
            ? copyFailureText()
            : "复制本条日志"
      }
    >
      <Button
        aria-label="复制本条日志"
        /* 悬停/聚焦才显形：日志是「长时间盯着看」的界面，一个常在的按钮列会
         * 在每行末尾多出一块常驻色块，把正文的右边界切碎。键盘 Tab 聚焦时同样
         * 显形（`focus-visible`），不然纯键盘用户点不到它。 */
        className={`shrink-0 self-center rounded transition-opacity ${
          outcome === "idle"
            ? "hover:bg-subtle hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            : "opacity-100"
        } ${
          outcome === "done"
            ? "text-success-strong"
            : outcome === "failed"
              ? "text-danger-strong"
              : "text-ink-muted"
        }`}
        data-log-copy=""
        onClick={() => {
          onCopy();
        }}
        size="icon-xs"
        variant="ghost"
      >
        {outcome === "idle" ? (
          <Copy data-icon="inline-start" size={13} />
        ) : (
          <span className="text-2xs whitespace-nowrap">
            {outcome === "done" ? "已复制" : "复制失败"}
          </span>
        )}
      </Button>
    </Hint>
  );
}

/**
 * 一行日志。`height` 由虚拟窗口给出并写成内联样式：估算与 `leading-snug` 实际行高须同口径，
 * 否则累计误差让滚动位置与内容错开；`overflow-hidden` 防止内容溢到下一行。
 * comfy-cli 原始输出行折叠成一行、展开经 `JsonViewer`；展开状态归面板，展开高度归
 * `log-virtual` 的 `LOG_ROW_EXPANDED`（行内不自己测高）。 */
export const LogRow = memo(function LogRow({
  density = "standard",
  entry,
  expanded,
  keyword,
  onToggleExpand,
  showDetails = true,
  style,
  wrap,
}: {
  /** 行密度（ISSUE #4567 的间隔配置）：行的上下内边距随档位走，与虚拟行高同口径。 */
  density?: LogDensity;
  entry: LogEntry;
  /** 该行是否处于展开态（只对可展开的原始输出行有意义）。 */
  expanded: boolean;
  keyword: string;
  /** 点标题行折叠 / 展开（`Disclosure` 的受控回调）；回调带 id 以便面板方用稳定引用。 */
  onToggleExpand: (id: string) => void;
  /** false = 精简显示：隐藏时刻 / 级别 / 位置 / 来源列与行首类别前缀，只留正文（复制也不带元信息）。 */
  showDetails?: boolean;
  /** 附加内联样式（可选）。行盒的尺寸下限由面板方的包裹层（minHeight）承载，行自身按内容自然高度渲染。 */
  style?: React.CSSProperties;
  wrap: boolean;
}) {
  /* 文件路径那枚的复制：**显式静默**失败 —— 整条路径就印在按钮上，
   * 旁边没有第二处可说的地方，而弹 toast 会盖住正在看的日志。 */
  const copyLocation = useCopyFeedback({ onFailure: "silent" });

  /* 可展开判据与解析都走共享模块的唯一口径：面板按 `isCliJsonLine` 给高度，
   * 这里按它决定要不要走 `Disclosure`，两边不会分叉。 */
  const expandable = isCliJsonLine(entry.message);
  const cliJson = useMemo(
    () => (expandable ? parseCliJsonLine(entry.message) : null),
    [expandable, entry.message],
  );

  const location = entry.location;
  /* 精简列档（隐藏时刻 / 级别 / 来源）连行首的类别前缀（`[orchestrator]` 等）一并剥掉：
   * 这一刻用户要的是最简洁的正文（ISSUE #4717）；完整档保留前缀（它们已被调成背景层 gray）。 */
  const displayMessage = showDetails ? entry.message : stripCategoryPrefixes(entry.message);
  const timeNode = (
    <time
      className="text-ink-muted shrink-0 tabular-nums"
      dateTime={new Date(entry.time).toISOString()}
    >
      {formatTime(entry.time)}
    </time>
  );
  const levelNode = (
    <span
      className={`text-2xs inline-flex h-5 w-11 shrink-0 items-center justify-center rounded-md font-medium ${LEVEL_BADGE_STYLES[entry.level]}`}
    >
      {LEVEL_BADGE_LABELS[entry.level]}
    </span>
  );
  /* 可展开行折叠态恒为一行摘要（完整内容在展开态），因此不受 `wrap` 影响。 */
  const truncated = expandable || !wrap;
  const messageTitle = expandable
    ? expanded
      ? "点击收起完整输出"
      : "点击展开完整 JSON"
    : wrap
      ? undefined
      : displayMessage;
  const messageNode = (
    <Hint label={messageTitle}>
      <span
        /* 选区判定的落点：面板贴底前要知道「用户框选的是不是日志正文」，
         * 这个属性就是那件事的载体（见 selectionInsideLogs）。 */
        {...{ [LOG_ROW_TEXT_ATTRIBUTE]: "" }}
        className={`min-w-0 flex-1 ${
          truncated ? "truncate" : "wrap-break-word whitespace-pre-wrap"
        } ${LEVEL_TEXT_STYLES[entry.level]}`}
      >
        <HighlightedText keyword={keyword} text={displayMessage} />
      </span>
    </Hint>
  );
  /* 位置分两态（ISSUE #1703）：`src/…:123` 是可点开的业务位置；`pkg → fn` 是「这条日志
   * 不是我们写的，是哪个库在哪层打的」。后者没有文件可打开，提示语必须说清「这是库」。
   * 判据用 `" → "` 而不是冒号：Windows 盘符 `C:…` 是反例，`→` 只有库那一态会产生。 */

  const isLibraryLocation = location !== undefined && location !== "" && location.includes(" → ");
  const locationHint = isLibraryLocation
    ? `${location}（库内部打出的日志，不是本项目文件；点击复制）`
    : `${location}（点击复制）`;
  const locationNode =
    showDetails && location !== undefined && location !== "" ? (
      <Hint label={locationHint}>
        <Button
          className="text-ink-muted hover:text-ink-soft text-2xs h-auto max-w-[28%] shrink-0 cursor-pointer truncate rounded-none p-0 text-right font-normal whitespace-nowrap"
          onClick={() => {
            copyLocation(location);
          }}
          variant="ghost"
        >
          {location}
        </Button>
      </Hint>
    ) : null;
  const sourceNode =
    showDetails && entry.origin ? (
      <span className="text-ink-muted text-2xs shrink-0">{entry.origin}</span>
    ) : showDetails && entry.source === "console" ? null : showDetails ? (
      <span className="text-ink-muted text-2xs shrink-0">{entry.source}</span>
    ) : null;
  /* 复制按钮永远在**最后一列**：它是行的终点，位置固定用户才找得到；
     `self-center` 让它在多行（换行显示）的行里也贴住垂直中线。
     精简列档下复制的是剥掉前缀后的正文——列都藏起来了，前缀也不该混进复制结果。 */
  const copyNode = (
    <RowCopyButton
      entry={showDetails ? entry : { ...entry, message: displayMessage }}
      includeMeta={showDetails}
    />
  );

  if (!expandable) {
    return (
      <div
        className={`border-border-subtle hover:bg-subtle/60 group flex items-start gap-2.5 overflow-hidden border-b px-4 font-mono text-sm leading-snug ${DENSITY_PY_CLASS[density]}`}
        style={style}
      >
        {showDetails && timeNode}
        {showDetails && levelNode}
        {messageNode}
        {locationNode}
        {sourceNode}
        {copyNode}
      </div>
    );
  }

  /* 可展开行：整行是 `Disclosure`（触发开关 = 标题行，面板 = JsonViewer）。
   * 面板 `basis-full` 独占一行，高度 = 行高常量 − 标题行高；用 `gap-x` 而非
   * `gap`（不要行间距，否则标题行 + 面板会超出 `LOG_ROW_EXPANDED` 而被裁掉）。 */
  return (
    <div
      className="border-border-subtle hover:bg-subtle/60 group overflow-hidden border-b font-mono text-sm leading-snug"
      style={style}
    >
      <Disclosure
        className="w-auto min-w-0 flex-1"
        leading={
          <>
            {showDetails && timeNode}
            {showDetails && levelNode}
          </>
        }
        marker="chevron"
        onOpenChange={(next) => {
          if (next !== expanded) {
            onToggleExpand(entry.id);
          }
        }}
        open={expanded}
        panelClassName="basis-full"
        rootClassName={`flex flex-wrap items-start gap-x-2.5 px-4 ${DENSITY_PY_CLASS[density]}`}
        trailing={
          <>
            {locationNode}
            {sourceNode}
            {copyNode}
          </>
        }
        trigger={messageNode}
      >
        {expanded && cliJson ? (
          <div className="min-h-0" style={{ height: LOG_ROW_EXPANDED - rowHeightFor(density) }}>
            <LazyJsonViewer
              data={cliJson.value}
              initialCollapsedDepth={2}
              title={`comfy-cli ${cliJson.tag}`}
            />
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
});
