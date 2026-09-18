/* ── 「陈旧实例」告警的送达通道（规范 17 §17.2 第②层逻辑，无 JSX）────────
 * 判据与文案在 `~/lib/stale-store-instance`（第①层纯函数），送达方式在这里，
 * 视图层（`WorkflowEditorInner`）只负责在 effect 里把观测到的事实用 `report*`
 * 记下来。这样做的原因：
 *
 *   · 触发点在最底层的 store 调用处（`WorkflowStores.callStoreAction`），
 *     而提示要出在应用级通道上（toast + 消息中心）——两者之间不能直接连线，
 *     否则底层模块会反向依赖 React 组件目录；用模块级事件收口，两边都只依赖
 *     本文件。
 *   · 同一件事会在一次会话里被多次观测（每个依赖项变化都会重跑 effect），
 *     必须在**通道层**去重，而不是指望每个调用点自己记得「只报一次」。
 *   · 模块级（非 React 状态）是刻意的：它跨「组件卸载再挂载」仍然成立，而
 *     陈旧实例恰恰活得比组件久——重开编辑器并不会让运行图变新。
 *
 * 这是本项目里唯一一处「模块级事件 + 订阅」用于跨层送达的地方，与规范 01
 * 「状态用 Zustand」的取向不同：这里传的是**一次性的通知事件**，不是状态，
 * 放进 store 反而要求消费方自行处理「读过的旧事件」。若将来出现第二种同类
 * 事件，应改为 zustand 队列而不是再加一个模块级单例。
 */

import {
  deriveStaleStoreNotification,
  type StaleStoreReason,
  type StaleStoreNotification,
} from "./stale-store-instance";

/** 应用级送达器：由挂载在根布局的 Provider 注册（toast + 消息中心）。 */
export type StaleStoreDeliver = (notification: StaleStoreNotification) => void;

let deliver: StaleStoreDeliver | null = null;
/** 本次会话是否已就陈旧实例提示过（去重的唯一状态，见文件头注释）。 */
let notified = false;
/** 本次会话是否已知「运行图可能与源码不一致」。 */
let codeUpdatedSinceLoad = false;

/** 注册送达器；Provider 卸载时传 null 注销。
 *
 *  命名刻意用 `register*` 而非 `set*`：它不是 React/zustand 的 state setter，
 *  而 `set[A-Z]*` 的命名会撞上「函数式 updater 纯净性」守卫的判定口径（见
 *  `scripts/check-react-updater-purity.cjs`）——注册回调是立即生效的副作用，
 *  不该看起来像个 state setter。 */
export function registerStaleStoreDeliver(
  next: StaleStoreDeliver | null,
): void {
  deliver = next;
}

/** 测试用：把本模块的全部会话态清回初始（生产代码不调用）。 */
export function resetStaleStoreNotify(): void {
  deliver = null;
  notified = false;
  codeUpdatedSinceLoad = false;
}

/**
 * 上报「页面已跑过一段代码更新」。由根布局的 `CodeUpdateWatcher` 在两种事实
 * 成立时调用：① 页面加载时构建标识就与当前模块不一致；② 运行期间模块被
 * 热更新替换（HMR）。前者是「页面比源码旧」，后者是「页面跑着跑着源码变了」，
 * 两种都会让已挂载组件的旧实例与新模块错位。
 */
export function reportCodeUpdatedSinceLoad(): void {
  codeUpdatedSinceLoad = true;
}

/** 当前是否已知「运行图可能与源码不一致」（供调用点判断是否需要上报）。 */
export function hasCodeUpdatedSinceLoad(): boolean {
  return codeUpdatedSinceLoad;
}

/**
 * 上报「某次 store 动作因不在当前实例上被跳过」。
 *
 * 只有同时满足「跑过代码更新」时才会真的弹提示（判据见第①层的
 * `deriveStaleStoreNotification`）——否则这类缺失多半另有原因，把「重载页面」
 * 当结论会误导用户。返回值表示本次是否**真的送达**（未送达时为 false），
 * 便于调用点/测试断言去重行为。
 */
export function reportStaleStoreAction(
  reason: StaleStoreReason = "missing-store-action",
): boolean {
  const notification = deriveStaleStoreNotification({
    codeUpdatedSinceLoad,
    reason,
  });
  if (!notification) return false;
  if (notified) return false;
  notified = true;
  deliver?.(notification);
  return true;
}
