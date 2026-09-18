/* ── 「陈旧实例」告警的单一事实（可判定的 why + 用户该怎么做）─────────────
 * 背景（ISSUE #389）：桌面壳 / dev server 长开时，`src/` 的前端源码由 HMR
 * 自动生效——**但已经挂载的组件不会因此重建**。store 实例在挂载时创建一次，
 * 它身上的「动作集合」是那一刻从模块取到的函数；而动作本身是模块成员，会随
 * 热更新整体替换。于是出现一个稳定窗口：
 *
 *   · 拉了新提交（或改了 store 源码），窗口一直开着、页面没重载；
 *   · 这个时期新声明的动作不在旧实例上 → 直接调用抛 `xxx is not a function`；
 *   · 它被 ErrorBoundary 接住 → 整块画布打成错误页（用户看到的就是白屏）。
 *
 * 这类崩溃不是代码缺陷，而是「运行中的模块图停在了改动之前」。技术上由
 * `callStoreAction` 降级（跳过本次调用、不抛错），但**只降级不告知**等于把问题
 * 藏起来：用户看到某个增强动作静默失效，却不知道重载一次就全好了。既然触发
 * 这件事的事实是可知的（「当前页面已经跑过一段代码更新」+「某个动作不在实例
 * 上」），就该把它变成应用内通知，而不是等用户来问。
 *
 * 本模块只做**判据与文案**（规范 17 §17.2 第①层：纯函数、无 React、无 IO），
 * 便于直接单测；「谁在什么时候检测、怎么提示」在 hook / 组件层接线。
 */

/** 陈旧实例的成因：动作不在当前 store 实例上。 */
export type StaleStoreReason = "missing-store-action";

/** 需要向用户提示陈旧实例的条件（全部由调用方提供的**事实**派生）。 */
export interface StaleStoreSignalInput {
  /** 页面已运行过一段代码更新（加载时 / 运行中），此刻的运行图不保证是当前源码。 */
  codeUpdatedSinceLoad: boolean;
  /** 本次「调用 store 动作」因动作不在实例上而跳过。 */
  reason: StaleStoreReason | null;
}

/** 陈旧实例提示的收敛结果：该不该告知、告知什么。 */
export interface StaleStoreNotification {
  /** 一句话标题（toast / 消息中心列表行）。 */
  title: string;
  /** 概要（toast 第二行，短）。 */
  summary: string;
  /** 正文（消息中心全屏可读，含「怎么办」）。 */
  body: string;
}

/** 陈旧实例的**唯一**解法：重载一次，让运行图重新对齐当前源码。 */
export const STALE_STORE_RELOAD_STEPS = [
  "在桌面窗口里按 Ctrl+R 重新加载页面（浏览器 / 开发态同理）；",
  "如果窗口里正是「工作流编辑器」这类全屏视图，也可以先关掉再打开——它挂载时重取一次模块；",
  "仍然报同样的错，说明应用服务（dev server）自身也是旧的：关掉应用窗口重新启动一次。",
] as const;

/** 提醒用户「不会丢」的事实：工作流与画布数据都在服务端，重载不等于丢掉工作。 */
export const STALE_STORE_SAFETY_NOTE =
  "重载只是让页面重新取一份最新代码，已保存的工作流与画布数据不受影响。" +
  "唯一要注意的是：正在执行中的生成任务会随页面重载断开与执行日志的连接，" +
  "任务本身仍在服务端跑，可在执行记录里回看。";

/**
 * 把两个事实折叠成「是否提示 + 提示什么」。
 *
 * 为什么两个条件缺一不可：
 *   · 只有「动作缺失」而没有「跑过代码更新」时，原因多半是别的东西（模块
 *     循环依赖、构建缓存损坏），把「重载页面」当结论就是误导；
 *   · 只有「跑过代码更新」而没有观测到动作缺失时，一切正常，不该打扰用户
 *     （HMR 覆盖了绝大多数场景，能静默生效）。
 */
export function deriveStaleStoreNotification(
  input: StaleStoreSignalInput,
): StaleStoreNotification | null {
  if (!input.codeUpdatedSinceLoad || input.reason === null) return null;

  const steps = STALE_STORE_RELOAD_STEPS.map((s, i) => `${i + 1}. ${s}`).join(
    "\n",
  );
  const body = [
    "应用在运行期间拉取到了新代码，但当前页面还停留在改动之前的模块上，",
    "所以刚新增的部分能力在旧组件实例上不存在（表现为某个功能静默失效，",
    "或整块画布被打成错误页）。这属于运行态与源码不一致，不是工作流本身坏了。",
    "",
    "怎么做：",
    steps,
    "",
    STALE_STORE_SAFETY_NOTE,
  ].join("\n");

  return {
    title: "页面还跑着上一版代码，建议重载",
    summary: "检测到新代码生效后仍有旧组件实例，重载一次即可恢复到最新版本。",
    body,
  };
}
