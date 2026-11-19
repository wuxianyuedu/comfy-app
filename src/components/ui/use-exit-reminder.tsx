"use client";

// 「离开这一屏就丢掉现场」的唯一出口（规范 10.3.1 / 06 §6.7 第③档）：无 JS 的 CSS 过渡（`animation` + `:has()`），
// 零运行时状态、零定时器，与服务端渲染兼容。只做「离开会丢现场」这一族；路由 / 页签切换不做 —— 本仓库只有
// 全屏 `loading.tsx`，做出来是更长的白屏。不是确认对话框（`window.confirm` 会卡住 webview），也不用 JS 定时器
// （卸载期 `setState` / 连点覆盖 / 时长散落）。扩展落点：`globals.css` 加 `[data-exit-reminder]:has(<信号>)`，并把
// `<ExitReminder>` 放进**被导航整体替换掉的容器**；挂留驻祖先上永远不亮，这是最可能的静默失效方式。

/**
 * 「离开就丢」的提示条：默认**不占位、不可见** —— 没命中 `:has()` 信号时整条 `display: none`，
 * 所以可在任何容器里无条件渲染，不必让调用处先算「现在该不该显示」。用 `role="status"` 而不是
 * `alert`：它是「当前状态」的播报（这件事一直在），不是「刚刚发生了什么」，读屏只通知一次。
 */
export function ExitReminder({
  children,
  className = "",
}: {
  children: React.ReactNode;
  /** 额外类名（内边距 / 圆角这类**布局**决定由调用处给）。 */
  className?: string;
}) {
  // 属性段落里不要插 JSX 花括号注释：它只能出现在子节点位置，写在属性之间会把
  // 属性段整段截断。
  return (
    // 文案本身是给读屏与「CSS 规则没命中」两种情况用的兜底 —— 后者不会发生
    // （`:has()` 在 Chromium 111+ 一定支持），但 `display:none` 的元素仍会被
    // 读屏的虚拟光标读到，写清楚总比留空好。
    <p className={className} data-exit-reminder="" role="status">
      {children}
    </p>
  );
}

/** 「这一屏有会丢的东西」的**信号**注册，挂在**提供信号的元素**上。用 `data-` 属性而不是 class：属性是给 CSS 判据读的、
 * class 是给样式读的，混在一起后「这条 class 还有没有消费者」就数不清了（规范 03 §3.6.1.1「豁免会过期」的教训）。
 * 值为 `undefined` 即「没有会丢的东西」，属性整条消失、与不写等价，调用处不必再写三元。 */
export function exitReminderSignal(active: boolean): {
  "data-dirty": string | undefined;
} {
  return { "data-dirty": active ? "" : undefined };
}
