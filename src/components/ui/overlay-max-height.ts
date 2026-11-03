/**
 * 浮层的最大高档（规范 17 §17.2 第①层：常量 + 纯派生，无 React、无 DOM）。不把档位做成 `@theme` 的 `--max-height-*`：`cn("max-h-[85vh]", "max-h-overlay")` 会两条都留（tailwind-merge 认不出自定义名字的族），存字面量族则同族冲突照常生效（`max-h-[85vh]` + `max-h-[70vh]` 只留后者）。
 * 两档来自实测：85vh 是居中模态 / 图片看全 / 下拉式弹层面板的事实档（并入 78vh、90vh 两个漂移值）；70vh 是页面内自滚卡片区，角色不同。刻意不收 `WorkflowNodeJsonPopover` 的 60vh 与 `ConsoleView` 的 `max-h-[45%]`（百分比不同族）。
 */

/** 浮层主体（模态 / 看全 / 弹层面板）的上限：留出 15vh 让页面不被顶满。 */
export const OVERLAY_MAX_HEIGHT = "max-h-[85vh]";

/** 页面内自滚动区域的上限：比浮层矮一档，周围内容要留呼吸。 */
export const EMBEDDED_SCROLL_MAX_HEIGHT = "max-h-[70vh]";
