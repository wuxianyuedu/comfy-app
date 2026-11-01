/**
 * 设置分区导航的**树形结构**与「本节管什么」一句话（①配置层：常量 + 纯派生，无 React）。
 *
 * 两件事各有一个出处，别混：
 *   · **有哪些分区、每一项叫什么** —— 仍由 `use-settings-page-types.ts` 的
 *     `SETTINGS_SECTIONS` 一处给出（它是分区表，视图不许重抄一遍，§12.18）；
 *   · **哪几项挂在同一个分组下** + **每一项的一句话说明** —— 本模块。
 *     分组与文案都是「导航怎么呈现」的决定，与分区本身是什么无关，所以它归导航这一侧。
 *
 * ## 为什么是树，而不是一条横排 chip 带
 *
 * 顶部那条横排 chip 带把**分组名**和**分区项**排在同一行、同一种字号里
 *（`模型 本地模型 远程模型 ｜ 后端 创作后端 ｜ …`）—— 用户读到的是一串
 * 平权的词，分不清哪个是组、哪个能点（ISSUE #1694 的原始反馈：
 * 「还是树形结构显示标签吧，现在看着不舒服」）。横排的形态上限就是这样：
 * 分组只能靠一个竖线分隔符表达，而它在同一行里弱到看不见。
 *
 * 现在收成**一棵竖向的树**：分组名是父行（弱一档、不可点），分区项是它的子行
 *（缩进 + 引导线，可点、`aria-current` 落在当前项上）。层级由**缩进与引导线**
 * 表达（`~/components/ui/tree-rows` 的 `TreeChildren` 是唯一实现，§16.2.4.39），
 * 不再靠字号或分隔符暗示。溢出交给导航自己的纵向滚动条。
 *
 * `TREE_GROUPS` 里每一段都必须非空、且并集恰好等于 `SETTINGS_SECTIONS`
 *（漏项 / 多项由 `SettingsShell.test.tsx` 按 id 集合**双向比对**报红 ——
 * 静默漏项正是这张表的失效模式：某个分区从导航上消失，而界面其它地方都不会说）。
 */

import type { Section } from "~/app/(main)/settings/hooks/use-settings-page";

/** 导航树的一个分组：一个父行 + 挂在它下面的若干分区项（**顺序即渲染顺序**）。 */
export const TREE_GROUPS: Array<{
  /** 父行文案（弱一档、不是可点目标）。 */
  label: string;
  /** 挂在这一组下的分区（顺序即渲染顺序）。 */
  sections: Array<Section>;
}> = [
  { label: "模型", sections: ["llmLocal", "llmRemote"] },
  { label: "后端", sections: ["comfyui"] },
  { label: "数据", sections: ["database", "backup"] },
  { label: "应用", sections: ["appearance", "appUpdate", "exit"] },
  { label: "诊断", sections: ["logs"] },
];

/**
 * **页面的滚动顺序** = 导航树的展开顺序（分组 → 组内各项）。
 *
 * 一页到底之后导航是**目录**，「从头部滚到尾」读到的顺序必须与目录里的顺序一致
 *（否则用户按目录往下读，正文却跳到另一处）。所以顺序**从 `TREE_GROUPS` 派生**，
 * 不再直接拿 `SETTINGS_SECTIONS` —— 后者只是「有哪些分区」的清单，它的排列与
 * 导航的分组无关。
 *
 * 两项约束仍由 `SettingsShell.test.tsx` 守住：① 并集恰好等于 `SETTINGS_SECTIONS`
 *（不许漏 / 不许重）；② 每个分组至少一项（空的父行没有意义）。
 */
export const SETTINGS_SCROLL_ORDER: Array<Section> = TREE_GROUPS.flatMap((group) => group.sections);

/** 分区 → 一句话说明（导航行右侧那句）。 */
const SECTION_SUMMARY: Record<Section, string> = {
  llmLocal: "本机 Ollama 的连接、模型与按任务的温度",
  llmRemote: "OpenAI 兼容接口的模型清单，按用途分组管理",
  comfyui: "出图后端装在哪、端口与实例目录（启动与日志在侧栏「ComfyUI」页）",
  database: "本地 SQLite 的可视化浏览与运行 SQL",
  backup: "库的快照与恢复，换文件发生在下次启动",
  appearance: "主题、圆角与标题字阶",
  appUpdate: "检测并安装应用新版本",
  exit: "退出应用时后台服务是保活还是连带关闭",
  logs: "日志面板里显示哪几类来源",
};

/** 取一个分区的说明。查不到时给通用兜底（新增分区忘了补文案不该让标题行空着）。 */
export function sectionSummary(section: Section): string {
  return SECTION_SUMMARY[section] ?? "本分区的配置";
}
