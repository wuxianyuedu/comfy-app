"use client";

import type { ReactNode } from "react";

import { displayValue } from "~/lib/display-value";
import { cn } from "~/lib/utils";

/**
 * KeyValueRows —— 「把一个对象渲染成键值行」的唯一出口（规范 16 §16.2.4.20）。`items` 每项是 `key` + `value`（已渲染节点，可含徽标 / 链接）或 `key` + `raw`（原始值交 `displayValue`，缺值给 `—`），互斥。
 * 四档 `layout`：`rows`（标签左值右，可 `bordered` / `striped`）、`stacked`（标签在上、多列网格、`hint` 在下）、`table`（真 `<table>` + `<th scope="row">`）、`inline`（状态栏内联）。不合到 `Item`：四档只有 `rows` 能凑，其余超出其模型（P67 §12.18 已评估保留）。取哪些字段是域判据，留在调用处的派生函数。
 */

export type KeyValueItem = {
  /** 值下方的补充说明（仅 `stacked` 渲染；`rows` / `inline` 忽略）。 */
  hint?: ReactNode;
  /** React 列表 key：`key` 是节点或同块里标签重名时必须显式给。 */
  id?: string;
  /** 覆盖本行容器的类名（如 `stacked` 里让某项跨列）。 */
  itemClassName?: string;
  /** 标签（键）。纯文本，或已渲染节点（含徽标 / 图标等）。 */
  key: ReactNode;
  /** 原始值，交给 `displayValue` 处理缺值。与 `value` 二选一。 */
  raw?: unknown;
  /** 悬停提示。 */
  title?: string;
  /** 已渲染的值。与 `raw` 二选一。 */
  value?: ReactNode;
  /** 覆盖本行「值」的类名（如给某个值单独上色）。 */
  valueClassName?: string;
};

export type KeyValueLayout = "rows" | "stacked" | "inline" | "table";

/** 取标签的文本形式，供 React `key` 兜底（`key` 允许是节点）。 */
function itemLabelText(item: KeyValueItem): string {
  return typeof item.key === "string" ? item.key : (item.id ?? "row");
}

function renderValue(item: KeyValueItem, mono: boolean): ReactNode {
  if (item.value !== undefined) {
    return item.value;
  }
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
  /** `rows`：整块加外框（圆角 + 描边 + 裁切）。 */
  bordered?: boolean;
  className?: string;
  /** `stacked` 的列数（`rows` / `inline` 忽略）。 */
  columns?: 1 | 2 | 3;
  itemClassName?: string;
  items: ReadonlyArray<KeyValueItem>;
  keyClassName?: string;
  /** 布局语言，见文件头。 */
  layout?: KeyValueLayout;
  /** 值是否走等宽字体（数值 / 路径 / 标识符传 true，文案传 false）。 */
  mono?: boolean;
  /** `rows`：隔行底色。 */
  striped?: boolean;
  valueClassName?: string;
}) {
  if (items.length === 0) {
    return null;
  }

  if (layout === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        {items.map((item) => (
          <span
            className={cn("inline-flex items-center gap-1", itemClassName, item.itemClassName)}
            key={item.id ?? itemLabelText(item)}
            title={item.title}
          >
            <span className={cn("text-ink-muted", keyClassName)}>{item.key}</span>
            <span className={cn("text-ink-bright", valueClassName, item.valueClassName)}>
              {renderValue(item, mono)}
            </span>
          </span>
        ))}
      </span>
    );
  }

  if (layout === "stacked") {
    const colClass =
      columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2";
    return (
      <div className={cn("grid gap-x-4 gap-y-3", colClass, className)}>
        {items.map((item) => (
          <div
            className={cn("flex min-w-0 flex-col gap-0.5", itemClassName, item.itemClassName)}
            key={item.id ?? itemLabelText(item)}
            title={item.title}
          >
            <span className={cn("text-ink-fainter text-3xs", keyClassName)}>{item.key}</span>
            <span
              className={cn(
                "text-ink-field truncate text-sm font-medium",
                valueClassName,
                item.valueClassName,
              )}
            >
              {renderValue(item, false)}
            </span>
            {item.hint !== undefined && (
              <span className="text-ink-muted/80 text-3xs leading-tight">{item.hint}</span>
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
      <div className={cn("border-border-subtle overflow-hidden rounded-lg border", className)}>
        <table className="text-2xs w-full">
          <tbody>
            {items.map((item) => (
              <tr
                className={cn("border-border-subtle border-b last:border-b-0", item.itemClassName)}
                key={item.id ?? itemLabelText(item)}
              >
                <th
                  className={cn(
                    "border-border-subtle bg-card w-[36%] max-w-45 truncate border-r px-2.5 py-1.5 text-left align-top font-mono",
                    keyClassName,
                  )}
                  scope="row"
                  title={item.title}
                >
                  {item.key}
                </th>
                <td
                  className={cn(
                    "text-ink-bright px-2.5 py-1.5 text-left font-normal wrap-break-word",
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
          className={cn(
            "flex items-center justify-between gap-3 text-xs",
            bordered ? "px-3 py-2" : "py-1",
            striped && index % 2 === 0 && "bg-subtle",
            bordered && index > 0 && "border-border-subtle border-t",
            itemClassName,
            item.itemClassName,
          )}
          key={item.id ?? itemLabelText(item)}
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
