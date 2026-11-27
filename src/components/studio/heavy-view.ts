/**
 * 非活跃视图降级的判据（ISSUE #4677 三屏 → #4878 扩面 → #5196 收口）。
 *
 * 采用「默认降级 + 显式例外」而不是手写白名单：白名单与 `NavItems` 注册表、
 * `LazyViews` 懒加载表三处各说各话，后续新增的资源库视图只改了注册表与懒加载表，
 * 漏进白名单，切走仍全量渲染（#5196）。判据反过来写后，任何能作为页签打开的
 * 新视图自动纳入降级，例外只需为「隐藏期状态不可丢」的屏显式登记。
 *
 * 放在 components/studio 而非 lib：它是视图栈自己的渲染策略，不构成跨层地基。
 */

import type { WorkspaceView } from "./NavItems";

/**
 * 隐藏期不做降级的视图 —— 默认降级，只有这两屏显式例外。
 *  · `home` —— 默认入口、极轻，常驻省一次切回重挂；
 *  · `project` —— ReactFlow 的视口 / 选中 / 撤销栈在组件内部，降级要逐状态评估
 *    可丢性（#4677 留的题），风险与收益另算，不在这轮顺手改。
 *
 * 其余全局视图（含资产 / 角色 / 风格 / 脸 / 服饰 / 装饰等资源库）默认降级：
 * `Activity` 的 hidden 模式保留组件内部状态、隐藏期零渲染；生成态轮询已由
 * `pauseWhenViewHidden` / `enabled: isTabActive` 门控，切回时 effects 重挂补一拍。
 */
const NO_DEGRADE_VIEWS = new Set<WorkspaceView>(["home", "project"]);

/** 某视图在页签切走时是否应经 `HeavyViewGate` 降级为「DOM 摘除但状态保留」。 */
export function isHeavyView(view: WorkspaceView): boolean {
  return !NO_DEGRADE_VIEWS.has(view);
}
