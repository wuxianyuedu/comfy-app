"use client";
import React from "react";
import { Textarea } from "~/components/ui/textarea";

export function StringTextarea({
  value,
  mono,
  hasSize,
}: {
  value: string;
  mono?: boolean;
  hasSize: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (!hasSize) {
      // 内容自适应高度：textarea 自己决定高度，以内容封顶。
      // 不设 96px 上限：多行提示词必须完整
      // 可见，而不是被裁在行的另一半之后。
      // 先置 `auto`，好让浏览器能在取值变化后算出新的
      // scrollHeight。
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
    // hasSize：高度归 flex 链所有（父级的 `flex-1` +
    // `min-h-0`）；不动 textarea 的内联样式，让 CSS 胜出。
  }, [value, hasSize]);
  return (
    <Textarea
      ref={ref}
      readOnly
      value={value}
      rows={1}
      onFocus={(event) => event.currentTarget.blur()}
      className={
        "border-border-strong bg-canvas-deep text-ink-bright field-sizing-normal block w-full resize-none rounded border px-2 py-1.5 text-[10.5px] leading-snug focus-visible:ring-0" +
        (mono ? " font-mono" : "")
      }
      style={{
        /* `width: 100%` 占住行内 flexbox 给我们的每个像素。
         * `flex: 1 1 0` + `minHeight: 0` 在 hasSize 路径上接入行的 flex 链
         *  —— textarea 填满 STRING 行
         *  剩余的竖向空间（竖向堆叠）。此前这里
         *  有 `maxHeight: 96`；已移除，因为它会把 12 行
         *  提示词裁在行的另一半之后，正是用户报的
         *  「内容不可自适应高度，不铺满可用空间」。
         * `minWidth: 0` 覆盖默认的 `min-width: auto`，好让
         *  极宽的提示词行在交叉轴上省略
         *  而不是把标签顶出屏幕。（标签已单独占一行，此条
         *  现在无关紧要，但保留作防御。）
         * `overflowY: "auto"` 让多余内容可滚动。 */
        width: "100%",
        flex: "1 1 0",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
      }}
      title={value}
    />
  );
}
