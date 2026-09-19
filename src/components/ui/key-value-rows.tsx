"use client";

import type { ReactNode } from "react";

import { displayValue } from "~/lib/display-value";
import { cn } from "~/lib/utils";

/**
 * KeyValueRows —— 「把一个对象渲染成键值行」的唯一出口（规范 16 §16.2.4.20）。
 *
 * 此前全库有 5 处各写一遍「标签 + 值 + 空值占位」的行，形态各不相同：
 *
 * | 落点 | 形态 |
 * | --- | --- |
 * | `ProjectOutputs` 的参数表 | 行内左右分布 + 隔行底色 + 外层圆角边框 |
 * | `HistoryDetailModal` 的生成参数卡 | 网格卡片 + 标签在值左侧 + 行下 `hint` |
 * | `HistoryDetailModal` 的参数表 | HTML `<table>` 两列（左列等宽截断） |
 * | `TrainingStudio` 的 Metrics | 网格 + 标签在值上方 |
 * | `BrowserStatusBar` 的显存 / 内存 | 行内 label + value + 尾注 |
 *
 * 同一件事（一行键值）有四种布局语言、五份 `map`，而**「空值显示什么」**
 * 早由 `~/lib/display-value` 的 `displayValue` 收口（P8）—— 也就是说
 * 剩下的只有**布局**这一层没有被说出来。本组件收的就是这一层。
 *
 * ## 四种 layout
 *
 * - `rows`（缺省）：一行一对，标签左、值右，值走等宽字体；整块可加外框与
 *   隔行底色（`bordered` / `striped`）。适合参数表这类「扫一眼读数值」。
 * - `stacked`：标签在值**上方**，多列网格；`hint` 落在值下面一行。
 *   适合仪表盘指标（训练步数 / 触发词 / 底模）。`itemClassName` 可把它
 *   改回「标签在值左侧」（传 `flex-row items-baseline`）。
 * - `table`：真正的 `<table>`，`<th scope="row">` 声明行表头。
 *   适合两列参数表（左列等宽截断）。
 * - `inline`：`label value` 挤在一行不换行的内联项，用于状态栏。
 *
 * ## 值与缺值
 *
 * `value` 支持两种写法：
 * - **已渲染的节点**（`ReactNode`）—— 调用方自己决定怎么显示（含链接、徽章）；
 * - **原始值**（`raw`）—— 交给 `displayValue`，`null` / `undefined` / `""`
 *   自动给占位符 `—`。**这两个字段互斥**：本来就是「值怎么来」的单选题，
 *   留两个可选字段即可，不必再包一层。
 *
 * 形态：`<KeyValueRows bordered striped items={…} />`，`items` 的每一项是
 * 「`key` + `value`」或「`key` + `raw`」—— 前者给**已渲染好的值**（可含徽标 /
 * 链接，例如 `displayValue(o.seed)`），后者给**原始值**（缺值交给
 * `displayValue` 处理）。
 *
 * ⚠️ **它不管「取哪些字段」**：那是域判据（哪些参数该露、哪些被过滤掉），
 * 留在调用处的派生函数里（如 `history-detail-derive` 的 `deriveParamRows`）。
 */

export interface KeyValueItem {
  /** 标签（键）。纯文本，或已渲染节点（含徽标 / 图标等）。 */
  key: ReactNode;
  /** React 列表 key：`key` 是节点或同块里标签重名时必须显式给。 */
  id?: string;
  /** 已渲染的值。与 `raw` 二选一。 */
  value?: ReactNode;
  /** 原始值，交给 `displayValue` 处理缺值。与 `value` 二选一。 */
  raw?: unknown;
  /** 值下方的补充说明（仅 `stacked` 渲染；`rows` / `inline` 忽略）。 */
  hint?: ReactNode;
  /** 覆盖本行容器的类名（如 `stacked` 里让某项跨列）。 */
  itemClassName?: string;
  /** 覆盖本行「值」的类名（如给某个值单独上色）。 */
  valueClassName?: string;
  /** 悬停提示。 */
  title?: string;
}

export type KeyValueLayout = "rows" | "stacked" | "inline" | "table";

/** 取标签的文本形式，供 React `key` 兜底（`key` 允许是节点）。 */
function itemLabelText(item: KeyValueItem): string {
  return typeof item.key === "string" ? item.key : (item.id ?? "row");
}

function renderValue(item: KeyValueItem, mono: boolean): ReactNode {
  if (item.value !== undefined) return item.value;
  const text = displayValue(item.raw);
  return mono ? <span className="font-mono">{text}</span> : text;
}

export function KeyValueRows({
  items,
  layout = "rows",
  columns = 2,
  bordered = false,
  striped = false,
  mono = true,
  className,
  itemClassName,
  keyClassName,
  valueClassName,
}: {
  items: readonly KeyValueItem[];
  /** 布局语言，见文件头。 */
  layout?: KeyValueLayout;
  /** `stacked` 的列数（`rows` / `inline` 忽略）。 */
  columns?: 1 | 2 | 3;
  /** `rows`：整块加外框（圆角 + 描边 + 裁切）。 */
  bordered?: boolean;
  /** `rows`：隔行底色。 */
  striped?: boolean;
  /** 值是否走等宽字体（数值 / 路径 / 标识符传 true，文案传 false）。 */
  mono?: boolean;
  className?: string;
  itemClassName?: string;
  keyClassName?: string;
  valueClassName?: string;
}) {
  if (items.length === 0) return null;

  if (layout === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        {items.map((item) => (
          <span
            key={item.id ?? itemLabelText(item)}
            className={cn(
              "inline-flex items-center gap-1",
              itemClassName,
              item.itemClassName,
            )}
            title={item.title}
          >
            <span className={cn("text-ink-muted", keyClassName)}>
              {item.key}
            </span>
            <span
              className={cn(
                "text-ink-bright",
                valueClassName,
                item.valueClassName,
              )}
            >
              {renderValue(item, mono)}
            </span>
          </span>
        ))}
      </span>
    );
  }

  if (layout === "stacked") {
    const colClass =
      columns === 1
        ? "grid-cols-1"
        : columns === 3
          ? "grid-cols-2 sm:grid-cols-3"
          : "grid-cols-2";
    return (
      <div className={cn("grid gap-x-4 gap-y-3", colClass, className)}>
        {items.map((item) => (
          <div
            key={item.id ?? itemLabelText(item)}
            className={cn(
              "flex min-w-0 flex-col gap-0.5",
              itemClassName,
              item.itemClassName,
            )}
            title={item.title}
          >
            <span className={cn("text-ink-fainter text-[10px]", keyClassName)}>
              {item.key}
            </span>
            <span
              className={cn(
                "text-ink-field truncate text-[13px] font-medium",
                valueClassName,
                item.valueClassName,
              )}
            >
              {renderValue(item, false)}
            </span>
            {item.hint !== undefined && (
              <span className="text-ink-muted/80 text-[10px] leading-tight">
                {item.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (layout === "table") {
    /* 真正的 `<table>`：语义上是「参数表」，不是卡片行。用 `th scope="row"`
     * 声明行表头，读屏器读得出「哪个标签对应哪个值」—— 此前手写的两列
     * `<table>` 用的是 `<td>`，语义是空的。 */
    return (
      <div
        className={cn(
          "border-border-subtle overflow-hidden rounded-lg border",
          className,
        )}
      >
        <table className="w-full text-[11px]">
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id ?? itemLabelText(item)}
                className={cn(
                  "border-border-subtle border-b last:border-b-0",
                  item.itemClassName,
                )}
              >
                <th
                  scope="row"
                  title={item.title}
                  className={cn(
                    "border-border-subtle bg-card w-[36%] max-w-[180px] truncate border-r px-2.5 py-1.5 text-left align-top font-mono",
                    keyClassName,
                  )}
                >
                  {item.key}
                </th>
                <td
                  className={cn(
                    "text-ink-bright px-2.5 py-1.5 text-left font-normal break-words",
                    valueClassName,
                  )}
                >
                  {renderValue(item, mono)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  /* layout === "rows"：标签左、值右。 */
  return (
    <div
      className={cn(
        bordered && "border-border-strong overflow-hidden rounded-lg border",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.id ?? itemLabelText(item)}
          className={cn(
            "flex items-center justify-between gap-3 text-[12px]",
            bordered ? "px-3 py-2" : "py-1",
            striped && index % 2 === 0 && "bg-subtle",
            bordered && index > 0 && "border-border-subtle border-t",
            itemClassName,
            item.itemClassName,
          )}
          title={item.title}
        >
          <span className={cn("text-ink-muted", keyClassName)}>{item.key}</span>
          <span
            className={cn(
              "text-ink-bright min-w-0 truncate text-right",
              mono && "font-mono",
              valueClassName,
              item.valueClassName,
            )}
          >
            {renderValue(item, false)}
          </span>
        </div>
      ))}
    </div>
  );
}
