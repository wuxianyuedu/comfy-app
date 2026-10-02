"use client";

/**
 * 日志行的渲染层（从 `LogPanel.tsx` 拆出）。
 *
 * 拆分的理由是**文件行数**（规范 §12.6 的 900 行棘轮）：面板本体已经同时
 * 承担「筛选 / 分页 / 虚拟滚动 / 锚定」与「怎么画一行」两件事，而后者是完全
 * 自洽的一块 —— 行内分片缓存、关键词高亮、行级复制按钮都只被 `LogRow` 使用，
 * 与面板状态没有耦合。拆开之后两边的改动面互不牵连：调行内配色不必再进
 * 一个 1200+ 行的文件里定位。
 *
 * 契约（面板侧依赖的，拆走后不许改）：
 *   `LogRow` 的入参（entry / wrap / keyword / style）与 `data-log-*` 标记；
 *   换行与行高口径必须与 `log-virtual` 的 `LOG_ROW_SINGLE` / `LOG_ROW_LINE`
 *   一致（那个模块的注释指向的就是这里）。
 */

import React, { memo, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { formatEntryForClipboard, type LogEntry } from "./log-store";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Hint } from "~/components/ui/hint";
import { JsonViewer } from "~/components/ui/json-viewer";
import {
  copyFailureText,
  useCopyFeedback,
} from "~/components/ui/use-copy-feedback";
import { isCliJsonLine, parseCliJsonLine } from "~/lib/log/log-cli-json";
import { findLogPathTokens } from "~/lib/log/log-path-tokens";
import { normalizeNeedle } from "~/lib/list-filter";
import { useFlashState } from "~/components/ui/use-flash-state";
import { formatTime } from "./log-format";
import { useRevealLogPath } from "./use-reveal-log-path";
import { LOG_ROW_EXPANDED, LOG_ROW_SINGLE } from "./log-virtual";
import {
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  LOG_ROW_TEXT_ATTRIBUTE,
  TOKEN_CLASS,
  rowFragments,
  type RowToken,
} from "./log-row-style";

/* 逐消息渲染缓存：一条已解析的日志行是不可变的，所以我们按原始
 * 消息串缓存产出的片段列表。这避免了在父级每次重渲染时
 *（搜索、筛选、滚动、新日志到达）对每一行重跑
 * ANSI / token 解析器 —— 旧面板里最大的单项开销。
 * 内存由 RENDER_CACHE_MAX 限制（溢出时整体清空）。开发注记：
 * Fast Refresh 会在编辑时重执行本模块，所以规则变化天然
 * 从空缓存开始 —— 无需清理陈旧条目。 */
const FRAGMENT_CACHE = new Map<string, RowToken[]>();
const FRAGMENT_CACHE_MAX = 5000;

/* 搜索命中 `<mark>` 高亮——琥珀是"荧光笔"的通用视觉语言、不是状态色
 * (warning-strong 会把「搜索到」误读为「警告」)。没有对应的"命中/高亮"
 * 语义 token → §3.6.1 例外块。 */
// p71-allow:start 搜索命中 `<mark>` 高亮——荧光笔装饰色、非状态语义、无匹配 token
const SEARCH_HIT_CLASS =
  "rounded-sm bg-amber-400/30 px-0.5 text-amber-900 dark:text-amber-100";
// p71-allow:end

function fragmentsOf(text: string): RowToken[] {
  const hit = FRAGMENT_CACHE.get(text);
  if (hit) return hit;
  const out = rowFragments(text);
  if (FRAGMENT_CACHE.size >= FRAGMENT_CACHE_MAX) FRAGMENT_CACHE.clear();
  FRAGMENT_CACHE.set(text, out);
  return out;
}

function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  const fragments = fragmentsOf(text);
  /* 归一化走 `~/lib/list-filter`（规范 16 §16.2.4.16）：它与 `matchesSearch`
   * 必须同一口径 —— 命中判据折了小写而高亮没折，会出现「行被选中但字没高亮」。 */
  const needle = normalizeNeedle(keyword);
  return (
    <>
      {fragments.map((fragment, index) => {
        const className = fragment.style
          ? TOKEN_CLASS[fragment.style]
          : undefined;
        return (
          <span key={index} className={className}>
            {highlightNeedle(fragment.text, needle)}
          </span>
        );
      })}
    </>
  );
}

/** 把一段文本按命中关键字切成 `<mark>` 与普通文本两种片段。 */
function highlightNeedle(text: string, needle: string): React.ReactNode {
  if (!needle) return <PathLinkedText text={text} />;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let at = lower.indexOf(needle);
  let key = 0;
  while (at !== -1) {
    if (at > cursor) {
      parts.push(
        <PathLinkedText key={`t${key}`} text={text.slice(cursor, at)} />,
      );
    }
    parts.push(
      <mark key={`m${key}`} className={SEARCH_HIT_CLASS}>
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
 * 一段文本 → 其中「像本机路径」的那几段变成可点的按钮（ISSUE #1365）。
 *
 * 用户反馈：面板里那一列路径只是紫字，看得见却点不动 —— 要打开得自己抄进资源
 * 管理器，而启动排障时正是最需要「点一下就到现场」的时候。
 *
 * 分工（三层各自有单测）：**认得出**归 `~/lib/log/log-path-tokens`（纯函数，
 * 判据在那一侧）、**点得动**归 `~/components/studio/logs/use-reveal-log-path`
 * （重入 + 成功/失败反馈）、**打得开**归 `~/lib/shell/reveal-path` 与它的路由
 * （命令形态 + 检出目录闸门）。这里只做「把区间映射成按钮」。
 *
 * 识别**在片段之内**做，不跨片段：片段是既有的视觉切分（ANSI SGR / 词法上色），
 * 而重排它的代价是让「上色」与「可点」两层互相牵制（改一处配色要连带复核点击
 * 区间）。分片边界落在路径中间的概率极低 —— 词法分片的切点是 `[OK]` / `http://`
 * 这类前缀与 Windows 路径的开头，而 `F:\a\b 与 /c` 这类行本来就因为中文与空格
 * 判据各自成段。看不清的那一段最多回到「不可点」，与今天的行为一致。
 */
function PathLinkedText({ text }: { text: string }): React.ReactNode {
  const tokens = findLogPathTokens(text);
  if (tokens.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.start > cursor) parts.push(text.slice(cursor, token.start));
    parts.push(
      <RevealPathButton key={`p${index}`} path={token.text}>
        {token.text}
      </RevealPathButton>,
    );
    cursor = token.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * 一个可点的路径。
 *
 * 视觉：仍是原来的紫字（`TOKEN_CLASS["magenta-bright"]` 那档不去动它 —— 它是终端
 * 观感的一部分），只加**下划线**与悬停高亮表达「这里能点」。刻意不改成链接蓝：
 * 这一列路径的紫是既有的视觉语言，换色会让老用户以为「路径没了」。
 *
 * 反馈：挂在按钮自己身上（与行内复制按钮同一套口径）—— 日志是密集列表，没有地方
 * 放常驻说明，而「点了有反应」这件事必须在**点的那一处**看得出来。失败的原因
 * （服务端给的那句）进 `title`，鼠标停一下就能看到。
 */
function RevealPathButton({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  /* 回执与成功态**必须同生共死**：两个独立定时器在时长一改就会漂移，留下
   * 「已定位」还在、绿色已经消失的自相矛盾画面（与 `SaveExportButton` 同款）。 */
  const hint = useFlashState(1200);
  const feedback = useRevealLogPath(() => hint.flash());

  const onReveal = () => {
    if (feedback.busy) return;
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
        type="button"
        onClick={onReveal}
        /* 悬停/聚焦都给一点底色：日志行本身就是可滚动的密集文本，只有下划线时
         * 「这一段能不能点」在长行里读不出来。 */
        className={`hover:bg-subtle focus-visible:bg-subtle h-auto cursor-pointer rounded-sm px-0.5 py-0 leading-snug underline decoration-dotted underline-offset-2 ${tone}`}
        aria-label={`在文件管理器里定位 ${path}`}
      >
        {children}
        {hint.on ? (
          <span className="ml-1 text-[10px] whitespace-nowrap">
            {feedback.outcome === "failed" ? "打开失败" : "已定位"}
          </span>
        ) : null}
      </Button>
    </Hint>
  );
}

/**
 * 一行日志末尾的复制按钮。
 *
 * 为什么必须有它（用户反馈第 2 条）：「日志多了我想复制报错文本还是复制不了，
 * 我刚选中内容就刷走了」。此前唯一的出口是标题栏上的「复制**全部**日志」——
 * 用户要的是一行，拿到的却是 2000 行，还得自己在里面搜。
 *
 * 它也让「选区」这件事变得不重要：不必先框住文本（框到一半可能被新日志/滚动
 * 打断），点一下就拿走整行。
 *
 * 反馈是本地的、按行独立的：连点不会互相覆盖，也不需要全局 toast——按钮自己
 * 在 1.2s 内显示「已复制」，且**只在成功时**改口（写剪贴板失败时说「已复制」
 * 是撒谎，反而让用户把一次失败的复制当成成功）。
 */
function RowCopyButton({ entry }: { entry: LogEntry }) {
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

  const onCopy = () => copy(formatEntryForClipboard(entry));

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
        variant="ghost"
        size="icon-xs"
        onClick={() => void onCopy()}
        aria-label="复制本条日志"
        data-log-copy=""
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
      >
        {outcome === "idle" ? (
          <Copy data-icon="inline-start" size={13} />
        ) : (
          <span className="text-[11px] whitespace-nowrap">
            {outcome === "done" ? "已复制" : "复制失败"}
          </span>
        )}
      </Button>
    </Hint>
  );
}

/**
 * 一行日志。
 *
 * `height` 由**虚拟窗口**给出（`log-virtual` 的估算高度），这里写成内联样式：
 * 估算与 `leading-snug` 的实际行高必须同口径，否则累计误差会让滚动位置与
 * 内容错开（行高常量见 `LOG_ROW_SINGLE` / `LOG_ROW_LINE`）。
 *
 * 同时 `overflow-hidden`：高度被钉死之后，内容若比估算的高就会溢到下一行上，
 * 把两行叠在一起（不换行时尤其明显）。
 *
 * comfy-cli 原始输出行（`[comfy-cli 原始] {json}`）多一条形态：折叠成一行、
 * 展开后经 `JsonViewer` 显示完整 JSON（判据与解析见 `~/lib/log/log-cli-json`）。
 * 展开**状态**归面板（`useExpansionSet`），展开**高度**归 `log-virtual` 的
 * `LOG_ROW_EXPANDED` —— 行内不自己测高，否则虚拟滚动会与内容错位。
 */
export const LogRow = memo(function LogRow({
  entry,
  wrap,
  keyword,
  expanded,
  onToggleExpand,
  style,
}: {
  entry: LogEntry;
  wrap: boolean;
  keyword: string;
  /** 该行是否处于展开态（只对可展开的原始输出行有意义）。 */
  expanded: boolean;
  /** 点标题行折叠 / 展开（`Disclosure` 的受控回调）；回调带 id 以便面板方用稳定引用。 */
  onToggleExpand: (id: string) => void;
  style: React.CSSProperties;
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
  const timeNode = (
    <time
      dateTime={new Date(entry.time).toISOString()}
      className="text-ink-muted shrink-0 tabular-nums"
    >
      {formatTime(entry.time)}
    </time>
  );
  const levelNode = (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_BADGE_STYLES[entry.level]}`}
    >
      {entry.level}
    </span>
  );
  /* 可展开行折叠态恒为一行摘要（完整内容在展开态），因此不受 `wrap` 影响。 */
  const truncated = expandable || !wrap;
  const messageTitle = expandable
    ? expanded
      ? "点击收起完整输出"
      : "点击展开完整 JSON"
    : !wrap
      ? entry.message
      : undefined;
  const messageNode = (
    <span
      /* 选区判定的落点：面板贴底前要知道「用户框选的是不是日志正文」，
       * 这个属性就是那件事的载体（见 selectionInsideLogs）。 */
      {...{ [LOG_ROW_TEXT_ATTRIBUTE]: "" }}
      className={`min-w-0 flex-1 ${
        truncated ? "truncate" : "wrap-break-word whitespace-pre-wrap"
      } ${LEVEL_TEXT_STYLES[entry.level]}`}
      title={messageTitle}
    >
      <HighlightedText text={entry.message} keyword={keyword} />
    </span>
  );
  const locationNode = location ? (
    <Hint label={`${location}（点击复制）`}>
      <Button
        variant="ghost"
        onClick={() => copyLocation(location)}
        className="text-ink-fainter hover:text-ink-soft h-auto max-w-[28%] shrink-0 cursor-pointer truncate rounded-none p-0 text-right text-[11px] font-normal whitespace-nowrap"
      >
        {location}
      </Button>
    </Hint>
  ) : null;
  const sourceNode = entry.origin ? (
    <span className="text-ink-fainter shrink-0 text-[11px]">
      {entry.origin}
    </span>
  ) : entry.source !== "console" ? (
    <span className="text-ink-fainter shrink-0 text-[11px]">
      {entry.source}
    </span>
  ) : null;
  /* 复制按钮永远在**最后一列**：它是行的终点，位置固定用户才找得到；
     `self-center` 让它在多行（换行显示）的行里也贴住垂直中线。 */
  const copyNode = <RowCopyButton entry={entry} />;

  if (!expandable) {
    return (
      <div
        style={style}
        className="border-border-subtle hover:bg-subtle/60 group flex items-start gap-2.5 overflow-hidden border-b px-4 py-1 font-mono text-[13px] leading-snug"
      >
        {timeNode}
        {levelNode}
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
      style={style}
      className="border-border-subtle hover:bg-subtle/60 group overflow-hidden border-b font-mono text-[13px] leading-snug"
    >
      <Disclosure
        open={expanded}
        onOpenChange={(next) => {
          if (next !== expanded) onToggleExpand(entry.id);
        }}
        marker="chevron"
        rootClassName="flex flex-wrap items-start gap-x-2.5 px-4 py-1"
        className="w-auto min-w-0 flex-1"
        panelClassName="basis-full"
        leading={
          <>
            {timeNode}
            {levelNode}
          </>
        }
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
          <div
            className="min-h-0"
            style={{ height: LOG_ROW_EXPANDED - LOG_ROW_SINGLE }}
          >
            <JsonViewer
              data={cliJson.value}
              title={`comfy-cli ${cliJson.tag}`}
              initialCollapsedDepth={2}
            />
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
});
