"use client";

import type { ReactNode } from "react";

import type { WorkspaceView } from "./NavItems";

/**
 * 各视图那句「偶尔才需要读」的解释 —— 全库唯一出处（规范 §12.18）。
 *
 * 它渲染成顶栏（`TopBar`）视图标题右侧的一枚悬浮「说明」按钮：屏内页头
 * **不再**重复显示标题，也不再有第二颗问号（同一句话在一屏里说两遍正是
 * ISSUE #1693 要治的病）。没有登记的视图不渲染那颗按钮（「没有说明的不显示」）。
 *
 * 为什么收成注册表而不是让每个视图各自往 `PageHeader` 传 `help`：那句话的宿主
 * 从屏内页头换成了顶栏之后，视图自己够不着顶栏 —— 各写一份就会漂（历史那句
 * 与队列那句曾经只差一个句号，却没人发现）。名字也从 `NavItems` 的注册表取，
 * 与侧栏 / 页签同一个出处。
 *
 * 注意 `/models` 独立路由页：那一页不在 `AppShell` 里、没有顶栏 —— 它挂的就是
 * 工作区这份实现（`studio/ModelLibrary`，#2424 退役浏览版后两处同源），说明
 * 按钮只渲染在壳内的顶栏上，壳外不渲染（`models` 的说明已登记在上面）。
 */
const VIEW_HELP: Partial<Record<WorkspaceView, ReactNode>> = {
  history: "所有生成任务与执行日志，按时间倒序排列。",
  queue: "每 2 秒读一次本机后端；位次按提交先后排，第 1 位就是下一个开跑的。",
  comfyui:
    "出图后端自己的屏：在不在跑、开起来 / 关下去、以及每一次启动的日志。路径与端口在「设置 → 创作后端」里配。",
  models:
    "本机 ComfyUI 能用哪些 —— 按扫描目录分类，每个目录即一种独立的模型类型。",
  library: "参考图、音效、成片片段 —— 按分类管，可直接拖进画布或工坊。",
  console: "在项目根执行命令；命令与其子进程在切走视图或点「停止」时一并回收。",
  "model-adapters":
    "为远端模型配置工坊各模式下的输入 / 输出：统一输入映射到该接口请求体的字段名，产物按字段路径提取。",
  settings:
    "全部设置在同一页里：左侧是目录，点一项滚到那一节，右侧只有一根滚动条。ComfyUI 的启动 / 关闭与日志在侧栏「ComfyUI」页。",
  "mode-contract":
    "每种模式的统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器。契约是模式级的全局口径，与具体接口无关（接口字段映射在「模型适配」里配）。",
};

/** 某视图的说明文案；没有登记（没有说明）时返回 `undefined` —— 调用方据此不渲染按钮。 */
export function viewHelp(view: WorkspaceView): ReactNode | undefined {
  return VIEW_HELP[view];
}
