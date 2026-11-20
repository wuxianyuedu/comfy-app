"use client";

import { useEffect, useState } from "react";

/**
 * useDebouncedValue —— 「高频输入 → 低频消费」的**值侧**唯一出口（规范 16 收口）。
 *
 * 返回 `value` 的防抖副本：`value` 停止变化达 `delayMs` 后才跟上；窗口内的
 * 连续变更只保留最后一次。典型用途是把**重计算**（markdown 解析 / 搜索 /
 * 过滤）喂给防抖值，而输入本身（受控 input / textarea）仍吃实时 `value` ——
 * 即「编辑不延迟，消费降频」。
 *
 * 与邻居分工：`use-throttled-progress` 管**进度回调**的节流（单调读数取
 * 节流，防抖会推迟到安静之后）；本出口管**派生值**的防抖（重解析宁可慢半拍，
 * 也不要逐键全量跑，见 #4610）。事件侧（点击 / 输入回调防抖）不在这里 ——
 * 那是回调侧的事，别把回调包进本 hook。
 *
 * 卸载安全：清理时清掉定时器，卸载后不会再写 state。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
